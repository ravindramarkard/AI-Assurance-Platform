from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import db
from ..config import schedular_dir
from ..models import CreateScheduledJobRequest, UpdateScheduledJobRequest
from ..scheduler import fire_job, next_run_after, to_iso, utc_now

router = APIRouter(prefix="/api/scheduled-jobs", tags=["scheduled-jobs"])


def _enrich(job: dict) -> dict:
    return {**job, "workspace": "schedular", "workspace_path": str(schedular_dir())}


@router.get("")
async def list_jobs():
    jobs = await db.list_scheduled_jobs()
    return [_enrich(j) for j in jobs]


@router.post("")
async def create_job(body: CreateScheduledJobRequest):
    job_type = body.job_type or "agent"
    task = (body.task or "").strip()
    if job_type == "agent" and not task:
        raise HTTPException(400, "Task is required for agent jobs")
    if job_type == "api_test":
        payload = body.payload or {}
        if not payload.get("project_id"):
            raise HTTPException(400, "payload.project_id is required for api_test jobs")
        task = task or f"[api_test] Run suite for {payload.get('project_id')}"
    # Due on the next scheduler tick so the first run happens promptly
    job = await db.create_scheduled_job(
        task=task,
        name=(body.name or "").strip() or None,
        schedule=body.schedule,
        model=body.model,
        llm_provider=body.llm_provider,
        max_steps=body.max_steps,
        start_url=(body.start_url or "").strip() or None,
        system_prompt=(body.system_prompt or "").strip() or None,
        next_run_at=to_iso(utc_now()),
        enabled=body.enabled,
        job_type=job_type,
        payload=body.payload,
    )
    return _enrich(job)


@router.get("/{job_id}")
async def get_job(job_id: str):
    job = await db.get_scheduled_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return _enrich(job)


@router.patch("/{job_id}")
async def update_job(job_id: str, body: UpdateScheduledJobRequest):
    if not await db.get_scheduled_job(job_id):
        raise HTTPException(404, "Job not found")
    fields = body.model_dump(exclude_unset=True)
    if "task" in fields and fields["task"] is not None:
        fields["task"] = fields["task"].strip()
        if not fields["task"]:
            raise HTTPException(400, "Task cannot be empty")
    if "name" in fields and fields["name"] is not None:
        fields["name"] = fields["name"].strip() or None
    if "start_url" in fields and fields["start_url"] is not None:
        fields["start_url"] = fields["start_url"].strip() or None
    if "system_prompt" in fields and fields["system_prompt"] is not None:
        fields["system_prompt"] = fields["system_prompt"].strip() or None
    if "schedule" in fields and fields["schedule"]:
        fields["next_run_at"] = to_iso(next_run_after(fields["schedule"]))
    if "enabled" in fields:
        fields["status"] = "active" if fields["enabled"] else "paused"
    job = await db.update_scheduled_job(job_id, **fields)
    return _enrich(job)  # type: ignore[arg-type]


@router.delete("/{job_id}")
async def delete_job(job_id: str):
    if not await db.delete_scheduled_job(job_id):
        raise HTTPException(404, "Job not found")
    return {"ok": True, "id": job_id}


@router.post("/{job_id}/run")
async def run_job_now(job_id: str):
    job = await db.get_scheduled_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    result_id = await fire_job(job)
    refreshed = await db.get_scheduled_job(job_id)
    job_type = (job.get("job_type") or "agent").lower()
    if job_type == "api_test":
        return {
            "ok": True,
            "run_id": result_id,
            "session_id": None,
            "job": _enrich(refreshed),  # type: ignore[arg-type]
        }
    return {
        "ok": True,
        "session_id": result_id,
        "run_id": None,
        "job": _enrich(refreshed),  # type: ignore[arg-type]
    }

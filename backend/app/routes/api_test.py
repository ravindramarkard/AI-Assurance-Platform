"""API Test Console routes — OpenAPI ingest, generate, run."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from .. import db
from ..api_test import service
from ..api_test.auth import public_security
from ..models import (
    ApiAuthUpdate,
    ApiAuthorizeRequest,
    ApiIngestRequest,
    ApiOAuthCallback,
    ApiProjectCreate,
    ApiProjectScheduleUpdate,
    ApiProjectUpdate,
    ApiRequestEdit,
    ApiRunRequest,
    ApiServiceCreate,
    ApiServiceUpdate,
    ApiSingleStepRunRequest,
    ApiTestConnectionRequest,
    ApiTokenRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/api-test", tags=["api-test"])


@router.get("/projects")
async def list_projects():
    return await db.list_api_projects()


@router.post("/projects")
async def create_project(body: ApiProjectCreate):
    return await db.create_api_project(
        name=body.name.strip(),
        base_url=(body.base_url or "").strip(),
        openapi_url=(body.openapi_url or "").strip(),
        config=body.config,
    )


@router.get("/projects/{project_id}")
async def get_project(project_id: str):
    p = await db.get_api_project(project_id, include_raw=False)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@router.patch("/projects/{project_id}")
async def patch_project(project_id: str, body: ApiProjectUpdate):
    if not await db.get_api_project(project_id, include_raw=False):
        raise HTTPException(404, "Project not found")
    fields = body.model_dump(exclude_unset=True)
    if "name" in fields and fields["name"]:
        fields["name"] = fields["name"].strip()
    if "base_url" in fields and fields["base_url"] is not None:
        fields["base_url"] = fields["base_url"].strip()
    if "openapi_url" in fields and fields["openapi_url"] is not None:
        fields["openapi_url"] = fields["openapi_url"].strip()
    updated = await db.update_api_project(project_id, **fields)
    # Keep primary service mirrors aligned when legacy project fields change.
    if updated and ("base_url" in fields or "openapi_url" in fields):
        primary = await db.get_primary_api_service(project_id, include_raw=False, ensure=False)
        if primary and not primary.get("synthetic"):
            svc_fields: dict = {}
            if "base_url" in fields:
                svc_fields["base_url"] = fields["base_url"]
            if "openapi_url" in fields:
                svc_fields["openapi_url"] = fields["openapi_url"]
            if svc_fields:
                await db.update_api_service(primary["id"], **svc_fields)
                updated = await db.get_api_project(project_id, include_raw=False)
        elif primary and primary.get("synthetic") and ("base_url" in fields or "openapi_url" in fields):
            await db.ensure_primary_api_service(project_id)
            primary2 = await db.get_primary_api_service(project_id, include_raw=False)
            if primary2:
                svc_fields = {}
                if "base_url" in fields:
                    svc_fields["base_url"] = fields["base_url"]
                if "openapi_url" in fields:
                    svc_fields["openapi_url"] = fields["openapi_url"]
                if svc_fields:
                    await db.update_api_service(primary2["id"], **svc_fields)
                    updated = await db.get_api_project(project_id, include_raw=False)
    return updated


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    try:
        return await service.delete_project(project_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/projects/{project_id}/services")
async def list_services(project_id: str):
    if not await db.get_api_project(project_id, include_raw=False):
        raise HTTPException(404, "Project not found")
    return await db.list_api_services(project_id, include_raw=False, synthesize_legacy=True)


@router.post("/projects/{project_id}/services")
async def create_service(project_id: str, body: ApiServiceCreate):
    if not await db.get_api_project(project_id, include_raw=False):
        raise HTTPException(404, "Project not found")
    try:
        return await db.create_api_service(
            project_id,
            key=body.key,
            name=body.name or body.key,
            base_url=(body.base_url or "").strip(),
            openapi_url=(body.openapi_url or "").strip(),
            sort_order=body.sort_order,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.patch("/projects/{project_id}/services/{service_id}")
async def patch_service(project_id: str, service_id: str, body: ApiServiceUpdate):
    svc = await db.get_api_service(service_id, include_raw=False)
    if not svc or svc.get("project_id") != project_id:
        # Allow patching synthetic legacy id
        if not (service_id.startswith("legacy:") and service_id.endswith(project_id)):
            raise HTTPException(404, "Service not found")
    fields = body.model_dump(exclude_unset=True)
    try:
        updated = await db.update_api_service(service_id, **fields)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not updated:
        raise HTTPException(404, "Service not found")
    return updated


@router.delete("/projects/{project_id}/services/{service_id}")
async def delete_service(project_id: str, service_id: str):
    svc = await db.get_api_service(service_id, include_raw=False)
    if not svc or svc.get("project_id") != project_id:
        raise HTTPException(404, "Service not found")
    if service_id.startswith("legacy:"):
        raise HTTPException(400, "Cannot delete legacy synthetic service — create a named service first")
    ok = await db.delete_api_service(service_id)
    if ok:
        # Rebuild endpoints without the deleted service's ops
        try:
            await service._rebuild_endpoints_from_services(project_id)
        except Exception:
            logger.exception("rebuild endpoints after service delete failed")
    return {"ok": ok}


@router.post("/projects/{project_id}/services/{service_id}/ingest")
async def ingest_service(project_id: str, service_id: str, body: ApiIngestRequest | None = None):
    try:
        return await service.ingest_project(
            project_id,
            url=(body.url if body else None),
            service_id=service_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("service ingest failed")
        raise HTTPException(400, str(exc)) from exc


@router.post("/projects/{project_id}/services/{service_id}/ingest/upload")
async def ingest_service_upload(project_id: str, service_id: str, file: UploadFile = File(...)):
    raw = (await file.read()).decode("utf-8", errors="replace")
    try:
        return await service.ingest_project(
            project_id,
            raw_text=raw,
            url=file.filename,
            service_id=service_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("service ingest upload failed")
        raise HTTPException(400, str(exc)) from exc


@router.post("/projects/{project_id}/ingest")
async def ingest(project_id: str, body: ApiIngestRequest | None = None):
    """Legacy: ingest into the primary (first) service."""
    try:
        return await service.ingest_project(project_id, url=(body.url if body else None))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("ingest failed")
        raise HTTPException(400, str(exc)) from exc


@router.post("/projects/{project_id}/ingest/upload")
async def ingest_upload(project_id: str, file: UploadFile = File(...)):
    raw = (await file.read()).decode("utf-8", errors="replace")
    try:
        return await service.ingest_project(project_id, raw_text=raw, url=file.filename)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("ingest upload failed")
        raise HTTPException(400, str(exc)) from exc


@router.post("/projects/{project_id}/ingest/postman")
async def ingest_postman(project_id: str, file: UploadFile = File(...)):
    raw = (await file.read()).decode("utf-8", errors="replace")
    try:
        return await service.ingest_postman(project_id, raw_text=raw, filename=file.filename)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("postman ingest failed")
        raise HTTPException(400, str(exc)) from exc


@router.put("/projects/{project_id}/mock-data")
async def put_mock_data(project_id: str, body: dict):
    try:
        mock = body.get("mock_data") if isinstance(body, dict) and "mock_data" in body else body
        return await service.save_mock_data(project_id, mock if isinstance(mock, dict) else {})
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.put("/projects/{project_id}/request-edit")
async def put_request_edit(project_id: str, body: ApiRequestEdit):
    try:
        return await service.save_request_edit(
            project_id,
            method=body.method,
            path=body.path or "",
            path_template=body.path_template,
            operation_id=body.operation_id,
            flow_name=body.flow_name,
            headers=body.headers,
            query=body.query,
            body=body.body,
            update_mock=body.update_mock,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/projects/{project_id}/endpoints")
async def endpoints(project_id: str):
    if not await db.get_api_project(project_id, include_raw=False):
        raise HTTPException(404, "Project not found")
    return await db.list_api_endpoints(project_id)


@router.get("/projects/{project_id}/drift")
async def drift(project_id: str):
    try:
        return await service.get_drift(project_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/projects/{project_id}/baseline/reset")
async def reset_baseline(project_id: str):
    try:
        return await service.reset_baseline(project_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/projects/{project_id}/security")
async def security(project_id: str):
    project = await db.get_api_project(project_id, include_raw=False)
    if not project:
        raise HTTPException(404, "Project not found")
    schemes = project.get("security_schemes") or {}
    rows = await db.list_api_auth(project_id)
    return public_security(schemes, rows)


@router.put("/projects/{project_id}/auth")
async def put_auth(project_id: str, body: ApiAuthUpdate):
    secrets = body.model_dump(exclude={"scheme_name"}, exclude_none=True)
    try:
        return await service.save_auth(project_id, body.scheme_name, secrets)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/projects/{project_id}/test-connection")
async def test_connection(project_id: str, body: ApiTestConnectionRequest | None = None):
    try:
        return await service.test_connection(
            project_id,
            scheme_name=(body.scheme_name if body else None),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("test connection failed")
        raise HTTPException(400, str(exc)) from exc


@router.post("/projects/{project_id}/auth/token")
async def auth_token(project_id: str, body: ApiTokenRequest):
    try:
        return await service.exchange_token(
            project_id,
            body.scheme_name,
            grant=body.grant,
            code=body.code,
            redirect_uri=body.redirect_uri,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/projects/{project_id}/auth/authorize-url")
async def auth_authorize_url(project_id: str, body: ApiAuthorizeRequest):
    try:
        return await service.authorize_url(
            project_id, body.scheme_name, body.redirect_uri, body.state
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/projects/{project_id}/oauth/callback")
async def oauth_callback(project_id: str, body: ApiOAuthCallback):
    try:
        return await service.exchange_token(
            project_id,
            body.scheme_name,
            grant="authorizationCode",
            code=body.code,
            redirect_uri=body.redirect_uri,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/projects/{project_id}/generate")
async def generate(project_id: str):
    try:
        return await service.generate_project_flows(project_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/projects/{project_id}/flows")
async def flows(project_id: str):
    if not await db.get_api_project(project_id, include_raw=False):
        raise HTTPException(404, "Project not found")
    return await db.list_api_flows(project_id)


@router.get("/projects/{project_id}/export/postman")
async def export_postman(project_id: str):
    """Download generated flows as a Postman Collection v2.1 JSON file."""
    try:
        collection = await service.export_postman_collection(project_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    info_name = str((collection.get("info") or {}).get("name") or "api-assurance")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", info_name).strip("._") or "api-assurance"
    filename = f"{safe}.postman_collection.json"
    body = json.dumps(collection, indent=2, ensure_ascii=False)
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/projects/{project_id}/runs")
async def start_run(project_id: str, body: ApiRunRequest | None = None):
    try:
        return await service.execute_run(
            project_id, flow_ids=(body.flow_ids if body else None)
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/projects/{project_id}/schedule")
async def get_schedule(project_id: str):
    try:
        return await service.get_project_schedule(project_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.put("/projects/{project_id}/schedule")
async def put_schedule(project_id: str, body: ApiProjectScheduleUpdate):
    try:
        return await service.upsert_project_schedule(
            project_id,
            enabled=body.enabled,
            schedule=body.schedule,
            flow_ids=body.flow_ids,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/projects/{project_id}/schedule/run")
async def run_schedule_now(project_id: str):
    try:
        return await service.run_project_schedule_now(project_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/projects/{project_id}/run-step")
async def run_single_step(project_id: str, body: ApiSingleStepRunRequest):
    try:
        return await service.execute_single_step(
            project_id,
            method=body.method,
            path=body.path,
            path_template=body.path_template,
            operation_id=body.operation_id,
            flow_name=body.flow_name,
            headers=body.headers,
            query=body.query,
            body=body.body,
            captures=body.captures,
            seed_var=body.seed_var,
            expected_status=body.expected_status,
            kind=body.kind,
            use_auth=body.use_auth,
            skip_auth=body.skip_auth,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("single step run failed")
        raise HTTPException(400, str(exc)) from exc


@router.get("/projects/{project_id}/history")
async def history(project_id: str):
    if not await db.get_api_project(project_id, include_raw=False):
        raise HTTPException(404, "Project not found")
    return await db.list_api_runs(project_id)


@router.delete("/projects/{project_id}/history")
async def clear_history(project_id: str):
    try:
        return await service.clear_project_runs(project_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.delete("/projects/{project_id}/runs/{run_id}")
async def delete_run(project_id: str, run_id: str):
    try:
        return await service.delete_project_run(project_id, run_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/projects/{project_id}/overview")
async def project_overview(project_id: str):
    try:
        return await service.overview(project_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/projects/{project_id}/anomalies")
async def anomalies(project_id: str):
    if not await db.get_api_project(project_id, include_raw=False):
        raise HTTPException(404, "Project not found")
    return await db.list_api_anomalies(project_id)


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    run = await db.get_api_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@router.get("/runs/{run_id}/steps")
async def get_run_steps(run_id: str):
    if not await db.get_api_run(run_id):
        raise HTTPException(404, "Run not found")
    return await db.list_api_run_steps(run_id)


@router.get("/runs/{run_id}/insights")
async def get_run_insights(run_id: str):
    try:
        return await service.get_run_insights(run_id, persist=True)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/runs/{run_id}/report")
async def get_run_report(run_id: str):
    try:
        meta = await service.get_run_report(run_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    # Public URL the UI can open for the HTML Allure-style report
    meta["report_url"] = f"/api/api-test/runs/{run_id}/report/view"
    meta["has_report"] = bool(meta.get("report_html"))
    return meta


@router.get("/runs/{run_id}/report/view")
async def view_run_report(run_id: str):
    """Serve the self-contained Allure-style HTML report inline in the browser."""
    try:
        meta = await service.get_run_report(run_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    html_path = meta.get("report_html")
    if not html_path:
        raise HTTPException(404, "Report not generated yet")
    path = Path(html_path)
    if not path.is_file():
        raise HTTPException(404, "Report file missing on disk")
    # Inline — never force a download; the UI embeds / opens this for on-screen viewing
    return FileResponse(
        path,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f'inline; filename="allure-report-{run_id}.html"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/runs/{run_id}/report/download")
async def download_run_report(run_id: str):
    """Deprecated: kept for compatibility; serves the same inline HTML report."""
    return await view_run_report(run_id)

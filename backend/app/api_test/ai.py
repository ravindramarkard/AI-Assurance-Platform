"""LLM helpers for API Test Console: payload enrichment, scenario ideation, RCA polish, heal."""

from __future__ import annotations

import json
import logging
import random
import re
from typing import Any

logger = logging.getLogger(__name__)


def _extract_json(text: str) -> Any | None:
    raw = (text or "").strip()
    if not raw:
        return None
    # Strip common markdown fences
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.I)
    if fence:
        raw = fence.group(1).strip()
    try:
        return json.loads(raw)
    except Exception:
        pass
    for pattern in (r"\{[\s\S]*\}", r"\[[\s\S]*\]"):
        m = re.search(pattern, raw)
        if not m:
            continue
        try:
            return json.loads(m.group(0))
        except Exception:
            continue
    return None


async def invoke_llm_text(system: str, user: str, *, required: bool = False) -> str | None:
    """Chat completion via platform LLM settings. Returns None on soft failure unless required."""
    try:
        from browser_use.llm.messages import SystemMessage, UserMessage

        from ..llm_factory import build_llm, effective_settings

        cfg = await effective_settings()
        llm = build_llm(cfg)
        if hasattr(llm, "dont_force_structured_output"):
            try:
                llm.dont_force_structured_output = True  # type: ignore[attr-defined]
            except Exception:
                pass
        result = await llm.ainvoke(
            [
                SystemMessage(content=system),
                UserMessage(content=user),
            ]
        )
        text = getattr(result, "completion", None) or getattr(result, "content", None) or result
        reply = str(text or "").strip()
        if not reply and required:
            raise ValueError("LLM returned an empty response")
        return reply or None
    except Exception as exc:
        logger.info("API-test LLM call failed: %s", exc)
        if required:
            raise ValueError(f"LLM call failed: {exc}") from exc
        return None


async def invoke_llm_json(system: str, user: str, *, required: bool = False) -> Any | None:
    text = await invoke_llm_text(system, user, required=required)
    if not text:
        return None
    data = _extract_json(text)
    if data is None and required:
        raise ValueError("LLM response was not valid JSON")
    return data


async def llm_enrich_payload(
    schema: dict[str, Any] | None,
    context: str,
    *,
    kind: str = "happy",
    seed: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Ask the LLM for a schema-valid request body. Returns None on failure."""
    if not schema or not isinstance(schema, dict):
        return None
    # Keep prompt bounded
    schema_s = json.dumps(schema, default=str)[:6000]
    seed_s = json.dumps(seed or {}, default=str)[:2000]
    system = (
        "You are an API test data generator. "
        "Return ONLY a single JSON object that is a valid request body for the given JSON Schema. "
        "No markdown, no commentary."
    )
    user = (
        f"Kind: {kind}\n"
        f"Context: {context}\n"
        f"JSON Schema:\n{schema_s}\n"
        f"Optional seed/hints (merge when useful):\n{seed_s}\n"
        "Rules:\n"
        "- Prefer realistic values for emails, names, urls, ids.\n"
        "- Keep arrays as arrays (e.g. photoUrls).\n"
        "- For kind=negative, omit a required field or use a wrong type.\n"
        "- For kind=edge, use boundary / unicode / empty-string values where valid.\n"
        "- For kind=happy/e2e/contract, produce a complete valid body.\n"
    )
    data = await invoke_llm_json(system, user)
    return data if isinstance(data, dict) else None


def _op_catalog_entry(op: dict[str, Any]) -> dict[str, Any]:
    schema = op.get("request_schema")
    schema_snip = None
    if isinstance(schema, dict):
        schema_snip = {
            "type": schema.get("type"),
            "required": (schema.get("required") or [])[:12],
            "properties": {
                k: {"type": (v or {}).get("type"), "format": (v or {}).get("format")}
                for k, v in list((schema.get("properties") or {}).items())[:16]
                if isinstance(v, dict)
            },
        }
    return {
        "operation_id": op.get("operation_id"),
        "method": op.get("method"),
        "path": op.get("path"),
        "path_params": op.get("path_params") or [],
        "tags": (op.get("tags") or [])[:3],
        "summary": (op.get("summary") or "")[:140],
        "request_schema": schema_snip,
    }


def _batch_ops(ops: list[dict[str, Any]], *, size: int = 28) -> list[list[dict[str, Any]]]:
    if len(ops) <= size:
        return [ops]
    # Prefer grouping by first tag so CRUD stays together
    by_tag: dict[str, list[dict[str, Any]]] = {}
    for op in ops:
        tags = op.get("tags") or []
        key = str(tags[0]) if tags else "_other"
        by_tag.setdefault(key, []).append(op)
    batches: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for group in by_tag.values():
        if len(current) + len(group) > size and current:
            batches.append(current)
            current = []
        if len(group) > size:
            for i in range(0, len(group), size):
                batches.append(group[i : i + size])
        else:
            current.extend(group)
    if current:
        batches.append(current)
    return batches or [ops]


def _default_expected(kind: str) -> list[int]:
    if kind == "negative":
        return [400, 401, 403, 404, 405, 422, 500]
    if kind == "security":
        return [401, 403, 404, 400]
    if kind == "edge":
        return [200, 201, 202, 204, 400, 404, 405, 422]
    if kind == "load":
        return [200, 201, 202, 204]
    return [200, 201, 202, 204]


def _materialize_step(
    raw: dict[str, Any],
    *,
    op: dict[str, Any],
    kind: str,
) -> dict[str, Any]:
    method = str(op.get("method") or "GET").upper()
    path_template = str(op.get("path") or "/")
    path = path_template
    path_params = list(op.get("path_params") or [])
    overrides = raw.get("path_params") if isinstance(raw.get("path_params"), dict) else {}
    for p in path_params:
        token = overrides.get(p) if p in overrides else f"{{{{{p}}}}}"
        path = path.replace("{" + p + "}", str(token))
    expected = raw.get("expected_status")
    if not isinstance(expected, list) or not expected:
        expected = _default_expected(kind)
    captures = raw.get("captures") if isinstance(raw.get("captures"), list) else []
    clean_captures = []
    for c in captures:
        if isinstance(c, dict) and c.get("var") and c.get("jsonpath"):
            clean_captures.append({"var": str(c["var"]), "jsonpath": str(c["jsonpath"])})
    body = raw.get("body")
    if body is not None and not isinstance(body, (dict, list, str, int, float, bool)):
        body = None
    step: dict[str, Any] = {
        "operation_id": op.get("operation_id"),
        "method": method,
        "path": path,
        "path_template": path_template,
        "query": raw.get("query") if isinstance(raw.get("query"), dict) else {},
        "headers": raw.get("headers") if isinstance(raw.get("headers"), dict) else {},
        "body": body,
        "captures": clean_captures,
        "expected_status": [int(x) for x in expected if isinstance(x, int) or str(x).isdigit()],
        "assert_schema": kind in ("contract", "e2e"),
        "kind": kind,
        "skip_auth": bool(raw.get("skip_auth")),
        "ai_generated": True,
        "rationale": str(raw.get("rationale") or "")[:300],
    }
    if raw.get("security_probe") in ("missing_auth", "injection"):
        step["security_probe"] = raw["security_probe"]
    if isinstance(raw.get("seed_var"), dict):
        step["seed_var"] = raw["seed_var"]
    if kind == "load":
        step["vus"] = int(raw.get("vus") or 10)
    return step


_FLOW_SCHEMA_HINT = (
    "Each flow object:\n"
    '- name: string\n'
    '- kind: one of "contract","e2e","edge","negative","security","load"\n'
    "- resource: tag/resource name, or \"journey\" for cross-resource happy paths\n"
    "- steps: array of step objects\n"
    "Each step object:\n"
    "- operation_id: required, from catalog\n"
    "- body: JSON body for POST/PUT/PATCH (realistic; arrays stay arrays)\n"
    "- query: object (optional)\n"
    "- headers: object (optional)\n"
    '- path_params: object mapping path param -> value or "{{var}}"\n'
    '- captures: [{"var":"pet_id","jsonpath":"$.id"}] after creates\n'
    '- seed_var: object of variables to set even if response omits ids '
    '(e.g. {"username":"buyer_1","pet_id":12345,"extracted_post_id":12345})\n'
    "- expected_status: int array\n"
    '- skip_auth: true for security missing-auth probes\n'
    '- security_probe: "missing_auth" or "injection" when applicable\n'
    "- rationale: short why this step matters\n"
)


def _materialize_flows_payload(
    data: Any,
    ops: list[dict[str, Any]],
    *,
    include_negative: bool = True,
    include_edge: bool = True,
    include_security: bool = True,
    include_load: bool = True,
    load_vus: int = 10,
    force_kind: str | None = None,
    default_resource: str | None = None,
) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        raise ValueError("LLM JSON root must be an object with a flows array")
    raw_flows = data.get("flows")
    if not isinstance(raw_flows, list):
        raw_flows = data.get("scenarios") if isinstance(data.get("scenarios"), list) else []
    if not isinstance(raw_flows, list):
        raise ValueError("LLM JSON must include a flows (or scenarios) array")

    by_id = {o.get("operation_id"): o for o in ops if o.get("operation_id")}
    flows: list[dict[str, Any]] = []
    for rf in raw_flows:
        if not isinstance(rf, dict):
            continue
        kind = str(force_kind or rf.get("kind") or "e2e")
        if kind == "happy":
            kind = "e2e"
        if kind not in ("contract", "e2e", "edge", "negative", "security", "load"):
            kind = "e2e"
        if kind == "edge" and not include_edge:
            continue
        if kind == "negative" and not include_negative:
            continue
        if kind == "security" and not include_security:
            continue
        if kind == "load" and not include_load:
            continue
        steps_in = rf.get("steps")
        if not isinstance(steps_in, list):
            if rf.get("operation_id"):
                steps_in = [rf]
            else:
                continue
        steps: list[dict[str, Any]] = []
        for rs in steps_in:
            if not isinstance(rs, dict):
                continue
            oid = rs.get("operation_id")
            op = by_id.get(oid)
            if not op:
                continue
            steps.append(_materialize_step(rs, op=op, kind=kind))
        if not steps:
            continue
        resource = str(rf.get("resource") or default_resource or "")
        if not resource:
            tags = (by_id.get(steps[0].get("operation_id")) or {}).get("tags") or []
            resource = str(tags[0]) if tags else ""
        flow: dict[str, Any] = {
            "name": str(rf.get("name") or f"AI {kind} {resource or steps[0].get('operation_id')}")[:160],
            "kind": kind,
            "resource": resource,
            "steps": steps,
            "ai_generated": True,
        }
        if kind == "load":
            flow["vus"] = int(rf.get("vus") or load_vus)
        if resource == "journey" or len(steps) >= 6:
            flow["journey"] = True
        flows.append(flow)
    return flows


def _normalize_journey_bindings(flows: list[dict[str, Any]], ops: list[dict[str, Any]]) -> None:
    """Strengthen capture/seed wiring so chained happy paths resolve variables."""
    by_id = {o.get("operation_id"): o for o in ops if o.get("operation_id")}
    for flow in flows:
        if str(flow.get("kind") or "") not in ("e2e", "happy"):
            continue
        steps = flow.get("steps") or []
        if not isinstance(steps, list):
            continue
        for step in steps:
            if not isinstance(step, dict):
                continue
            op = by_id.get(step.get("operation_id")) or {}
            method = str(step.get("method") or "").upper()
            oid = str(step.get("operation_id") or "").lower()
            path_t = str(step.get("path_template") or step.get("path") or "").lower()
            body = step.get("body") if isinstance(step.get("body"), dict) else {}
            seed = dict(step.get("seed_var") or {}) if isinstance(step.get("seed_var"), dict) else {}
            captures = list(step.get("captures") or []) if isinstance(step.get("captures"), list) else []

            def _has_cap(var: str) -> bool:
                return any(isinstance(c, dict) and str(c.get("var")) == var for c in captures)

            # User create / login identity
            if method == "POST" and ("user" in oid or path_t.rstrip("/").endswith("/user")):
                username = body.get("username") or seed.get("username") or "journey_user"
                body.setdefault("username", username)
                seed.setdefault("username", username)
                if "password" in body or "password" in (op.get("request_schema") or {}).get("properties", {}):
                    pwd = body.get("password") or seed.get("password") or "TestPass!123"
                    body.setdefault("password", pwd)
                    seed.setdefault("password", pwd)
                if not _has_cap("username"):
                    captures.append({"var": "username", "jsonpath": "$.username"})
            if "login" in oid:
                # Prefer bound vars from createUser
                q = step.get("query") if isinstance(step.get("query"), dict) else {}
                q.setdefault("username", "{{username}}")
                q.setdefault("password", "{{password}}")
                step["query"] = q
            if "logout" in oid:
                step.setdefault("expected_status", [200, 204])

            # Pet create → bind pet id into later path params
            if method == "POST" and ("addpet" in oid or path_t.rstrip("/") in ("/pet", "/pets")):
                pid = body.get("id") or seed.get("pet_id") or seed.get("extracted_post_id") or random.randint(
                    100000, 999999999
                )
                body.setdefault("id", pid)
                seed.setdefault("pet_id", pid)
                seed.setdefault("extracted_post_id", pid)
                seed.setdefault("id", pid)
                if not _has_cap("pet_id"):
                    captures.append({"var": "pet_id", "jsonpath": "$.id"})
                if not _has_cap("extracted_post_id"):
                    captures.append({"var": "extracted_post_id", "jsonpath": "$.id"})
                body.setdefault("name", body.get("name") or "journey-pet")
                if "photoUrls" in (op.get("request_schema") or {}).get("properties", {}):
                    if not isinstance(body.get("photoUrls"), list):
                        body["photoUrls"] = ["https://example.test/pet.jpg"]

            # Store order → bind order id + pet id
            if method == "POST" and ("order" in oid or "/store/order" in path_t):
                oid_num = body.get("id") or seed.get("order_id") or random.randint(100000, 999999999)
                body.setdefault("id", oid_num)
                body.setdefault("petId", "{{pet_id}}")
                seed.setdefault("order_id", oid_num)
                seed.setdefault("extracted_order_id", oid_num)
                if not _has_cap("order_id"):
                    captures.append({"var": "order_id", "jsonpath": "$.id"})

            # Rewrite path templates to shared journey variables
            path = str(step.get("path") or "")
            for param in op.get("path_params") or []:
                mustache = "{{" + param + "}}"
                if mustache not in path:
                    continue
                pl = param.lower().replace("_", "")
                if "pet" in pl:
                    path = path.replace(mustache, "{{pet_id}}")
                elif "order" in pl:
                    path = path.replace(mustache, "{{order_id}}")
                elif pl in ("username", "user") or "user" in pl:
                    path = path.replace(mustache, "{{username}}")
            path = (
                path.replace("{{petId}}", "{{pet_id}}")
                .replace("{{orderId}}", "{{order_id}}")
                .replace("{{username}}", "{{username}}")
            )
            if "order" in path.lower() and "{{extracted_post_id}}" in path:
                path = path.replace("{{extracted_post_id}}", "{{order_id}}")
            elif "pet" in path.lower() and "{{extracted_post_id}}" not in path and "{{pet_id}}" in path:
                pass
            step["path"] = path
            if body:
                step["body"] = body
            if seed:
                step["seed_var"] = seed
            if captures:
                step["captures"] = captures


def _op_blob(op: dict[str, Any]) -> str:
    return " ".join(
        [
            str(op.get("operation_id") or ""),
            str(op.get("method") or ""),
            str(op.get("path") or ""),
            " ".join(op.get("tags") or []),
            str(op.get("summary") or ""),
        ]
    ).lower()


def _find_op(ops: list[dict[str, Any]], *needles: str, exclude: set[str] | None = None) -> dict[str, Any] | None:
    exclude = exclude or set()
    for op in ops:
        oid = str(op.get("operation_id") or "")
        if oid in exclude:
            continue
        blob = _op_blob(op)
        if all(n.lower() in blob for n in needles):
            return op
    return None


def _pick_journey_skeleton(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pick an ordered cross-resource happy-path skeleton from available operations."""
    used: set[str] = set()
    picks: list[tuple[str, dict[str, Any] | None]] = [
        ("create_user", _find_op(ops, "user", "post", exclude=used) or _find_op(ops, "createuser", exclude=used)),
        ("login", _find_op(ops, "login", exclude=used)),
        ("add_pet", _find_op(ops, "addpet", exclude=used) or _find_op(ops, "post", "/pet", exclude=used)),
        ("get_pet", _find_op(ops, "getpet", exclude=used) or _find_op(ops, "get", "/pet/{", exclude=used)),
        ("update_pet", _find_op(ops, "updatepet", exclude=used) or _find_op(ops, "put", "/pet", exclude=used)),
        ("update_user", _find_op(ops, "updateuser", exclude=used) or _find_op(ops, "put", "/user/{", exclude=used)),
        ("inventory", _find_op(ops, "inventory", exclude=used)),
        ("place_order", _find_op(ops, "placeorder", exclude=used) or _find_op(ops, "post", "/store/order", exclude=used)),
        ("get_order", _find_op(ops, "getorder", exclude=used) or _find_op(ops, "get", "/store/order/{", exclude=used)),
        ("logout", _find_op(ops, "logout", exclude=used)),
    ]
    skeleton: list[dict[str, Any]] = []
    for _role, op in picks:
        if not op:
            continue
        oid = str(op.get("operation_id") or "")
        if not oid or oid in used:
            continue
        used.add(oid)
        skeleton.append(op)
    return skeleton


def _stitch_short_journey_flows(flows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """If the model returned many 1-step journey fragments, merge into one multi-step flow."""
    if not flows:
        return flows
    long_ones = [f for f in flows if len(f.get("steps") or []) >= 4]
    if long_ones:
        return long_ones
    short = [f for f in flows if len(f.get("steps") or []) >= 1]
    if len(short) < 2:
        return flows
    merged_steps: list[dict[str, Any]] = []
    seen_ops: set[str] = set()
    for f in short:
        for s in f.get("steps") or []:
            if not isinstance(s, dict):
                continue
            oid = str(s.get("operation_id") or "")
            key = oid or f"{s.get('method')}:{s.get('path')}"
            if key in seen_ops:
                continue
            seen_ops.add(key)
            merged_steps.append(s)
    if len(merged_steps) < 2:
        return flows
    return [
        {
            "name": "Happy path: login to logout (stitched)",
            "kind": "e2e",
            "resource": "journey",
            "steps": merged_steps,
            "ai_generated": True,
            "journey": True,
        }
    ]


async def _ai_fill_journey_skeleton(ops: list[dict[str, Any]], skeleton: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ask the LLM to fill bodies/captures for a fixed cross-resource op sequence."""
    if len(skeleton) < 4:
        return []
    catalog = [_op_catalog_entry(op) for op in skeleton]
    system = (
        "You fill request bodies for a fixed API happy-path journey. "
        "Return ONLY JSON {\"steps\":[...]} with one object per operation_id, same order. "
        "No markdown."
    )
    user = (
        "Fill each step for this exact sequence (do not reorder, do not drop ops):\n"
        f"{json.dumps(catalog, default=str)[:12000]}\n\n"
        "Each step: operation_id, body (or null), query, path_params with {{username}}/{{pet_id}}/{{order_id}}, "
        "captures, seed_var, expected_status=[200,201,202,204].\n"
        "Reuse one username/password/pet id across the journey.\n"
    )
    data = await invoke_llm_json(system, user, required=True)
    if not isinstance(data, dict):
        return []
    raw_steps = data.get("steps") if isinstance(data.get("steps"), list) else []
    by_id = {o.get("operation_id"): o for o in skeleton}
    # Map by position if model omits ids
    steps: list[dict[str, Any]] = []
    for i, op in enumerate(skeleton):
        raw = raw_steps[i] if i < len(raw_steps) and isinstance(raw_steps[i], dict) else {}
        if raw.get("operation_id") and raw["operation_id"] in by_id:
            op = by_id[raw["operation_id"]]
        steps.append(_materialize_step(raw if isinstance(raw, dict) else {}, op=op, kind="e2e"))
    flow = {
        "name": "Happy path: login to logout (user → pet → order)",
        "kind": "e2e",
        "resource": "journey",
        "steps": steps,
        "ai_generated": True,
        "journey": True,
    }
    _normalize_journey_bindings([flow], ops)
    return [flow]


async def _ai_generate_happy_path_journeys(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Generate cross-resource login→…→logout journeys via LLM (with skeleton fallback)."""
    catalog = [_op_catalog_entry(op) for op in ops[:100]]
    system = (
        "You are an expert API journey designer. "
        "Build FULL happy-path end-to-end journeys that chain interrelated endpoints "
        "across resources (user, auth, pet, store/order, inventory, etc.). "
        "Return ONLY JSON {\"flows\":[...]} with no markdown. "
        "IMPORTANT: put ALL lifecycle steps inside ONE flow.steps array (not separate 1-step flows)."
    )
    user = (
        "Create 1 primary journey (optionally 1 alternate) covering a realistic "
        "customer lifecycle using ONLY operation_id values from the catalog.\n\n"
        "Required journey shape (adapt names to available ops):\n"
        "1) Create user (capture/seed username + password)\n"
        "2) Login user (use {{username}} / {{password}})\n"
        "3) Create/post pet (seed + capture pet_id / extracted_post_id)\n"
        "4) Get pet by id using {{pet_id}}\n"
        "5) Update/edit pet using {{pet_id}}\n"
        "6) Optionally update user profile using {{username}}\n"
        "7) View store inventory\n"
        "8) Place order for that pet (body.petId={{pet_id}}; capture order_id)\n"
        "9) Get order status by {{order_id}}\n"
        "10) Logout user\n"
        "Skip steps only when the matching operation_id is absent from the catalog. "
        "Do NOT stop at single-resource CRUD — the journey MUST cross resources when ops exist.\n\n"
        "Rules:\n"
        '- kind must be "e2e"\n'
        '- resource must be "journey"\n'
        "- name like \"Happy path: login to logout (user → pet → order)\"\n"
        "- ONE flow with many steps (minimum 6 when ops allow)\n"
        "- Reuse the SAME username/password/pet id across steps via seed_var + captures + {{vars}}\n"
        "- Bodies must be valid for schemas; photoUrls/tags stay arrays\n"
        "- expected_status should accept common 2xx codes\n"
        f"{_FLOW_SCHEMA_HINT}\n"
        f"Operations catalog:\n{json.dumps(catalog, default=str)[:14000]}\n"
    )

    flows: list[dict[str, Any]] = []
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            data = await invoke_llm_json(system, user, required=True)
            flows = _materialize_flows_payload(
                data,
                ops,
                include_negative=False,
                include_edge=False,
                include_security=False,
                include_load=False,
                force_kind="e2e",
                default_resource="journey",
            )
            flows = _stitch_short_journey_flows(flows)
            break
        except Exception as exc:
            last_err = exc
            logger.warning("happy-path attempt %s failed: %s", attempt + 1, exc)

    for f in flows:
        f["kind"] = "e2e"
        f["resource"] = "journey"
        f["journey"] = True
        if "happy path" not in str(f.get("name") or "").lower():
            f["name"] = f"Happy path: {f.get('name')}"
    _normalize_journey_bindings(flows, ops)
    flows.sort(key=lambda f: len(f.get("steps") or []), reverse=True)
    flows = [f for f in flows if len(f.get("steps") or []) >= 4][:2]

    if flows:
        return flows

    # Fallback: fixed skeleton from OpenAPI ops + LLM bodies
    skeleton = _pick_journey_skeleton(ops)
    if len(skeleton) >= 4:
        try:
            filled = await _ai_fill_journey_skeleton(ops, skeleton)
            if filled and len(filled[0].get("steps") or []) >= 4:
                return filled
        except Exception as exc:
            last_err = exc
            logger.warning("skeleton journey fill failed: %s", exc)

    detail = str(last_err) if last_err else "model returned no multi-step journey"
    raise ValueError(
        "Could not build a full E2E journey (need create/login → pet → order → logout style chain). "
        f"Detail: {detail}"
    )


async def _ai_generate_batch(
    ops: list[dict[str, Any]],
    *,
    budget: int,
    include_negative: bool,
    include_edge: bool,
    include_security: bool,
    include_load: bool,
    load_vus: int,
) -> list[dict[str, Any]]:
    catalog = [_op_catalog_entry(op) for op in ops]
    layers = ["contract"]
    if include_edge:
        layers.append("edge")
    if include_negative:
        layers.append("negative")
    if include_security:
        layers.append("security")
    if include_load:
        layers.append("load")
    # Short e2e supplements are optional; primary journeys are generated separately
    layers.append("e2e")
    system = (
        "You are an expert API test architect. "
        "Generate supplemental API tests (not the main login-to-logout journey). "
        "Return ONLY JSON of the form {\"flows\":[...]} — no markdown, no commentary. "
        "Do not invent operation_id values; use only ids from the catalog."
    )
    user = (
        f"Target about {budget} total steps across these supplemental flows (soft cap).\n"
        f"Required spectrum layers: {', '.join(layers)}.\n"
        f"Default load VUs when kind=load: {load_vus}.\n"
        f"Operations catalog:\n{json.dumps(catalog, default=str)[:12000]}\n\n"
        f"{_FLOW_SCHEMA_HINT}\n"
        "Coverage rules (MANDATORY — create separate flows for EACH layer):\n"
        "- Do NOT recreate the full login→logout journey here.\n"
        "- At least 2 flows with kind=contract (schema/success checks).\n"
        "- At least 2 flows with kind=negative (omit required fields / wrong types / bad ids).\n"
        "- At least 2 flows with kind=edge (boundary, empty string, unicode) when edge is required.\n"
        "- At least 2 flows with kind=security (missing_auth and/or injection) when security is required.\n"
        "- At least 1 flow with kind=load when load is required.\n"
        "- Short resource-focused e2e snippets are OK (2-4 steps) but do not replace the layers above.\n"
    )
    data = await invoke_llm_json(system, user, required=True)
    return _materialize_flows_payload(
        data,
        ops,
        include_negative=include_negative,
        include_edge=include_edge,
        include_security=include_security,
        include_load=include_load,
        load_vus=load_vus,
    )


async def _fill_missing_bodies_with_ai(
    ops: list[dict[str, Any]],
    flows: list[dict[str, Any]],
) -> int:
    """Ensure write steps have AI bodies when the suite JSON omitted them."""
    by_id = {o.get("operation_id"): o for o in ops if o.get("operation_id")}
    filled = 0
    for flow in flows:
        kind = str(flow.get("kind") or "e2e")
        for step in flow.get("steps") or []:
            if not isinstance(step, dict):
                continue
            method = str(step.get("method") or "").upper()
            if method not in ("POST", "PUT", "PATCH"):
                continue
            if step.get("security_probe") == "injection":
                continue
            if isinstance(step.get("body"), dict) and step["body"]:
                continue
            op = by_id.get(step.get("operation_id")) or {}
            schema = op.get("request_schema") if isinstance(op, dict) else None
            if not isinstance(schema, dict):
                continue
            synth_kind = "happy"
            if kind in ("edge", "negative"):
                synth_kind = kind
            body = await llm_enrich_payload(
                schema,
                f"{method} {step.get('path_template') or step.get('path')} "
                f"op={step.get('operation_id')} kind={kind}",
                kind=synth_kind,
            )
            if not body:
                raise ValueError(
                    f"AI model failed to generate body for {step.get('operation_id')}. "
                    "Check Settings → LLM."
                )
            for af in ("photoUrls", "tags"):
                if af in body and not isinstance(body[af], list):
                    body[af] = [body[af]] if body[af] is not None else []
            step["body"] = body
            step["ai_generated"] = True
            filled += 1
    return filled


def _is_journey_flow(flow: dict[str, Any]) -> bool:
    if flow.get("journey"):
        return True
    if str(flow.get("resource") or "").lower() == "journey":
        return True
    name = str(flow.get("name") or "").lower()
    if "happy path" in name or "login to logout" in name:
        return True
    return str(flow.get("kind") or "") == "e2e" and len(flow.get("steps") or []) >= 6


_SPECTRUM_ORDER = ("contract", "e2e", "edge", "negative", "security", "load")


def _wanted_spectrum_kinds(
    *,
    include_negative: bool,
    include_edge: bool,
    include_security: bool,
    include_load: bool,
) -> set[str]:
    wanted = {"contract", "e2e"}
    if include_edge:
        wanted.add("edge")
    if include_negative:
        wanted.add("negative")
    if include_security:
        wanted.add("security")
    if include_load:
        wanted.add("load")
    return wanted


def _kinds_present(flows: list[dict[str, Any]]) -> set[str]:
    out: set[str] = set()
    for f in flows:
        kind = str(f.get("kind") or "e2e")
        if kind == "happy":
            kind = "e2e"
        out.add(kind)
    return out


def _ensure_full_spectrum(
    ops: list[dict[str, Any]],
    flows: list[dict[str, Any]],
    *,
    include_negative: bool,
    include_edge: bool,
    include_security: bool,
    include_load: bool,
    load_vus: int,
    budget: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Guarantee every enabled spectrum layer has flows.
    LLM batches often omit negative/edge/security/load — fill gaps from OpenAPI heuristics.
    """
    from .flows import generate_flows

    wanted = _wanted_spectrum_kinds(
        include_negative=include_negative,
        include_edge=include_edge,
        include_security=include_security,
        include_load=include_load,
    )
    present = _kinds_present(flows)
    missing = wanted - present
    meta: dict[str, Any] = {
        "spectrum_fallback_kinds": [],
        "spectrum_fallback_flows": 0,
    }
    if not missing:
        return flows, meta

    heuristic = generate_flows(
        ops,
        budget=max(budget, 80),
        include_negative=include_negative,
        include_edge=include_edge,
        include_security=include_security,
        include_load=include_load,
        load_vus=load_vus,
    )
    has_journey = any(_is_journey_flow(f) for f in flows)
    per_kind_cap = {
        "contract": max(3, budget // 12),
        "edge": max(3, budget // 12),
        "negative": max(4, budget // 10),
        "security": max(4, budget // 10),
        "load": 1,
        # Keep short resource E2E only when AI produced no e2e/journey at all
        "e2e": 0 if has_journey else max(2, budget // 15),
    }
    by_kind: dict[str, list[dict[str, Any]]] = {}
    for hf in heuristic:
        kind = str(hf.get("kind") or "e2e")
        if kind == "happy":
            kind = "e2e"
        if kind not in missing:
            continue
        if kind == "e2e" and has_journey:
            continue
        row = dict(hf)
        row["kind"] = kind
        row["ai_generated"] = False
        row["spectrum_fallback"] = True
        by_kind.setdefault(kind, []).append(row)

    out = list(flows)
    filled_kinds: list[str] = []
    added = 0
    for kind in _SPECTRUM_ORDER:
        if kind not in missing:
            continue
        take = (by_kind.get(kind) or [])[: per_kind_cap.get(kind, 3)]
        if not take:
            continue
        out.extend(take)
        filled_kinds.append(kind)
        added += len(take)
    meta["spectrum_fallback_kinds"] = filled_kinds
    meta["spectrum_fallback_flows"] = added
    if filled_kinds:
        logger.info(
            "Filled missing spectrum layers via OpenAPI heuristics: %s (%s flows)",
            ",".join(filled_kinds),
            added,
        )
    return out, meta


def _trim_flows_to_budget(flows: list[dict[str, Any]], budget: int) -> list[dict[str, Any]]:
    """Keep journeys + fair share of every spectrum kind within the step budget."""
    if budget <= 0:
        return flows
    journeys = [f for f in flows if _is_journey_flow(f)]
    others = [f for f in flows if not _is_journey_flow(f)]
    selected: list[dict[str, Any]] = []
    steps = 0

    # Always keep the primary happy-path journey (and a second if room)
    for flow in sorted(journeys, key=lambda f: len(f.get("steps") or []), reverse=True):
        n = len(flow.get("steps") or [])
        if n == 0:
            continue
        if selected and steps + n > budget:
            if any(_is_journey_flow(x) for x in selected):
                continue
        selected.append(flow)
        steps += n

    by_kind: dict[str, list[dict[str, Any]]] = {}
    for f in others:
        by_kind.setdefault(str(f.get("kind") or "e2e"), []).append(f)

    # Reserve a fair slice of remaining budget for each present spectrum kind
    remaining = max(0, budget - steps)
    present_kinds = [k for k in _SPECTRUM_ORDER if by_kind.get(k)]
    if present_kinds and remaining > 0:
        # Minimum 1 step-slot intent per kind; distribute leftover round-robin
        per_kind_quota = max(1, remaining // len(present_kinds))
    else:
        per_kind_quota = 0
    kind_steps = {k: 0 for k in present_kinds}

    # Pass 1: at least one flow per kind (so KPIs are never empty for that layer)
    for kind in present_kinds:
        bucket = by_kind.get(kind) or []
        if not bucket:
            continue
        flow = bucket[0]
        n = len(flow.get("steps") or [])
        if n == 0:
            continue
        # Allow slight budget overrun for the first flow of a missing KPI layer
        if steps + n > budget and selected and kind_steps[kind] > 0:
            continue
        if steps + n > budget + 4 and selected:
            continue
        selected.append(flow)
        steps += n
        kind_steps[kind] += n

    # Pass 2: round-robin fill remaining budget
    indexes = {k: (1 if kind_steps.get(k, 0) else 0) for k in by_kind}
    progressed = True
    while progressed and steps < budget:
        progressed = False
        for kind in _SPECTRUM_ORDER:
            bucket = by_kind.get(kind) or []
            i = indexes.get(kind, 0)
            if i >= len(bucket):
                continue
            # Soft per-kind cap so one layer cannot consume the whole remainder
            if kind in kind_steps and kind_steps[kind] >= per_kind_quota * 2 and steps + 1 < budget:
                # still allow if other kinds are exhausted
                others_left = any(
                    indexes.get(k, 0) < len(by_kind.get(k) or [])
                    for k in present_kinds
                    if k != kind
                )
                if others_left:
                    continue
            flow = bucket[i]
            indexes[kind] = i + 1
            n = len(flow.get("steps") or [])
            if n == 0:
                continue
            if steps + n > budget and selected:
                continue
            selected.append(flow)
            steps += n
            if kind in kind_steps:
                kind_steps[kind] += n
            progressed = True
            if steps >= budget:
                break
    return selected or flows[:1]


async def ai_generate_flows(
    ops: list[dict[str, Any]],
    *,
    budget: int = 80,
    include_negative: bool = True,
    include_edge: bool = True,
    include_security: bool = True,
    include_load: bool = True,
    load_vus: int = 10,
    mock_data: dict[str, Any] | None = None,
    collection_steps: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Generate the full API test suite: AI happy-path journeys + spectrum layers.
    Missing spectrum kinds are filled from OpenAPI heuristics so KPIs are never empty.
    """
    if not ops:
        raise ValueError("No operations available — ingest an OpenAPI/Postman document first")

    flows: list[dict[str, Any]] = []
    llm_errors: list[str] = []
    journey_count = 0

    if collection_steps:
        flows.append(
            {
                "name": "Postman collection (recorded)",
                "kind": "e2e",
                "resource": "postman",
                "from_postman": True,
                "steps": list(collection_steps),
            }
        )

    # 1) Full cross-resource happy path(s) using the entire catalog
    try:
        journeys = await _ai_generate_happy_path_journeys(ops)
        flows.extend(journeys)
        journey_count = len(journeys)
    except Exception as exc:
        llm_errors.append(str(exc))
        logger.warning("AI happy-path journey generation failed: %s", exc)

    # 2) Supplemental spectrum coverage via LLM (contract/edge/negative/security/load)
    # Leave headroom so spectrum is not crowded out by the journey alone.
    journey_steps = sum(len(f.get("steps") or []) for f in flows)
    remaining = max(24, budget - journey_steps)
    batches = _batch_ops(ops, size=28)
    per_batch = max(8, remaining // max(1, len(batches)))
    for batch in batches:
        try:
            part = await _ai_generate_batch(
                batch,
                budget=per_batch,
                include_negative=include_negative,
                include_edge=include_edge,
                include_security=include_security,
                include_load=include_load,
                load_vus=load_vus,
            )
            flows.extend(part)
        except Exception as exc:
            llm_errors.append(str(exc))
            logger.warning("AI batch generate failed: %s", exc)

    # 3) Guarantee every enabled spectrum layer exists (heuristic fill for gaps)
    flows, spectrum_meta = _ensure_full_spectrum(
        ops,
        flows,
        include_negative=include_negative,
        include_edge=include_edge,
        include_security=include_security,
        include_load=include_load,
        load_vus=load_vus,
        budget=budget,
    )

    if not flows:
        detail = llm_errors[0] if llm_errors else "empty model response"
        raise ValueError(
            "AI model failed to generate flows. Configure a working LLM in Settings → LLM. "
            f"Detail: {detail}"
        )
    if journey_count == 0:
        raise ValueError(
            "AI model failed to generate a full happy-path journey (login → related endpoints → logout). "
            f"Detail: {llm_errors[0] if llm_errors else 'no journey returned'}"
        )

    still_missing = _wanted_spectrum_kinds(
        include_negative=include_negative,
        include_edge=include_edge,
        include_security=include_security,
        include_load=include_load,
    ) - _kinds_present(flows)
    if still_missing:
        logger.warning("Spectrum layers still empty after fallback: %s", sorted(still_missing))

    _normalize_journey_bindings(flows, ops)
    filled = await _fill_missing_bodies_with_ai(ops, flows)
    # Prefer a larger effective budget when spectrum was just filled so KPIs stay populated
    trim_budget = max(budget, journey_steps + 20) if spectrum_meta.get("spectrum_fallback_flows") else budget
    flows = _trim_flows_to_budget(flows, trim_budget)

    if mock_data:
        try:
            from .postman import apply_fixtures_to_step

            for flow in flows:
                for step in flow.get("steps") or []:
                    if isinstance(step, dict):
                        apply_fixtures_to_step(step, mock_data)
        except Exception as exc:
            logger.debug("mock fixture apply skipped: %s", exc)

    step_count = sum(len(f.get("steps") or []) for f in flows)
    meta = {
        "llm_used": True,
        "ai_flows": len(flows),
        "ai_steps": step_count,
        "ai_batches": len(batches) + 1,
        "ai_journeys": journey_count,
        "bodies_filled": filled,
        "source": "llm",
        **spectrum_meta,
    }
    return flows, meta


async def ai_polish_insights(
    insights: dict[str, Any],
    *,
    failed_steps: list[dict[str, Any]],
) -> dict[str, Any]:
    """Rewrite RCA headline/root-cause/solution with LLM while keeping structure."""
    if not insights:
        return insights
    compact_fails = []
    for s in failed_steps[:12]:
        detail = s.get("detail") if isinstance(s.get("detail"), dict) else {}
        compact_fails.append(
            {
                "method": s.get("method"),
                "path": s.get("path"),
                "status": s.get("status"),
                "error": str(s.get("error") or "")[:200],
                "kind": s.get("kind") or detail.get("kind"),
            }
        )
    system = (
        "You are an API testing RCA assistant. "
        "Improve the executive summary for engineers. "
        "Return ONLY JSON with keys: headline, summary, primary_root_cause, primary_solution. "
        "Be concrete and actionable. No markdown."
    )
    user = (
        f"Heuristic insights:\n{json.dumps(insights, default=str)[:5000]}\n\n"
        f"Failed steps sample:\n{json.dumps(compact_fails, default=str)[:4000]}\n"
    )
    data = await invoke_llm_json(system, user)
    if not isinstance(data, dict):
        return insights
    out = dict(insights)
    for key in ("headline", "summary", "primary_root_cause", "primary_solution"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            out[key] = val.strip()[:1200]
    out["ai_polished"] = True
    return out


async def llm_heal_payload(
    body: dict[str, Any],
    *,
    status_code: int,
    error_text: str,
    request_schema: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """LLM fallback when regex self-heal cannot fix a 400/422/415 body."""
    if not isinstance(body, dict):
        return None
    system = (
        "You fix invalid API request JSON bodies. "
        "Return ONLY the corrected JSON object. No markdown."
    )
    user = (
        f"HTTP status: {status_code}\n"
        f"Error body/text:\n{(error_text or '')[:2500]}\n"
        f"Current request body:\n{json.dumps(body, default=str)[:4000]}\n"
        f"JSON Schema (optional):\n{json.dumps(request_schema or {}, default=str)[:4000]}\n"
        "Fix type mismatches, missing required fields, and array/object shape errors. "
        "Keep unrelated fields unchanged."
    )
    data = await invoke_llm_json(system, user)
    return data if isinstance(data, dict) else None

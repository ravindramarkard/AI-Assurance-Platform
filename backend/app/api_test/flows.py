"""Build the full OpenAPI testing spectrum: contract, E2E, edge, negative, security, load."""

from __future__ import annotations

import random
from typing import Any

from .deps import build_dependency_graph
from .postman import apply_fixtures_to_step
from .synth import synthesize_object, synthesize_params

INJECTION_PAYLOADS = [
    "' OR '1'='1",
    "<script>alert(1)</script>",
    "../../etc/passwd",
    "{{7*7}}",
]


def _capture_from_response(op: dict[str, Any], var_name: str, field: str) -> list[dict[str, str]]:
    """JSONPath extraction rules (extracted_post_id = response.body.id)."""
    return [
        {"var": var_name, "jsonpath": f"$.{field}"},
        {"var": "extracted_post_id", "jsonpath": f"$.{field}"},
        {"var": "extracted_id", "jsonpath": f"$.{field}"},
        {"var": field, "jsonpath": f"$.{field}"},
    ]


def _step_for_op(
    op: dict[str, Any],
    *,
    kind: str,
    captures: list[dict[str, str]] | None = None,
    expected_status: list[int] | None = None,
    skip_auth: bool = False,
    body_override: Any = None,
) -> dict[str, Any]:
    body = body_override
    if body is None and op.get("request_schema") and op["method"] in ("POST", "PUT", "PATCH"):
        synth_kind = "happy" if kind in ("contract", "e2e", "security", "load") else kind
        if kind == "edge":
            synth_kind = "edge"
        if kind == "negative":
            synth_kind = "negative"
        body = synthesize_object(op["request_schema"], kind=synth_kind)
    # Ensure array fields stay arrays for APIs like Petstore photoUrls
    if isinstance(body, dict) and kind not in ("negative",):
        for af in ("photoUrls", "tags"):
            if af in body and not isinstance(body[af], list):
                body[af] = [body[af]] if body[af] is not None else []
    params = synthesize_params(
        op.get("parameters") or [],
        kind="edge" if kind == "edge" else ("negative" if kind == "negative" else "happy"),
    )
    path = op["path"]
    for p in op.get("path_params") or []:
        path = path.replace("{" + p + "}", "{{" + p + "}}")
    if expected_status is None:
        if kind == "negative":
            # Include 500: negative probes validate error handling exists
            expected_status = [400, 401, 403, 404, 405, 422, 500]
        elif kind == "security":
            expected_status = [401, 403, 404, 400]
        elif kind == "edge":
            expected_status = [200, 201, 202, 204, 400, 404, 405, 422]
        else:
            # Petstore and many specs omit success codes — accept common 2xx + documented errors
            expected_status = [200, 201, 202, 204]
    step = {
        "operation_id": op["operation_id"],
        "method": op["method"],
        "path": path,
        "path_template": op["path"],
        "query": params.get("query") or {},
        "headers": params.get("header") or {},
        "body": body,
        "captures": captures or [],
        "expected_status": expected_status,
        "assert_schema": kind in ("contract", "e2e"),
        "kind": kind,
        "skip_auth": skip_auth,
    }
    if op.get("service_key"):
        step["service_key"] = op["service_key"]
    if op.get("service_id"):
        step["service_id"] = op["service_id"]
    return step


def _id_field(op: dict[str, Any]) -> str:
    rs = op.get("response_schema") or {}
    props = (rs.get("properties") or {}) if isinstance(rs, dict) else {}
    if isinstance(rs, dict) and rs.get("type") == "array" and isinstance(rs.get("items"), dict):
        props = (rs["items"].get("properties") or {}) if isinstance(rs["items"], dict) else {}
    for name in props:
        nl = name.lower()
        if nl == "id" or nl.endswith("_id") or nl.endswith("id"):
            return name
    return "id"


def generate_flows(
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
) -> list[dict[str, Any]]:
    """Allocate budget across all 6 spectrum layers so none are starved."""
    graph = build_dependency_graph(ops)
    by_id = {o["operation_id"]: o for o in ops}

    # Reserved slots (minimum) per layer; remainder goes to e2e.
    reserve = {
        "contract": max(3, budget // 10),
        "e2e": max(6, budget // 4),
        "edge": max(4, budget // 10) if include_edge else 0,
        "negative": max(6, budget // 8) if include_negative else 0,
        "security": max(6, budget // 8) if include_security else 0,
        "load": 1 if include_load else 0,
    }
    # normalize if sum > budget
    total_res = sum(reserve.values()) or 1
    if total_res > budget:
        scale = budget / total_res
        reserve = {k: max(1 if v else 0, int(v * scale)) for k, v in reserve.items()}

    buckets: dict[str, list[dict[str, Any]]] = {k: [] for k in reserve}

    # 1) Contract
    for op in ops:
        if len(buckets["contract"]) >= reserve["contract"]:
            break
        if not op.get("response_schema") or op.get("path_params"):
            continue
        buckets["contract"].append(
            {
                "name": f"Contract {op['operation_id']}",
                "kind": "contract",
                "resource": (op.get("tags") or [""])[0] if op.get("tags") else "",
                "steps": [_step_for_op(op, kind="contract")],
            }
        )

    # 2) E2E CRUD (limit chains)
    for resource, group in graph["groups"].items():
        if len(buckets["e2e"]) >= reserve["e2e"]:
            break
        posts = [o for o in group if o["method"] == "POST" and not o.get("path_params")]
        gets = [o for o in group if o["method"] == "GET"]
        patches = [o for o in group if o["method"] in ("PATCH", "PUT")]
        deletes = [o for o in group if o["method"] == "DELETE"]
        if not posts and not gets:
            continue
        steps: list[dict[str, Any]] = []
        if posts:
            post = posts[0]
            field = _id_field(post)
            created_var = f"{resource}_{field}"
            # Seed an explicit id in the body so chains work even when APIs omit response ids
            body = synthesize_object(post.get("request_schema"), kind="happy")
            seeded_id = random.randint(100000, 999999999)
            if isinstance(body, dict):
                body.setdefault("id", seeded_id)
                if "username" in (post.get("request_schema") or {}).get("properties", {}):
                    body.setdefault("username", f"user_{seeded_id}")
            step = _step_for_op(
                post,
                kind="e2e",
                captures=_capture_from_response(post, created_var, field),
                expected_status=[200, 201, 202, 204, 405],
                body_override=body if isinstance(body, dict) else None,
            )
            step["seed_var"] = {
                created_var: body.get("id") if isinstance(body, dict) else seeded_id,
                "extracted_post_id": body.get("id") if isinstance(body, dict) else seeded_id,
            }
            if isinstance(body, dict) and body.get("username"):
                step["seed_var"][f"{resource}_username"] = body["username"]
                step["seed_var"]["username"] = body["username"]
            steps.append(step)
            # only follow a few consumers to avoid huge chains with unresolved vars
            for consumer in (gets + patches + deletes)[:4]:
                if not consumer.get("path_params"):
                    if consumer["method"] == "GET":
                        steps.append(_step_for_op(consumer, kind="e2e"))
                    continue
                step = _step_for_op(
                    consumer, kind="e2e", expected_status=[200, 201, 202, 204, 404, 405]
                )
                p0 = consumer["path_params"][0]
                # Injection: target_post_id = {{extracted_post_id}}
                step["path"] = consumer["path"].replace(
                    "{" + p0 + "}", "{{extracted_post_id}}"
                )
                # fallback alias if extracted_post_id missing at runtime
                step["path_fallback"] = consumer["path"].replace(
                    "{" + p0 + "}", "{{" + created_var + "}}"
                )
                for p in consumer["path_params"][1:]:
                    step["path"] = step["path"].replace("{" + p + "}", "1")
                    if step.get("path_fallback"):
                        step["path_fallback"] = step["path_fallback"].replace("{" + p + "}", "1")
                step["expect_vars"] = ["extracted_post_id", created_var]
                steps.append(step)
        else:
            for g in gets[:2]:
                if not g.get("path_params"):
                    steps.append(_step_for_op(g, kind="e2e"))
        if steps:
            buckets["e2e"].append(
                {"name": f"E2E CRUD {resource}", "kind": "e2e", "resource": resource, "steps": steps}
            )

    # limited cross-resource chains
    for edge in graph["edges"][: max(0, reserve["e2e"] - len(buckets["e2e"]))]:
        src, dst = by_id.get(edge["from"]), by_id.get(edge["to"])
        if not src or not dst:
            continue
        var = edge["var"]
        steps = [
            _step_for_op(
                src,
                kind="e2e",
                captures=_capture_from_response(src, var, edge["capture"]),
                expected_status=[200, 201, 202, 204, 405],
            ),
            _step_for_op(dst, kind="e2e", expected_status=[200, 201, 202, 204, 404, 405]),
        ]
        steps[1]["path"] = dst["path"].replace(
            "{" + edge["inject"] + "}", "{{extracted_post_id}}"
        )
        steps[1]["path_fallback"] = dst["path"].replace(
            "{" + edge["inject"] + "}", "{{" + var + "}}"
        )
        for p in dst.get("path_params") or []:
            if p != edge["inject"]:
                steps[1]["path"] = steps[1]["path"].replace("{" + p + "}", "1")
                steps[1]["path_fallback"] = steps[1]["path_fallback"].replace("{" + p + "}", "1")
        steps[1]["expect_vars"] = ["extracted_post_id", var]
        buckets["e2e"].append(
            {
                "name": f"E2E Chain {src['operation_id']} → {dst['operation_id']}",
                "kind": "e2e",
                "resource": edge.get("inject") or "",
                "steps": steps,
            }
        )

    # 3) Edge
    if include_edge:
        for op in ops:
            if len(buckets["edge"]) >= reserve["edge"]:
                break
            if op["method"] not in ("POST", "PUT", "PATCH", "GET"):
                continue
            if not op.get("request_schema") and not op.get("parameters"):
                continue
            if op.get("path_params"):
                continue
            buckets["edge"].append(
                {
                    "name": f"Edge {op['operation_id']}",
                    "kind": "edge",
                    "resource": (op.get("tags") or [""])[0] if op.get("tags") else "",
                    "steps": [_step_for_op(op, kind="edge")],
                }
            )

    # 4) Negative
    if include_negative:
        for op in ops:
            if len(buckets["negative"]) >= reserve["negative"]:
                break
            if op["method"] not in ("POST", "PUT", "PATCH") or not op.get("request_schema"):
                continue
            if op.get("path_params"):
                continue
            buckets["negative"].append(
                {
                    "name": f"Negative {op['operation_id']}",
                    "kind": "negative",
                    "resource": (op.get("tags") or [""])[0] if op.get("tags") else "",
                    "steps": [_step_for_op(op, kind="negative")],
                }
            )
        for op in ops:
            if len(buckets["negative"]) >= reserve["negative"]:
                break
            if op["method"] != "GET" or not op.get("path_params"):
                continue
            step = _step_for_op(op, kind="negative", expected_status=[400, 404, 405])
            for p in op["path_params"]:
                step["path"] = step["path"].replace("{{" + p + "}}", "999999999").replace(
                    "{" + p + "}", "999999999"
                )
            buckets["negative"].append(
                {
                    "name": f"Negative missing {op['operation_id']}",
                    "kind": "negative",
                    "resource": "",
                    "steps": [step],
                }
            )

    # 5) Security
    if include_security:
        for op in [o for o in ops if o.get("security")]:
            if len(buckets["security"]) >= reserve["security"] // 2 + 1:
                break
            if op.get("path_params"):
                continue
            step = _step_for_op(
                op,
                kind="security",
                skip_auth=True,
                expected_status=[200, 201, 401, 403, 404, 405, 500],
            )
            step["security_probe"] = "missing_auth"
            buckets["security"].append(
                {
                    "name": f"Security missing-auth {op['operation_id']}",
                    "kind": "security",
                    "resource": "",
                    "steps": [step],
                }
            )
        for op in ops:
            if len(buckets["security"]) >= reserve["security"]:
                break
            if op["method"] not in ("POST", "PUT", "PATCH") or not op.get("request_schema"):
                continue
            if op.get("path_params"):
                continue
            body = synthesize_object(op["request_schema"], kind="happy")
            if isinstance(body, dict):
                injected = False
                for k, v in list(body.items()):
                    if isinstance(v, str):
                        body[k] = INJECTION_PAYLOADS[0]
                        injected = True
                        break
                if not injected:
                    body["_probe"] = INJECTION_PAYLOADS[1]
            step = _step_for_op(
                op,
                kind="security",
                body_override=body,
                expected_status=[200, 201, 400, 401, 403, 404, 405, 422, 500],
            )
            step["security_probe"] = "injection"
            buckets["security"].append(
                {
                    "name": f"Security injection {op['operation_id']}",
                    "kind": "security",
                    "resource": "",
                    "steps": [step],
                }
            )

    # 6) Load
    if include_load and reserve["load"]:
        candidates = [o for o in ops if o["method"] == "GET" and not o.get("path_params")]
        if not candidates:
            candidates = [o for o in ops if o["method"] == "POST" and not o.get("path_params")]
        if candidates:
            op = candidates[0]
            buckets["load"].append(
                {
                    "name": f"Load {op['operation_id']} x{load_vus}",
                    "kind": "load",
                    "resource": "",
                    "steps": [
                        _step_for_op(op, kind="load", expected_status=[200, 201, 202, 204, 405])
                    ],
                    "load_vus": load_vus,
                }
            )

    # Assemble in spectrum order
    order = ["contract", "e2e", "edge", "negative", "security", "load"]
    flows: list[dict[str, Any]] = []

    # Prefer Postman collection order as a dedicated E2E flow when available
    if collection_steps:
        flows.append(
            {
                "name": "Postman collection (recorded)",
                "kind": "e2e",
                "resource": "postman",
                "steps": list(collection_steps),
            }
        )

    for key in order:
        flows.extend(buckets[key])

    if not flows:
        for op in ops[: min(10, budget)]:
            flows.append(
                {
                    "name": f"E2E Smoke {op['operation_id']}",
                    "kind": "e2e",
                    "resource": "",
                    "steps": [_step_for_op(op, kind="e2e")],
                }
            )

    if mock_data:
        for flow in flows:
            flow["steps"] = [
                apply_fixtures_to_step(s, mock_data) for s in (flow.get("steps") or [])
            ]

    return flows[:budget]

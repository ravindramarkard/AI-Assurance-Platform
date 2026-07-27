"""Baseline vs current OpenAPI drift detection."""

from __future__ import annotations

import json
from typing import Any

from .parser import fingerprint_ops, normalize_operations, parse_spec_text


def _prop_names(schema: dict[str, Any] | None) -> set[str]:
    if not schema or not isinstance(schema, dict):
        return set()
    props = schema.get("properties")
    if isinstance(props, dict):
        return set(props.keys())
    if schema.get("type") == "array" and isinstance(schema.get("items"), dict):
        return _prop_names(schema["items"])
    return set()


def compute_drift(baseline_raw: str, current_raw: str) -> dict[str, Any]:
    try:
        base_doc = parse_spec_text(baseline_raw) if baseline_raw else {}
        cur_doc = parse_spec_text(current_raw) if current_raw else {}
    except ValueError as exc:
        return {"changes": [], "added": 0, "removed": 0, "modified": 0, "error": str(exc)}

    base_ops = {f"{o['method']} {o['path']}": o for o in normalize_operations(base_doc)}
    cur_ops = {f"{o['method']} {o['path']}": o for o in normalize_operations(cur_doc)}

    changes: list[dict[str, Any]] = []
    for key in sorted(cur_ops.keys() - base_ops.keys()):
        changes.append({"op": key, "kind": "added", "detail": "New operation"})
    for key in sorted(base_ops.keys() - cur_ops.keys()):
        changes.append({"op": key, "kind": "removed", "detail": "Removed operation"})

    for key in sorted(base_ops.keys() & cur_ops.keys()):
        b, c = base_ops[key], cur_ops[key]
        notes: list[str] = []
        bp, cp = _prop_names(b.get("request_schema")), _prop_names(c.get("request_schema"))
        added_req = cp - bp
        removed_req = bp - cp
        if added_req:
            notes.append(f"+ request fields: {', '.join(sorted(added_req))}")
        if removed_req:
            notes.append(f"- request fields: {', '.join(sorted(removed_req))}")
        br, cr = _prop_names(b.get("response_schema")), _prop_names(c.get("response_schema"))
        added_res = cr - br
        removed_res = br - cr
        if added_res:
            notes.append(f"+ response fields: {', '.join(sorted(added_res))}")
        if removed_res:
            notes.append(f"- response fields: {', '.join(sorted(removed_res))}")
        bp_params = {p.get("name") for p in (b.get("parameters") or []) if isinstance(p, dict)}
        cp_params = {p.get("name") for p in (c.get("parameters") or []) if isinstance(p, dict)}
        if cp_params - bp_params:
            notes.append(f"+ params: {', '.join(sorted(cp_params - bp_params))}")
        if bp_params - cp_params:
            notes.append(f"- params: {', '.join(sorted(bp_params - cp_params))}")
        if notes:
            changes.append({"op": key, "kind": "modified", "detail": "; ".join(notes)})

    return {
        "changes": changes,
        "added": sum(1 for c in changes if c["kind"] == "added"),
        "removed": sum(1 for c in changes if c["kind"] == "removed"),
        "modified": sum(1 for c in changes if c["kind"] == "modified"),
        "baseline_ops": len(base_ops),
        "current_ops": len(cur_ops),
    }


def ops_fingerprint_json(ops: list[dict[str, Any]]) -> str:
    return json.dumps(sorted(fingerprint_ops(ops)))

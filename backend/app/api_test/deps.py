"""Resource hierarchy and create→consume dependency mapping."""

from __future__ import annotations

import re
from typing import Any


def _resource_key(path: str) -> str:
    # /v1/orders/{id}/items -> orders
    parts = [p for p in path.strip("/").split("/") if p and not p.startswith("{")]
    return parts[-1] if parts else path


def _normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _schema_id_fields(schema: dict[str, Any] | None) -> list[str]:
    if not schema or not isinstance(schema, dict):
        return []
    props = schema.get("properties") or {}
    if not isinstance(props, dict):
        # unwrap array items
        if schema.get("type") == "array" and isinstance(schema.get("items"), dict):
            return _schema_id_fields(schema["items"])
        return []
    fields: list[str] = []
    for name in props:
        n = name.lower()
        if n == "id" or n.endswith("_id") or n.endswith("Id") or n.endswith("ID"):
            fields.append(name)
        elif n in ("uuid", "guid"):
            fields.append(name)
    # prefer shorter / common names first
    fields.sort(key=lambda x: (0 if x.lower() == "id" else 1, len(x)))
    return fields


def build_dependency_graph(ops: list[dict[str, Any]]) -> dict[str, Any]:
    """Map creators (POST/PUT) to consumers that need path/query IDs."""
    creators: list[dict[str, Any]] = []
    consumers: list[dict[str, Any]] = []

    for op in ops:
        method = op["method"]
        path = op["path"]
        entry = {
            "method": method,
            "path": path,
            "operation_id": op["operation_id"],
            "resource": _resource_key(path),
            "path_params": list(op.get("path_params") or []),
            "produces": _schema_id_fields(op.get("response_schema")),
            "tags": list(op.get("tags") or []),
        }
        if method in ("POST", "PUT") and not op.get("path_params"):
            creators.append(entry)
        if op.get("path_params") or method in ("GET", "PATCH", "PUT", "DELETE"):
            consumers.append(entry)

    edges: list[dict[str, Any]] = []
    for creator in creators:
        for field in creator["produces"] or ["id"]:
            fn = _normalize_name(field)
            for consumer in consumers:
                if creator["operation_id"] == consumer["operation_id"]:
                    continue
                # same resource family or param name match
                same_res = _normalize_name(creator["resource"]) in _normalize_name(
                    consumer["resource"]
                ) or _normalize_name(consumer["resource"]) in _normalize_name(creator["resource"])
                for param in consumer["path_params"]:
                    pn = _normalize_name(param)
                    if pn == fn or pn.endswith(fn) or fn.endswith(pn) or same_res and (
                        pn == "id" or pn.endswith("id")
                    ):
                        edges.append(
                            {
                                "from": creator["operation_id"],
                                "to": consumer["operation_id"],
                                "capture": field,
                                "inject": param,
                                "var": f"{creator['resource']}_{field}",
                            }
                        )
                        break

    # CRUD groups by resource
    groups: dict[str, list[dict[str, Any]]] = {}
    for op in ops:
        key = _resource_key(op["path"])
        groups.setdefault(key, []).append(op)

    return {"creators": creators, "consumers": consumers, "edges": edges, "groups": groups}

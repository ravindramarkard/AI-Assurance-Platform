"""SSRF guards for OpenAPI fetch and outbound API calls."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


class UnsafeURLError(ValueError):
    pass


def _is_private_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    return bool(
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def assert_safe_url(url: str, *, allow_private: bool = False) -> str:
    """Validate URL for outbound fetch. Raises UnsafeURLError if blocked."""
    raw = (url or "").strip()
    if not raw:
        raise UnsafeURLError("URL is empty")
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeURLError(f"Unsupported scheme: {parsed.scheme or '(none)'}")
    host = parsed.hostname
    if not host:
        raise UnsafeURLError("URL has no hostname")
    if host.lower() in ("localhost", "metadata.google.internal"):
        if not allow_private:
            raise UnsafeURLError(f"Host blocked: {host}")
        return raw
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise UnsafeURLError(f"Cannot resolve host: {host}") from exc
    if not allow_private:
        for info in infos:
            ip = info[4][0]
            if _is_private_ip(ip):
                raise UnsafeURLError(f"Private/reserved address blocked: {ip}")
    return raw

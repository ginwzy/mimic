"""HTML script URL extraction for Cebu Akamai abck / BMS."""

from __future__ import annotations

import re
from urllib.parse import urlparse

_SCRIPT_SRC_RE = re.compile(r'''(?i)<script[^>]*\ssrc\s*=\s*["']([^"']+)["']''')
_VERSIONED_SCRIPT_RE = re.compile(r'''src=["']([^"']*\?v=[^"']+)["']''')


def extract_bms_script(html: str) -> str | None:
    m = _VERSIONED_SCRIPT_RE.search(html)
    return m.group(1) if m else None


def extract_abck_script(html: str) -> str | None:
    sources = _SCRIPT_SRC_RE.findall(html)
    versioned = extract_bms_script(html)
    if versioned:
        prefix = "/" + versioned.split("?", 1)[0].lstrip("/").split("/", 1)[0] + "/"
        for src in sources:
            if src.startswith(prefix) and "?v=" not in src:
                return src
    # Extensionless Akamai sensor path
    for src in reversed(sources):
        p = urlparse(src)
        segs = [s for s in p.path.split("/") if s]
        if (
            not p.scheme
            and not p.netloc
            and p.path.startswith("/")
            and len(segs) >= 4
            and "." not in segs[-1]
        ):
            return src
    return None


def select_abck_bodies(
    bodies: list[str], post_count: int | None = None
) -> list[str]:
    """Pick abck bodies to POST. Default: first, second, last; --post-count N → first N."""
    if not bodies:
        return []
    if post_count is not None:
        return bodies[: max(0, post_count)]
    if len(bodies) == 1:
        return bodies[:1]
    if len(bodies) == 2:
        return bodies[:2]
    # first, second, last (deduped naturally when short)
    return [bodies[0], bodies[1], bodies[-1]]

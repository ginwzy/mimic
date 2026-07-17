"""Spawn Node mimic bridge to capture sensor POST bodies."""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path

from mimic_flow.logging import log

# Must match RESULT_PREFIX in test/cebu_capture.mjs
RESULT_MARKER = b"__CEBU_CAPTURE_RESULT__"


async def capture_bodies(
    *,
    bridge: Path,
    profile: str,
    page_url: str,
    page_html: str,
    script_url: str,
    script_source: str,
    cookies: str,
    max_posts: int,
    events: str,
    deadline_ms: int,
    script_timeout_ms: int,
) -> list[str]:
    if not bridge.is_file():
        raise RuntimeError(f"bridge missing: {bridge}")
    log(
        f"mimic capture start events={events} max_posts={max_posts} "
        f"deadline={deadline_ms}ms script_timeout={script_timeout_ms}ms "
        f"script={script_url} cookies={len([c for c in cookies.split(';') if '=' in c])}"
    )
    payload = json.dumps(
        {
            "pageUrl": page_url,
            "pageHtml": page_html,
            "scriptUrl": script_url,
            "scriptSource": script_source,
            "cookies": [c.strip() for c in cookies.split(";") if "=" in c],
            "profile": profile,
            "deadlineMs": deadline_ms,
            "maxPosts": max_posts,
            "scriptTimeoutMs": script_timeout_ms,
            "events": events,
        },
        ensure_ascii=False,
    ).encode()
    with tempfile.NamedTemporaryFile(
        prefix="mimic-capture-", suffix=".json", delete=False
    ) as f:
        f.write(payload)
        path = Path(f.name)
    try:
        log(f"mimic spawn node {bridge.name}")
        proc = await asyncio.create_subprocess_exec(
            "node",
            str(bridge),
            str(path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=deadline_ms / 1000 + script_timeout_ms / 1000 + 20,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError("mimic capture timed out") from None
    finally:
        path.unlink(missing_ok=True)

    _, found, rest = stdout.rpartition(RESULT_MARKER)
    if not found:
        detail = stderr.decode(errors="replace").strip()
        raise RuntimeError(
            "mimic bridge no result" + (f": {detail}" if detail else "")
        )
    result = json.loads(rest)
    if proc.returncode != 0 or not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(
            f"mimic capture failed: "
            f"{result.get('error') if isinstance(result, dict) else result}"
        )
    bodies = result.get("bodies")
    if not isinstance(bodies, list) or not all(isinstance(b, str) for b in bodies):
        raise RuntimeError("invalid sensor bodies from bridge")
    sizes = [len(b) for b in bodies]
    log(f"mimic capture done bodies={len(bodies)} sizes={sizes} rc={proc.returncode}")
    if stderr:
        err = stderr.decode(errors="replace").strip()
        if err:
            for line in err.splitlines()[-20:]:
                log(f"mimic stderr: {line}")
    return bodies

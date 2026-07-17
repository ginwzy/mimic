"""Concurrent workers: one proxy + client + flow per worker."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from time import time
from typing import Any

from mimic_flow import config
from mimic_flow.logging import log, worker_tag
from mimic_flow.proxy.base import ProxyProvider
from mimic_flow.runtime.context import FlowContext
from mimic_flow.session.client import make_client

# flow(ctx, **kwargs) -> result dict
FlowFn = Callable[..., Awaitable[dict[str, Any]]]


async def run_worker(
    worker_id: int,
    *,
    provider: ProxyProvider,
    flow: FlowFn,
    flow_kwargs: dict[str, Any] | None = None,
    bridge: Path | None = None,
    profile: str | None = None,
    default_cookie_url: str = "",
    client_timeout_s: float = 30,
) -> dict[str, Any]:
    """One full flow: build proxy → client → FlowContext → flow()."""
    with worker_tag(worker_id):
        started = time()
        kwargs = dict(flow_kwargs or {})
        log(f"worker start proxy={provider.name} kwargs={list(kwargs)}")
        try:
            built = provider.build()
            client = make_client(built.proxy, timeout_s=client_timeout_s)
            ctx = FlowContext(
                client=client,
                built_proxy=built,
                bridge=bridge or config.DEFAULT_BRIDGE,
                profile=profile or config.DEFAULT_PROFILE,
                default_cookie_url=default_cookie_url,
            )
            out = await flow(ctx, **kwargs)
            out.setdefault("worker", worker_id)
            out.setdefault("proxy", built.name)
            out.setdefault("proxy_meta", built.meta)
            out.setdefault("elapsed_s", round(time() - started, 2))
            if "ok" not in out:
                out["ok"] = True
            log(f"worker done ok={out.get('ok')} elapsed={out['elapsed_s']}s")
            return out
        except Exception as exc:
            log(f"FAILED: {type(exc).__name__}: {exc}")
            return {
                "worker": worker_id,
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "elapsed_s": round(time() - started, 2),
                "proxy": getattr(provider, "name", "?"),
            }


async def run_concurrent(
    concurrency: int,
    *,
    provider: ProxyProvider,
    flow: FlowFn,
    flow_kwargs: dict[str, Any] | None = None,
    bridge: Path | None = None,
    profile: str | None = None,
    default_cookie_url: str = "",
    client_timeout_s: float = 30,
) -> list[dict[str, Any]]:
    """Run N independent flows (each builds its own sticky proxy when applicable)."""
    log(f"concurrent start n={concurrency} proxy={provider.name}")
    tasks = [
        run_worker(
            i + 1,
            provider=provider,
            flow=flow,
            flow_kwargs=flow_kwargs,
            bridge=bridge,
            profile=profile,
            default_cookie_url=default_cookie_url,
            client_timeout_s=client_timeout_s,
        )
        for i in range(concurrency)
    ]
    results = await asyncio.gather(*tasks)
    ok_n = sum(1 for r in results if r.get("ok"))
    fail_n = concurrency - ok_n
    log(f"concurrent summary ok={ok_n} fail={fail_n} total={concurrency}")
    for r in results:
        wid = r.get("worker")
        if r.get("ok"):
            log(
                f"summary w{wid}: ok status={r.get('search_status')} "
                f"abck_posts={r.get('abck_post_count')} elapsed={r.get('elapsed_s')}s"
            )
        else:
            log(
                f"summary w{wid}: FAIL {r.get('error')} elapsed={r.get('elapsed_s')}s"
            )
    return list(results)

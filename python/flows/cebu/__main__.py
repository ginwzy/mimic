"""CLI: python -m flows.cebu --search --proxy lumi -j 3

Requires PYTHONPATH to include the python/ directory, e.g.:
  PYTHONPATH=python python -m flows.cebu --search
Or use the thin wrapper: python3 test/cebu_flow.py --search
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Allow `python -m flows.cebu` when cwd is repo root without installed package.
_PYTHON_ROOT = Path(__file__).resolve().parents[2]
if str(_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_ROOT))

from flows.cebu import constants as C
from flows.cebu.flow import run_flow
from mimic_flow.logging import log
from mimic_flow.proxy import make_proxy_provider
from mimic_flow.runtime import add_runtime_args, run_concurrent


async def async_main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Cebu www flow: abck + BMS → availability")
    p.add_argument("--search", action="store_true", help="call availability after init")
    p.add_argument(
        "--post-count",
        type=int,
        help="post first N _abck bodies (default: all captured)",
    )
    add_runtime_args(p)
    args = p.parse_args(argv)

    if args.concurrency < 1:
        log("concurrency must be >= 1")
        return 2

    provider = make_proxy_provider(args.proxy, country=args.country)
    log(
        f"start search={args.search} post_count={args.post_count} "
        f"concurrency={args.concurrency} proxy={args.proxy}"
        + (f" country={args.country}" if args.country else "")
    )

    results = await run_concurrent(
        args.concurrency,
        provider=provider,
        flow=run_flow,
        flow_kwargs={"do_search": args.search, "post_count": args.post_count},
        profile=C.PROFILE,
        default_cookie_url=C.SITE,
    )

    if not args.search:
        return 0 if all(r.get("ok") for r in results) else 1
    ok_n = sum(1 for r in results if r.get("search_success"))
    code = 0 if ok_n == len(results) else 1
    log(f"exit {code} search_ok={ok_n}/{len(results)}")
    return code


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(async_main(argv))


if __name__ == "__main__":
    raise SystemExit(main())

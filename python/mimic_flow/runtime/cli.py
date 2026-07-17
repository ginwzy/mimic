"""Shared CLI flags for flow entrypoints."""

from __future__ import annotations

import argparse

from mimic_flow.proxy.factory import PROXY_NAMES


def add_runtime_args(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    parser.add_argument(
        "--proxy",
        choices=PROXY_NAMES,
        default="lumi",
        help="egress proxy provider (default: lumi)",
    )
    parser.add_argument(
        "--country",
        default=None,
        metavar="CC",
        help="Lumi exit country ISO code (default: config/env LUMI_COUNTRY)",
    )
    parser.add_argument(
        "-j",
        "--concurrency",
        type=int,
        default=1,
        metavar="N",
        help="run N full flows in parallel (each own proxy+cookies); default 1",
    )
    return parser

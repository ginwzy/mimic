"""Stderr progress logging with optional per-worker tags."""

from __future__ import annotations

import sys
from contextlib import contextmanager
from contextvars import ContextVar
from time import time
from typing import Iterator

_T0 = time()
_WORKER: ContextVar[str] = ContextVar("worker", default="")


def log(msg: str) -> None:
    """Progress to stderr; always flush. Concurrent workers get [wN] prefix."""
    tag = _WORKER.get()
    prefix = f"[{tag}] " if tag else ""
    print(f"[{time() - _T0:6.1f}s] {prefix}{msg}", file=sys.stderr, flush=True)


@contextmanager
def worker_tag(worker_id: int) -> Iterator[None]:
    token = _WORKER.set(f"w{worker_id}")
    try:
        yield
    finally:
        _WORKER.reset(token)

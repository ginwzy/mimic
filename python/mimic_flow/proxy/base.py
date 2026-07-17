"""Proxy provider protocol and built proxy value."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from rnet import Proxy


@dataclass(frozen=True)
class BuiltProxy:
    """Result of ProxyProvider.build(); proxy=None means direct (no CONNECT)."""

    name: str
    proxy: Proxy | None
    meta: dict[str, Any] = field(default_factory=dict)


class ProxyProvider(Protocol):
    """One provider per worker build — Lumi sticky sessions must not be shared."""

    name: str

    def build(self) -> BuiltProxy: ...

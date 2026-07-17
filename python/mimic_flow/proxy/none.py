"""Direct egress (no proxy) — local environment regression baseline."""

from __future__ import annotations

from dataclasses import dataclass

from mimic_flow.logging import log
from mimic_flow.proxy.base import BuiltProxy


@dataclass
class NoProxy:
    name: str = "none"

    def build(self) -> BuiltProxy:
        log("proxy=none (direct)")
        return BuiltProxy(name=self.name, proxy=None, meta={})

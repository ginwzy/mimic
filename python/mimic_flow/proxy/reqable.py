"""Reqable HTTP CONNECT proxy (local capture)."""

from __future__ import annotations

from dataclasses import dataclass

from rnet import Proxy

from mimic_flow import config
from mimic_flow.logging import log
from mimic_flow.proxy.base import BuiltProxy


@dataclass
class ReqableProxy:
    name: str = "reqable"
    url: str = config.REQABLE_PROXY

    def build(self) -> BuiltProxy:
        log(f"reqable proxy url={self.url}")
        return BuiltProxy(
            name=self.name,
            proxy=Proxy.all(self.url),
            meta={"url": self.url},
        )

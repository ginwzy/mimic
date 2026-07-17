"""MITM HTTP CONNECT proxy with optional ClientHello id header."""

from __future__ import annotations

from dataclasses import dataclass, field

from rnet import Proxy

from mimic_flow import config
from mimic_flow.logging import log
from mimic_flow.proxy.base import BuiltProxy


@dataclass
class MitmProxy:
    name: str = "mitm"
    url: str = config.MITM_PROXY
    clienthello_id: str = config.MITM_CLIENTHELLO_ID
    extra_headers: dict[str, str] = field(default_factory=dict)

    def build(self) -> BuiltProxy:
        headers = {"X-ClientHello-Id": self.clienthello_id, **self.extra_headers}
        log(f"mitm proxy url={self.url} clienthello={self.clienthello_id}")
        return BuiltProxy(
            name=self.name,
            proxy=Proxy.all(self.url, custom_http_headers=headers),
            meta={"url": self.url, "clienthello_id": self.clienthello_id},
        )

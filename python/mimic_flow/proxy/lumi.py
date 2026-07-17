"""Bright Data (Luminati) residential proxy with sticky session."""

from __future__ import annotations

import secrets
from dataclasses import dataclass

from rnet import Proxy

from mimic_flow import config
from mimic_flow.logging import log
from mimic_flow.proxy.base import BuiltProxy


@dataclass
class LumiProxy:
    """Fixed country + unique sticky session per build()."""

    name: str = "lumi"
    country: str = config.LUMI_COUNTRY
    url: str = config.LUMI_PROXY_URL
    customer_zone: str = config.LUMI_CUSTOMER_ZONE
    password: str = config.LUMI_PASSWORD

    def build(self, *, session_id: str | None = None) -> BuiltProxy:
        # Alphanumeric only — Bright Data rejects session values with '-' / '*'.
        # Do not invent username params like sessionduration (→ ProxyAuthRequired).
        sid = session_id or secrets.token_hex(8)
        user = (
            f"{self.customer_zone}-country-{self.country}"
            f"-session-{sid}-route_err-block"
        )
        log(f"lumi proxy country={self.country} session={sid} url={self.url}")
        return BuiltProxy(
            name=self.name,
            proxy=Proxy.all(self.url, username=user, password=self.password),
            meta={"country": self.country, "session": sid, "url": self.url},
        )

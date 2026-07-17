"""Build a ProxyProvider by name."""

from __future__ import annotations

from mimic_flow.proxy.base import ProxyProvider
from mimic_flow.proxy.lumi import LumiProxy
from mimic_flow.proxy.mitm import MitmProxy
from mimic_flow.proxy.none import NoProxy
from mimic_flow.proxy.reqable import ReqableProxy

PROXY_NAMES = ("lumi", "none", "reqable", "mitm")


def make_proxy_provider(
    name: str,
    *,
    country: str | None = None,
) -> ProxyProvider:
    key = name.strip().lower()
    if key == "lumi":
        return LumiProxy(country=country) if country else LumiProxy()
    if key == "none":
        return NoProxy()
    if key == "reqable":
        return ReqableProxy()
    if key == "mitm":
        return MitmProxy()
    raise ValueError(f"unknown proxy {name!r}; choose from {', '.join(PROXY_NAMES)}")

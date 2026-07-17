"""rnet Client factory with browser TLS emulation."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from rnet import Client, Emulation, EmulationOS, EmulationOption, Policy, Proxy


def make_client(
    proxy: Proxy | None = None,
    *,
    timeout_s: float = 30,
    emulation: Emulation = Emulation.Chrome144,
    emulation_os: EmulationOS = EmulationOS.Android,
    cookie_store: bool = True,
    verify: bool = False,
    redirect_limit: int = 10,
) -> Client:
    """Build an rnet Client. proxy=None → direct egress (no proxies key)."""
    kwargs: dict[str, Any] = {
        "emulation": EmulationOption(emulation=emulation, emulation_os=emulation_os),
        "cookie_store": cookie_store,
        "timeout": timedelta(seconds=timeout_s),
        "redirect": Policy.limited(redirect_limit),
        "verify": verify,
    }
    if proxy is not None:
        kwargs["proxies"] = [proxy]
    return Client(**kwargs)

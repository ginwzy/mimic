"""Environment-backed defaults for proxies and capture bridge."""

from __future__ import annotations

import os
from pathlib import Path

# Repo root: python/mimic_flow/config.py → parents[2]
_REPO_ROOT = Path(__file__).resolve().parents[2]


def _env(key: str, default: str) -> str:
    v = os.environ.get(key)
    return v if v is not None and v != "" else default


# --- Lumi (Bright Data) ---
LUMI_PROXY_URL = _env(
    "LUMI_PROXY_URL", "http://servercountry-gb.brd.superproxy.io:22225/"
)
LUMI_CUSTOMER_ZONE = _env(
    "LUMI_CUSTOMER_ZONE", "lum-customer-travel_fusion-zone-gen"
)
LUMI_PASSWORD = _env("LUMI_PASSWORD", "j48ly0d63top")
LUMI_COUNTRY = _env("LUMI_COUNTRY", "gb")

# --- Local / MITM proxies ---
REQABLE_PROXY = _env("REQABLE_PROXY", "http://10.5.2.79:9001")
MITM_PROXY = _env("MITM_PROXY", "http://95.179.202.136:24800")
MITM_CLIENTHELLO_ID = _env("MITM_CLIENTHELLO_ID", "hellochrome_150")

# --- Mimic capture bridge (Node) ---
DEFAULT_BRIDGE = Path(
    _env(
        "MIMIC_CAPTURE_BRIDGE",
        str(_REPO_ROOT / "test" / "cebu_capture.mjs"),
    )
)
DEFAULT_PROFILE = _env("MIMIC_PROFILE", "android-chrome/2201116sg-v138-10025")

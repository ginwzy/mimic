"""Cookie jar helpers (site-agnostic)."""

from __future__ import annotations

import re
from time import time
from urllib.parse import urlparse

from rnet import Client


def cookie_header(client: Client, url: str) -> str:
    """Serialize jar cookies matching url host into a Cookie header string."""
    jar = client.cookie_jar
    if jar is None:
        return ""
    host = (urlparse(url).hostname or "").lower()
    pairs = []
    for c in jar.get_all():
        domain = (c.domain or "").lstrip(".").lower()
        if domain and (host == domain or host.endswith("." + domain)):
            pairs.append(f"{c.name}={c.value}")
    return "; ".join(pairs)


def filter_cookies(cookie: str, names: frozenset[str]) -> str:
    """Keep only named cookies, preserving first-seen order."""
    order, values = [], {}
    for item in cookie.split(";"):
        piece = item.strip()
        if not piece or "=" not in piece:
            continue
        name, value = piece.split("=", 1)
        if name not in names:
            continue
        if name not in values:
            order.append(name)
        values[name] = value
    return "; ".join(f"{n}={values[n]}" for n in order)


def cookie_value(cookie: str, name: str) -> str | None:
    for item in cookie.split(";"):
        piece = item.strip()
        if not piece or "=" not in piece:
            continue
        n, v = piece.split("=", 1)
        if n == name:
            return v
    return None


def cookie_names(cookie: str) -> list[str]:
    names = []
    for item in cookie.split(";"):
        piece = item.strip()
        if not piece or "=" not in piece:
            continue
        names.append(piece.split("=", 1)[0])
    return names


def enrich_bm_lso(cookie: str) -> str:
    """Browser sets bm_lso from bm_so client-side; jar may not have it."""
    if not cookie.strip():
        return cookie
    order, values = [], {}
    for item in cookie.split(";"):
        piece = item.strip()
        if not piece or "=" not in piece:
            continue
        name, value = piece.split("=", 1)
        if name not in values:
            order.append(name)
        values[name] = value
    bm_so = values.get("bm_so")
    if bm_so and "bm_lso" not in values:
        if re.search(r"~\d{10,}$", bm_so):
            values["bm_lso"] = bm_so
        else:
            values["bm_lso"] = f"{bm_so}~{int(time() * 1000)}"
        order.append("bm_lso")
    return "; ".join(f"{n}={values[n]}" for n in order)

"""Thin logged HTTP helpers over rnet Client."""

from __future__ import annotations

from rnet import Client, Jar

from mimic_flow.logging import log


async def http_get(client: Client, url: str, headers: dict) -> tuple[int, str]:
    log(f"GET {url}")
    r = await client.get(url, headers=headers)
    status = r.status.as_int()
    body = bytes(await r.bytes()).decode("utf-8", errors="replace")
    await r.close()
    log(f"GET done HTTP {status} body={len(body)}B")
    return status, body


async def http_post(
    client: Client,
    url: str,
    headers: dict,
    body: str,
    *,
    orig_headers: list[str] | None = None,
    cookies: str | dict | None = None,
    cookie_provider: Jar | None = None,
    label: str = "",
) -> tuple[int, str]:
    tag = label or "POST"
    log(f"{tag} {url} body={len(body)}B")
    kwargs: dict = {"headers": headers, "body": body}
    if orig_headers is not None:
        kwargs["orig_headers"] = orig_headers
    if cookies is not None:
        kwargs["cookies"] = cookies
    if cookie_provider is not None:
        kwargs["cookie_provider"] = cookie_provider
    r = await client.post(url, **kwargs)
    status = r.status.as_int()
    text = bytes(await r.bytes()).decode("utf-8", errors="replace")
    await r.close()
    log(f"{tag} done HTTP {status} resp={len(text)}B")
    return status, text

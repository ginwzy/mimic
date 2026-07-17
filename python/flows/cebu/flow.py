"""Cebu business flow: select-flight → abck → BMS → optional availability."""

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import urljoin

from rnet import Jar

from flows.cebu import constants as C
from flows.cebu.parse import (
    extract_abck_script,
    extract_bms_script,
    select_abck_bodies,
)
from mimic_flow.logging import log
from mimic_flow.runtime.context import FlowContext
from mimic_flow.session.cookies import (
    cookie_names,
    cookie_value,
    enrich_bm_lso,
    filter_cookies,
)


def browser_headers() -> dict:
    return {
        "user-agent": C.UA,
        "sec-ch-ua": C.SEC_CH_UA,
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
    }


def log_abck_tilde0(cookie: str, where: str) -> None:
    abck = cookie_value(cookie, "_abck")
    if abck is None:
        log(f"{where} _abck: missing")
        return
    has = "~0~" in abck
    log(f"{where} _abck has ~0~: {has} (len={len(abck)} preview={abck[:48]}...)")


async def initialize(ctx: FlowContext, post_count: int | None = None) -> dict:
    base = browser_headers()
    log("=== init: select-flight ===")
    status, html = await ctx.get(
        C.SELECT_FLIGHT,
        {
            **base,
            "upgrade-insecure-requests": "1",
            "accept": C.DOC_ACCEPT,
            "sec-fetch-site": "same-origin",
            "sec-fetch-mode": "navigate",
            "sec-fetch-user": "?1",
            "sec-fetch-dest": "document",
            "accept-language": C.ACCEPT_LANG,
        },
    )
    if status != 200:
        raise RuntimeError(f"select-flight HTTP {status}")
    initial_cookies = ctx.cookies(C.SITE)
    log(f"select-flight cookies ({len(cookie_names(initial_cookies))}): {cookie_names(initial_cookies)}")

    script_hdrs = {
        **base,
        "accept": "*/*",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-dest": "script",
        "referer": C.SELECT_FLIGHT,
        "accept-language": C.ACCEPT_LANG,
    }

    # Real HAR order: abck multi-POST first, BMS later. Match that for soar.
    abck_path = extract_abck_script(html)
    if not abck_path:
        raise RuntimeError("abck script not found")
    abck_url = urljoin(C.SITE + "/", abck_path)
    log(f"=== init: abck script {abck_path} ===")
    st, abck_src = await ctx.get(abck_url, script_hdrs)
    if st != 200:
        raise RuntimeError(f"abck script HTTP {st}")
    log(f"abck script source {len(abck_src)}B")

    sensor_bodies = await ctx.capture(
        page_url=C.SELECT_FLIGHT,
        page_html=html,
        script_url=abck_url,
        script_source=abck_src,
        max_posts=8,
        events="abck",
        deadline_ms=5000,
        script_timeout_ms=12_000,
    )
    if not sensor_bodies:
        raise RuntimeError("no _abck bodies captured")

    # Default: first, second, last (see select_abck_bodies). --post-count N → first N.
    to_post = select_abck_bodies(sensor_bodies, post_count=post_count)
    log(
        f"abck will post {len(to_post)}/{len(sensor_bodies)} bodies "
        f"(policy={'first-N=' + str(post_count) if post_count is not None else '1st+2nd+last'})"
    )
    abck_post = {
        **base,
        "content-type": "text/plain;charset=UTF-8",
        "accept": C.DOC_ACCEPT,
        "origin": C.SITE,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "referer": C.SELECT_FLIGHT,
        "accept-language": C.ACCEPT_LANG,
    }
    post_url = abck_url.split("?", 1)[0]
    for i, body in enumerate(to_post, 1):
        await asyncio.sleep(0.15)
        st, _ = await ctx.post(
            post_url, abck_post, body, label=f"_abck POST {i}/{len(to_post)}"
        )
        if st >= 400:
            raise RuntimeError(f"_abck POST HTTP {st}")

    bms_url = None
    bms_posted = False
    bms_path = extract_bms_script(html)
    if bms_path:
        bms_url = urljoin(C.SITE + "/", bms_path)
        log(f"=== init: BMS script {bms_path} ===")
        st, bms_src = await ctx.get(bms_url, script_hdrs)
        if st != 200:
            raise RuntimeError(f"BMS script HTTP {st}")
        log(f"BMS script source {len(bms_src)}B")
        bodies = await ctx.capture(
            page_url=C.SELECT_FLIGHT,
            page_html=html,
            script_url=bms_url,
            script_source=bms_src,
            max_posts=1,
            events="none",
            deadline_ms=4000,
            script_timeout_ms=12_000,
        )
        if bodies:
            bms_posted = True
            st, _ = await ctx.post(
                bms_url.split("?", 1)[0],
                {
                    **base,
                    "content-type": "application/json",
                    "accept": "application/json",
                    "origin": C.SITE,
                    "sec-fetch-site": "same-origin",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-dest": "empty",
                    "referer": C.SELECT_FLIGHT,
                    "accept-language": C.ACCEPT_LANG,
                },
                bodies[0],
                label="BMS POST",
            )
            if st >= 400:
                raise RuntimeError(f"BMS POST HTTP {st}")
            log(f"BMS posted ok; cookies={ctx.cookies(C.SITE)[:120]}...")
        else:
            log("BMS capture empty, skip post")
    else:
        log("no BMS script on page")

    cookies = ctx.cookies(C.SITE)
    names = cookie_names(enrich_bm_lso(cookies))
    log(f"=== init done cookies ({len(names)}): {names} ===")
    log_abck_tilde0(cookies, "init")
    return {
        "initial_status": status,
        "initial_cookies": initial_cookies,
        "cookies": cookies,
        "bms_script_url": bms_url,
        "abck_script_url": abck_url,
        "bms_posted": bms_posted,
        "abck_body_count": len(sensor_bodies),
        "abck_post_count": len(to_post),
        "cookie_names": names,
    }


async def search(ctx: FlowContext, body: str = C.DEFAULT_BODY) -> dict:
    log("=== search: availability ===")
    cookie = filter_cookies(
        ctx.cookies(C.SEARCH_URL), C.SEARCH_COOKIE_NAMES
    )
    log_abck_tilde0(cookie, "search")
    cnames = cookie_names(cookie)
    log(f"search cookie names ({len(cnames)}): {cnames}")
    headers = {
        **browser_headers(),
        "accept": C.SEARCH_ACCEPT,
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": C.ACCEPT_LANG,
        "authorization": C.AUTHORIZATION,
        "content-type": "application/json",
        "origin": C.SITE,
        "priority": "u=1, i",
        "referer": C.SITE + "/",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "x-auth-token": C.X_AUTH_TOKEN,
        "x-path": C.X_PATH,
    }
    status, text = await ctx.post(
        C.SEARCH_URL,
        headers,
        body,
        orig_headers=C.SEARCH_HEADER_ORDER,
        cookies=cookie or {},
        cookie_provider=Jar(),
        label="availability POST",
    )
    ok = status == 401
    log(f"search result HTTP {status} success={ok} body_preview={text[:200]!r}")
    return {"search_status": status, "search_success": ok, "search_body": text}


async def run_flow(
    ctx: FlowContext,
    *,
    do_search: bool = False,
    post_count: int | None = None,
) -> dict[str, Any]:
    """Full Cebu flow for one worker (called by mimic_flow runtime)."""
    out: dict[str, Any] = {}
    out.update(await initialize(ctx, post_count=post_count))
    if do_search:
        out.update(await search(ctx))
    else:
        out.update(search_status=None, search_success=None, search_body=None)
        log("init-only, skip search")
    out["ok"] = (not do_search) or bool(out.get("search_success"))
    return out

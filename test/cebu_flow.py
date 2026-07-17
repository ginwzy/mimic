"""Cebu www flow smoke test: mimic sensor bodies → cookies → availability."""

import argparse
import asyncio
import json
import re
import secrets
import sys
import tempfile
from contextvars import ContextVar
from datetime import timedelta
from pathlib import Path
from time import time
from typing import Any
from urllib.parse import urljoin, urlparse

from rnet import Client, Emulation, EmulationOS, EmulationOption, Jar, Policy, Proxy

_T0 = time()
_WORKER: ContextVar[str] = ContextVar("worker", default="")


def log(msg: str) -> None:
    """Progress to stderr; always flush. Concurrent workers get [wN] prefix."""
    tag = _WORKER.get()
    prefix = f"[{tag}] " if tag else ""
    print(f"[{time() - _T0:6.1f}s] {prefix}{msg}", file=sys.stderr, flush=True)

SITE = "https://www.cebupacificair.com"
# HTTP CONNECT proxy; X-ClientHello-Id is sent on the CONNECT hop.
REQABLE_PROXY = "http://10.5.2.79:9001"
MITM_PROXY = "http://95.179.202.136:24800"
PROXY_HEADERS = {"X-ClientHello-Id": "hellochrome_150"}
LUMI_PROXY_URL = "http://servercountry-gb.brd.superproxy.io:22225/"
# Single fixed exit country (no random multi-country). Sticky pin is per-flow session id.
LUMI_COUNTRY = "gb"
# Zone credentials (username prefix + zone password). Optional params go on the username.
LUMI_CUSTOMER_ZONE = "lum-customer-travel_fusion-zone-gen"
LUMI_PASSWORD = "j48ly0d63top"
SELECT_FLIGHT = f"{SITE}/en-PH/booking/select-flight"
SEARCH_URL = "https://soar.cebupacificair.com/ceb-omnix-proxy-v3/availability"
BRIDGE = Path(__file__).with_name("cebu_capture.mjs")
PROFILE = "android-chrome/2201116sg-v138-10025"

UA = (
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36"
)
SEC_CH_UA = '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"'
ACCEPT_LANG = "dz-BT,dz;q=0.9,en;q=0.8"
DOC_ACCEPT = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
    "image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
)
SEARCH_ACCEPT = "application/json, text/plain, */*"

# Captured Web v3 availability sample. Session cookies (_abck/bm_s) from init.
# HTTP 401 = bot passed + stale/invalid anonymous auth.
AUTHORIZATION = "Bearer ff020ca4a2a0MoV5doJAgndROj90LA3trQleGE"
X_AUTH_TOKEN = (
    "837bd9b7a6U2FsdGVkX1+v2jUFaYmhWijDL3pyl5Fa0cAtWT4qTfyTcDmYs3UktAk/6Xip/co7"
    "QmhmOZscQ/n9FmOGKotA1WSFd6Uo1Hbyr+4TyDl3d26NnQ7HP/n7UtMV/PQBCuFGbgv192DfK+L"
    "xsiIQRDmcnInOzkUvFRFmG9BHwpyUYE8131ZItFKgqHcgHIT2oeKR5JZ3urZGfX4QQQpH7O0Tt9"
    "QJuvWsI6yY7AyEG2/pVYFgW4D8BVLLW0+7Mryt8p7JUGOEqdX7wIf24xU9rXxh/VjWTbzOBFKPV"
    "GSJfVU4HGg="
)
X_PATH = "U2FsdGVkX19lEh6mUmJtjvofU5TNrKriSc6QSUKLV3c="
DEFAULT_BODY = (
    '{"content":"U2FsdGVkX1++rgeTvC4KykMJNXMS9no1//kQGagNJcFIBev2I3hvbq9PYpRS3P0rheYk'
    "pM29yAljeQkee4+GW26MTrimeyjvmZ5cParoSzDOWoLEFGdLkqqH0OOVTx8CgN9xmIfXmuGva4E5"
    "u0AprbAQn+y53Slw3HoN4+r3pSoruQ55c27Fhd+5S1r755eAlHmixHDOoZnlFYlil2uCMi8Hogre"
    "woYw53VBdMNRv0mjQg+3Quvmmpoukqd+a2owfVmXv1x32Gc39VfQg7599qBfW4IB0VlTZjmt00ZN"
    "o6arsAcPVe2c+f52IrWtVyAcOxBzEYwlD9L48vKFNa91IdWtQ837bd9b7a6U2FsdGVkX1+v2jUFa"
    "YmhWijDL3pyl5Fa0cAtWT4qTfyTcDmYs3UktAk/6Xip/co7QmhmOZscQ/n9FmOGKotA1WSFd6Uo1"
    "Hbyr+4TyDl3d26NnQ7HP/n7UtMV/PQBCuFGbgv192DfK+LxsiIQRDmcnInOzkUvFRFmG9BHwpyUY"
    "E8131ZItFKgqHcgHIT2oeKR5JZ3urZGfX4QQQpH7O0Tt9QJuvWsI6yY7AyEG2/pVYFgW4D8BVLLW"
    "0+7Mryt8p7JUGOEqdX7wIf24xU9rXxh/VjWTbzOBFKPVGSJfVU4HGg=00bl1Uu+EOl6trV9nAcSt"
    "tyCdCzJB/8UCj08cg5r95tPNKliv9hJy1u+tSxBpbTHBPWoCCEB1LSIr2fexlzMZDHjUD3wCUEP5"
    "7HSoxqBs+M0yTCTeKiZUPMJFxNGKff020ca4a2a0MoV5doJAgndROj90LA3trQleGEMtLONGsOTo"
    "HbcI3p6LXJLelHon55uDE0fgHNe2NtohsHawwRsHJ66rWfGaMbAapGPJTw/VvGefYB7ON6EnENwL"
    "ZtR/36t/FpsC0dWx050fa2ZPsTNIhYCeUh+ul0Xk8/zKIfePfbWLENpKsSurlUGXbj1FaCc8doXt"
    'iqK/EVEO"}'
)

_SCRIPT_SRC_RE = re.compile(r'''(?i)<script[^>]*\ssrc\s*=\s*["']([^"']+)["']''')
_VERSIONED_SCRIPT_RE = re.compile(r'''src=["']([^"']*\?v=[^"']+)["']''')


def browser_headers() -> dict:
    return {
        "user-agent": UA,
        "sec-ch-ua": SEC_CH_UA,
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
    }


def get_lumi_proxy(
    *,
    country: str = LUMI_COUNTRY,
    session_id: str | None = None,
) -> Proxy:
    """Bright Data residential: fixed country + unique sticky session for this Client.

    Each call mints a new alphanumeric session id so concurrent workers do not
    share an exit IP. Stickiness is Bright Data's default session TTL (re-use the
    same session id for the whole Client lifetime — do not invent invalid params
    like sessionduration; those yield ProxyAuthRequired / 407).
    """
    # Alphanumeric only — Bright Data rejects session values with '-' / '*'.
    sid = session_id or secrets.token_hex(8)
    user = (
        f"{LUMI_CUSTOMER_ZONE}-country-{country}"
        f"-session-{sid}-route_err-block"
    )
    log(f"lumi proxy country={country} session={sid} url={LUMI_PROXY_URL}")
    # Native username/password → CONNECT Proxy-Authorization (more reliable than
    # stuffing Basic into custom_http_headers under concurrency).
    return Proxy.all(
        LUMI_PROXY_URL,
        username=user,
        password=LUMI_PASSWORD,
    )

def get_mitm_proxy() -> Proxy:
    """MITM HTTP CONNECT proxy; X-ClientHello-Id header on CONNECT hop."""
    return Proxy.all(
        MITM_PROXY,
        custom_http_headers=PROXY_HEADERS,
    )

def cookie_header(client: Client, url: str = SITE) -> str:
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


def extract_bms_script(html: str) -> str | None:
    m = _VERSIONED_SCRIPT_RE.search(html)
    return m.group(1) if m else None


def extract_abck_script(html: str) -> str | None:
    sources = _SCRIPT_SRC_RE.findall(html)
    versioned = extract_bms_script(html)
    if versioned:
        prefix = "/" + versioned.split("?", 1)[0].lstrip("/").split("/", 1)[0] + "/"
        for src in sources:
            if src.startswith(prefix) and "?v=" not in src:
                return src
    # Extensionless Akamai sensor path
    for src in reversed(sources):
        p = urlparse(src)
        segs = [s for s in p.path.split("/") if s]
        if not p.scheme and not p.netloc and p.path.startswith("/") and len(segs) >= 4 and "." not in segs[-1]:
            return src
    return None


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


async def capture_bodies(
    page_url: str,
    page_html: str,
    script_url: str,
    script_source: str,
    cookies: str,
    *,
    max_posts: int,
    events: str,
    deadline_ms: int,
    script_timeout_ms: int,
) -> list[str]:
    if not BRIDGE.is_file():
        raise RuntimeError(f"bridge missing: {BRIDGE}")
    log(
        f"mimic capture start events={events} max_posts={max_posts} "
        f"deadline={deadline_ms}ms script_timeout={script_timeout_ms}ms "
        f"script={script_url} cookies={len([c for c in cookies.split(';') if '=' in c])}"
    )
    payload = json.dumps(
        {
            "pageUrl": page_url,
            "pageHtml": page_html,
            "scriptUrl": script_url,
            "scriptSource": script_source,
            "cookies": [c.strip() for c in cookies.split(";") if "=" in c],
            "profile": PROFILE,
            "deadlineMs": deadline_ms,
            "maxPosts": max_posts,
            "scriptTimeoutMs": script_timeout_ms,
            "events": events,
        },
        ensure_ascii=False,
    ).encode()
    with tempfile.NamedTemporaryFile(prefix="cebu-capture-", suffix=".json", delete=False) as f:
        f.write(payload)
        path = Path(f.name)
    try:
        log(f"mimic spawn node {BRIDGE.name}")
        proc = await asyncio.create_subprocess_exec(
            "node", str(BRIDGE), str(path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=deadline_ms / 1000 + script_timeout_ms / 1000 + 20,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError("mimic capture timed out") from None
    finally:
        path.unlink(missing_ok=True)

    marker = b"__CEBU_CAPTURE_RESULT__"
    _, found, rest = stdout.rpartition(marker)
    if not found:
        detail = stderr.decode(errors="replace").strip()
        raise RuntimeError("mimic bridge no result" + (f": {detail}" if detail else ""))
    result = json.loads(rest)
    if proc.returncode != 0 or not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"mimic capture failed: {result.get('error') if isinstance(result, dict) else result}")
    bodies = result.get("bodies")
    if not isinstance(bodies, list) or not all(isinstance(b, str) for b in bodies):
        raise RuntimeError("invalid sensor bodies from bridge")
    sizes = [len(b) for b in bodies]
    log(f"mimic capture done bodies={len(bodies)} sizes={sizes} rc={proc.returncode}")
    if stderr:
        err = stderr.decode(errors="replace").strip()
        if err:
            for line in err.splitlines()[-20:]:
                log(f"mimic stderr: {line}")
    return bodies


def select_abck_bodies(bodies: list[str], post_count: int | None = None) -> list[str]:
    """Pick abck bodies to POST. Default: first, second, last (deduped if short)."""
    if not bodies:
        return []
    if post_count is not None:
        return bodies[: max(0, post_count)]
    if len(bodies) == 1:
        return bodies[:1]
    if len(bodies) == 2:
        return bodies[:2]
    # first, second, last
    return [bodies[0], bodies[1], bodies[-1]]


async def initialize(client: Client, post_count: int | None = None) -> dict:
    base = browser_headers()
    log("=== init: select-flight ===")
    status, html = await http_get(
        client,
        SELECT_FLIGHT,
        {
            **base,
            "upgrade-insecure-requests": "1",
            "accept": DOC_ACCEPT,
            "sec-fetch-site": "same-origin",
            "sec-fetch-mode": "navigate",
            "sec-fetch-user": "?1",
            "sec-fetch-dest": "document",
            "accept-language": ACCEPT_LANG,
        },
    )
    if status != 200:
        raise RuntimeError(f"select-flight HTTP {status}")
    initial_cookies = cookie_header(client)
    names = [p.split("=", 1)[0] for p in initial_cookies.split("; ") if "=" in p]
    log(f"select-flight cookies ({len(names)}): {names}")

    script_hdrs = {
        **base,
        "accept": "*/*",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-dest": "script",
        "referer": SELECT_FLIGHT,
        "accept-language": ACCEPT_LANG,
    }

    # Real HAR order: abck multi-POST first, BMS later (~+13s). Match that for soar.
    abck_path = extract_abck_script(html)
    if not abck_path:
        raise RuntimeError("abck script not found")
    abck_url = urljoin(SITE + "/", abck_path)
    log(f"=== init: abck script {abck_path} ===")
    st, abck_src = await http_get(client, abck_url, script_hdrs)
    if st != 200:
        raise RuntimeError(f"abck script HTTP {st}")
    log(f"abck script source {len(abck_src)}B")

    sensor_bodies = await capture_bodies(
        SELECT_FLIGHT, html, abck_url, abck_src, cookie_header(client),
        max_posts=8, events="abck", deadline_ms=5000, script_timeout_ms=12_000,
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
        "accept": DOC_ACCEPT,
        "origin": SITE,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "referer": SELECT_FLIGHT,
        "accept-language": ACCEPT_LANG,
    }
    post_url = abck_url.split("?", 1)[0]
    for i, body in enumerate(to_post, 1):
        await asyncio.sleep(0.15)
        st, _ = await http_post(
            client, post_url, abck_post, body, label=f"_abck POST {i}/{len(to_post)}"
        )
        if st >= 400:
            raise RuntimeError(f"_abck POST HTTP {st}")

    bms_url = None
    bms_posted = False
    bms_path = extract_bms_script(html)
    if bms_path:
        bms_url = urljoin(SITE + "/", bms_path)
        log(f"=== init: BMS script {bms_path} ===")
        st, bms_src = await http_get(client, bms_url, script_hdrs)
        if st != 200:
            raise RuntimeError(f"BMS script HTTP {st}")
        log(f"BMS script source {len(bms_src)}B")
        bodies = await capture_bodies(
            SELECT_FLIGHT, html, bms_url, bms_src, cookie_header(client),
            max_posts=1, events="none", deadline_ms=4000, script_timeout_ms=12_000,
        )
        if bodies:
            bms_posted = True
            st, _ = await http_post(
                client,
                bms_url.split("?", 1)[0],
                {
                    **base,
                    "content-type": "application/json",
                    "accept": "application/json",
                    "origin": SITE,
                    "sec-fetch-site": "same-origin",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-dest": "empty",
                    "referer": SELECT_FLIGHT,
                    "accept-language": ACCEPT_LANG,
                },
                bodies[0],
                label="BMS POST",
            )
            if st >= 400:
                raise RuntimeError(f"BMS POST HTTP {st}")
            log(f"BMS posted ok; cookies={cookie_header(client)[:120]}...")
        else:
            log("BMS capture empty, skip post")
    else:
        log("no BMS script on page")

    cookies = cookie_header(client)
    cookie_names = [
        p.split("=", 1)[0]
        for p in enrich_bm_lso(cookies).split("; ")
        if "=" in p
    ]
    log(f"=== init done cookies ({len(cookie_names)}): {cookie_names} ===")
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
        "cookie_names": cookie_names,
    }


# Availability request wire order from browser capture (HTTP/1.x).
# host/content-length filled by client.
SEARCH_HEADER_ORDER = [
    "host",
    "content-length",
    "user-agent",
    "accept",
    "accept-encoding",
    "content-type",
    "sec-ch-ua-platform",
    "x-auth-token",
    "authorization",
    "x-path",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "origin",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-dest",
    "referer",
    "accept-language",
    "priority",
    "cookie",
]


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


def log_abck_tilde0(cookie: str, where: str) -> None:
    abck = cookie_value(cookie, "_abck")
    if abck is None:
        log(f"{where} _abck: missing")
        return
    has = "~0~" in abck
    log(f"{where} _abck has ~0~: {has} (len={len(abck)} preview={abck[:48]}...)")


# Availability: only these cookies on the wire.
SEARCH_COOKIE_NAMES = frozenset({"_abck", "bm_s"})


async def search(client: Client, body: str = DEFAULT_BODY) -> dict:
    log("=== search: availability ===")
    # Only _abck + bm_s on the wire; empty jar so client store cannot add others.
    cookie = filter_cookies(cookie_header(client, SEARCH_URL), SEARCH_COOKIE_NAMES)
    log_abck_tilde0(cookie, "search")
    # Do not force bm_s — use jar from live BMS POST only (local network verification).
    # cookie = filter_cookies(cookie + "; bm_s=<captured>;", SEARCH_COOKIE_NAMES)
    cnames = [p.split("=", 1)[0] for p in cookie.split("; ") if "=" in p]
    log(f"search cookie names ({len(cnames)}): {cnames}")
    headers = {
        **browser_headers(),
        "accept": SEARCH_ACCEPT,
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": ACCEPT_LANG,
        "authorization": AUTHORIZATION,
        "content-type": "application/json",
        "origin": SITE,
        "priority": "u=1, i",
        "referer": SITE + "/",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "x-auth-token": X_AUTH_TOKEN,
        "x-path": X_PATH,
    }
    status, text = await http_post(
        client,
        SEARCH_URL,
        headers,
        body,
        orig_headers=SEARCH_HEADER_ORDER,
        cookies=cookie or {},
        cookie_provider=Jar(),
        label="availability POST",
    )
    # Web: bot-passed + stale anonymous auth → 401
    ok = status == 401
    log(f"search result HTTP {status} success={ok} body_preview={text[:200]!r}")
    return {"search_status": status, "search_success": ok, "search_body": text}


def make_client(proxy: Proxy | None = None) -> Client:
    """Build a Client. Default: new Lumi sticky session (unique exit pin)."""
    kwargs: dict[str, Any] = {
        "emulation": EmulationOption(
            emulation=Emulation.Chrome144,
            emulation_os=EmulationOS.Android,
        ),
        "cookie_store": True,
        "timeout": timedelta(seconds=30),
        "redirect": Policy.limited(10),
        "verify": False,
    }
    # Always assign proxies last so a fresh get_lumi_proxy() session is used.
    kwargs["proxies"] = [proxy if proxy is not None else get_lumi_proxy()]
    # Historical options:
    # kwargs["proxies"] = [Proxy.all(REQABLE_PROXY)]
    # kwargs["proxies"] = [get_mitm_proxy()]
    return Client(**kwargs)


async def run_worker(
    worker_id: int,
    *,
    do_search: bool,
    post_count: int | None,
) -> dict[str, Any]:
    """One full flow: own sticky proxy + client → init → optional search."""
    token = _WORKER.set(f"w{worker_id}")
    started = time()
    try:
        log(f"worker start search={do_search} post_count={post_count}")
        client = make_client()
        out: dict[str, Any] = {"worker": worker_id}
        try:
            init = await initialize(client, post_count=post_count)
            out.update(init)
            if do_search:
                out.update(await search(client))
            else:
                out.update(search_status=None, search_success=None, search_body=None)
                log("init-only, skip search")
            ok = (not do_search) or bool(out.get("search_success"))
            out["ok"] = ok
            out["elapsed_s"] = round(time() - started, 2)
            log(f"worker done ok={ok} elapsed={out['elapsed_s']}s")
            return out
        except Exception as exc:
            log(f"FAILED: {type(exc).__name__}: {exc}")
            return {
                "worker": worker_id,
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "elapsed_s": round(time() - started, 2),
            }
    finally:
        _WORKER.reset(token)


async def run_concurrent(
    concurrency: int,
    *,
    do_search: bool,
    post_count: int | None,
) -> list[dict[str, Any]]:
    """Run N independent flows in parallel (each: own sticky proxy+cookies)."""
    log(f"concurrent start n={concurrency} search={do_search}")
    tasks = [
        run_worker(i + 1, do_search=do_search, post_count=post_count)
        for i in range(concurrency)
    ]
    results = await asyncio.gather(*tasks)
    ok_n = sum(1 for r in results if r.get("ok"))
    fail_n = concurrency - ok_n
    log(f"concurrent summary ok={ok_n} fail={fail_n} total={concurrency}")
    for r in results:
        wid = r.get("worker")
        if r.get("ok"):
            log(
                f"summary w{wid}: ok status={r.get('search_status')} "
                f"abck_posts={r.get('abck_post_count')} elapsed={r.get('elapsed_s')}s"
            )
        else:
            log(f"summary w{wid}: FAIL {r.get('error')} elapsed={r.get('elapsed_s')}s")
    return list(results)


async def main() -> int:
    p = argparse.ArgumentParser(description="Cebu www flow smoke test")
    p.add_argument("--search", action="store_true", help="call availability after init")
    p.add_argument(
        "--post-count",
        type=int,
        help="post first N _abck bodies (default: first, second, last)",
    )
    p.add_argument(
        "-j",
        "--concurrency",
        type=int,
        default=1,
        metavar="N",
        help="run N full flows in parallel (each own proxy+cookies); default 1",
    )
    args = p.parse_args()
    if args.concurrency < 1:
        log("concurrency must be >= 1")
        return 2

    log(
        f"start search={args.search} post_count={args.post_count} "
        f"concurrency={args.concurrency}"
    )
    results = await run_concurrent(
        args.concurrency,
        do_search=args.search,
        post_count=args.post_count,
    )
    if not args.search:
        return 0 if all(r.get("ok") for r in results) else 1
    ok_n = sum(1 for r in results if r.get("search_success"))
    code = 0 if ok_n == len(results) else 1
    log(f"exit {code} search_ok={ok_n}/{len(results)}")
    return code


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

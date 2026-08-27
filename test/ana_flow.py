"""ANA www flow smoke test: mimic sensor bodies → cookies → roundtrip-owd."""

import argparse
import asyncio
import json
import random
import re
import secrets
import sys
import tempfile
import uuid
from collections import Counter
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


SITE = "https://www.ana.co.jp"
SELECT_URL = f"{SITE}/en/jp/"
ASWBE_ORIGIN = "https://aswbe.ana.co.jp"
# Lab / local egress. Direct datacenter IP is Akamai-whitelisted (no BMS/abck inject);
# use LOCAL_PROXY (Clash etc.) for a non-whitelist path when not on Lumi.
LOCAL_PROXY = "http://127.0.0.1:7890"
# HTTP CONNECT proxy; X-ClientHello-Id is sent on the CONNECT hop.
REQABLE_PROXY = "http://10.5.2.163:9001"
MITM_PROXY = "http://95.179.202.136:24800"
PROXY_HEADERS = {"X-ClientHello-Id": "hellochrome_150"}
# Bright Data: country via username (and optional host); do not hard-pin only in host.
LUMI_PROXY_HOST = "brd.superproxy.io"
LUMI_PROXY_PORT = 22225
# lab-ana defaults to lumi:jp.
LUMI_COUNTRY = "jp"
LUMI_CUSTOMER_ZONE = "lum-customer-travel_fusion-zone-gen"
LUMI_PASSWORD = "j48ly0d63top"
VERIFY_URL = "https://space.ana.co.jp/aswbe-search/api/v1/roundtrip-owd"
CHANGE_OFFICE_URL = "https://space.ana.co.jp/aswbe-user/api/v1/change-office-and-lang"
BRIDGE = Path(__file__).with_name("cebu_capture.mjs")
REPO_ROOT = Path(__file__).resolve().parents[1]
PROFILES_DIR = REPO_ROOT / "profiles"
DEFAULT_PROFILE = "android-chrome/2201116sg-v145-10025"
ANDROID_CHROME_DIR = PROFILES_DIR / "android-chrome"

# Wire TLS/UA pin (rnet egress only). Independent of mimic profile selection.
CHROME_MAJOR = 145
UA = (
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 "
    f"(KHTML, like Gecko) Chrome/{CHROME_MAJOR}.0.0.0 Mobile Safari/537.36"
)
SEC_CH_UA = (
    f'"Not;A=Brand";v="8", "Chromium";v="{CHROME_MAJOR}", '
    f'"Google Chrome";v="{CHROME_MAJOR}"'
)
ACCEPT_LANG = "en-US,en;q=0.9,ja;q=0.8"
RNET_EMULATION = Emulation.Chrome145

# Captured roundtrip-owd verify contract (akavm-suppliers ana/requests.rs).
VERIFY_AUTHORIZATION = (
    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJodHRwczovL2FuYS5jby5qcCIsInV1aWQiOiJlOWRmODgxZC1kN2ZmLTQ4MWQtOWMwMS04MDU3MzM1NWIxZDUifQ."
    "Z_HMxeLIGwoQFrbg9Dp89FuNTrrbQkPEkctpAWuFxuQ"
)
VERIFY_CLIENT_ID = "d4df2b8bcfdc47cc9005bde719f3e9c0"
VERIFY_CLIENT_SECRET = "BeBb2FE567eb400e8C70145F6ad4D5d0"
VERIFY_IDENTIFICATION_ID = "a19d5424-de0e-4d5c-b784-557a512f5737"
VERIFY_SYS_ID = "ABE"
DEFAULT_BODY = (
    '{"itineraries":[{"originLocationCode":"TYO","destinationLocationCode":"HNL",'
    '"departureDate":"2026-08-27"}],"travelers":{"ADT":1,"B15":0,"CHD":0,"INF":0},'
    '"fare":{"isMixedCabin":false,"cabinClass":"eco","fareOptionType":"0"},'
    '"searchPreferences":{"getAirCalendarOnly":false,"getLatestOperation":true}}'
)
CHANGE_OFFICE_BODY = '{"lang":"en","pointOfSaleId":"TYONH08AA"}'
# Captured queue-it page on aswbe reservation search (already query-encoded).
QUEUEIT_AJAX_PAGE = (
    "https%3A%2F%2Faswbe.ana.co.jp%2Fwebapps%2Freservation%2Fflight-search"
    "%3FCONNECTION_KIND%3DJPN%26LANG%3Den"
)

_SCRIPT_SRC_RE = re.compile(r'''(?i)<script[^>]*\ssrc\s*=\s*["']([^"']+)["']''')
_BASE_HREF_RE = re.compile(r'''(?i)<base[^>]*\shref\s*=\s*["']([^"']+)["']''')


def list_android_chrome_profiles() -> list[str]:
    """Ids like android-chrome/<stem> for every profiles/android-chrome/*.json."""
    if not ANDROID_CHROME_DIR.is_dir():
        return []
    return sorted(
        f"android-chrome/{p.stem}"
        for p in ANDROID_CHROME_DIR.glob("*.json")
        if p.is_file()
    )


def resolve_profile(explicit: str | None) -> str:
    """Pick mimic profile for one flow. explicit pins; else random from android-chrome pool."""
    if explicit:
        path = PROFILES_DIR / f"{explicit}.json"
        if not path.is_file():
            raise FileNotFoundError(f"profile not found: {explicit} ({path})")
        return explicit
    pool = list_android_chrome_profiles()
    if not pool:
        log(f"no android-chrome profiles under {ANDROID_CHROME_DIR}; using {DEFAULT_PROFILE}")
        return DEFAULT_PROFILE
    chosen = random.choice(pool)
    return chosen


DOC_ACCEPT = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
    "image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
)
VERIFY_ACCEPT = "application/json"


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
    url = f"http://{LUMI_PROXY_HOST}:{LUMI_PROXY_PORT}/"
    log(f"lumi proxy country={country} session={sid} url={url}")
    return Proxy.all(
        url,
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


def document_base(document_url: str, html: str) -> str:
    m = _BASE_HREF_RE.search(html)
    if not m:
        return document_url
    return urljoin(document_url, m.group(1))


def extract_script_srcs(html: str) -> list[str]:
    return _SCRIPT_SRC_RE.findall(html)


def _has_bms_marker(src: str) -> bool:
    return "?v=" in src or "&v=" in src


def discover_script_urls(document_url: str, html: str) -> tuple[str, str]:
    """BMS = last ?v= script (else last script); ABCK = the other of the last two.

    Matches akavm-suppliers ana/requests.rs discover_script_urls.
    """
    scripts = extract_script_srcs(html)
    if len(scripts) < 2:
        raise RuntimeError("en/jp page has fewer than two scripts")
    bms_index = next(
        (i for i in range(len(scripts) - 1, -1, -1) if _has_bms_marker(scripts[i])),
        len(scripts) - 1,
    )
    if bms_index == len(scripts) - 1:
        abck_index = len(scripts) - 2
    else:
        abck_index = len(scripts) - 1
    base = document_base(document_url, html)
    bms_url = urljoin(base, scripts[bms_index])
    abck_url = urljoin(base, scripts[abck_index])
    if bms_url == abck_url:
        raise RuntimeError("en/jp page resolved identical BMS and ABCK scripts")
    return bms_url, abck_url


def classify_verify(status: int, body: str) -> str:
    """Accepted = 2xx + non-empty body. 403 is forbidden; else reject."""
    if status == 403:
        return "edge_403"
    if 200 <= status < 300 and body:
        return "ok_2xx"
    if "Processing" in body:
        return "soft_blocked_processing"
    return f"verify_{status}"


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
    profile: str,
    max_posts: int,
    events: str,
    deadline_ms: int,
    script_timeout_ms: int,
) -> list[str]:
    if not BRIDGE.is_file():
        raise RuntimeError(f"bridge missing: {BRIDGE}")
    log(
        f"mimic capture start profile={profile} events={events} max_posts={max_posts} "
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
            "profile": profile,
            "deadlineMs": deadline_ms,
            "maxPosts": max_posts,
            "scriptTimeoutMs": script_timeout_ms,
            "events": events,
        },
        ensure_ascii=False,
    ).encode()
    with tempfile.NamedTemporaryFile(prefix="ana-capture-", suffix=".json", delete=False) as f:
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
    probe = result.get("assignProbe")
    if isinstance(probe, dict):
        batches = probe.get("batches") if isinstance(probe.get("batches"), list) else []
        per = [b.get("n") for b in batches if isinstance(b, dict)]
        log(
            f"BMS assignProbe batches={probe.get('batchCount')} "
            f"uniqueKeys={probe.get('uniqueKeys')} per_batch={per}"
        )
        try:
            out = Path("tmp/ana-baseline")
            out.mkdir(parents=True, exist_ok=True)
            stamp = int(time())
            (out / f"bms-assign-{stamp}.json").write_text(
                json.dumps(probe, indent=2), encoding="utf-8"
            )
            if bodies:
                (out / f"bms-body-{stamp}.txt").write_text(bodies[0], encoding="utf-8")
            log(f"BMS assignProbe wrote tmp/ana-baseline/bms-assign-{stamp}.json")
        except OSError as exc:
            log(f"BMS assignProbe write failed: {exc}")
    if stderr:
        err = stderr.decode(errors="replace").strip()
        if err:
            for line in err.splitlines()[-20:]:
                log(f"mimic stderr: {line}")
    return bodies


def select_abck_bodies(
    bodies: list[str],
    post_count: int | None = None,
    *,
    policy: str = "all",
) -> list[str]:
    """Pick abck bodies to POST.

    policy:
      - all: every captured body (default)
      - edges: first, second, last (legacy sparse policy)
    post_count: if set, first N bodies (overrides policy).
    """
    if not bodies:
        return []
    if post_count is not None:
        return bodies[: max(0, post_count)]
    if policy == "edges":
        if len(bodies) == 1:
            return bodies[:1]
        if len(bodies) == 2:
            return bodies[:2]
        return [bodies[0], bodies[1], bodies[-1]]
    if policy != "all":
        raise ValueError(f"unknown abck policy: {policy}")
    return list(bodies)


def capture_deadlines(proxy_mode: str) -> tuple[int, int, int]:
    """(abck_deadline_ms, bms_deadline_ms, script_timeout_ms) by egress RTT."""
    if proxy_mode == "lumi":
        return 8000, 7000, 16_000
    return 5000, 5000, 12_000


async def initialize(
    client: Client,
    post_count: int | None = None,
    *,
    abck_policy: str = "all",
    proxy_mode: str = "local",
    profile: str,
) -> dict:
    base = browser_headers()
    abck_dl, bms_dl, script_to = capture_deadlines(proxy_mode)
    log(
        f"=== init: en/jp (proxy={proxy_mode} abck_policy={abck_policy} "
        f"profile={profile} tls=Chrome{CHROME_MAJOR}) ==="
    )
    status, html = await http_get(
        client,
        SELECT_URL,
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
        raise RuntimeError(f"en/jp HTTP {status}")
    initial_cookies = cookie_header(client)
    names = [p.split("=", 1)[0] for p in initial_cookies.split("; ") if "=" in p]
    log(f"en/jp cookies ({len(names)}): {names}")

    bms_url, abck_url = discover_script_urls(SELECT_URL, html)
    log(f"discovered BMS={bms_url}")
    log(f"discovered ABCK={abck_url}")

    script_hdrs = {
        **base,
        "accept": "*/*",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-dest": "script",
        "referer": SELECT_URL,
        "accept-language": ACCEPT_LANG,
    }

    # Same as cebu_flow: abck multi-POST first, BMS later.
    log(f"=== init: abck script {abck_url} ===")
    st, abck_src = await http_get(client, abck_url, script_hdrs)
    if st != 200:
        raise RuntimeError(f"abck script HTTP {st}")
    log(f"abck script source {len(abck_src)}B")

    sensor_bodies = await capture_bodies(
        SELECT_URL, html, abck_url, abck_src, cookie_header(client),
        profile=profile,
        max_posts=8, events="abck", deadline_ms=abck_dl, script_timeout_ms=script_to,
    )
    if not sensor_bodies:
        raise RuntimeError("no _abck bodies captured")

    to_post = select_abck_bodies(
        sensor_bodies, post_count=post_count, policy=abck_policy
    )
    if post_count is not None:
        policy_label = f"first-N={post_count}"
    else:
        policy_label = abck_policy
    log(
        f"abck will post {len(to_post)}/{len(sensor_bodies)} bodies "
        f"(policy={policy_label} deadline={abck_dl}ms)"
    )
    abck_post = {
        **base,
        "content-type": "text/plain;charset=UTF-8",
        "accept": DOC_ACCEPT,
        "origin": SITE,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "referer": SELECT_URL,
        "accept-language": ACCEPT_LANG,
    }
    post_url = abck_url.split("?", 1)[0]
    gap = 0.25 if proxy_mode == "lumi" else 0.15
    for i, body in enumerate(to_post, 1):
        await asyncio.sleep(gap)
        st, _ = await http_post(
            client, post_url, abck_post, body, label=f"_abck POST {i}/{len(to_post)}"
        )
        if st >= 400:
            raise RuntimeError(f"_abck POST HTTP {st}")

    bms_posted = False
    if bms_url:
        log(f"=== init: BMS script {bms_url} ===")
        st, bms_src = await http_get(client, bms_url, script_hdrs)
        if st != 200:
            raise RuntimeError(f"BMS script HTTP {st}")
        log(f"BMS script source {len(bms_src)}B")
        # max_posts=2: real BMS body + optional __BMS_ASSIGN__ multi-id probe post
        bodies = await capture_bodies(
            SELECT_URL, html, bms_url, bms_src, cookie_header(client),
            profile=profile,
            max_posts=2, events="none", deadline_ms=bms_dl, script_timeout_ms=script_to,
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
                    "referer": SELECT_URL,
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
        "profile": profile,
        "bms_script_url": bms_url,
        "abck_script_url": abck_url,
        "bms_posted": bms_posted,
        "abck_body_count": len(sensor_bodies),
        "abck_post_count": len(to_post),
        "abck_policy": (
            f"first-N={post_count}" if post_count is not None else abck_policy
        ),
        "cookie_names": cookie_names,
    }


# change-office-and-lang wire order from browser capture. host/content-length by client.
CHANGE_OFFICE_HEADER_ORDER = [
    "host",
    "content-length",
    "sys_id",
    "sec-ch-ua-platform",
    "authorization",
    "x-correlation-id",
    "x-queueit-ajaxpageurl",
    "sec-ch-ua",
    "client_id",
    "sec-ch-ua-mobile",
    "client_secret",
    "identification_id",
    "user-agent",
    "accept",
    "content-type",
    "origin",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-dest",
    "referer",
    "accept-encoding",
    "accept-language",
    "cookie",
]

# roundtrip-owd wire order. host/content-length filled by client.
VERIFY_HEADER_ORDER = [
    "host",
    "content-length",
    "user-agent",
    "accept",
    "accept-encoding",
    "content-type",
    "sec-ch-ua-platform",
    "authorization",
    "sys_id",
    "client_id",
    "client_secret",
    "identification_id",
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


def aswbe_api_headers(*, extra: dict | None = None) -> dict:
    headers = {
        **browser_headers(),
        "accept": VERIFY_ACCEPT,
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": ACCEPT_LANG,
        "authorization": VERIFY_AUTHORIZATION,
        "client_id": VERIFY_CLIENT_ID,
        "client_secret": VERIFY_CLIENT_SECRET,
        "content-type": "application/json",
        "identification_id": VERIFY_IDENTIFICATION_ID,
        "origin": ASWBE_ORIGIN,
        "referer": ASWBE_ORIGIN + "/",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "sys_id": VERIFY_SYS_ID,
    }
    if extra:
        headers.update(extra)
    return headers


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


async def change_office_and_lang(client: Client) -> dict:
    log("=== verify: change-office-and-lang ===")
    cookie = cookie_header(client, CHANGE_OFFICE_URL)
    cnames = [p.split("=", 1)[0] for p in cookie.split("; ") if "=" in p]
    log(f"change-office cookie names ({len(cnames)}): {cnames}")
    st, text = await http_post(
        client,
        CHANGE_OFFICE_URL,
        aswbe_api_headers(
            extra={
                "x-correlation-id": str(uuid.uuid4()),
                "x-queueit-ajaxpageurl": QUEUEIT_AJAX_PAGE,
            }
        ),
        CHANGE_OFFICE_BODY,
        orig_headers=CHANGE_OFFICE_HEADER_ORDER,
        label="change-office POST",
    )
    if st >= 400:
        raise RuntimeError(f"change-office POST HTTP {st}")
    return {"change_office_status": st, "change_office_body": text}


async def verify(client: Client, body: str = DEFAULT_BODY) -> dict:
    office = await change_office_and_lang(client)
    log("=== verify: roundtrip-owd ===")
    cookie = cookie_header(client, VERIFY_URL)
    log_abck_tilde0(cookie, "verify")
    cnames = [p.split("=", 1)[0] for p in cookie.split("; ") if "=" in p]
    log(f"verify cookie names ({len(cnames)}): {cnames}")
    status, text = await http_post(
        client,
        VERIFY_URL,
        aswbe_api_headers(extra={"priority": "u=1, i"}),
        body,
        orig_headers=VERIFY_HEADER_ORDER,
        label="roundtrip-owd POST",
    )
    bucket = classify_verify(status, text)
    ok = bucket == "ok_2xx"
    log(f"verify result HTTP {status} class={bucket} success={ok} body_preview={text[:200]!r}")
    return {
        **office,
        "verify_status": status,
        "verify_success": ok,
        "verify_class": bucket,
        "verify_body": text,
    }


def resolve_proxy(mode: str, *, lumi_country: str = LUMI_COUNTRY) -> Proxy | None:
    """Map CLI proxy mode to rnet Proxy (or None for direct egress)."""
    if mode == "none":
        return None
    if mode == "local":
        return Proxy.all(LOCAL_PROXY)
    if mode == "lumi":
        return get_lumi_proxy(country=lumi_country)
    if mode == "mitm":
        return get_mitm_proxy()
    if mode == "reqable":
        return Proxy.all(REQABLE_PROXY)
    raise ValueError(f"unknown proxy mode: {mode}")


def make_client(
    proxy: Proxy | None = None,
    *,
    proxy_mode: str = "local",
) -> Client:
    """Build a Client. proxy=None → direct egress; else sticky/CONNECT proxy."""
    http_timeout = 60 if proxy_mode == "lumi" else 30
    kwargs: dict[str, Any] = {
        "emulation": EmulationOption(
            emulation=RNET_EMULATION,
            emulation_os=EmulationOS.Android,
        ),
        "cookie_store": True,
        "timeout": timedelta(seconds=http_timeout),
        "redirect": Policy.limited(10),
        "verify": False,
    }
    if proxy is not None:
        kwargs["proxies"] = [proxy]
    return Client(**kwargs)


def classify_result(r: dict[str, Any]) -> str:
    """Bucket one flow for baseline notes (not a strict state machine)."""
    if r.get("error"):
        err = str(r["error"])
        if "fewer than two scripts" in err or "identical BMS" in err:
            return "no_akamai_scripts"
        if "no _abck bodies" in err or "BMS capture empty" in err or "mimic" in err.lower():
            return "flow_capture"
        if "_abck POST" in err or "BMS POST" in err or "en/jp" in err or "change-office" in err:
            return "http_init"
        return "exception"
    if not r.get("bms_posted"):
        return "bms_skip"
    abck = cookie_value(str(r.get("cookies") or ""), "_abck") or ""
    if "~0~" not in abck:
        return "abck_no_tilde0"
    if r.get("verify_class"):
        return str(r["verify_class"])
    st = r.get("verify_status")
    if st is None:
        return "init_only"
    return f"verify_{st}"


async def run_worker(
    worker_id: int,
    *,
    do_verify: bool,
    post_count: int | None,
    proxy_mode: str,
    lumi_country: str = LUMI_COUNTRY,
    abck_policy: str = "all",
    profile: str | None = None,
) -> dict[str, Any]:
    """One full flow: own sticky proxy + client → init → optional verify (single pass)."""
    token = _WORKER.set(f"w{worker_id}")
    started = time()
    chosen_profile = resolve_profile(profile)
    try:
        log(
            f"worker start verify={do_verify} post_count={post_count} "
            f"abck_policy={abck_policy} proxy={proxy_mode} lumi_country={lumi_country} "
            f"profile={chosen_profile}"
        )
        client = make_client(
            resolve_proxy(proxy_mode, lumi_country=lumi_country),
            proxy_mode=proxy_mode,
        )
        out: dict[str, Any] = {
            "worker": worker_id,
            "proxy_mode": proxy_mode,
            "lumi_country": lumi_country if proxy_mode == "lumi" else None,
            "profile": chosen_profile,
            "tls_emulation": f"Chrome{CHROME_MAJOR}+Android",
        }
        try:
            init = await initialize(
                client,
                post_count=post_count,
                abck_policy=abck_policy,
                proxy_mode=proxy_mode,
                profile=chosen_profile,
            )
            out.update(init)
            abck = cookie_value(str(out.get("cookies") or ""), "_abck") or ""
            out["abck_tilde0"] = "~0~" in abck
            out["has_bm_s"] = cookie_value(str(out.get("cookies") or ""), "bm_s") is not None
            if do_verify:
                out.update(await verify(client))
            else:
                out.update(
                    change_office_status=None,
                    verify_status=None,
                    verify_success=None,
                    verify_class=None,
                    verify_body=None,
                )
                log("init-only, skip verify")
            ok = (not do_verify) or bool(out.get("verify_success"))
            out["ok"] = ok
            out["class"] = classify_result(out)
            out["elapsed_s"] = round(time() - started, 2)
            log(
                f"worker done ok={ok} class={out['class']} profile={chosen_profile} "
                f"status={out.get('verify_status')} elapsed={out['elapsed_s']}s"
            )
            return out
        except Exception as exc:
            log(f"FAILED: {type(exc).__name__}: {exc}")
            fail = {
                "worker": worker_id,
                "proxy_mode": proxy_mode,
                "profile": chosen_profile,
                "tls_emulation": f"Chrome{CHROME_MAJOR}+Android",
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "elapsed_s": round(time() - started, 2),
            }
            fail["class"] = classify_result(fail)
            return fail
    finally:
        _WORKER.reset(token)


async def run_concurrent(
    count: int,
    concurrency: int,
    *,
    do_verify: bool,
    post_count: int | None,
    proxy_mode: str,
    lumi_country: str = LUMI_COUNTRY,
    abck_policy: str = "all",
    profile: str | None = None,
) -> list[dict[str, Any]]:
    """Run ``count`` independent flows with at most ``concurrency`` in flight.

    Each job: own sticky proxy + cookies + profile pick (unless profile pinned).
    """
    if count < 1:
        raise ValueError("count must be >= 1")
    if concurrency < 1:
        raise ValueError("concurrency must be >= 1")
    concurrency = min(concurrency, count)
    pool_n = 1 if profile else len(list_android_chrome_profiles())
    log(
        f"concurrent start count={count} concurrency={concurrency} verify={do_verify} "
        f"proxy={proxy_mode} lumi_country={lumi_country} abck_policy={abck_policy} "
        f"profile={'pin:' + profile if profile else f'random pool={pool_n}'} "
        f"tls=Chrome{CHROME_MAJOR} (decoupled)"
    )
    sem = asyncio.Semaphore(concurrency)
    results: list[dict[str, Any] | None] = [None] * count

    async def one(job_id: int) -> None:
        async with sem:
            results[job_id - 1] = await run_worker(
                job_id,
                do_verify=do_verify,
                post_count=post_count,
                proxy_mode=proxy_mode,
                lumi_country=lumi_country,
                abck_policy=abck_policy,
                profile=profile,
            )

    await asyncio.gather(*(one(i + 1) for i in range(count)))
    out = [r for r in results if r is not None]
    ok_n = sum(1 for r in out if r.get("ok"))
    fail_n = count - ok_n
    log(f"concurrent summary ok={ok_n} fail={fail_n} total={count} concurrency={concurrency}")
    buckets = Counter(str(r.get("class") or "?") for r in out)
    log(f"class buckets: {dict(buckets)}")
    for r in out:
        wid = r.get("worker")
        if r.get("ok"):
            log(
                f"summary w{wid}: ok status={r.get('verify_status')} "
                f"class={r.get('class')} profile={r.get('profile')} "
                f"abck_posts={r.get('abck_post_count')} "
                f"bms={r.get('bms_posted')} tilde0={r.get('abck_tilde0')} "
                f"bm_s={r.get('has_bm_s')} elapsed={r.get('elapsed_s')}s"
            )
        else:
            log(
                f"summary w{wid}: FAIL class={r.get('class')} profile={r.get('profile')} "
                f"{r.get('error')} elapsed={r.get('elapsed_s')}s"
            )
    return out


async def main() -> int:
    p = argparse.ArgumentParser(description="ANA www flow smoke test")
    p.add_argument(
        "--verify",
        action="store_true",
        help="change-office-and-lang then roundtrip-owd after init",
    )
    p.add_argument(
        "--post-count",
        type=int,
        help="post first N _abck bodies (overrides --abck-policy)",
    )
    p.add_argument(
        "--abck-policy",
        choices=("all", "edges"),
        default="all",
        help="all=every captured body (default); edges=1st+2nd+last",
    )
    p.add_argument(
        "-j",
        "--concurrency",
        type=int,
        default=1,
        metavar="N",
        help="max parallel flows (each own proxy+cookies); default 1",
    )
    p.add_argument(
        "-n",
        "--count",
        type=int,
        default=None,
        metavar="N",
        help=(
            "total number of flows to run (default: same as --concurrency). "
            "Use e.g. -n 20 -j 4 for 20 jobs with 4 in flight"
        ),
    )
    p.add_argument(
        "--proxy",
        choices=("local", "lumi", "none", "mitm", "reqable"),
        default="local",
        help=(
            "egress: local=127.0.0.1:7890 (default; non-whitelist), "
            "lumi=Bright Data sticky (country jp), none=direct (whitelist shell), "
            "mitm/reqable=lab"
        ),
    )
    p.add_argument(
        "--lumi-country",
        default=LUMI_COUNTRY,
        help=f"Bright Data -country-XX (default {LUMI_COUNTRY}); only with --proxy lumi",
    )
    p.add_argument(
        "--profile",
        default=None,
        metavar="ID",
        help=(
            "pin mimic profile id (e.g. android-chrome/2201116sg-v145-10025); "
            "default: random per worker from profiles/android-chrome/*.json "
            "(sensor only; wire TLS stays Chrome145)"
        ),
    )
    p.add_argument(
        "--json-out",
        type=Path,
        help="write full results JSON array to this path",
    )
    args = p.parse_args()
    if args.concurrency < 1:
        log("concurrency must be >= 1")
        return 2
    count = args.concurrency if args.count is None else args.count
    if count < 1:
        log("count must be >= 1")
        return 2

    log(
        f"start verify={args.verify} post_count={args.post_count} "
        f"abck_policy={args.abck_policy} count={count} concurrency={args.concurrency} "
        f"proxy={args.proxy} lumi_country={args.lumi_country} "
        f"profile={args.profile or 'random'} tls=Chrome{CHROME_MAJOR}"
    )
    results = await run_concurrent(
        count,
        args.concurrency,
        do_verify=args.verify,
        post_count=args.post_count,
        proxy_mode=args.proxy,
        lumi_country=args.lumi_country,
        abck_policy=args.abck_policy,
        profile=args.profile,
    )
    if args.json_out:
        slim = []
        for r in results:
            slim.append(
                {
                    k: r.get(k)
                    for k in (
                        "worker",
                        "proxy_mode",
                        "lumi_country",
                        "profile",
                        "tls_emulation",
                        "ok",
                        "class",
                        "change_office_status",
                        "verify_status",
                        "verify_success",
                        "verify_class",
                        "abck_post_count",
                        "abck_body_count",
                        "abck_policy",
                        "bms_posted",
                        "abck_tilde0",
                        "has_bm_s",
                        "elapsed_s",
                        "error",
                    )
                    if k in r or k in ("ok", "class", "worker")
                }
            )
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(slim, indent=2), encoding="utf-8")
        log(f"wrote {args.json_out}")
    if not args.verify:
        return 0 if all(r.get("ok") for r in results) else 1
    ok_n = sum(1 for r in results if r.get("verify_success"))
    code = 0 if ok_n == len(results) else 1
    log(f"exit {code} verify_ok={ok_n}/{len(results)}")
    return code


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

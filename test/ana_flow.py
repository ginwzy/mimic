"""ANA www flow smoke test: mimic sensor bodies → cookies → roundtrip-owd."""

import argparse
import asyncio
import json
import random
import re
import secrets
import subprocess
import sys
import tempfile
from collections import Counter
from contextvars import ContextVar
from datetime import timedelta
from functools import cache
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


# --- site / egress ---

SITE = "https://www.ana.co.jp"
SELECT_URL = "https://aswbe.ana.co.jp/webapps/reservation/common/system-error"
ASWBE_ORIGIN = "https://aswbe.ana.co.jp"
VERIFY_URL = "https://space.ana.co.jp/aswbe-search/api/v1/roundtrip-owd"

# Lab / local egress. Direct datacenter IP is Akamai-whitelisted (no BMS/abck inject);
# use LOCAL_PROXY (Clash etc.) for a non-whitelist path when not on Lumi.
LOCAL_PROXY = "http://127.0.0.1:7890"
REQABLE_PROXY = "http://10.5.2.163:9001"
MITM_PROXY = "http://95.179.202.136:24800"
PROXY_HEADERS = {"X-ClientHello-Id": "hellochrome_150"}

LUMI_PROXY_HOST = "brd.superproxy.io"
LUMI_PROXY_PORT = 22225
LUMI_COUNTRY = "jp"
LUMI_CUSTOMER_ZONE = "lum-customer-travel_fusion-zone-gen"
LUMI_PASSWORD = "j48ly0d63top"

BRIDGE = Path(__file__).with_name("cebu_capture.mjs")
REPO_ROOT = Path(__file__).resolve().parents[1]
PROFILES_DIR = REPO_ROOT / "profiles"
MIMIC_CLI = REPO_ROOT / "dist" / "src" / "cli.js"
DEFAULT_PROFILE = "android-chrome/2201116sg-v145-10025"

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

DOC_ACCEPT = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
    "image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
)
VERIFY_ACCEPT = "application/json"

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
    '"departureDate":"2026-09-27"}],"travelers":{"ADT":1,"B15":0,"CHD":0,"INF":0},'
    '"fare":{"isMixedCabin":false,"cabinClass":"eco","fareOptionType":"0"},'
    '"searchPreferences":{"getAirCalendarOnly":false,"getLatestOperation":true}}'
)

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

_SCRIPT_SRC_RE = re.compile(r'''(?i)<script[^>]*\ssrc\s*=\s*["']([^"']+)["']''')
_BASE_HREF_RE = re.compile(r'''(?i)<base[^>]*\shref\s*=\s*["']([^"']+)["']''')


# --- profiles ---

@cache
def list_android_chrome_profiles() -> tuple[str, ...]:
    """Ask mimic for canonical and raw fp-env Android Chrome profile ids."""
    if not MIMIC_CLI.is_file():
        raise FileNotFoundError(f"mimic CLI not built: {MIMIC_CLI}; run npm run build")
    completed = subprocess.run(
        ["node", str(MIMIC_CLI), "list", "profiles", "--profiles", str(PROFILES_DIR)],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    profiles = json.loads(completed.stdout)
    if not isinstance(profiles, list) or not all(isinstance(item, str) for item in profiles):
        raise TypeError("mimic profile list must be a string array")
    return tuple(profile for profile in profiles if profile.startswith("android-chrome/"))


def resolve_profile(explicit: str | None) -> str:
    """Pin if given; else random from android-chrome pool."""
    pool = list_android_chrome_profiles()
    if explicit:
        if explicit not in pool:
            raise FileNotFoundError(f"profile not found: {explicit}")
        return explicit
    if not pool:
        log(f"no android-chrome profiles under {PROFILES_DIR}; using {DEFAULT_PROFILE}")
        return DEFAULT_PROFILE
    return random.choice(pool)


# --- headers ---

def browser_headers() -> dict:
    return {
        "user-agent": UA,
        "sec-ch-ua": SEC_CH_UA,
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
    }


def nav_headers() -> dict:
    return {
        **browser_headers(),
        "upgrade-insecure-requests": "1",
        "accept": DOC_ACCEPT,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate",
        "sec-fetch-user": "?1",
        "sec-fetch-dest": "document",
        "accept-language": ACCEPT_LANG,
    }


def script_headers(referer: str) -> dict:
    return {
        **browser_headers(),
        "accept": "*/*",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-dest": "script",
        "referer": referer,
        "accept-language": ACCEPT_LANG,
    }


def sensor_post_headers(*, content_type: str, accept: str) -> dict:
    return {
        **browser_headers(),
        "content-type": content_type,
        "accept": accept,
        "origin": SITE,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "referer": SELECT_URL,
        "accept-language": ACCEPT_LANG,
    }


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


# --- proxy / client ---

def get_lumi_proxy(
    *,
    country: str = LUMI_COUNTRY,
    session_id: str | None = None,
) -> Proxy:
    """Bright Data residential: fixed country + sticky session for this Client."""
    # Alphanumeric only — Bright Data rejects session values with '-' / '*'.
    sid = session_id or secrets.token_hex(8)
    user = (
        f"{LUMI_CUSTOMER_ZONE}-country-{country}"
        f"-session-{sid}-route_err-block"
    )
    url = f"http://{LUMI_PROXY_HOST}:{LUMI_PROXY_PORT}/"
    log(f"lumi proxy country={country} session={sid} url={url}")
    return Proxy.all(url, username=user, password=LUMI_PASSWORD)


def get_mitm_proxy() -> Proxy:
    return Proxy.all(MITM_PROXY, custom_http_headers=PROXY_HEADERS)


def resolve_proxy(mode: str, *, lumi_country: str = LUMI_COUNTRY) -> Proxy | None:
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


def make_client(proxy: Proxy | None = None, *, proxy_mode: str = "local") -> Client:
    http_timeout = 60 if proxy_mode == "lumi" else 30
    kwargs: dict[str, Any] = {
        "emulation": EmulationOption(
            emulation=Emulation.Chrome145,
            emulation_os=EmulationOS.Android,
        ),
        "cookie_store": True,
        "timeout": timedelta(seconds=http_timeout),
        "verify": False,
    }
    if proxy is not None:
        kwargs["proxies"] = [proxy]
    return Client(**kwargs)


# --- cookies ---

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


def cookie_names(cookie: str) -> list[str]:
    return [p.split("=", 1)[0] for p in cookie.split("; ") if "=" in p]


def cookie_value(cookie: str, name: str) -> str | None:
    for item in cookie.split(";"):
        piece = item.strip()
        if not piece or "=" not in piece:
            continue
        n, v = piece.split("=", 1)
        if n == name:
            return v
    return None


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


def log_abck_tilde0(cookie: str, where: str) -> None:
    abck = cookie_value(cookie, "_abck")
    if abck is None:
        log(f"{where} _abck: missing")
        return
    log(f"{where} _abck has ~0~: {'~0~' in abck} (len={len(abck)} preview={abck[:48]}...)")


# --- HTML / script discovery ---

def document_base(document_url: str, html: str) -> str:
    m = _BASE_HREF_RE.search(html)
    return urljoin(document_url, m.group(1)) if m else document_url


def discover_script_urls(document_url: str, html: str) -> tuple[str, str]:
    """BMS = last ?v= script (else last); ABCK = the other of the last two.

    Matches akavm-suppliers ana/requests.rs discover_script_urls.
    """
    scripts = _SCRIPT_SRC_RE.findall(html)
    if len(scripts) < 2:
        raise RuntimeError("landing page has fewer than two scripts")

    bms_index = next(
        (i for i in range(len(scripts) - 1, -1, -1) if "?v=" in scripts[i] or "&v=" in scripts[i]),
        len(scripts) - 1,
    )
    abck_index = len(scripts) - 2 if bms_index == len(scripts) - 1 else len(scripts) - 1
    base = document_base(document_url, html)
    bms_url = urljoin(base, scripts[bms_index])
    abck_url = urljoin(base, scripts[abck_index])
    if bms_url == abck_url:
        raise RuntimeError("landing page resolved identical BMS and ABCK scripts")
    return bms_url, abck_url


# --- HTTP ---

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


# --- mimic capture ---

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
    interaction_seed: str | None = None,
) -> list[str]:
    if not BRIDGE.is_file():
        raise RuntimeError(f"bridge missing: {BRIDGE}")

    log(
        f"mimic capture start profile={profile} events={events} max_posts={max_posts} "
        f"deadline={deadline_ms}ms script_timeout={script_timeout_ms}ms"
    )
    payload = json.dumps(
        {
            "pageUrl": page_url,
            "pageHtml": page_html,
            "scriptUrl": script_url,
            "scriptSource": script_source,
            "cookies": [c.strip() for c in cookies.split(";") if "=" in c],
            "profile": profile,
            "profilesRoot": str(PROFILES_DIR),
            "deadlineMs": deadline_ms,
            "maxPosts": max_posts,
            "scriptTimeoutMs": script_timeout_ms,
            "events": events,
            "interactionSeed": interaction_seed,
        },
        ensure_ascii=False,
    ).encode()

    with tempfile.NamedTemporaryFile(prefix="ana-capture-", suffix=".json", delete=False) as f:
        f.write(payload)
        path = Path(f.name)

    try:
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
        err = result.get("error") if isinstance(result, dict) else result
        raise RuntimeError(f"mimic capture failed: {err}")

    bodies = result.get("bodies")
    if not isinstance(bodies, list) or not all(isinstance(b, str) for b in bodies):
        raise RuntimeError("invalid sensor bodies from bridge")

    log(f"mimic capture done bodies={len(bodies)} sizes={[len(b) for b in bodies]}")
    _maybe_dump_bms_probe(result.get("assignProbe"), bodies)

    if stderr:
        for line in stderr.decode(errors="replace").strip().splitlines()[-20:]:
            if line:
                log(f"mimic stderr: {line}")
    return bodies


def _maybe_dump_bms_probe(probe: Any, bodies: list[str]) -> None:
    """Optional debug dump for BMS multi-id assign probe."""
    if not isinstance(probe, dict):
        return
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


def select_abck_bodies(
    bodies: list[str],
    post_count: int | None = None,
    *,
    policy: str = "all",
) -> list[str]:
    """Pick abck bodies: all | edges (1st+2nd+last) | first N via post_count."""
    if not bodies:
        return []
    if post_count is not None:
        return bodies[: max(0, post_count)]
    if policy == "edges":
        if len(bodies) <= 2:
            return list(bodies)
        return [bodies[0], bodies[1], bodies[-1]]
    if policy != "all":
        raise ValueError(f"unknown abck policy: {policy}")
    return list(bodies)


def capture_deadlines(proxy_mode: str) -> tuple[int, int, int]:
    """(abck_deadline_ms, bms_deadline_ms, script_timeout_ms) by egress RTT."""
    if proxy_mode == "lumi":
        return 8000, 7000, 16_000
    return 5000, 5000, 12_000


# --- flow ---

async def initialize(
    client: Client,
    post_count: int | None = None,
    *,
    abck_policy: str = "all",
    proxy_mode: str = "local",
    profile: str,
    interaction_seed: str,
) -> dict:
    abck_dl, bms_dl, script_to = capture_deadlines(proxy_mode)
    log(
        f"=== init (proxy={proxy_mode} abck_policy={abck_policy} "
        f"profile={profile} tls=Chrome{CHROME_MAJOR}) ==="
    )

    # 1) landing page → cookies + BMS/ABCK script URLs
    status, html = await http_get(client, SELECT_URL, nav_headers())
    if status != 200:
        raise RuntimeError(f"landing HTTP {status}")
    initial_cookies = cookie_header(client)
    log(f"landing cookies ({len(cookie_names(initial_cookies))}): {cookie_names(initial_cookies)}")

    bms_url, abck_url = discover_script_urls(SELECT_URL, html)
    log(f"discovered BMS={bms_url}")
    log(f"discovered ABCK={abck_url}")
    script_hdrs = script_headers(SELECT_URL)

    # 2) ABCK: fetch script → mimic capture → multi-POST
    log(f"=== abck script ===")
    st, abck_src = await http_get(client, abck_url, script_hdrs)
    if st != 200:
        raise RuntimeError(f"abck script HTTP {st}")

    sensor_bodies = await capture_bodies(
        SELECT_URL, html, abck_url, abck_src, cookie_header(client),
        profile=profile,
        max_posts=8, events="abck", deadline_ms=abck_dl, script_timeout_ms=script_to,
        interaction_seed=interaction_seed,
    )
    if not sensor_bodies:
        raise RuntimeError("no _abck bodies captured")

    to_post = select_abck_bodies(sensor_bodies, post_count=post_count, policy=abck_policy)
    policy_label = f"first-N={post_count}" if post_count is not None else abck_policy
    log(f"abck will post {len(to_post)}/{len(sensor_bodies)} bodies (policy={policy_label})")

    abck_post = sensor_post_headers(
        content_type="text/plain;charset=UTF-8", accept=DOC_ACCEPT,
    )
    post_url = abck_url.split("?", 1)[0]
    gap = 0.25 if proxy_mode == "lumi" else 0.15
    for i, body in enumerate(to_post, 1):
        await asyncio.sleep(gap)
        st, _ = await http_post(
            client, post_url, abck_post, body, label=f"_abck POST {i}/{len(to_post)}"
        )
        if st >= 400:
            raise RuntimeError(f"_abck POST HTTP {st}")

    # 3) BMS: fetch script → capture → single POST
    bms_posted = False
    if bms_url:
        log(f"=== BMS script ===")
        st, bms_src = await http_get(client, bms_url, script_hdrs)
        if st != 200:
            raise RuntimeError(f"BMS script HTTP {st}")
        # max_posts=2: real BMS body + optional __BMS_ASSIGN__ multi-id probe
        bodies = await capture_bodies(
            SELECT_URL, html, bms_url, bms_src, cookie_header(client),
            profile=profile,
            max_posts=2, events="none", deadline_ms=bms_dl, script_timeout_ms=script_to,
        )
        if bodies:
            st, _ = await http_post(
                client,
                bms_url.split("?", 1)[0],
                sensor_post_headers(content_type="application/json", accept="application/json"),
                bodies[0],
                label="BMS POST",
            )
            if st >= 400:
                raise RuntimeError(f"BMS POST HTTP {st}")
            bms_posted = True
            log(f"BMS posted ok")
        else:
            log("BMS capture empty, skip post")

    cookies = cookie_header(client)
    names = cookie_names(enrich_bm_lso(cookies))
    log(f"=== init done cookies ({len(names)}): {names} ===")
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
        "abck_policy": policy_label,
        "cookie_names": names,
    }


def classify_verify(status: int, body: str) -> str:
    if status == 403:
        return "edge_403"
    if 200 <= status < 300 and body:
        return "ok_2xx"
    if "Processing" in body:
        return "soft_blocked_processing"
    return f"verify_{status}"


async def verify(client: Client, body: str = DEFAULT_BODY) -> dict:
    log("=== verify: roundtrip-owd ===")
    cookie = cookie_header(client, VERIFY_URL)
    log_abck_tilde0(cookie, "verify")
    log(f"verify cookies ({len(cookie_names(cookie))}): {cookie_names(cookie)}")

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
        "verify_status": status,
        "verify_success": ok,
        "verify_class": bucket,
        "verify_body": text,
    }


def classify_result(r: dict[str, Any]) -> str:
    """Bucket one flow for baseline notes."""
    if r.get("error"):
        err = str(r["error"])
        if "fewer than two scripts" in err or "identical BMS" in err:
            return "no_akamai_scripts"
        if "no _abck bodies" in err or "BMS capture empty" in err or "mimic" in err.lower():
            return "flow_capture"
        if "_abck POST" in err or "BMS POST" in err or "landing" in err:
            return "http_init"
        return "exception"
    if not r.get("bms_posted"):
        return "bms_skip"
    abck = cookie_value(str(r.get("cookies") or ""), "_abck") or ""
    if "~0~" not in abck:
        return "abck_no_tilde0"
    if r.get("verify_class"):
        return str(r["verify_class"])
    if r.get("verify_status") is None:
        return "init_only"
    return f"verify_{r['verify_status']}"


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
    """One flow: sticky proxy + client → init → optional verify."""
    token = _WORKER.set(f"w{worker_id}")
    started = time()
    chosen_profile = resolve_profile(profile)
    interaction_seed = secrets.token_hex(16)
    try:
        log(
            f"worker start verify={do_verify} post_count={post_count} "
            f"abck_policy={abck_policy} proxy={proxy_mode} profile={chosen_profile}"
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
            "interaction_seed": interaction_seed,
        }
        try:
            init = await initialize(
                client,
                post_count=post_count,
                abck_policy=abck_policy,
                proxy_mode=proxy_mode,
                profile=chosen_profile,
                interaction_seed=interaction_seed,
            )
            out.update(init)
            cookies = str(out.get("cookies") or "")
            out["abck_tilde0"] = "~0~" in (cookie_value(cookies, "_abck") or "")
            out["has_bm_s"] = cookie_value(cookies, "bm_s") is not None

            if do_verify:
                out.update(await verify(client))
            else:
                out.update(verify_status=None, verify_success=None, verify_class=None, verify_body=None)
                log("init-only, skip verify")

            out["ok"] = (not do_verify) or bool(out.get("verify_success"))
            out["class"] = classify_result(out)
            out["elapsed_s"] = round(time() - started, 2)
            log(
                f"worker done ok={out['ok']} class={out['class']} "
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
                "interaction_seed": interaction_seed,
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
    """Run ``count`` flows with at most ``concurrency`` in flight."""
    if count < 1 or concurrency < 1:
        raise ValueError("count and concurrency must be >= 1")
    concurrency = min(concurrency, count)
    pool_n = 1 if profile else len(list_android_chrome_profiles())
    log(
        f"concurrent start count={count} concurrency={concurrency} verify={do_verify} "
        f"proxy={proxy_mode} abck_policy={abck_policy} "
        f"profile={'pin:' + profile if profile else f'random pool={pool_n}'}"
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
    log(f"concurrent summary ok={ok_n} fail={count - ok_n} total={count}")
    log(f"class buckets: {dict(Counter(str(r.get('class') or '?') for r in out))}")
    for r in out:
        wid = r.get("worker")
        if r.get("ok"):
            log(
                f"summary w{wid}: ok status={r.get('verify_status')} class={r.get('class')} "
                f"profile={r.get('profile')} abck_posts={r.get('abck_post_count')} "
                f"bms={r.get('bms_posted')} tilde0={r.get('abck_tilde0')} "
                f"elapsed={r.get('elapsed_s')}s"
            )
        else:
            log(
                f"summary w{wid}: FAIL status={r.get('verify_status')} class={r.get('class')} "
                f"verify_class={r.get('verify_class')} profile={r.get('profile')} "
                f"abck_posts={r.get('abck_post_count')} tilde0={r.get('abck_tilde0')} "
                f"error={r.get('error')} elapsed={r.get('elapsed_s')}s"
            )
    return out


_JSON_OUT_KEYS = (
    "worker", "proxy_mode", "lumi_country", "profile", "tls_emulation",
    "interaction_seed",
    "ok", "class", "verify_status", "verify_success", "verify_class",
    "abck_post_count", "abck_body_count", "abck_policy", "bms_posted",
    "abck_tilde0", "has_bm_s", "elapsed_s", "error",
)


async def main() -> int:
    p = argparse.ArgumentParser(description="ANA www flow smoke test")
    p.add_argument("--verify", action="store_true", help="POST roundtrip-owd after init")
    p.add_argument("--post-count", type=int, help="post first N _abck bodies (overrides --abck-policy)")
    p.add_argument(
        "--abck-policy", choices=("all", "edges"), default="all",
        help="all=every body (default); edges=1st+2nd+last",
    )
    p.add_argument(
        "-j", "--concurrency", type=int, default=1, metavar="N",
        help="max parallel flows (each own proxy+cookies); default 1",
    )
    p.add_argument(
        "-n", "--count", type=int, default=None, metavar="N",
        help="total flows (default: same as --concurrency)",
    )
    p.add_argument(
        "--proxy", choices=("local", "lumi", "none", "mitm", "reqable"), default="local",
        help="egress: local (default), lumi, none, mitm, reqable",
    )
    p.add_argument(
        "--lumi-country", default=LUMI_COUNTRY,
        help=f"Bright Data -country-XX (default {LUMI_COUNTRY}); only with --proxy lumi",
    )
    p.add_argument(
        "--profile", default=None, metavar="ID",
        help="pin mimic profile; default: random from canonical and raw fp-env Android Chrome profiles",
    )
    p.add_argument("--json-out", type=Path, help="write slim results JSON array")
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
        f"proxy={args.proxy} profile={args.profile or 'random'}"
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
        slim = [{k: r.get(k) for k in _JSON_OUT_KEYS if k in r or k in ("ok", "class", "worker")} for r in results]
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

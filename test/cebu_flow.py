"""Cebu www flow smoke test: mimic sensor bodies → cookies → availability."""

import argparse
import asyncio
import json
import re
import tempfile
from datetime import timedelta
from pathlib import Path
from time import time
from urllib.parse import urljoin, urlparse

from rnet import Client, Emulation, EmulationOS, EmulationOption, Policy, Proxy

SITE = "https://www.cebupacificair.com"
PROXY = "http://10.5.2.79:9001"
SELECT_FLIGHT = f"{SITE}/en-PH/booking/select-flight"
SEARCH_URL = "https://soar.cebupacificair.com/ceb-omnix-proxy-v3/availability"
BRIDGE = Path(__file__).with_name("cebu_capture.mjs")
PROFILE = "android-chrome/2201116sg-v138-10025"

UA = (
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36"
)
SEC_CH_UA = '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"'
ACCEPT_LANG = "en,en-US;q=0.9,zh-CN;q=0.8,zh;q=0.7"
DOC_ACCEPT = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
    "image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
)

# Captured Web v3 sample; cookies from mimic. HTTP 401 = bot passed.
AUTHORIZATION = "Bearer b6b406a0dbGRE79g3Rm6ruBcSiz3fhGawn4kD7"
X_AUTH_TOKEN = (
    "f13bf793c8U2FsdGVkX1+oWtzU1Jn0t3xdybCpiw7G8lsMyvTCIRlvJwmRht1IXlWBr7+UMahr"
    "WEDz5oh9fypiMd9FeNhuzkjkizZYtj1wFx5ssbV000QbdW29CVIeduX2yLzcCbyUbGpl1YrXWh"
    "n5agpnA5XO06RjxOAlB+2TiXuDnuWD+p0v/4mRATZ0zCA7QAQJnkLhyqRS6lpFNZlh/L9URL8G"
    "NEUbCixzXIkvolHJbgp433JIQ3+vVXfpBc3n6BNE6wuzk2lNMulrLAF97RSqphOuYu60T+vncN"
    "VZY2v2EfkP4nM="
)
X_PATH = "U2FsdGVkX19PzY7Ss8H+VQJNOsPMWzAAX2Z2St2/z1g="
DEFAULT_BODY = (
    '{"content":"U2FsdGVkX1+lnF9oonJrfETXCi2D7mZOCSj7UhJve3FsDc5O8ES/6HkR2LMXBZhskI5N'
    "zwaxbauhMUHnq2XcNBXIPMvmrhwPYCHhVilHX2+KlVDKDFUvmqRWOs5Ey7Cr1He6o73mYKD4Z4WaE"
    "nry2klsBIgxrlq6tAUAlQHSir+/oMCWJO2mk+TneZDjav7XrHU1VKGMFZuqNZwV5KIWBtsGRooPTD"
    "5pt8QEtezKHo9nKq8FNg01BKujGXh7BpgEo8gUs9ynoIbAJ3fMNeQ2XNWR6hUZLQuthqQfKmdf13"
    "bf793c8U2FsdGVkX1+oWtzU1Jn0t3xdybCpiw7G8lsMyvTCIRlvJwmRht1IXlWBr7+UMahrWEDz5"
    "oh9fypiMd9FeNhuzkjkizZYtj1wFx5ssbV000QbdW29CVIeduX2yLzcCbyUbGpl1YrXWhn5agpnA"
    "5XO06RjxOAlB+2TiXuDnuWD+p0v/4mRATZ0zCA7QAQJnkLhyqRS6lpFNZlh/L9URL8GNEUbCixzX"
    "IkvolHJbgp433JIQ3+vVXfpBc3n6BNE6wuzk2lNMulrLAF97RSqphOuYu60T+vncNVZY2v2EfkP4"
    "nM=H3/ypOAkdI7w4yUed1XQ9rGg1o86iGJ8oxFvdyjVviNQXWszeGmAqOIQiwhqeSVQBogj4yGmW"
    "BPXUEFWo3x2g9CVKYuigdub6b406a0dbGRE79g3Rm6ruBcSiz3fhGawn4kD7YMinne2j2WGRe2CG"
    "KJNKr0++Arpgs/CrVVw25Oe3WB8RmCUwiHdFYtgwxdvxMFHX11GxEZkjYCxhb0HxAb0q4z9A2Py9"
    'vdxlZjJj9mXPgQEHut7/S/Ce2CR9QP"}'
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
    r = await client.get(url, headers=headers)
    status = r.status.as_int()
    body = bytes(await r.bytes()).decode("utf-8", errors="replace")
    await r.close()
    return status, body


async def http_post(
    client: Client,
    url: str,
    headers: dict,
    body: str,
    *,
    orig_headers: list[str] | None = None,
) -> tuple[int, str]:
    kwargs: dict = {"headers": headers, "body": body}
    if orig_headers is not None:
        kwargs["orig_headers"] = orig_headers
    r = await client.post(url, **kwargs)
    status = r.status.as_int()
    text = bytes(await r.bytes()).decode("utf-8", errors="replace")
    await r.close()
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
    return bodies


async def initialize(client: Client, post_count: int | None = None) -> dict:
    base = browser_headers()
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

    script_hdrs = {
        **base,
        "accept": "*/*",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-dest": "script",
        "referer": SELECT_FLIGHT,
        "accept-language": ACCEPT_LANG,
    }

    bms_url = None
    bms_posted = False
    bms_path = extract_bms_script(html)
    if bms_path:
        bms_url = urljoin(SITE + "/", bms_path)
        st, bms_src = await http_get(client, bms_url, script_hdrs)
        if st != 200:
            raise RuntimeError(f"BMS script HTTP {st}")
        bodies = await capture_bodies(
            SELECT_FLIGHT, html, bms_url, bms_src, cookie_header(client),
            max_posts=1, events="none", deadline_ms=1000, script_timeout_ms=8000,
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
            )
            if st >= 400:
                raise RuntimeError(f"BMS POST HTTP {st}")

    abck_path = extract_abck_script(html)
    if not abck_path:
        raise RuntimeError("abck script not found")
    abck_url = urljoin(SITE + "/", abck_path)
    st, abck_src = await http_get(client, abck_url, script_hdrs)
    if st != 200:
        raise RuntimeError(f"abck script HTTP {st}")

    sensor_bodies = await capture_bodies(
        SELECT_FLIGHT, html, abck_url, abck_src, cookie_header(client),
        max_posts=8, events="abck", deadline_ms=4000, script_timeout_ms=12000,
    )
    if not sensor_bodies:
        raise RuntimeError("no _abck bodies captured")

    n = len(sensor_bodies) if post_count is None else min(post_count, len(sensor_bodies))
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
    for body in sensor_bodies[:n]:
        await asyncio.sleep(0.1)
        st, _ = await http_post(client, post_url, abck_post, body)
        if st >= 400:
            raise RuntimeError(f"_abck POST HTTP {st}")

    cookies = cookie_header(client)
    return {
        "initial_status": status,
        "initial_cookies": initial_cookies,
        "cookies": cookies,
        "bms_script_url": bms_url,
        "abck_script_url": abck_url,
        "bms_posted": bms_posted,
        "abck_body_count": len(sensor_bodies),
        "abck_post_count": n,
        "cookie_names": [
            p.split("=", 1)[0]
            for p in enrich_bm_lso(cookies).split("; ")
            if "=" in p
        ],
    }


# Availability request wire order (HTTP/1.x). host/content-length are client-filled.
SEARCH_HEADER_ORDER = [
    "host",
    "content-length",
    "pragma",
    "cache-control",
    "sec-ch-ua-platform",
    "x-auth-token",
    "authorization",
    "x-path",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
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
    "priority",
    "cookie",
]


async def search(client: Client, body: str = DEFAULT_BODY) -> dict:
    cookie = enrich_bm_lso(cookie_header(client, SEARCH_URL))
    headers = {
        **browser_headers(),
        "accept": "application/json",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": ACCEPT_LANG,
        "authorization": AUTHORIZATION,
        "cache-control": "no-cache",
        "content-type": "application/json",
        "origin": SITE,
        "pragma": "no-cache",
        "priority": "u=1, i",
        "referer": SITE + "/",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "x-auth-token": X_AUTH_TOKEN,
        "x-path": X_PATH,
    }
    if cookie:
        headers["cookie"] = cookie
    status, text = await http_post(
        client, SEARCH_URL, headers, body, orig_headers=SEARCH_HEADER_ORDER
    )
    # Web: bot-passed + stale anonymous auth → 401
    return {"search_status": status, "search_success": status == 401, "search_body": text}


async def main() -> int:
    p = argparse.ArgumentParser(description="Cebu www flow smoke test")
    p.add_argument("--search", action="store_true", help="call availability after init")
    p.add_argument("--post-count", type=int, help="post only first N _abck bodies")
    args = p.parse_args()

    client = Client(
        emulation=EmulationOption(
            emulation=Emulation.Chrome138,
            emulation_os=EmulationOS.Android,
        ),
        cookie_store=True,
        timeout=timedelta(seconds=30),
        redirect=Policy.limited(10),
        proxies=[Proxy.all(PROXY)],
        verify=False,
    )
    out = await initialize(client, post_count=args.post_count)
    if args.search:
        out.update(await search(client))
    else:
        out.update(search_status=None, search_success=None, search_body=None)
    print(json.dumps(out, ensure_ascii=False))
    return 0 if not args.search or out["search_success"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

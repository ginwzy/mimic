"""Run the Cebu request flow against www with sensor bodies from mimic."""

from __future__ import annotations

import argparse
import asyncio
import inspect
import json
import os
import random
import re
import signal
import tempfile
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from time import time
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urljoin, urlparse

from rnet import Client, Emulation, EmulationOS, EmulationOption, Policy

SITE_URL = "https://www.cebupacificair.com"
# Web availability endpoint (main.js apiPostAvailability).
SEARCH_URL = "https://soar.cebupacificair.com/ceb-omnix-proxy-v3/availability"
AUTHORIZED_HOSTS = frozenset({
    "www.cebupacificair.com",
    "soar.cebupacificair.com",
})
MIMIC_BRIDGE_PATH = Path(__file__).resolve().with_name("cebu_capture.mjs")
MIMIC_PROFILE = "android-chrome/2201116sg-v138-10025"
RNET_EMULATION = EmulationOption(
    emulation=Emulation.Chrome138,
    emulation_os=EmulationOS.Android,
)
# Abck multi-post capture window (motion + swipe sequences need room to fire).
ABCK_CAPTURE_DEADLINE_MS = 4_000
ABCK_MAX_POSTS = 8
ABCK_SCRIPT_TIMEOUT_MS = 12_000

DOCUMENT_ACCEPT = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
    "image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
)
DEFAULT_ACCEPT_ENCODING = "gzip, deflate, br, zstd"
DEFAULT_ACCEPT_LANGUAGE = "en,en-US;q=0.9,zh-CN;q=0.8,zh;q=0.7"

# Captured Web v3 availability request (browser). Auth/body are fixed samples;
# session cookies come from the mimic abck flow. HTTP 401 = bot passed.
AUTHORIZATION = "Bearer b6b406a0dbGRE79g3Rm6ruBcSiz3fhGawn4kD7"
X_AUTH_TOKEN = (
    "f13bf793c8U2FsdGVkX1+oWtzU1Jn0t3xdybCpiw7G8lsMyvTCIRlvJwmRht1IXlWBr7+UMahr"
    "WEDz5oh9fypiMd9FeNhuzkjkizZYtj1wFx5ssbV000QbdW29CVIeduX2yLzcCbyUbGpl1YrXWh"
    "n5agpnA5XO06RjxOAlB+2TiXuDnuWD+p0v/4mRATZ0zCA7QAQJnkLhyqRS6lpFNZlh/L9URL8G"
    "NEUbCixzXIkvolHJbgp433JIQ3+vVXfpBc3n6BNE6wuzk2lNMulrLAF97RSqphOuYu60T+vncN"
    "VZY2v2EfkP4nM="
)
X_PATH = "U2FsdGVkX19PzY7Ss8H+VQJNOsPMWzAAX2Z2St2/z1g="

DEFAULT_SEARCH_BODY = (
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

_SCRIPT_SRC_RE = re.compile(
    r'''(?i)<script[^>]*\ssrc\s*=\s*["']([^"']+)["']'''
)
_VERSIONED_SCRIPT_RE = re.compile(r'''src=["']([^"']*\?v=[^"']+)["']''')


class CebuFlowError(RuntimeError):
    """Raised when the Cebu initialization flow cannot be reconstructed."""


def _origin(url: str) -> Tuple[str, Optional[str], Optional[int]]:
    parsed = urlparse(url)
    port = parsed.port
    if port is None:
        port = 443 if parsed.scheme.lower() == "https" else 80
    return parsed.scheme.lower(), parsed.hostname, port


def _origin_allowed(url: str) -> bool:
    scheme, host, port = _origin(url)
    return scheme == "https" and host in AUTHORIZED_HOSTS and port == 443


async def _terminate_process_group(
    process: asyncio.subprocess.Process,
) -> None:
    """Kill a spawned wrapper and its descendants, then drain its pipes."""

    if process.returncode is None:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            try:
                process.kill()
            except ProcessLookupError:
                pass
    try:
        await process.communicate()
    except (BrokenPipeError, ConnectionResetError, RuntimeError):
        if process.returncode is None:
            await process.wait()


class HttpResponse:
    def __init__(self, status: int, body: bytes) -> None:
        self.status = status
        self._body = body

    async def text(self) -> str:
        return self._body.decode("utf-8", errors="replace")

    async def close(self) -> None:
        return None


class RnetClient:
    """Async HTTP client via rnet (Chrome Android TLS/JA3 emulation + cookie jar)."""

    def __init__(self, timeout: int = 30) -> None:
        self.timeout = timeout
        self._closed = False
        # proxy=True: honor system/env proxy (user already routes traffic via local proxy).
        self._client = Client(
            emulation=RNET_EMULATION,
            cookie_store=True,
            timeout=timedelta(seconds=timeout),
            redirect=Policy.limited(10),
            proxy=True,
            verify=False,
        )

    def get_cookies(self, url: str) -> str:
        jar = self._client.cookie_jar
        if jar is None:
            return ""
        host = (urlparse(url).hostname or "").lower()
        pairs: List[str] = []
        for cookie in jar.get_all():
            domain = (cookie.domain or "").lstrip(".").lower()
            if not domain:
                continue
            if host == domain or host.endswith("." + domain):
                pairs.append(f"{cookie.name}={cookie.value}")
        return "; ".join(pairs)

    async def get(self, url: str, headers: Dict[str, str]) -> HttpResponse:
        return await self._request("GET", url, headers)

    async def post(
        self,
        url: str,
        headers: Dict[str, str],
        body: str,
    ) -> HttpResponse:
        return await self._request("POST", url, headers, body)

    async def _request(
        self,
        method: str,
        url: str,
        headers: Dict[str, str],
        body: Optional[str] = None,
    ) -> HttpResponse:
        if self._closed:
            raise CebuFlowError("rnet client is closed")
        try:
            target_origin = _origin(url)
        except ValueError as error:
            raise CebuFlowError(f"refusing invalid URL: {url}") from error
        if not _origin_allowed(url):
            raise CebuFlowError(f"refusing out-of-scope URL: {url}")

        try:
            if method == "GET":
                response = await self._client.get(url, headers=headers)
            elif method == "POST":
                response = await self._client.post(url, headers=headers, body=body or "")
            else:
                raise CebuFlowError(f"unsupported method: {method}")
            status = response.status.as_int()
            raw = await response.bytes()
            body_bytes = bytes(raw) if not isinstance(raw, (bytes, bytearray)) else bytes(raw)
            await response.close()
            return HttpResponse(status, body_bytes)
        except CebuFlowError:
            raise
        except Exception as error:
            raise CebuFlowError(f"rnet {method} failed for {url}: {error}") from error

    async def close(self) -> None:
        self._closed = True


@dataclass(frozen=True)
class BrowserProfile:
    user_agent: str = (
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36"
    )
    sec_ch_ua: str = (
        '"Not)A;Brand";v="8", "Chromium";v="138", '
        '"Google Chrome";v="138"'
    )
    sec_ch_ua_mobile: str = "?1"
    sec_ch_ua_platform: str = '"Android"'


@dataclass(frozen=True)
class SensorBodyContext:
    page_url: str
    script_url: str
    script_source: str
    page_html: str
    cookie_header: str


@dataclass(frozen=True)
class InitializationResult:
    status: int
    initial_cookie_header: str
    cookie_header: str
    bms_script_url: Optional[str]
    abck_script_url: str
    bms_posted: bool
    abck_body_count: int
    abck_post_count: int


@dataclass(frozen=True)
class SearchResult:
    status: int
    success: bool
    body: str
    data: Optional[Any]


@dataclass(frozen=True)
class FlowResult:
    initialization: InitializationResult
    search: SearchResult


def extract_bms_script(html: str) -> Optional[str]:
    """Mirror ``get_bms_script`` from ``util.rs``."""

    match = _VERSIONED_SCRIPT_RE.search(html)
    return match.group(1) if match else None


def extract_abck_script(html: str) -> Optional[str]:
    """Mirror ``get_abck_script`` from ``util.rs``."""

    sources = _SCRIPT_SRC_RE.findall(html)
    versioned = extract_bms_script(html)
    if versioned is not None:
        path = versioned.split("?", 1)[0]
        segments = path.lstrip("/").split("/", 1)
        if segments and segments[0]:
            prefix = "/{}/".format(segments[0])
            for source in sources:
                if source.startswith(prefix) and "?v=" not in source:
                    return source

    # Current pages often expose only the extensionless Akamai sensor path.
    for source in reversed(sources):
        parsed = urlparse(source)
        segments = [segment for segment in parsed.path.split("/") if segment]
        if (
            not parsed.scheme
            and not parsed.netloc
            and parsed.path.startswith("/")
            and len(segments) >= 4
            and "." not in segments[-1]
        ):
            return source
    return None


class CebuFlow:
    def __init__(
        self,
        client: Optional[Any] = None,
        profile: BrowserProfile = BrowserProfile(),
        timeout: int = 30,
        sensor_post_delay: float = 0.1,
        site_url: str = SITE_URL,
        availability_url: Optional[str] = None,
        mimic_profile: str = MIMIC_PROFILE,
        mimic_bridge_path: Path = MIMIC_BRIDGE_PATH,
        capture_deadline_ms: int = ABCK_CAPTURE_DEADLINE_MS,
    ) -> None:
        parsed_site = urlparse(site_url)
        if parsed_site.scheme not in {"http", "https"} or not parsed_site.netloc:
            raise ValueError("site_url must be an absolute HTTP(S) URL")
        if not _origin_allowed(site_url):
            raise ValueError(
                "site_url must be an authorized cebupacificair.com HTTPS origin"
            )
        if capture_deadline_ms < 1:
            raise ValueError("capture_deadline_ms must be positive")
        self.profile = profile
        self.sensor_post_delay = sensor_post_delay
        self.site_url = SITE_URL
        self.select_flight_url = urljoin(
            self.site_url + "/",
            "en-PH/booking/select-flight",
        )
        if availability_url:
            self.availability_url = (
                availability_url
                if "://" in availability_url
                else urljoin(self.site_url + "/", availability_url)
            )
        else:
            self.availability_url = SEARCH_URL
        self._site_origin = self._origin(self.site_url)
        if not _origin_allowed(self.availability_url):
            raise ValueError(
                f"availability_url is out of scope: {self.availability_url}"
            )
        self.mimic_profile = mimic_profile
        self.mimic_bridge_path = Path(mimic_bridge_path)
        self.capture_deadline_ms = capture_deadline_ms
        self.client = (
            client if client is not None else RnetClient(timeout=timeout)
        )

    @staticmethod
    def _origin(url: str) -> Tuple[str, Optional[str], Optional[int]]:
        return _origin(url)

    def _require_same_origin(self, url: str) -> None:
        if self._origin(url) != self._site_origin:
            raise CebuFlowError(f"refusing out-of-scope URL: {url}")

    def _browser_headers(self) -> Dict[str, str]:
        return {
            "user-agent": self.profile.user_agent,
            "sec-ch-ua": self.profile.sec_ch_ua,
            "sec-ch-ua-mobile": self.profile.sec_ch_ua_mobile,
            "sec-ch-ua-platform": self.profile.sec_ch_ua_platform,
        }

    def _document_get_headers(self, sec_fetch_site: str) -> Dict[str, str]:
        headers = self._browser_headers()
        headers.update(
            {
                "upgrade-insecure-requests": "1",
                "accept": DOCUMENT_ACCEPT,
                "sec-fetch-site": sec_fetch_site,
                "sec-fetch-mode": "navigate",
                "sec-fetch-user": "?1",
                "sec-fetch-dest": "document",
                "accept-encoding": DEFAULT_ACCEPT_ENCODING,
                "accept-language": DEFAULT_ACCEPT_LANGUAGE,
                "priority": "u=0, i",
            }
        )
        return headers

    def _script_get_headers(self) -> Dict[str, str]:
        headers = self._browser_headers()
        headers.update(
            {
                "accept": "*/*",
                "sec-fetch-site": "same-origin",
                "sec-fetch-mode": "no-cors",
                "sec-fetch-dest": "script",
                "referer": self.select_flight_url,
                "accept-encoding": DEFAULT_ACCEPT_ENCODING,
                "accept-language": DEFAULT_ACCEPT_LANGUAGE,
                "priority": "u=1",
            }
        )
        return headers

    def _sensor_post_headers(
        self,
        accept: str,
        content_type: str,
    ) -> Dict[str, str]:
        headers = self._browser_headers()
        headers.update(
            {
                "content-type": content_type,
                "accept": accept,
                "origin": self.site_url,
                "sec-fetch-site": "same-origin",
                "sec-fetch-mode": "cors",
                "sec-fetch-dest": "empty",
                "referer": self.select_flight_url,
                "accept-encoding": DEFAULT_ACCEPT_ENCODING,
                "accept-language": DEFAULT_ACCEPT_LANGUAGE,
                "priority": "u=1, i",
            }
        )
        return headers

    def cookie_header(self, url: Optional[str] = None) -> str:
        raw = self.client.get_cookies(url or self.site_url)
        if raw is None:
            return ""
        if isinstance(raw, bytes):
            return raw.decode("latin-1")
        return str(raw)

    async def generate_bms_body(
        self,
        context: SensorBodyContext,
    ) -> Optional[str]:
        """Capture the first BMS request body emitted by its browser script."""

        bodies = await self._capture_sensor_bodies(
            context,
            max_posts=1,
            events="none",
            deadline_ms=1_000,
            script_timeout_ms=8_000,
        )
        return bodies[0] if bodies else None

    async def generate_abck_bodies(
        self,
        context: SensorBodyContext,
    ) -> Sequence[str]:
        """Capture ordered _abck bodies with multi-post motion/touch events."""

        bodies = await self._capture_sensor_bodies(
            context,
            max_posts=ABCK_MAX_POSTS,
            events="abck",
            deadline_ms=self.capture_deadline_ms
            if self.capture_deadline_ms > ABCK_CAPTURE_DEADLINE_MS
            else ABCK_CAPTURE_DEADLINE_MS,
            script_timeout_ms=ABCK_SCRIPT_TIMEOUT_MS,
        )
        if not bodies:
            raise CebuFlowError("mimic did not capture an _abck sensor body")
        return bodies

    @staticmethod
    def _cookie_strings(cookie_header: str) -> List[str]:
        return [
            item.strip()
            for item in cookie_header.split(";")
            if "=" in item and item.strip()
        ]

    async def _capture_sensor_bodies(
        self,
        context: SensorBodyContext,
        max_posts: int,
        events: str = "none",
        deadline_ms: Optional[int] = None,
        script_timeout_ms: int = 8_000,
    ) -> List[str]:
        if not self.mimic_bridge_path.is_file():
            raise CebuFlowError(
                f"mimic bridge not found: {self.mimic_bridge_path}"
            )
        capture_deadline = (
            self.capture_deadline_ms if deadline_ms is None else deadline_ms
        )
        payload = json.dumps(
            {
                "pageUrl": context.page_url,
                "pageHtml": context.page_html,
                "scriptUrl": context.script_url,
                "scriptSource": context.script_source,
                "cookies": self._cookie_strings(context.cookie_header),
                "profile": self.mimic_profile,
                "deadlineMs": capture_deadline,
                "maxPosts": max_posts,
                "scriptTimeoutMs": script_timeout_ms,
                "events": events,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        input_file = tempfile.NamedTemporaryFile(
            prefix="cebu-capture-",
            suffix=".json",
            delete=False,
        )
        input_path = Path(input_file.name)
        input_file.write(payload)
        input_file.close()
        process: Optional[asyncio.subprocess.Process] = None
        try:
            process = await asyncio.create_subprocess_exec(
                "node",
                str(self.mimic_bridge_path),
                str(input_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=max(30, capture_deadline / 1_000 + script_timeout_ms / 1_000 + 15),
                )
            except asyncio.TimeoutError as error:
                raise CebuFlowError("mimic sensor capture timed out") from error
        finally:
            if process is not None and process.returncode is None:
                await _terminate_process_group(process)
            input_path.unlink(missing_ok=True)

        marker = b"__CEBU_CAPTURE_RESULT__"
        _, found, result_payload = stdout.rpartition(marker)
        if not found:
            detail = stderr.decode("utf-8", errors="replace").strip()
            raise CebuFlowError(
                "mimic bridge returned no result"
                + (f": {detail}" if detail else "")
            )
        try:
            result = json.loads(result_payload)
        except json.JSONDecodeError as error:
            raise CebuFlowError("mimic bridge returned invalid JSON") from error
        if (
            process.returncode != 0
            or not isinstance(result, dict)
            or not result.get("ok")
        ):
            error_detail = result.get("error") if isinstance(result, dict) else result
            raise CebuFlowError(
                f"mimic sensor capture failed: {error_detail}"
            )
        bodies = result.get("bodies")
        if not isinstance(bodies, list) or not all(
            isinstance(body, str) for body in bodies
        ):
            raise CebuFlowError("mimic bridge returned invalid sensor bodies")
        return bodies

    async def _fetch_script(self, path: str) -> Tuple[str, str]:
        url = urljoin(self.site_url + "/", path)
        self._require_same_origin(url)
        response = await self.client.get(
            url,
            headers=self._script_get_headers(),
        )
        status = int(response.status)
        source = await response.text()
        await response.close()
        if status != 200:
            raise CebuFlowError(f"script request returned HTTP {status}: {url}")
        return url, source

    async def _post_bms_body(self, url: str, body: str) -> None:
        response = await self.client.post(
            url,
            headers=self._sensor_post_headers(
                "application/json",
                "application/json",
            ),
            body=body,
        )
        status = int(response.status)
        await response.close()
        if status >= 400:
            raise CebuFlowError(f"BMS POST returned HTTP {status}")

    async def _post_abck_body(self, url: str, body: str) -> None:
        response = await self.client.post(
            url,
            headers=self._sensor_post_headers(
                DOCUMENT_ACCEPT,
                "text/plain;charset=UTF-8",
            ),
            body=body,
        )
        status = int(response.status)
        await response.close()
        if status >= 400:
            raise CebuFlowError(f"_abck POST returned HTTP {status}")

    @staticmethod
    def select_sensor_indices(
        length: int,
        post_count: Optional[int] = None,
        random_source: Optional[Any] = None,
    ) -> List[int]:
        """Return chronological abck body indices (first N posts in order)."""

        del random_source  # retained for call-site compatibility
        if length < 0:
            raise ValueError("length must be non-negative")
        if post_count is None:
            return list(range(length))
        if post_count < 0:
            raise ValueError("post_count must be non-negative")
        return list(range(min(post_count, length)))

    async def initialize_cookies(
        self,
        post_count: Optional[int] = None,
        random_source: Optional[Any] = None,
    ) -> InitializationResult:
        initial_response = await self.client.get(
            self.select_flight_url,
            headers=self._document_get_headers("same-origin"),
        )
        initial_status = int(initial_response.status)
        page_html = await initial_response.text()
        await initial_response.close()
        if initial_status != 200:
            raise CebuFlowError(
                f"select-flight returned HTTP {initial_status}"
            )
        initial_cookie_header = self.cookie_header()

        bms_path = extract_bms_script(page_html)
        bms_url: Optional[str] = None
        bms_posted = False
        if bms_path is not None:
            bms_url, bms_source = await self._fetch_script(bms_path)
            bms_context = SensorBodyContext(
                page_url=self.select_flight_url,
                script_url=bms_url,
                script_source=bms_source,
                page_html=page_html,
                cookie_header=self.cookie_header(),
            )
            bms_body = await self.generate_bms_body(bms_context)
            bms_posted = bms_body is not None
            if bms_body is not None:
                await self._post_bms_body(bms_url.split("?", 1)[0], bms_body)

        abck_path = extract_abck_script(page_html)
        if abck_path is None:
            raise CebuFlowError("get_abck_script failed")
        abck_url, abck_source = await self._fetch_script(abck_path)
        abck_context = SensorBodyContext(
            page_url=self.select_flight_url,
            script_url=abck_url,
            script_source=abck_source,
            page_html=page_html,
            cookie_header=self.cookie_header(),
        )
        sensor_bodies = list(await self.generate_abck_bodies(abck_context))
        sensor_indices = self.select_sensor_indices(
            len(sensor_bodies),
            post_count=post_count,
            random_source=random_source,
        )
        for index in sensor_indices:
            await asyncio.sleep(self.sensor_post_delay)
            await self._post_abck_body(
                abck_url.split("?", 1)[0],
                sensor_bodies[index],
            )

        return InitializationResult(
            status=initial_status,
            initial_cookie_header=initial_cookie_header,
            cookie_header=self.cookie_header(),
            bms_script_url=bms_url,
            abck_script_url=abck_url,
            bms_posted=bms_posted,
            abck_body_count=len(sensor_bodies),
            abck_post_count=len(sensor_indices),
        )

    @staticmethod
    def enrich_bot_manager_cookies(cookie_header: str) -> str:
        """Fill bot-manager cookies that browsers set client-side (not always in jar).

        Real pages (and BMS) write `bm_lso` via document.cookie after seeing `bm_so`.
        Captured browser traffic is typically:
          bm_lso = bm_so + "~" + epoch_ms
        node_akamai offline seeds often use bm_lso == bm_so. We follow the browser form.
        """

        if not cookie_header.strip():
            return cookie_header
        order: List[str] = []
        values: Dict[str, str] = {}
        for item in cookie_header.split(";"):
            piece = item.strip()
            if not piece or "=" not in piece:
                continue
            name, value = piece.split("=", 1)
            if name not in values:
                order.append(name)
            values[name] = value
        bm_so = values.get("bm_so")
        if bm_so and "bm_lso" not in values:
            # Avoid double-suffix if bm_so already ends with ~digits.
            if re.search(r"~\d{10,}$", bm_so):
                values["bm_lso"] = bm_so
            else:
                values["bm_lso"] = f"{bm_so}~{int(time() * 1000)}"
            order.append("bm_lso")
        return "; ".join(f"{name}={values[name]}" for name in order)

    def _availability_headers(self) -> Dict[str, str]:
        # Web v3 availability: same UA/sec-ch-ua as cookie init (profile environment).
        cookie = self.enrich_bot_manager_cookies(
            self.cookie_header(self.availability_url)
        )
        headers = self._browser_headers()
        headers.update(
            {
                "accept": "application/json",
                "accept-language": DEFAULT_ACCEPT_LANGUAGE,
                "authorization": AUTHORIZATION,
                "cache-control": "no-cache",
                "content-type": "application/json",
                "origin": SITE_URL,
                "pragma": "no-cache",
                "priority": "u=1, i",
                "referer": SITE_URL + "/",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "x-auth-token": X_AUTH_TOKEN,
                "x-path": X_PATH,
            }
        )
        if cookie:
            headers["cookie"] = cookie
        return headers

    @staticmethod
    def is_search_success(status: int) -> bool:
        # Web: bot-passed + stale/invalid anonymous auth -> HTTP 401.
        return status == 401

    async def search(self, body: str = DEFAULT_SEARCH_BODY) -> SearchResult:
        response = await self.client.post(
            self.availability_url,
            headers=self._availability_headers(),
            body=body,
        )
        status = int(response.status)
        text = await response.text()
        await response.close()
        try:
            data = json.loads(text)
        except (TypeError, json.JSONDecodeError):
            data = None
        return SearchResult(
            status=status,
            success=self.is_search_success(status),
            body=text,
            data=data,
        )

    async def close(self) -> None:
        closer = getattr(self.client, "close", None)
        if closer is None:
            return
        result = closer()
        if inspect.isawaitable(result):
            await result

    async def run(
        self,
        body: str = DEFAULT_SEARCH_BODY,
        post_count: Optional[int] = None,
    ) -> FlowResult:
        initialization = await self.initialize_cookies(post_count=post_count)
        result = await self.search(body=body)
        return FlowResult(initialization=initialization, search=result)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Cebu www request flow")
    parser.add_argument(
        "--availability-url",
        help="Same-origin availability URL or path",
    )
    parser.add_argument("--mimic-profile", default=MIMIC_PROFILE)
    parser.add_argument(
        "--capture-deadline-ms",
        type=int,
        default=ABCK_CAPTURE_DEADLINE_MS,
        help="Abck capture wait window in ms (default multi-post window)",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--search",
        action="store_true",
        help="Call the same-origin availability endpoint after initialization",
    )
    mode.add_argument(
        "--init-only",
        action="store_true",
        help="Initialize Akamai cookies (the default)",
    )
    parser.add_argument(
        "--body-file",
        type=Path,
        help="Optional file containing the raw availability JSON body",
    )
    parser.add_argument(
        "--post-count",
        type=int,
        help="Post only the last N generated _abck sensor bodies",
    )
    return parser


async def _main(args: argparse.Namespace) -> int:
    body = DEFAULT_SEARCH_BODY
    if args.body_file:
        body = args.body_file.read_text(encoding="utf-8")

    flow = CebuFlow(
        availability_url=args.availability_url,
        mimic_profile=args.mimic_profile,
        capture_deadline_ms=args.capture_deadline_ms,
    )
    try:
        if not args.search:
            initialization = await flow.initialize_cookies(
                post_count=args.post_count
            )
            search: Optional[SearchResult] = None
        else:
            result = await flow.run(body=body, post_count=args.post_count)
            initialization = result.initialization
            search = result.search

        output = {
            "initial_status": initialization.status,
            "initial_cookies": initialization.initial_cookie_header,
            "cookies": initialization.cookie_header,
            "bms_script_url": initialization.bms_script_url,
            "abck_script_url": initialization.abck_script_url,
            "bms_posted": initialization.bms_posted,
            "abck_body_count": initialization.abck_body_count,
            "abck_post_count": initialization.abck_post_count,
            "cookie_names": [
                item.split("=", 1)[0]
                for item in (
                    flow.enrich_bot_manager_cookies(initialization.cookie_header)
                    .split("; ")
                    if initialization.cookie_header
                    else []
                )
                if "=" in item
            ],
            "search_status": search.status if search else None,
            "search_success": search.success if search else None,
            "search_body": search.body if search else None,
        }
        print(json.dumps(output, ensure_ascii=False))
        return 0 if search is None or search.success else 1
    finally:
        await flow.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main(_parser().parse_args())))

"""Per-worker flow context: client + proxy meta + capture + cookie helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from rnet import Client, Jar

from mimic_flow.mimic.capture import capture_bodies
from mimic_flow.proxy.base import BuiltProxy
from mimic_flow.session.cookies import cookie_header as _cookie_header
from mimic_flow.session.http import http_get, http_post


@dataclass
class FlowContext:
    """Injected into site flows; one instance per worker."""

    client: Client
    built_proxy: BuiltProxy
    bridge: Path
    profile: str
    default_cookie_url: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def proxy_meta(self) -> dict[str, Any]:
        return dict(self.built_proxy.meta)

    def cookies(self, url: str | None = None) -> str:
        target = url or self.default_cookie_url
        if not target:
            raise ValueError("cookies(url) requires url or default_cookie_url")
        return _cookie_header(self.client, target)

    async def get(self, url: str, headers: dict) -> tuple[int, str]:
        return await http_get(self.client, url, headers)

    async def post(
        self,
        url: str,
        headers: dict,
        body: str,
        *,
        orig_headers: list[str] | None = None,
        cookies: str | dict | None = None,
        cookie_provider: Jar | None = None,
        label: str = "",
    ) -> tuple[int, str]:
        return await http_post(
            self.client,
            url,
            headers,
            body,
            orig_headers=orig_headers,
            cookies=cookies,
            cookie_provider=cookie_provider,
            label=label,
        )

    async def capture(
        self,
        *,
        page_url: str,
        page_html: str,
        script_url: str,
        script_source: str,
        cookies: str | None = None,
        max_posts: int,
        events: str,
        deadline_ms: int,
        script_timeout_ms: int,
    ) -> list[str]:
        return await capture_bodies(
            bridge=self.bridge,
            profile=self.profile,
            page_url=page_url,
            page_html=page_html,
            script_url=script_url,
            script_source=script_source,
            cookies=cookies if cookies is not None else self.cookies(page_url),
            max_posts=max_posts,
            events=events,
            deadline_ms=deadline_ms,
            script_timeout_ms=script_timeout_ms,
        )

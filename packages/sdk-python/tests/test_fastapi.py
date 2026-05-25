"""Integration tests for the FastAPI router (fastapi.py).

These tests are skipped automatically when FastAPI/Starlette TestClient
dependencies are not installed (e.g. the minimal Docker test image), so the
suite stays green everywhere.
"""

import pytest

# Skip the whole module if fastapi or the TestClient stack is unavailable.
fastapi = pytest.importorskip("fastapi")
pytest.importorskip("starlette.testclient")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from pocketping import PocketPing  # noqa: E402
from pocketping.fastapi import (  # noqa: E402
    _parse_user_agent,
    add_cors_middleware,
    create_router,
    lifespan_handler,
)
from pocketping.storage import MemoryStorage  # noqa: E402
from pocketping.utils.ip_filter import IpFilterConfig  # noqa: E402


def _make_client(pp: PocketPing, prefix: str = "") -> TestClient:
    app = FastAPI()
    app.include_router(create_router(pp, prefix=prefix))
    return TestClient(app)


@pytest.fixture
def pp():
    return PocketPing(storage=MemoryStorage())


# ─────────────────────────────────────────────────────────────────
# _parse_user_agent helper
# ─────────────────────────────────────────────────────────────────


class TestParseUserAgent:
    def test_none_returns_empty(self):
        assert _parse_user_agent(None) == {"device_type": None, "browser": None, "os": None}

    def test_chrome_on_windows(self):
        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36"
        info = _parse_user_agent(ua)
        assert info["device_type"] == "desktop"
        assert info["browser"] == "Chrome"
        assert info["os"] == "Windows"

    def test_firefox_on_linux(self):
        info = _parse_user_agent("Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Firefox/120.0")
        assert info["browser"] == "Firefox"
        assert info["os"] == "Linux"

    def test_edge_browser(self):
        info = _parse_user_agent("Mozilla/5.0 Chrome/120 Edg/120.0")
        assert info["browser"] == "Edge"

    def test_safari_on_macos(self):
        info = _parse_user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1")
        assert info["browser"] == "Safari"
        assert info["os"] == "macOS"

    def test_opera_browser(self):
        info = _parse_user_agent("Mozilla/5.0 OPR/100.0 Opera")
        assert info["browser"] == "Opera"

    def test_mobile_android(self):
        info = _parse_user_agent("Mozilla/5.0 (Android 13; Pixel) Mobile Chrome/120")
        assert info["device_type"] == "mobile"
        assert info["os"] == "Android"

    def test_mobile_android_with_linux_token_detected_as_linux(self):
        # OS detection checks 'linux' before 'android', so a UA containing both
        # resolves to Linux. This documents the implementation's precedence.
        info = _parse_user_agent("Mozilla/5.0 (Linux; Android 13; Pixel) Mobile Chrome/120")
        assert info["device_type"] == "mobile"
        assert info["os"] == "Linux"

    def test_tablet_ipad(self):
        info = _parse_user_agent("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS) Safari")
        assert info["device_type"] == "tablet"

    def test_iphone_ios(self):
        info = _parse_user_agent("Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) Safari")
        assert info["os"] == "iOS"
        assert info["device_type"] == "mobile"


# ─────────────────────────────────────────────────────────────────
# /connect endpoint
# ─────────────────────────────────────────────────────────────────


class TestConnectEndpoint:
    def test_connect_creates_session(self, pp):
        client = _make_client(pp)
        resp = client.post("/connect", json={"visitorId": "v-1"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["sessionId"]
        assert body["visitorId"] == "v-1"

    def test_connect_enriches_metadata_from_headers(self, pp):
        client = _make_client(pp)
        resp = client.post(
            "/connect",
            json={"visitorId": "v-2"},
            headers={
                "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537",
                "x-forwarded-for": "203.0.113.5, 10.0.0.1",
            },
        )
        assert resp.status_code == 200

    def test_connect_with_provided_metadata(self, pp):
        client = _make_client(pp)
        resp = client.post(
            "/connect",
            json={
                "visitorId": "v-3",
                "metadata": {"url": "https://x.com", "userAgent": "Custom Firefox/100"},
            },
            headers={"x-real-ip": "198.51.100.7"},
        )
        assert resp.status_code == 200

    def test_connect_with_prefix(self, pp):
        client = _make_client(pp, prefix="/pp")
        resp = client.post("/pp/connect", json={"visitorId": "v-4"})
        assert resp.status_code == 200


# ─────────────────────────────────────────────────────────────────
# version headers / blocking
# ─────────────────────────────────────────────────────────────────


class TestVersionHeaders:
    def test_version_headers_present(self, pp):
        client = _make_client(pp)
        resp = client.post(
            "/connect", json={"visitorId": "v"}, headers={"x-pocketping-version": "9.9.9"}
        )
        assert resp.status_code == 200
        assert "X-PocketPing-Version-Status" in resp.headers

    def test_unsupported_version_blocked_426(self):
        pp = PocketPing(storage=MemoryStorage(), min_widget_version="2.0.0")
        client = _make_client(pp)
        resp = client.post(
            "/connect", json={"visitorId": "v"}, headers={"x-pocketping-version": "1.0.0"}
        )
        assert resp.status_code == 426
        assert resp.json()["detail"]["minVersion"] == "2.0.0"


# ─────────────────────────────────────────────────────────────────
# /message, /messages, /typing, /read, /presence
# ─────────────────────────────────────────────────────────────────


class TestOtherEndpoints:
    def test_message_success(self, pp):
        client = _make_client(pp)
        sid = client.post("/connect", json={"visitorId": "v"}).json()["sessionId"]
        resp = client.post(
            "/message", json={"sessionId": sid, "content": "Hello", "sender": "visitor"}
        )
        assert resp.status_code == 200
        assert resp.json()["messageId"]

    def test_message_invalid_session_404(self, pp):
        client = _make_client(pp)
        resp = client.post(
            "/message", json={"sessionId": "nope", "content": "Hi", "sender": "visitor"}
        )
        assert resp.status_code == 404

    def test_get_messages(self, pp):
        client = _make_client(pp)
        sid = client.post("/connect", json={"visitorId": "v"}).json()["sessionId"]
        client.post("/message", json={"sessionId": sid, "content": "m1", "sender": "visitor"})
        resp = client.get("/messages", params={"sessionId": sid})
        assert resp.status_code == 200
        assert "messages" in resp.json()

    def test_typing(self, pp):
        client = _make_client(pp)
        sid = client.post("/connect", json={"visitorId": "v"}).json()["sessionId"]
        resp = client.post("/typing", json={"sessionId": sid, "sender": "visitor", "isTyping": True})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_read(self, pp):
        client = _make_client(pp)
        sid = client.post("/connect", json={"visitorId": "v"}).json()["sessionId"]
        mid = client.post(
            "/message", json={"sessionId": sid, "content": "m1", "sender": "visitor"}
        ).json()["messageId"]
        resp = client.post(
            "/read", json={"sessionId": sid, "messageIds": [mid], "status": "read"}
        )
        assert resp.status_code == 200

    def test_presence(self, pp):
        client = _make_client(pp)
        resp = client.get("/presence")
        assert resp.status_code == 200
        assert "online" in resp.json()


# ─────────────────────────────────────────────────────────────────
# IP filtering on HTTP routes
# ─────────────────────────────────────────────────────────────────


class TestIpFilterHttp:
    def test_blocked_ip_returns_403(self):
        pp = PocketPing(
            storage=MemoryStorage(),
            ip_filter=IpFilterConfig(enabled=True, mode="blocklist", blocklist=["203.0.113.0/24"]),
        )
        client = _make_client(pp)
        resp = client.post(
            "/connect", json={"visitorId": "v"}, headers={"x-forwarded-for": "203.0.113.9"}
        )
        assert resp.status_code == 403

    def test_allowed_ip_passes(self):
        pp = PocketPing(
            storage=MemoryStorage(),
            ip_filter=IpFilterConfig(enabled=True, mode="blocklist", blocklist=["203.0.113.0/24"]),
        )
        client = _make_client(pp)
        resp = client.post(
            "/connect", json={"visitorId": "v"}, headers={"x-forwarded-for": "8.8.8.8"}
        )
        assert resp.status_code == 200

    def test_blocked_ip_with_custom_logger(self):
        events = []
        pp = PocketPing(
            storage=MemoryStorage(),
            ip_filter=IpFilterConfig(
                enabled=True,
                mode="blocklist",
                blocklist=["1.2.3.4"],
                logger=lambda e: events.append(e),
            ),
        )
        client = _make_client(pp)
        resp = client.post(
            "/connect", json={"visitorId": "v"}, headers={"x-real-ip": "1.2.3.4"}
        )
        assert resp.status_code == 403
        assert len(events) == 1


# ─────────────────────────────────────────────────────────────────
# WebSocket /stream
# ─────────────────────────────────────────────────────────────────


class TestWebSocketStream:
    def test_websocket_connect_and_typing(self, pp):
        client = _make_client(pp)
        sid = client.post("/connect", json={"visitorId": "v"}).json()["sessionId"]
        with client.websocket_connect(f"/stream?sessionId={sid}") as ws:
            ws.send_json({"type": "typing", "sender": "visitor", "isTyping": True})
        # After context exits the connection is unregistered without error.

    def test_websocket_blocked_by_ip_filter(self):
        pp = PocketPing(
            storage=MemoryStorage(),
            ip_filter=IpFilterConfig(
                enabled=True, mode="allowlist", allowlist=["9.9.9.9"], log_blocked=True
            ),
        )
        client = _make_client(pp)
        with pytest.raises(Exception):
            with client.websocket_connect("/stream?sessionId=s1"):
                pass


# ─────────────────────────────────────────────────────────────────
# lifespan + CORS helpers
# ─────────────────────────────────────────────────────────────────


class TestLifespanAndCors:
    @pytest.mark.asyncio
    async def test_lifespan_handler_starts_and_stops(self):
        pp = PocketPing(storage=MemoryStorage())
        async with lifespan_handler(pp):
            pass  # start() then stop() should run without error

    def test_add_cors_middleware_default(self):
        app = FastAPI()
        add_cors_middleware(app)
        # Middleware registered without raising.
        assert any("CORSMiddleware" in str(m) for m in app.user_middleware)

    def test_add_cors_middleware_custom_origins(self):
        app = FastAPI()
        add_cors_middleware(app, origins=["https://yoursite.com"])
        assert any("CORSMiddleware" in str(m) for m in app.user_middleware)

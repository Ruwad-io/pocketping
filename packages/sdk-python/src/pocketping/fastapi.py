"""FastAPI integration for PocketPing."""

from contextlib import asynccontextmanager
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect

from pocketping.core import PocketPing
from pocketping.models import (
    ConnectRequest,
    ReadRequest,
    SendMessageRequest,
    SessionMetadata,
    TypingRequest,
)
from pocketping.utils.ip_filter import check_ip_filter, create_log_event

# Headers exposed to the widget for version management
VERSION_EXPOSE_HEADERS = [
    "X-PocketPing-Version-Status",
    "X-PocketPing-Min-Version",
    "X-PocketPing-Latest-Version",
    "X-PocketPing-Version-Message",
]


def _get_client_ip(request: Request) -> str:
    """Extract client IP from request headers (supports proxies)."""
    # Check common proxy headers
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # Take the first IP (original client)
        return forwarded.split(",")[0].strip()

    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip

    # Fall back to direct connection
    if request.client:
        return request.client.host

    return "unknown"


def _parse_user_agent(user_agent: str | None) -> dict:
    """Parse user agent string to extract device, browser, and OS info."""
    if not user_agent:
        return {"device_type": None, "browser": None, "os": None}

    ua = user_agent.lower()

    # Device type
    if any(x in ua for x in ["mobile", "android", "iphone", "ipod"]):
        device_type = "mobile"
    elif any(x in ua for x in ["ipad", "tablet"]):
        device_type = "tablet"
    else:
        device_type = "desktop"

    # Browser detection
    browser = None
    if "firefox" in ua:
        browser = "Firefox"
    elif "edg" in ua:
        browser = "Edge"
    elif "chrome" in ua:
        browser = "Chrome"
    elif "safari" in ua:
        browser = "Safari"
    elif "opera" in ua or "opr" in ua:
        browser = "Opera"

    # OS detection
    os_name = None
    if "windows" in ua:
        os_name = "Windows"
    elif "mac os" in ua or "macos" in ua:
        os_name = "macOS"
    elif "linux" in ua:
        os_name = "Linux"
    elif "android" in ua:
        os_name = "Android"
    elif "iphone" in ua or "ipad" in ua:
        os_name = "iOS"

    return {"device_type": device_type, "browser": browser, "os": os_name}


def _check_version_and_set_headers(pp: PocketPing, request: Request, response: Response) -> None:
    """Check widget version from request header and set response headers.

    Args:
        pp: PocketPing instance
        request: FastAPI request
        response: FastAPI response

    Raises:
        HTTPException: If widget version is unsupported (426 Upgrade Required)
    """
    widget_version = request.headers.get("x-pocketping-version")
    version_check = pp.check_widget_version(widget_version)

    # Set version headers on response
    for header_name, header_value in pp.get_version_headers(version_check).items():
        response.headers[header_name] = header_value

    # Block unsupported versions
    if not version_check.can_continue:
        raise HTTPException(
            status_code=426,
            detail={
                "error": "Widget version unsupported",
                "message": version_check.message,
                "minVersion": version_check.min_version,
                "latestVersion": version_check.latest_version,
            },
        )


async def _check_ip_filter(pp: PocketPing, request: Request, path: str) -> None:
    """Check IP filter and block if not allowed.

    Args:
        pp: PocketPing instance
        request: FastAPI request
        path: Request path for logging

    Raises:
        HTTPException: If IP is blocked (403 Forbidden by default)
    """
    if not pp.ip_filter or not pp.ip_filter.enabled:
        return

    client_ip = _get_client_ip(request)
    filter_result = await check_ip_filter(client_ip, pp.ip_filter, {"path": path})

    if not filter_result.allowed:
        # Log blocked request
        if pp.ip_filter.log_blocked:
            log_event = create_log_event(
                event_type="blocked",
                ip=client_ip,
                reason=filter_result.reason,
                path=path,
            )

            if pp.ip_filter.logger:
                pp.ip_filter.logger(log_event)
            else:
                print(f"[PocketPing] IP blocked: {client_ip} - reason: {filter_result.reason}")

        raise HTTPException(
            status_code=pp.ip_filter.blocked_status_code,
            detail=pp.ip_filter.blocked_message,
        )


def create_router(pp: PocketPing, prefix: str = "") -> APIRouter:
    """Create a FastAPI router for PocketPing endpoints.

    Usage:
        from fastapi import FastAPI
        from pocketping import PocketPing
        from pocketping.fastapi import create_router

        app = FastAPI()
        pp = PocketPing(...)

        app.include_router(create_router(pp), prefix="/pocketping")
    """
    router = APIRouter(prefix=prefix)

    @router.post("/connect")
    async def connect(body: ConnectRequest, request: Request, response: Response):
        """Initialize or resume a chat session."""
        # Check IP filter first
        await _check_ip_filter(pp, request, "/connect")

        # Check widget version
        _check_version_and_set_headers(pp, request, response)

        # Enrich metadata with server-side info
        client_ip = _get_client_ip(request)
        ua_info = _parse_user_agent(body.metadata.user_agent if body.metadata else request.headers.get("user-agent"))

        if body.metadata:
            body.metadata.ip = client_ip
            body.metadata.device_type = body.metadata.device_type or ua_info["device_type"]
            body.metadata.browser = body.metadata.browser or ua_info["browser"]
            body.metadata.os = body.metadata.os or ua_info["os"]
        else:
            body.metadata = SessionMetadata(
                ip=client_ip,
                user_agent=request.headers.get("user-agent"),
                **ua_info,
            )

        connect_response = await pp.handle_connect(body)
        return connect_response.model_dump(by_alias=True)

    @router.post("/message")
    async def send_message(request: SendMessageRequest):
        """Send a message."""
        try:
            response = await pp.handle_message(request)
            return response.model_dump(by_alias=True)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.get("/messages")
    async def get_messages(
        session_id: str = Query(..., alias="sessionId"),
        after: Optional[str] = None,
        limit: int = 50,
    ):
        """Get messages for a session."""
        return await pp.handle_get_messages(session_id, after, limit)

    @router.post("/typing")
    async def typing(request: TypingRequest):
        """Send typing indicator."""
        return await pp.handle_typing(request)

    @router.post("/read")
    async def read(request: ReadRequest):
        """Mark messages as read/delivered."""
        response = await pp.handle_read(request)
        return response.model_dump(by_alias=True)

    @router.get("/presence")
    async def presence():
        """Get operator presence status."""
        response = await pp.handle_presence()
        return response.model_dump(by_alias=True)

    @router.websocket("/stream")
    async def websocket_stream(
        websocket: WebSocket,
        session_id: str = Query(..., alias="sessionId"),
    ):
        """WebSocket endpoint for real-time updates."""
        # Check IP filter before accepting connection
        if pp.ip_filter and pp.ip_filter.enabled:
            # Get client IP from WebSocket scope
            client_ip = "unknown"
            if websocket.client:
                client_ip = websocket.client.host

            # Check headers for proxy
            forwarded = websocket.headers.get("x-forwarded-for")
            if forwarded:
                client_ip = forwarded.split(",")[0].strip()
            else:
                real_ip = websocket.headers.get("x-real-ip")
                if real_ip:
                    client_ip = real_ip

            filter_result = await check_ip_filter(client_ip, pp.ip_filter, {"path": "/stream"})

            if not filter_result.allowed:
                if pp.ip_filter.log_blocked:
                    log_event = create_log_event(
                        event_type="blocked",
                        ip=client_ip,
                        reason=filter_result.reason,
                        path="/stream",
                        session_id=session_id,
                    )

                    if pp.ip_filter.logger:
                        pp.ip_filter.logger(log_event)
                    else:
                        print(f"[PocketPing] WS IP blocked: {client_ip} - reason: {filter_result.reason}")

                await websocket.close(code=4003, reason=pp.ip_filter.blocked_message)
                return

        await websocket.accept()

        pp.register_websocket(session_id, websocket)

        try:
            while True:
                # Keep connection alive, handle incoming messages
                data = await websocket.receive_json()

                if data.get("type") == "typing":
                    await pp.handle_typing(
                        TypingRequest(
                            session_id=session_id,
                            sender=data.get("sender", "visitor"),
                            is_typing=data.get("isTyping", True),
                        )
                    )

        except WebSocketDisconnect:
            pass
        finally:
            pp.unregister_websocket(session_id, websocket)

    return router


@asynccontextmanager
async def lifespan_handler(pp: PocketPing):
    """Context manager for FastAPI lifespan events.

    Usage:
        from contextlib import asynccontextmanager
        from fastapi import FastAPI
        from pocketping import PocketPing
        from pocketping.fastapi import lifespan_handler

        pp = PocketPing(...)

        @asynccontextmanager
        async def lifespan(app: FastAPI):
            async with lifespan_handler(pp):
                yield

        app = FastAPI(lifespan=lifespan)
    """
    await pp.start()
    try:
        yield
    finally:
        await pp.stop()


def add_cors_middleware(app, origins: list[str] = None):
    """Add CORS middleware for PocketPing widget.

    Usage:
        from fastapi import FastAPI
        from pocketping.fastapi import add_cors_middleware

        app = FastAPI()
        add_cors_middleware(app, origins=["https://yoursite.com"])
    """
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["*"],
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-PocketPing-Version"],
        expose_headers=VERSION_EXPOSE_HEADERS,
    )

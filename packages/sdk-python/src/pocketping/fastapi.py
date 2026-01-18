"""FastAPI integration for PocketPing."""

from contextlib import asynccontextmanager
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.responses import JSONResponse

from pocketping.core import PocketPing
from pocketping.models import (
    ConnectRequest,
    SendMessageRequest,
    TypingRequest,
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
    async def connect(request: ConnectRequest):
        """Initialize or resume a chat session."""
        response = await pp.handle_connect(request)
        return response.model_dump(by_alias=True)

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
        allow_headers=["*"],
    )

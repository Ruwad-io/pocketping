"""Core PocketPing implementation."""

import asyncio
import secrets
import time
from datetime import datetime
from typing import Any, Callable, Optional

from pocketping.models import (
    ConnectRequest,
    ConnectResponse,
    Message,
    PresenceResponse,
    SendMessageRequest,
    SendMessageResponse,
    Sender,
    Session,
    TypingRequest,
    WebSocketEvent,
)
from pocketping.storage import MemoryStorage, Storage
from pocketping.bridges import Bridge
from pocketping.ai.base import AIProvider


class PocketPing:
    """Main PocketPing class for handling chat sessions."""

    def __init__(
        self,
        storage: Optional[Storage] = None,
        bridges: Optional[list[Bridge]] = None,
        ai_provider: Optional[AIProvider] = None,
        ai_system_prompt: Optional[str] = None,
        ai_takeover_delay: int = 300,  # seconds
        welcome_message: Optional[str] = None,
        on_new_session: Optional[Callable[[Session], Any]] = None,
        on_message: Optional[Callable[[Message, Session], Any]] = None,
    ):
        self.storage = storage or MemoryStorage()
        self.bridges = bridges or []
        self.ai_provider = ai_provider
        self.ai_system_prompt = ai_system_prompt or (
            "You are a helpful customer support assistant. "
            "Be friendly, concise, and helpful. "
            "If you don't know something, say so and offer to connect them with a human."
        )
        self.ai_takeover_delay = ai_takeover_delay
        self.welcome_message = welcome_message
        self.on_new_session = on_new_session
        self.on_message = on_message

        self._operator_online = False
        self._last_operator_activity: dict[str, float] = {}  # session_id -> timestamp
        self._websocket_connections: dict[str, set] = {}  # session_id -> set of websockets
        self._presence_check_task: Optional[asyncio.Task] = None

    # ─────────────────────────────────────────────────────────────────
    # Lifecycle
    # ─────────────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Start PocketPing (initialize bridges, start background tasks)."""
        for bridge in self.bridges:
            await bridge.init(self)

        # Start presence check task
        self._presence_check_task = asyncio.create_task(self._presence_check_loop())

    async def stop(self) -> None:
        """Stop PocketPing gracefully."""
        if self._presence_check_task:
            self._presence_check_task.cancel()
            try:
                await self._presence_check_task
            except asyncio.CancelledError:
                pass

        for bridge in self.bridges:
            await bridge.destroy()

    # ─────────────────────────────────────────────────────────────────
    # Protocol Handlers
    # ─────────────────────────────────────────────────────────────────

    async def handle_connect(self, request: ConnectRequest) -> ConnectResponse:
        """Handle a connection request from the widget."""
        session: Optional[Session] = None

        # Try to resume existing session
        if request.session_id:
            session = await self.storage.get_session(request.session_id)

        # Create new session if needed
        if not session:
            session = Session(
                id=self._generate_id(),
                visitor_id=request.visitor_id,
                created_at=datetime.utcnow(),
                last_activity=datetime.utcnow(),
                operator_online=self._operator_online,
                ai_active=False,
                metadata=request.metadata,
            )
            await self.storage.create_session(session)

            # Notify bridges
            await self._notify_bridges_new_session(session)

            # Callback
            if self.on_new_session:
                result = self.on_new_session(session)
                if asyncio.iscoroutine(result):
                    await result

        # Get existing messages
        messages = await self.storage.get_messages(session.id)

        return ConnectResponse(
            session_id=session.id,
            visitor_id=session.visitor_id,
            operator_online=self._operator_online,
            welcome_message=self.welcome_message,
            messages=messages,
        )

    async def handle_message(self, request: SendMessageRequest) -> SendMessageResponse:
        """Handle a message from visitor or operator."""
        session = await self.storage.get_session(request.session_id)
        if not session:
            raise ValueError("Session not found")

        message = Message(
            id=self._generate_id(),
            session_id=request.session_id,
            content=request.content,
            sender=request.sender,
            timestamp=datetime.utcnow(),
            reply_to=request.reply_to,
        )

        await self.storage.save_message(message)

        # Update session activity
        session.last_activity = datetime.utcnow()
        await self.storage.update_session(session)

        # Track operator activity for presence detection
        if request.sender == Sender.OPERATOR:
            self._last_operator_activity[request.session_id] = time.time()
            # If operator responds, disable AI for this session
            if session.ai_active:
                session.ai_active = False
                await self.storage.update_session(session)

        # Notify bridges (only for visitor messages)
        if request.sender == Sender.VISITOR:
            await self._notify_bridges_message(message, session)

        # Broadcast to WebSocket clients
        await self._broadcast_to_session(
            request.session_id,
            WebSocketEvent(type="message", data=message.model_dump(by_alias=True)),
        )

        # Callback
        if self.on_message:
            result = self.on_message(message, session)
            if asyncio.iscoroutine(result):
                await result

        return SendMessageResponse(
            message_id=message.id,
            timestamp=message.timestamp,
        )

    async def handle_get_messages(
        self, session_id: str, after: Optional[str] = None, limit: int = 50
    ) -> dict:
        """Get messages for a session."""
        limit = min(limit, 100)
        messages = await self.storage.get_messages(session_id, after, limit + 1)

        return {
            "messages": [m.model_dump(by_alias=True) for m in messages[:limit]],
            "hasMore": len(messages) > limit,
        }

    async def handle_typing(self, request: TypingRequest) -> dict:
        """Handle typing indicator."""
        await self._broadcast_to_session(
            request.session_id,
            WebSocketEvent(
                type="typing",
                data={
                    "sessionId": request.session_id,
                    "sender": request.sender.value,
                    "isTyping": request.is_typing,
                },
            ),
        )
        return {"ok": True}

    async def handle_presence(self) -> PresenceResponse:
        """Get operator presence status."""
        return PresenceResponse(
            online=self._operator_online,
            ai_enabled=self.ai_provider is not None,
            ai_active_after=self.ai_takeover_delay,
        )

    # ─────────────────────────────────────────────────────────────────
    # Operator Actions
    # ─────────────────────────────────────────────────────────────────

    async def send_operator_message(self, session_id: str, content: str) -> Message:
        """Send a message as the operator."""
        response = await self.handle_message(
            SendMessageRequest(
                session_id=session_id,
                content=content,
                sender=Sender.OPERATOR,
            )
        )

        return Message(
            id=response.message_id,
            session_id=session_id,
            content=content,
            sender=Sender.OPERATOR,
            timestamp=response.timestamp,
        )

    def set_operator_online(self, online: bool) -> None:
        """Set operator online/offline status."""
        self._operator_online = online

        # Broadcast to all sessions
        for session_id in self._websocket_connections.keys():
            asyncio.create_task(
                self._broadcast_to_session(
                    session_id,
                    WebSocketEvent(type="presence", data={"online": online}),
                )
            )

    def is_operator_online(self) -> bool:
        """Check if operator is online."""
        return self._operator_online

    # ─────────────────────────────────────────────────────────────────
    # AI Fallback
    # ─────────────────────────────────────────────────────────────────

    async def _check_ai_takeover(self, session: Session) -> bool:
        """Check if AI should take over a session."""
        if not self.ai_provider:
            return False

        if session.ai_active:
            return False  # Already active

        # Check last operator activity
        last_activity = self._last_operator_activity.get(session.id)
        if last_activity:
            elapsed = time.time() - last_activity
            if elapsed < self.ai_takeover_delay:
                return False

        # Check if there are unanswered visitor messages
        messages = await self.storage.get_messages(session.id, limit=10)
        if not messages:
            return False

        # Find last visitor message
        last_visitor_msg_time = None
        last_response_time = None

        for msg in reversed(messages):
            if msg.sender == Sender.VISITOR and not last_visitor_msg_time:
                last_visitor_msg_time = msg.timestamp
            elif msg.sender in (Sender.OPERATOR, Sender.AI) and not last_response_time:
                last_response_time = msg.timestamp

        if not last_visitor_msg_time:
            return False

        # If no response or response is older than visitor message
        if not last_response_time or last_response_time < last_visitor_msg_time:
            elapsed = (datetime.utcnow() - last_visitor_msg_time).total_seconds()
            if elapsed >= self.ai_takeover_delay:
                return True

        return False

    async def _trigger_ai_response(self, session: Session) -> None:
        """Generate and send an AI response."""
        if not self.ai_provider:
            return

        # Mark session as AI active
        session.ai_active = True
        await self.storage.update_session(session)

        # Notify bridges
        for bridge in self.bridges:
            try:
                await bridge.on_ai_takeover(session, "timeout")
            except Exception as e:
                print(f"[PocketPing] Bridge error on AI takeover: {e}")

        # Broadcast AI takeover event
        await self._broadcast_to_session(
            session.id,
            WebSocketEvent(
                type="ai_takeover",
                data={"sessionId": session.id, "reason": "timeout"},
            ),
        )

        # Get conversation history
        messages = await self.storage.get_messages(session.id)

        try:
            # Generate response
            response_content = await self.ai_provider.generate_response(
                messages, self.ai_system_prompt
            )

            # Send as AI message
            ai_message = Message(
                id=self._generate_id(),
                session_id=session.id,
                content=response_content,
                sender=Sender.AI,
                timestamp=datetime.utcnow(),
            )

            await self.storage.save_message(ai_message)

            # Broadcast
            await self._broadcast_to_session(
                session.id,
                WebSocketEvent(type="message", data=ai_message.model_dump(by_alias=True)),
            )

        except Exception as e:
            print(f"[PocketPing] AI response error: {e}")

    # ─────────────────────────────────────────────────────────────────
    # Presence Detection Loop
    # ─────────────────────────────────────────────────────────────────

    async def _presence_check_loop(self) -> None:
        """Background task to check for AI takeover opportunities."""
        while True:
            try:
                await asyncio.sleep(30)  # Check every 30 seconds

                if not self.ai_provider:
                    continue

                # Get all active sessions (this is a simplified approach)
                if isinstance(self.storage, MemoryStorage):
                    sessions = await self.storage.get_all_sessions()
                    for session in sessions:
                        if await self._check_ai_takeover(session):
                            await self._trigger_ai_response(session)

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[PocketPing] Presence check error: {e}")

    # ─────────────────────────────────────────────────────────────────
    # WebSocket Management
    # ─────────────────────────────────────────────────────────────────

    def register_websocket(self, session_id: str, websocket: Any) -> None:
        """Register a WebSocket connection for a session."""
        if session_id not in self._websocket_connections:
            self._websocket_connections[session_id] = set()
        self._websocket_connections[session_id].add(websocket)

    def unregister_websocket(self, session_id: str, websocket: Any) -> None:
        """Unregister a WebSocket connection."""
        if session_id in self._websocket_connections:
            self._websocket_connections[session_id].discard(websocket)

    async def _broadcast_to_session(self, session_id: str, event: WebSocketEvent) -> None:
        """Broadcast an event to all WebSocket connections for a session."""
        connections = self._websocket_connections.get(session_id, set())
        message = event.model_dump_json(by_alias=True)

        dead_connections = []
        for ws in connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead_connections.append(ws)

        # Clean up dead connections
        for ws in dead_connections:
            self.unregister_websocket(session_id, ws)

    # ─────────────────────────────────────────────────────────────────
    # Bridge Notifications
    # ─────────────────────────────────────────────────────────────────

    async def _notify_bridges_new_session(self, session: Session) -> None:
        """Notify all bridges about a new session."""
        for bridge in self.bridges:
            try:
                await bridge.on_new_session(session)
            except Exception as e:
                print(f"[PocketPing] Bridge {bridge.name} error: {e}")

    async def _notify_bridges_message(self, message: Message, session: Session) -> None:
        """Notify all bridges about a new message."""
        for bridge in self.bridges:
            try:
                await bridge.on_message(message, session)
            except Exception as e:
                print(f"[PocketPing] Bridge {bridge.name} error: {e}")

    # ─────────────────────────────────────────────────────────────────
    # Utilities
    # ─────────────────────────────────────────────────────────────────

    def _generate_id(self) -> str:
        """Generate a unique ID."""
        timestamp = hex(int(time.time() * 1000))[2:]
        random_part = secrets.token_hex(4)
        return f"{timestamp}-{random_part}"

    def add_bridge(self, bridge: Bridge) -> None:
        """Add a bridge dynamically."""
        self.bridges.append(bridge)
        asyncio.create_task(bridge.init(self))

"""Core PocketPing implementation."""

import asyncio
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import httpx

from pocketping.ai.base import AIProvider
from pocketping.bridges import Bridge
from pocketping.models import (
    ConnectRequest,
    ConnectResponse,
    CustomEvent,
    DeleteMessageRequest,
    DeleteMessageResponse,
    EditedMessageData,
    EditMessageRequest,
    EditMessageResponse,
    IdentifyRequest,
    IdentifyResponse,
    Message,
    MessageStatus,
    PresenceResponse,
    ReadRequest,
    ReadResponse,
    Sender,
    SendMessageRequest,
    SendMessageResponse,
    Session,
    TypingRequest,
    VersionCheckResult,
    VersionStatus,
    VersionWarning,
    WebSocketEvent,
)
from pocketping.storage import MemoryStorage, Storage
from pocketping.utils.ip_filter import IpFilterConfig


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
        on_event: Optional[Callable[[CustomEvent, Session], Any]] = None,
        on_identify: Optional[Callable[[Session], Any]] = None,
        # Webhook configuration
        webhook_url: Optional[str] = None,
        webhook_secret: Optional[str] = None,
        webhook_timeout: float = 5.0,
        # Version management
        min_widget_version: Optional[str] = None,
        latest_widget_version: Optional[str] = None,
        version_warning_message: Optional[str] = None,
        version_upgrade_url: Optional[str] = None,
        # IP filtering
        ip_filter: Optional[IpFilterConfig] = None,
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
        self.on_event_callback = on_event
        self.on_identify_callback = on_identify

        # Webhook config
        self.webhook_url = webhook_url
        self.webhook_secret = webhook_secret
        self.webhook_timeout = webhook_timeout
        self._http_client: Optional[httpx.AsyncClient] = None

        # Version management config
        self.min_widget_version = min_widget_version
        self.latest_widget_version = latest_widget_version
        self.version_warning_message = version_warning_message
        self.version_upgrade_url = version_upgrade_url or "https://docs.pocketping.io/widget/installation"

        # IP filtering config
        self.ip_filter = ip_filter

        self._operator_online = False
        self._last_operator_activity: dict[str, float] = {}  # session_id -> timestamp
        self._websocket_connections: dict[str, set] = {}  # session_id -> set of websockets
        self._presence_check_task: Optional[asyncio.Task] = None
        self._event_handlers: dict[str, set[Callable]] = {}  # event_name -> set of handlers

    # ─────────────────────────────────────────────────────────────────
    # Lifecycle
    # ─────────────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Start PocketPing (initialize bridges, start background tasks)."""
        for bridge in self.bridges:
            await bridge.init(self)

        # Initialize HTTP client for webhook
        if self.webhook_url:
            self._http_client = httpx.AsyncClient(timeout=self.webhook_timeout)

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

        # Close HTTP client
        if self._http_client:
            await self._http_client.aclose()

        for bridge in self.bridges:
            await bridge.destroy()

    # ─────────────────────────────────────────────────────────────────
    # Protocol Handlers
    # ─────────────────────────────────────────────────────────────────

    async def handle_connect(self, request: ConnectRequest) -> ConnectResponse:
        """Handle a connection request from the widget."""
        session: Optional[Session] = None

        # Try to resume existing session by session_id
        if request.session_id:
            session = await self.storage.get_session(request.session_id)

        # Try to find existing session by visitor_id
        if not session:
            session = await self.storage.get_session_by_visitor_id(request.visitor_id)

        # Create new session if needed
        if not session:
            session = Session(
                id=self._generate_id(),
                visitor_id=request.visitor_id,
                created_at=datetime.now(timezone.utc),
                last_activity=datetime.now(timezone.utc),
                operator_online=self._operator_online,
                ai_active=False,
                metadata=request.metadata,
                identity=request.identity,
            )
            await self.storage.create_session(session)

            # Notify bridges
            await self._notify_bridges_new_session(session)

            # Callback
            if self.on_new_session:
                result = self.on_new_session(session)
                if asyncio.iscoroutine(result):
                    await result
        else:
            needs_update = False

            # Update metadata if provided (e.g., new page URL)
            if request.metadata:
                # Merge new metadata with existing, keeping geo info
                if session.metadata:
                    # Preserve server-side fields (IP, country, city)
                    request.metadata.ip = session.metadata.ip or request.metadata.ip
                    request.metadata.country = session.metadata.country or request.metadata.country
                    request.metadata.city = session.metadata.city or request.metadata.city
                session.metadata = request.metadata
                needs_update = True

            # Update identity if provided
            if request.identity:
                session.identity = request.identity
                needs_update = True

            if needs_update:
                session.last_activity = datetime.now(timezone.utc)
                await self.storage.update_session(session)

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
            timestamp=datetime.now(timezone.utc),
            reply_to=request.reply_to,
        )

        await self.storage.save_message(message)

        # Update session activity
        session.last_activity = datetime.now(timezone.utc)
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

    async def handle_get_messages(self, session_id: str, after: Optional[str] = None, limit: int = 50) -> dict:
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

    async def handle_read(self, request: ReadRequest) -> ReadResponse:
        """Handle message read/delivered status update."""

        updated = 0
        now = datetime.now(timezone.utc)

        for message_id in request.message_ids:
            message = await self.storage.get_message(message_id)
            if message and message.session_id == request.session_id:
                # Update status
                message.status = request.status
                if request.status == MessageStatus.DELIVERED:
                    message.delivered_at = now
                elif request.status == MessageStatus.READ:
                    message.delivered_at = message.delivered_at or now
                    message.read_at = now

                await self.storage.save_message(message)
                updated += 1

        # Broadcast read event to WebSocket clients and bridges
        if updated > 0:
            broadcast_data = {
                "sessionId": request.session_id,
                "messageIds": request.message_ids,
                "status": request.status.value,
            }
            # Include timestamps if available
            if request.status == MessageStatus.DELIVERED:
                broadcast_data["deliveredAt"] = now.isoformat()
            elif request.status == MessageStatus.READ:
                broadcast_data["readAt"] = now.isoformat()
                broadcast_data["deliveredAt"] = now.isoformat()

            await self._broadcast_to_session(
                request.session_id,
                WebSocketEvent(
                    type="read",
                    data=broadcast_data,
                ),
            )

            # Notify bridges about read status
            session = await self.storage.get_session(request.session_id)
            if session:
                await self._notify_bridges_read(request.session_id, request.message_ids, request.status, session)

        return ReadResponse(updated=updated)

    async def _notify_bridges_read(
        self,
        session_id: str,
        message_ids: list[str],
        status: MessageStatus,
        session: Session,
    ) -> None:
        """Notify all bridges about message read status."""

        for bridge in self.bridges:
            if hasattr(bridge, "on_message_read"):
                try:
                    await bridge.on_message_read(session_id, message_ids, status, session)
                except Exception as e:
                    print(f"[PocketPing] Error notifying {bridge.name} of read status: {e}")

    # ─────────────────────────────────────────────────────────────────
    # User Identity
    # ─────────────────────────────────────────────────────────────────

    async def handle_identify(self, request: IdentifyRequest) -> IdentifyResponse:
        """Handle user identification from widget.

        Called when visitor calls PocketPing.identify().

        Args:
            request: The identify request with session_id and identity

        Returns:
            IdentifyResponse with ok=True on success

        Raises:
            ValueError: If identity.id is missing or session not found
        """
        if not request.identity or not request.identity.id:
            raise ValueError("identity.id is required")

        session = await self.storage.get_session(request.session_id)
        if not session:
            raise ValueError("Session not found")

        # Update session with identity
        session.identity = request.identity
        session.last_activity = datetime.now(timezone.utc)
        await self.storage.update_session(session)

        # Notify bridges about identity update
        await self._notify_bridges_identity(session)

        # Callback
        if self.on_identify_callback:
            result = self.on_identify_callback(session)
            if asyncio.iscoroutine(result):
                await result

        # Forward identity event to webhook
        if self.webhook_url:
            asyncio.create_task(self._forward_identity_to_webhook(session))

        return IdentifyResponse(ok=True)

    async def _notify_bridges_identity(self, session: Session) -> None:
        """Notify all bridges about identity update."""
        for bridge in self.bridges:
            if hasattr(bridge, "on_identity_update"):
                try:
                    await bridge.on_identity_update(session)
                except Exception as e:
                    print(f"[PocketPing] Bridge {bridge.name} identity notification error: {e}")

    async def get_session(self, session_id: str) -> Optional[Session]:
        """Get a session by ID."""
        return await self.storage.get_session(session_id)

    # ─────────────────────────────────────────────────────────────────
    # Message Edit/Delete
    # ─────────────────────────────────────────────────────────────────

    async def handle_edit_message(self, request: EditMessageRequest) -> EditMessageResponse:
        """Handle message edit from widget.

        Only the message sender can edit their own messages.

        Args:
            request: The edit request with session_id, message_id, and new content

        Returns:
            EditMessageResponse with the edited message data

        Raises:
            ValueError: If session/message not found or validation fails
        """
        session = await self.storage.get_session(request.session_id)
        if not session:
            raise ValueError("Session not found")

        message = await self.storage.get_message(request.message_id)
        if not message:
            raise ValueError("Message not found")

        if message.session_id != request.session_id:
            raise ValueError("Message does not belong to this session")

        if message.deleted_at:
            raise ValueError("Cannot edit deleted message")

        # Only visitor messages can be edited from widget
        if message.sender != Sender.VISITOR:
            raise ValueError("Cannot edit this message")

        # Validate content
        if not request.content or not request.content.strip():
            raise ValueError("Content is required")

        if len(request.content) > 4000:
            raise ValueError("Content exceeds maximum length")

        # Update message
        message.content = request.content.strip()
        message.edited_at = datetime.now(timezone.utc)

        await self.storage.update_message(message)

        # Sync edit to bridges
        await self._sync_edit_to_bridges(message.id, message.content)

        # Broadcast to WebSocket clients
        await self._broadcast_to_session(
            request.session_id,
            WebSocketEvent(
                type="message_edited",
                data={
                    "messageId": message.id,
                    "content": message.content,
                    "editedAt": message.edited_at.isoformat(),
                },
            ),
        )

        return EditMessageResponse(
            message=EditedMessageData(
                id=message.id,
                content=message.content,
                edited_at=message.edited_at,
            )
        )

    async def handle_delete_message(self, request: DeleteMessageRequest) -> DeleteMessageResponse:
        """Handle message delete from widget.

        Only the message sender can delete their own messages (soft delete).

        Args:
            request: The delete request with session_id and message_id

        Returns:
            DeleteMessageResponse with deleted=True

        Raises:
            ValueError: If session/message not found or validation fails
        """
        session = await self.storage.get_session(request.session_id)
        if not session:
            raise ValueError("Session not found")

        message = await self.storage.get_message(request.message_id)
        if not message:
            raise ValueError("Message not found")

        if message.session_id != request.session_id:
            raise ValueError("Message does not belong to this session")

        if message.deleted_at:
            raise ValueError("Message already deleted")

        # Only visitor messages can be deleted from widget
        if message.sender != Sender.VISITOR:
            raise ValueError("Cannot delete this message")

        # Sync delete to bridges BEFORE soft delete (need bridge IDs)
        await self._sync_delete_to_bridges(message.id)

        # Soft delete message
        message.deleted_at = datetime.now(timezone.utc)
        await self.storage.update_message(message)

        # Broadcast to WebSocket clients
        await self._broadcast_to_session(
            request.session_id,
            WebSocketEvent(
                type="message_deleted",
                data={
                    "messageId": message.id,
                    "deletedAt": message.deleted_at.isoformat(),
                },
            ),
        )

        return DeleteMessageResponse(deleted=True)

    async def _sync_edit_to_bridges(self, message_id: str, new_content: str) -> None:
        """Sync message edit to all bridges that support it."""
        bridge_ids = await self.storage.get_bridge_message_ids(message_id)
        if not bridge_ids:
            return

        for bridge in self.bridges:
            if not hasattr(bridge, "on_message_edit"):
                continue

            try:
                bridge_message_id: Optional[str | int] = None

                if bridge.name == "telegram" and bridge_ids.telegram_message_id:
                    bridge_message_id = bridge_ids.telegram_message_id
                elif bridge.name == "discord" and bridge_ids.discord_message_id:
                    bridge_message_id = bridge_ids.discord_message_id
                elif bridge.name == "slack" and bridge_ids.slack_message_ts:
                    bridge_message_id = bridge_ids.slack_message_ts

                if bridge_message_id is not None:
                    await bridge.on_message_edit(message_id, new_content, bridge_message_id)
            except Exception as e:
                print(f"[PocketPing] Bridge {bridge.name} edit sync error: {e}")

    async def _sync_delete_to_bridges(self, message_id: str) -> None:
        """Sync message delete to all bridges that support it."""
        bridge_ids = await self.storage.get_bridge_message_ids(message_id)
        if not bridge_ids:
            return

        for bridge in self.bridges:
            if not hasattr(bridge, "on_message_delete"):
                continue

            try:
                bridge_message_id: Optional[str | int] = None

                if bridge.name == "telegram" and bridge_ids.telegram_message_id:
                    bridge_message_id = bridge_ids.telegram_message_id
                elif bridge.name == "discord" and bridge_ids.discord_message_id:
                    bridge_message_id = bridge_ids.discord_message_id
                elif bridge.name == "slack" and bridge_ids.slack_message_ts:
                    bridge_message_id = bridge_ids.slack_message_ts

                if bridge_message_id is not None:
                    await bridge.on_message_delete(message_id, bridge_message_id)
            except Exception as e:
                print(f"[PocketPing] Bridge {bridge.name} delete sync error: {e}")

    # ─────────────────────────────────────────────────────────────────
    # Operator Actions
    # ─────────────────────────────────────────────────────────────────

    async def send_operator_message(
        self,
        session_id: str,
        content: str,
        source_bridge: str | None = None,
        operator_name: str | None = None,
    ) -> Message:
        """Send a message as the operator.

        Args:
            session_id: The session to send to
            content: Message content
            source_bridge: Name of the bridge that originated this message (for sync)
            operator_name: Name of the operator who sent the message
        """
        response = await self.handle_message(
            SendMessageRequest(
                session_id=session_id,
                content=content,
                sender=Sender.OPERATOR,
            )
        )

        message = Message(
            id=response.message_id,
            session_id=session_id,
            content=content,
            sender=Sender.OPERATOR,
            timestamp=response.timestamp,
        )

        # Notify all bridges about this operator message (for cross-bridge sync)
        session = await self.storage.get_session(session_id)
        if session:
            await self._notify_bridges_operator_message(message, session, source_bridge or "api", operator_name)

        return message

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
            elapsed = (datetime.now(timezone.utc) - last_visitor_msg_time).total_seconds()
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
            response_content = await self.ai_provider.generate_response(messages, self.ai_system_prompt)

            # Send as AI message
            ai_message = Message(
                id=self._generate_id(),
                session_id=session.id,
                content=response_content,
                sender=Sender.AI,
                timestamp=datetime.now(timezone.utc),
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
        """Notify all bridges about a new visitor message."""
        for bridge in self.bridges:
            try:
                await bridge.on_visitor_message(message, session)
            except Exception as e:
                print(f"[PocketPing] Bridge {bridge.name} error: {e}")

    async def _notify_bridges_operator_message(
        self,
        message: Message,
        session: Session,
        source_bridge: str,
        operator_name: str | None = None,
    ) -> None:
        """Notify all bridges about an operator message (for cross-bridge sync)."""
        for bridge in self.bridges:
            try:
                await bridge.on_operator_message(message, session, source_bridge, operator_name)
            except Exception as e:
                print(f"[PocketPing] Bridge {bridge.name} sync error: {e}")

    # ─────────────────────────────────────────────────────────────────
    # Custom Events
    # ─────────────────────────────────────────────────────────────────

    def on_event(self, event_name: str, handler: Callable[[CustomEvent, Session], Any]) -> Callable[[], None]:
        """Subscribe to a custom event.

        Args:
            event_name: The name of the event (e.g., 'clicked_pricing') or '*' for all events
            handler: Callback function to handle the event

        Returns:
            Unsubscribe function
        """
        if event_name not in self._event_handlers:
            self._event_handlers[event_name] = set()
        self._event_handlers[event_name].add(handler)

        def unsubscribe():
            self._event_handlers[event_name].discard(handler)

        return unsubscribe

    def off_event(self, event_name: str, handler: Callable) -> None:
        """Unsubscribe from a custom event.

        Args:
            event_name: The name of the event
            handler: The handler to remove
        """
        if event_name in self._event_handlers:
            self._event_handlers[event_name].discard(handler)

    async def emit_event(self, session_id: str, event_name: str, data: Optional[dict] = None) -> None:
        """Emit a custom event to a specific session.

        Args:
            session_id: The session to send the event to
            event_name: The name of the event
            data: Optional payload data
        """
        event = CustomEvent(
            name=event_name,
            data=data,
            timestamp=datetime.now(timezone.utc),
            session_id=session_id,
        )

        # Broadcast to WebSocket clients
        await self._broadcast_to_session(
            session_id,
            WebSocketEvent(type="event", data=event.model_dump(by_alias=True)),
        )

    async def broadcast_event(self, event_name: str, data: Optional[dict] = None) -> None:
        """Broadcast a custom event to all connected sessions.

        Args:
            event_name: The name of the event
            data: Optional payload data
        """
        for session_id in self._websocket_connections.keys():
            await self.emit_event(session_id, event_name, data)

    async def handle_custom_event(self, session_id: str, event: CustomEvent) -> None:
        """Handle an incoming custom event from the widget.

        Args:
            session_id: The session that sent the event
            event: The custom event
        """
        session = await self.storage.get_session(session_id)
        if not session:
            print(f"[PocketPing] Session {session_id} not found for custom event")
            return

        event.session_id = session_id

        # Call specific event handlers
        handlers = self._event_handlers.get(event.name, set())
        for handler in handlers:
            try:
                result = handler(event, session)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                print(f"[PocketPing] Error in event handler for '{event.name}': {e}")

        # Call wildcard handlers
        wildcard_handlers = self._event_handlers.get("*", set())
        for handler in wildcard_handlers:
            try:
                result = handler(event, session)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                print(f"[PocketPing] Error in wildcard event handler: {e}")

        # Call the config callback
        if self.on_event_callback:
            try:
                result = self.on_event_callback(event, session)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                print(f"[PocketPing] Error in on_event callback: {e}")

        # Notify bridges
        await self._notify_bridges_event(event, session)

        # Forward to webhook (fire and forget)
        if self.webhook_url:
            asyncio.create_task(self._forward_to_webhook(event, session))

    async def _notify_bridges_event(self, event: CustomEvent, session: Session) -> None:
        """Notify all bridges about a custom event."""
        for bridge in self.bridges:
            try:
                await bridge.on_custom_event(event, session)
            except Exception as e:
                print(f"[PocketPing] Bridge {bridge.name} error on custom event: {e}")

    # ─────────────────────────────────────────────────────────────────
    # Webhook Forwarding
    # ─────────────────────────────────────────────────────────────────

    async def _forward_to_webhook(self, event: CustomEvent, session: Session) -> None:
        """Forward a custom event to the configured webhook URL.

        Used for integrations with Zapier, Make, n8n, or custom backends.
        """
        if not self.webhook_url:
            return

        payload = {
            "event": {
                "name": event.name,
                "data": event.data,
                "timestamp": event.timestamp.isoformat() if event.timestamp else None,
                "sessionId": event.session_id,
            },
            "session": {
                "id": session.id,
                "visitorId": session.visitor_id,
                "metadata": session.metadata.model_dump(by_alias=True) if session.metadata else None,
                "identity": session.identity.model_dump(by_alias=True) if session.identity else None,
            },
            "sentAt": datetime.now(timezone.utc).isoformat(),
        }

        body = json.dumps(payload)
        headers = {"Content-Type": "application/json"}

        # Add HMAC signature if secret is configured
        if self.webhook_secret:
            signature = hmac.new(self.webhook_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
            headers["X-PocketPing-Signature"] = f"sha256={signature}"

        try:
            # Create client on-demand if not initialized via start()
            client = self._http_client or httpx.AsyncClient(timeout=self.webhook_timeout)
            response = await client.post(self.webhook_url, content=body, headers=headers)

            if not response.is_success:
                print(f"[PocketPing] Webhook returned {response.status_code}: {response.text}")

            # Close client if created on-demand
            if not self._http_client:
                await client.aclose()

        except httpx.TimeoutException:
            print(f"[PocketPing] Webhook timed out after {self.webhook_timeout}s")
        except Exception as e:
            print(f"[PocketPing] Webhook error: {e}")

    async def _forward_identity_to_webhook(self, session: Session) -> None:
        """Forward identity update to webhook as a special event."""
        if not self.webhook_url or not session.identity:
            return

        event = CustomEvent(
            name="identify",
            data=session.identity.model_dump(by_alias=True),
            timestamp=datetime.now(timezone.utc),
            session_id=session.id,
        )

        await self._forward_to_webhook(event, session)

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

    # ─────────────────────────────────────────────────────────────────
    # Version Management
    # ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_version(version: str) -> tuple[int, int, int]:
        """Parse a semver string into (major, minor, patch) tuple."""
        parts = version.lstrip("v").split(".")
        major = int(parts[0]) if len(parts) > 0 else 0
        minor = int(parts[1]) if len(parts) > 1 else 0
        patch = int(parts[2].split("-")[0]) if len(parts) > 2 else 0  # Handle pre-release
        return (major, minor, patch)

    @staticmethod
    def _compare_versions(v1: str, v2: str) -> int:
        """Compare two semver strings. Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2."""
        p1 = PocketPing._parse_version(v1)
        p2 = PocketPing._parse_version(v2)
        if p1 < p2:
            return -1
        elif p1 > p2:
            return 1
        return 0

    def check_widget_version(self, widget_version: str | None) -> VersionCheckResult:
        """Check widget version compatibility.

        Args:
            widget_version: Version string from X-PocketPing-Version header

        Returns:
            VersionCheckResult with status and message
        """
        if not widget_version:
            return VersionCheckResult(
                status=VersionStatus.OK,
                min_version=self.min_widget_version,
                latest_version=self.latest_widget_version,
                can_continue=True,
            )

        # Check against minimum version
        if self.min_widget_version:
            comparison = self._compare_versions(widget_version, self.min_widget_version)
            if comparison < 0:
                default_msg = (
                    f"Widget version {widget_version} is no longer supported. "
                    f"Please upgrade to {self.min_widget_version} or later."
                )
                return VersionCheckResult(
                    status=VersionStatus.UNSUPPORTED,
                    message=self.version_warning_message or default_msg,
                    min_version=self.min_widget_version,
                    latest_version=self.latest_widget_version,
                    can_continue=False,
                )

        # Check if outdated (behind latest)
        if self.latest_widget_version:
            comparison = self._compare_versions(widget_version, self.latest_widget_version)
            if comparison < 0:
                # Check how far behind
                current = self._parse_version(widget_version)
                latest = self._parse_version(self.latest_widget_version)

                if current[0] < latest[0]:
                    # Major version behind - deprecated
                    default_msg = (
                        f"Widget version {widget_version} is deprecated. "
                        f"Please upgrade to {self.latest_widget_version}."
                    )
                    return VersionCheckResult(
                        status=VersionStatus.DEPRECATED,
                        message=self.version_warning_message or default_msg,
                        min_version=self.min_widget_version,
                        latest_version=self.latest_widget_version,
                        can_continue=True,
                    )
                else:
                    # Minor/patch behind - outdated
                    return VersionCheckResult(
                        status=VersionStatus.OUTDATED,
                        message=f"A newer widget version ({self.latest_widget_version}) is available.",
                        min_version=self.min_widget_version,
                        latest_version=self.latest_widget_version,
                        can_continue=True,
                    )

        return VersionCheckResult(
            status=VersionStatus.OK,
            min_version=self.min_widget_version,
            latest_version=self.latest_widget_version,
            can_continue=True,
        )

    def get_version_headers(self, version_check: VersionCheckResult) -> dict[str, str]:
        """Get HTTP headers to set for version information.

        Args:
            version_check: Result from check_widget_version

        Returns:
            Dictionary of header name -> value
        """
        headers = {
            "X-PocketPing-Version-Status": version_check.status.value,
        }

        if version_check.min_version:
            headers["X-PocketPing-Min-Version"] = version_check.min_version

        if version_check.latest_version:
            headers["X-PocketPing-Latest-Version"] = version_check.latest_version

        if version_check.message:
            headers["X-PocketPing-Version-Message"] = version_check.message

        return headers

    async def send_version_warning(
        self,
        session_id: str,
        version_check: VersionCheckResult,
        current_version: str,
    ) -> None:
        """Send a version warning via WebSocket.

        Args:
            session_id: Session to send warning to
            version_check: Result from check_widget_version
            current_version: The widget's current version
        """
        severity_map = {
            VersionStatus.OK: "info",
            VersionStatus.OUTDATED: "info",
            VersionStatus.DEPRECATED: "warning",
            VersionStatus.UNSUPPORTED: "error",
        }

        warning = VersionWarning(
            severity=severity_map.get(version_check.status, "info"),
            message=version_check.message or "",
            current_version=current_version,
            min_version=version_check.min_version,
            latest_version=version_check.latest_version,
            can_continue=version_check.can_continue,
            upgrade_url=self.version_upgrade_url,
        )

        await self._broadcast_to_session(
            session_id,
            WebSocketEvent(type="version_warning", data=warning.model_dump(by_alias=True)),
        )

"""Tests for custom events functionality."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from pocketping import CustomEvent, PocketPing
from pocketping.models import ConnectRequest, SessionMetadata


@pytest.fixture
def sample_event():
    """Create a sample custom event."""
    return CustomEvent(
        name="clicked_pricing",
        data={"plan": "pro", "source": "homepage"},
        timestamp=datetime.now(timezone.utc),
    )


class TestCustomEventModel:
    """Tests for the CustomEvent model."""

    def test_custom_event_creation(self):
        """Test creating a custom event."""
        event = CustomEvent(
            name="test_event",
            data={"key": "value"},
        )

        assert event.name == "test_event"
        assert event.data == {"key": "value"}
        assert event.timestamp is not None

    def test_custom_event_without_data(self):
        """Test creating a custom event without data payload."""
        event = CustomEvent(name="page_view")

        assert event.name == "page_view"
        assert event.data is None

    def test_custom_event_with_session_id(self):
        """Test creating a custom event with session_id."""
        event = CustomEvent(
            name="error_occurred",
            data={"code": 500},
            session_id="session-123",
        )

        assert event.session_id == "session-123"


class TestOnEventHandler:
    """Tests for event handler registration."""

    @pytest.fixture
    def pocketping(self):
        """Create a PocketPing instance."""
        return PocketPing()

    def test_on_event_registers_handler(self, pocketping):
        """Test that on_event registers a handler."""
        handler = MagicMock()
        pocketping.on_event("test_event", handler)

        assert "test_event" in pocketping._event_handlers
        assert handler in pocketping._event_handlers["test_event"]

    def test_on_event_returns_unsubscribe(self, pocketping):
        """Test that on_event returns an unsubscribe function."""
        handler = MagicMock()
        unsubscribe = pocketping.on_event("test_event", handler)

        assert callable(unsubscribe)

        unsubscribe()
        assert handler not in pocketping._event_handlers["test_event"]

    def test_on_event_supports_wildcard(self, pocketping):
        """Test that on_event supports wildcard '*' event name."""
        handler = MagicMock()
        pocketping.on_event("*", handler)

        assert "*" in pocketping._event_handlers
        assert handler in pocketping._event_handlers["*"]

    def test_off_event_removes_handler(self, pocketping):
        """Test that off_event removes a handler."""
        handler = MagicMock()
        pocketping.on_event("test_event", handler)
        pocketping.off_event("test_event", handler)

        assert handler not in pocketping._event_handlers.get("test_event", set())

    def test_multiple_handlers_for_same_event(self, pocketping):
        """Test registering multiple handlers for the same event."""
        handler1 = MagicMock()
        handler2 = MagicMock()

        pocketping.on_event("test_event", handler1)
        pocketping.on_event("test_event", handler2)

        assert len(pocketping._event_handlers["test_event"]) == 2


class TestHandleCustomEvent:
    """Tests for handling incoming custom events."""

    @pytest.fixture
    def pocketping(self):
        """Create a PocketPing instance."""
        return PocketPing()

    @pytest.fixture
    async def session(self, pocketping):
        """Create a session for testing."""
        request = ConnectRequest(
            visitor_id="visitor-123",
            metadata=SessionMetadata(url="https://example.com"),
        )
        response = await pocketping.handle_connect(request)
        return await pocketping.storage.get_session(response.session_id)

    @pytest.mark.asyncio
    async def test_handle_custom_event_calls_specific_handler(self, pocketping, session, sample_event):
        """Test that handle_custom_event calls the specific handler."""
        handler = MagicMock()
        pocketping.on_event("clicked_pricing", handler)

        await pocketping.handle_custom_event(session.id, sample_event)

        handler.assert_called_once()
        call_args = handler.call_args
        assert call_args[0][0].name == "clicked_pricing"
        assert call_args[0][1].id == session.id

    @pytest.mark.asyncio
    async def test_handle_custom_event_calls_wildcard_handler(self, pocketping, session, sample_event):
        """Test that handle_custom_event calls wildcard handlers."""
        specific_handler = MagicMock()
        wildcard_handler = MagicMock()

        pocketping.on_event("clicked_pricing", specific_handler)
        pocketping.on_event("*", wildcard_handler)

        await pocketping.handle_custom_event(session.id, sample_event)

        specific_handler.assert_called_once()
        wildcard_handler.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_custom_event_calls_config_callback(self, session):
        """Test that handle_custom_event calls the config on_event callback."""
        on_event_callback = MagicMock()
        pocketping = PocketPing(on_event=on_event_callback)

        # Create session in this instance
        request = ConnectRequest(
            visitor_id="visitor-456",
            metadata=SessionMetadata(url="https://example.com"),
        )
        response = await pocketping.handle_connect(request)

        event = CustomEvent(name="test_event", data={"foo": "bar"})
        await pocketping.handle_custom_event(response.session_id, event)

        on_event_callback.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_custom_event_supports_async_handlers(self, pocketping, session, sample_event):
        """Test that handle_custom_event supports async handlers."""
        async_handler = AsyncMock()
        pocketping.on_event("clicked_pricing", async_handler)

        await pocketping.handle_custom_event(session.id, sample_event)

        async_handler.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_custom_event_sets_session_id(self, pocketping, session, sample_event):
        """Test that handle_custom_event sets the session_id on the event."""
        handler = MagicMock()
        pocketping.on_event("clicked_pricing", handler)

        await pocketping.handle_custom_event(session.id, sample_event)

        event_received = handler.call_args[0][0]
        assert event_received.session_id == session.id

    @pytest.mark.asyncio
    async def test_handle_custom_event_unknown_session(self, pocketping, sample_event, capsys):
        """Test that handle_custom_event handles unknown sessions gracefully."""
        handler = MagicMock()
        pocketping.on_event("clicked_pricing", handler)

        await pocketping.handle_custom_event("unknown-session", sample_event)

        handler.assert_not_called()
        captured = capsys.readouterr()
        assert "not found" in captured.out


class TestEmitEvent:
    """Tests for emitting events to sessions."""

    @pytest.fixture
    def pocketping(self):
        """Create a PocketPing instance."""
        return PocketPing()

    @pytest.fixture
    def mock_websocket(self):
        """Create a mock WebSocket."""
        ws = MagicMock()
        ws.send_text = AsyncMock()
        return ws

    @pytest.fixture
    async def session_with_ws(self, pocketping, mock_websocket):
        """Create a session with a WebSocket connection."""
        request = ConnectRequest(
            visitor_id="visitor-789",
            metadata=SessionMetadata(url="https://example.com"),
        )
        response = await pocketping.handle_connect(request)
        pocketping.register_websocket(response.session_id, mock_websocket)
        return response.session_id, mock_websocket

    @pytest.mark.asyncio
    async def test_emit_event_broadcasts_to_websocket(self, pocketping, session_with_ws):
        """Test that emit_event broadcasts to WebSocket."""
        session_id, mock_ws = session_with_ws

        await pocketping.emit_event(session_id, "show_offer", {"discount": 20})

        mock_ws.send_text.assert_called_once()
        call_args = mock_ws.send_text.call_args[0][0]
        assert "show_offer" in call_args
        assert "20" in call_args

    @pytest.mark.asyncio
    async def test_broadcast_event_to_all_sessions(self, pocketping, mock_websocket):
        """Test that broadcast_event sends to all connected sessions."""
        # Create two sessions
        for i in range(2):
            request = ConnectRequest(
                visitor_id=f"visitor-{i}",
            )
            response = await pocketping.handle_connect(request)
            ws = MagicMock()
            ws.send_text = AsyncMock()
            pocketping.register_websocket(response.session_id, ws)

        await pocketping.broadcast_event("announcement", {"message": "Hello all!"})

        # Each session should have received the event
        for session_id, connections in pocketping._websocket_connections.items():
            for ws in connections:
                ws.send_text.assert_called_once()


class TestBridgeEventNotification:
    """Tests for bridge notification on custom events."""

    @pytest.fixture
    def mock_bridge(self):
        """Create a mock bridge."""
        bridge = MagicMock()
        bridge.name = "test-bridge"
        bridge.on_custom_event = AsyncMock()
        return bridge

    @pytest.fixture
    def pocketping_with_bridge(self, mock_bridge):
        """Create a PocketPing instance with a mock bridge."""
        return PocketPing(bridges=[mock_bridge])

    @pytest.mark.asyncio
    async def test_bridge_notified_on_custom_event(self, pocketping_with_bridge, mock_bridge, sample_event):
        """Test that bridge is notified when custom event is received."""
        # Create session
        request = ConnectRequest(
            visitor_id="visitor-bridge",
            metadata=SessionMetadata(url="https://example.com"),
        )
        response = await pocketping_with_bridge.handle_connect(request)

        await pocketping_with_bridge.handle_custom_event(response.session_id, sample_event)

        mock_bridge.on_custom_event.assert_awaited_once()
        event_arg = mock_bridge.on_custom_event.call_args[0][0]
        session_arg = mock_bridge.on_custom_event.call_args[0][1]

        assert event_arg.name == "clicked_pricing"
        assert session_arg.id == response.session_id

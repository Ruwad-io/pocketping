"""Tests for the PocketPing core functionality."""

import pytest

from pocketping.models import (
    ConnectRequest,
    MessageStatus,
    ReadRequest,
    Sender,
    SendMessageRequest,
)


class TestPocketPingConnect:
    """Tests for the connect functionality."""

    @pytest.mark.asyncio
    async def test_connect_creates_new_session(self, pocketping):
        """Test that connect creates a new session when no session_id provided."""
        request = ConnectRequest(
            visitor_id="new-visitor",
            metadata={"url": "https://example.com"},
        )

        response = await pocketping.handle_connect(request)

        assert response.session_id is not None
        assert response.visitor_id == "new-visitor"
        assert response.messages == []

    @pytest.mark.asyncio
    async def test_connect_reuses_existing_session(self, pocketping, sample_session):
        """Test that connect reuses an existing session when session_id provided."""
        # First, create the session
        await pocketping.storage.create_session(sample_session)

        request = ConnectRequest(
            visitor_id=sample_session.visitor_id,
            session_id=sample_session.id,
        )

        response = await pocketping.handle_connect(request)

        assert response.session_id == sample_session.id
        assert response.visitor_id == sample_session.visitor_id

    @pytest.mark.asyncio
    async def test_connect_returns_existing_messages(self, pocketping, sample_session, sample_visitor_message):
        """Test that connect returns messages from existing session."""
        await pocketping.storage.create_session(sample_session)
        await pocketping.storage.save_message(sample_visitor_message)

        request = ConnectRequest(
            visitor_id=sample_session.visitor_id,
            session_id=sample_session.id,
        )

        response = await pocketping.handle_connect(request)

        assert len(response.messages) == 1
        assert response.messages[0].id == sample_visitor_message.id

    @pytest.mark.asyncio
    async def test_connect_updates_metadata(self, pocketping, sample_session):
        """Test that connect updates session metadata."""
        await pocketping.storage.create_session(sample_session)

        new_url = "https://example.com/new-page"
        request = ConnectRequest(
            visitor_id=sample_session.visitor_id,
            session_id=sample_session.id,
            metadata={"url": new_url},
        )

        await pocketping.handle_connect(request)

        session = await pocketping.storage.get_session(sample_session.id)
        assert session.metadata.url == new_url


class TestPocketPingMessage:
    """Tests for message handling."""

    @pytest.mark.asyncio
    async def test_handle_visitor_message(self, pocketping, sample_session):
        """Test handling a visitor message."""
        await pocketping.storage.create_session(sample_session)

        request = SendMessageRequest(
            session_id=sample_session.id,
            content="Hello!",
            sender=Sender.VISITOR,
        )

        response = await pocketping.handle_message(request)

        assert response.message_id is not None
        assert response.timestamp is not None

        # Verify message was saved
        messages = await pocketping.storage.get_messages(sample_session.id)
        assert len(messages) == 1
        assert messages[0].content == "Hello!"

    @pytest.mark.asyncio
    async def test_handle_message_updates_session_activity(self, pocketping, sample_session):
        """Test that message updates session last_activity."""
        await pocketping.storage.create_session(sample_session)
        original_activity = sample_session.last_activity

        request = SendMessageRequest(
            session_id=sample_session.id,
            content="Hello!",
            sender=Sender.VISITOR,
        )

        await pocketping.handle_message(request)

        session = await pocketping.storage.get_session(sample_session.id)
        assert session.last_activity > original_activity

    @pytest.mark.asyncio
    async def test_handle_message_invalid_session(self, pocketping):
        """Test handling message for non-existent session."""
        request = SendMessageRequest(
            session_id="non-existent",
            content="Hello!",
            sender=Sender.VISITOR,
        )

        with pytest.raises(ValueError, match="Session not found"):
            await pocketping.handle_message(request)

    @pytest.mark.asyncio
    async def test_operator_message_disables_ai(self, pocketping, sample_session):
        """Test that operator message disables AI for session."""
        sample_session.ai_active = True
        await pocketping.storage.create_session(sample_session)

        request = SendMessageRequest(
            session_id=sample_session.id,
            content="Hi, I'm the operator",
            sender=Sender.OPERATOR,
        )

        await pocketping.handle_message(request)

        session = await pocketping.storage.get_session(sample_session.id)
        assert session.ai_active is False


class TestPocketPingReadReceipts:
    """Tests for read receipt handling."""

    @pytest.mark.asyncio
    async def test_handle_read_updates_message_status(self, pocketping, sample_session, sample_visitor_message):
        """Test that read receipt updates message status."""
        await pocketping.storage.create_session(sample_session)
        await pocketping.storage.save_message(sample_visitor_message)

        request = ReadRequest(
            session_id=sample_session.id,
            message_ids=[sample_visitor_message.id],
            status=MessageStatus.DELIVERED,
        )

        await pocketping.handle_read(request)

        messages = await pocketping.storage.get_messages(sample_session.id)
        assert messages[0].status == MessageStatus.DELIVERED

    @pytest.mark.asyncio
    async def test_handle_read_sets_delivered_at(self, pocketping, sample_session, sample_visitor_message):
        """Test that delivered status sets delivered_at timestamp."""
        await pocketping.storage.create_session(sample_session)
        await pocketping.storage.save_message(sample_visitor_message)

        request = ReadRequest(
            session_id=sample_session.id,
            message_ids=[sample_visitor_message.id],
            status=MessageStatus.DELIVERED,
        )

        await pocketping.handle_read(request)

        messages = await pocketping.storage.get_messages(sample_session.id)
        assert messages[0].delivered_at is not None

    @pytest.mark.asyncio
    async def test_handle_read_sets_read_at(self, pocketping, sample_session, sample_visitor_message):
        """Test that read status sets read_at timestamp."""
        await pocketping.storage.create_session(sample_session)
        await pocketping.storage.save_message(sample_visitor_message)

        request = ReadRequest(
            session_id=sample_session.id,
            message_ids=[sample_visitor_message.id],
            status=MessageStatus.READ,
        )

        await pocketping.handle_read(request)

        messages = await pocketping.storage.get_messages(sample_session.id)
        assert messages[0].read_at is not None
        assert messages[0].status == MessageStatus.READ


class TestPocketPingWebSocket:
    """Tests for WebSocket functionality."""

    @pytest.mark.asyncio
    async def test_register_websocket(self, pocketping, sample_session, mock_websocket):
        """Test registering a WebSocket connection."""
        await pocketping.storage.create_session(sample_session)

        pocketping.register_websocket(sample_session.id, mock_websocket)

        # Verify connection is registered
        connections = pocketping._websocket_connections.get(sample_session.id, set())
        assert mock_websocket in connections

    @pytest.mark.asyncio
    async def test_unregister_websocket(self, pocketping, sample_session, mock_websocket):
        """Test unregistering a WebSocket connection."""
        await pocketping.storage.create_session(sample_session)
        pocketping.register_websocket(sample_session.id, mock_websocket)

        pocketping.unregister_websocket(sample_session.id, mock_websocket)

        connections = pocketping._websocket_connections.get(sample_session.id, set())
        assert mock_websocket not in connections

    @pytest.mark.asyncio
    async def test_broadcast_to_session(self, pocketping, sample_session, mock_websocket):
        """Test broadcasting a message to session WebSockets."""
        await pocketping.storage.create_session(sample_session)
        pocketping.register_websocket(sample_session.id, mock_websocket)

        # Send a message to trigger broadcast
        request = SendMessageRequest(
            session_id=sample_session.id,
            content="Test broadcast",
            sender=Sender.VISITOR,
        )

        await pocketping.handle_message(request)

        # Verify WebSocket received the message
        mock_websocket.send_text.assert_called()
        call_args = mock_websocket.send_text.call_args[0][0]
        assert "Test broadcast" in call_args


class TestPocketPingOperator:
    """Tests for operator functionality."""

    @pytest.mark.asyncio
    async def test_send_operator_message(self, pocketping, sample_session):
        """Test sending an operator message."""
        await pocketping.storage.create_session(sample_session)

        message = await pocketping.send_operator_message(
            session_id=sample_session.id,
            content="Hello from operator!",
            source_bridge="test",
            operator_name="John",
        )

        assert message.content == "Hello from operator!"
        assert message.sender == Sender.OPERATOR

        # Verify message was saved
        messages = await pocketping.storage.get_messages(sample_session.id)
        assert len(messages) == 1

    def test_set_operator_online(self, pocketping):
        """Test setting operator online status."""
        assert pocketping.is_operator_online() is False

        pocketping.set_operator_online(True)

        assert pocketping.is_operator_online() is True

    @pytest.mark.asyncio
    async def test_operator_online_broadcasts_presence(self, pocketping, sample_session, mock_websocket):
        """Test that operator status change broadcasts presence."""
        await pocketping.storage.create_session(sample_session)
        pocketping.register_websocket(sample_session.id, mock_websocket)

        pocketping.set_operator_online(True)

        # Wait for async broadcast
        import asyncio

        await asyncio.sleep(0.1)

        mock_websocket.send_text.assert_called()
        call_args = mock_websocket.send_text.call_args[0][0]
        assert "presence" in call_args
        assert "online" in call_args


class TestPocketPingBridges:
    """Tests for bridge integration."""

    @pytest.mark.asyncio
    async def test_add_bridge(self, pocketping, mock_bridge):
        """Test adding a bridge."""
        pocketping.add_bridge(mock_bridge)

        assert mock_bridge in pocketping.bridges

    @pytest.mark.asyncio
    async def test_bridge_notified_on_new_session(self, pocketping, mock_bridge):
        """Test that bridge is notified on new session."""
        pocketping.add_bridge(mock_bridge)

        request = ConnectRequest(
            visitor_id="new-visitor",
            metadata={"url": "https://example.com"},
        )

        await pocketping.handle_connect(request)

        mock_bridge.on_new_session.assert_called_once()

    @pytest.mark.asyncio
    async def test_bridge_notified_on_visitor_message(self, pocketping, sample_session, mock_bridge):
        """Test that bridge is notified on visitor message."""
        await pocketping.storage.create_session(sample_session)
        pocketping.add_bridge(mock_bridge)

        request = SendMessageRequest(
            session_id=sample_session.id,
            content="Hello!",
            sender=Sender.VISITOR,
        )

        await pocketping.handle_message(request)

        mock_bridge.on_visitor_message.assert_called_once()

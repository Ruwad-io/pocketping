"""Comprehensive tests for TelegramBridge, DiscordBridge, and SlackBridge."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from pocketping import PocketPing
from pocketping.bridges.discord import DiscordBridge
from pocketping.bridges.slack import SlackBridge
from pocketping.bridges.telegram import TelegramBridge
from pocketping.models import (
    BridgeMessageResult,
    Message,
    MessageStatus,
    Sender,
    Session,
    SessionMetadata,
    UserIdentity,
)

# ─────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────


@pytest.fixture
def sample_session():
    """Create a sample session for testing."""
    return Session(
        id="test-session-123",
        visitor_id="test-visitor-456789abcdef",
        created_at=datetime.now(timezone.utc),
        last_activity=datetime.now(timezone.utc),
        operator_online=False,
        ai_active=False,
        metadata=SessionMetadata(
            url="https://example.com/test-page",
            ip="192.168.1.1",
            country="France",
            city="Paris",
        ),
    )


@pytest.fixture
def sample_session_with_identity():
    """Create a sample session with identity for testing."""
    return Session(
        id="test-session-456",
        visitor_id="test-visitor-789",
        created_at=datetime.now(timezone.utc),
        last_activity=datetime.now(timezone.utc),
        operator_online=False,
        ai_active=False,
        identity=UserIdentity(id="user-123", name="John Doe", email="john@example.com"),
        metadata=SessionMetadata(url="https://example.com"),
    )


@pytest.fixture
def sample_visitor_message(sample_session):
    """Create a sample visitor message for testing."""
    return Message(
        id="test-msg-001",
        session_id=sample_session.id,
        content="Hello, I need help!",
        sender=Sender.VISITOR,
        timestamp=datetime.now(timezone.utc),
        status=MessageStatus.SENT,
    )


@pytest.fixture
def sample_operator_message(sample_session):
    """Create a sample operator message for testing."""
    return Message(
        id="test-msg-002",
        session_id=sample_session.id,
        content="Hi! How can I help you?",
        sender=Sender.OPERATOR,
        timestamp=datetime.now(timezone.utc),
        status=MessageStatus.SENT,
    )


@pytest.fixture
def mock_pocketping():
    """Create a mock PocketPing instance."""
    pp = MagicMock(spec=PocketPing)
    return pp


# ─────────────────────────────────────────────────────────────────
# TelegramBridge Tests
# ─────────────────────────────────────────────────────────────────


class TestTelegramBridgeConstructor:
    """Tests for TelegramBridge constructor validation."""

    def test_creates_bridge_with_required_params(self):
        """Test that bridge can be created with required params."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")

        assert bridge.bot_token == "123:ABC"
        assert bridge.chat_id == "456"
        assert bridge.name == "telegram"

    def test_uses_default_options(self):
        """Test that default options are applied."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")

        assert bridge.parse_mode == "HTML"
        assert bridge.disable_notification is False

    def test_accepts_custom_options(self):
        """Test that custom options are accepted."""
        bridge = TelegramBridge(
            bot_token="123:ABC",
            chat_id=789,  # Test integer chat_id
            parse_mode="MarkdownV2",
            disable_notification=True,
        )

        assert bridge.parse_mode == "MarkdownV2"
        assert bridge.disable_notification is True
        assert bridge.chat_id == "789"  # Converted to string


class TestTelegramBridgeOnVisitorMessage:
    """Tests for TelegramBridge.on_visitor_message."""

    @pytest.mark.asyncio
    async def test_sends_message_to_api(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that visitor message is sent to Telegram API."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": True, "result": {"message_id": 123}})

            await bridge.on_visitor_message(sample_visitor_message, sample_session)

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            assert "sendMessage" in call_args[0][0]
            assert call_args[1]["json"]["chat_id"] == "456"
            assert sample_visitor_message.content in call_args[1]["json"]["text"]

    @pytest.mark.asyncio
    async def test_returns_bridge_message_result_with_message_id(
        self, sample_session, sample_visitor_message, mock_pocketping
    ):
        """Test that on_visitor_message returns BridgeMessageResult with message ID."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": True, "result": {"message_id": 999}})

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            assert isinstance(result, BridgeMessageResult)
            assert result.message_id == 999

    @pytest.mark.asyncio
    async def test_handles_api_errors_gracefully(self, sample_session, sample_visitor_message, mock_pocketping, capsys):
        """Test that API errors are handled gracefully."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": False, "description": "Chat not found"})

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            # Should return empty result, not raise
            assert isinstance(result, BridgeMessageResult)
            assert result.message_id is None

            captured = capsys.readouterr()
            assert "Chat not found" in captured.out

    @pytest.mark.asyncio
    async def test_ignores_non_visitor_messages(self, sample_session, sample_operator_message, mock_pocketping):
        """Test that non-visitor messages are ignored."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        result = await bridge.on_visitor_message(sample_operator_message, sample_session)

        assert result is None


class TestTelegramBridgeOnNewSession:
    """Tests for TelegramBridge.on_new_session."""

    @pytest.mark.asyncio
    async def test_sends_session_announcement(self, sample_session, mock_pocketping):
        """Test that new session announcement is sent."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": True, "result": {"message_id": 123}})

            await bridge.on_new_session(sample_session)

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            assert "sendMessage" in call_args[0][0]
            assert "New chat session" in call_args[1]["json"]["text"]

    @pytest.mark.asyncio
    async def test_formats_session_info_correctly(self, sample_session_with_identity, mock_pocketping):
        """Test that session info is formatted correctly with identity."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": True, "result": {"message_id": 123}})

            await bridge.on_new_session(sample_session_with_identity)

            call_args = mock_post.call_args
            text = call_args[1]["json"]["text"]
            assert "John Doe" in text
            assert "Visitor" in text


class TestTelegramBridgeOnMessageEdit:
    """Tests for TelegramBridge.on_message_edit."""

    @pytest.mark.asyncio
    async def test_calls_edit_api_with_correct_params(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that edit API is called with correct parameters."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": True, "result": {"message_id": 123}})

            await bridge.on_message_edit(sample_visitor_message, sample_session, platform_message_id=123)

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            assert "editMessageText" in call_args[0][0]
            assert call_args[1]["json"]["message_id"] == 123
            assert "(edited)" in call_args[1]["json"]["text"]

    @pytest.mark.asyncio
    async def test_returns_none_on_success(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that on_message_edit returns None (success is implied by no exception)."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": True, "result": {"message_id": 123}})

            result = await bridge.on_message_edit(sample_visitor_message, sample_session, platform_message_id=123)

            assert result is None

    @pytest.mark.asyncio
    async def test_handles_missing_platform_message_id(
        self, sample_session, sample_visitor_message, mock_pocketping, capsys
    ):
        """Test that missing platform_message_id is handled."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        await bridge.on_message_edit(sample_visitor_message, sample_session, platform_message_id=None)

        captured = capsys.readouterr()
        assert "Cannot edit message without platform_message_id" in captured.out


class TestTelegramBridgeOnMessageDelete:
    """Tests for TelegramBridge.on_message_delete."""

    @pytest.mark.asyncio
    async def test_calls_delete_api_with_correct_params(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that delete API is called with correct parameters."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": True, "result": True})

            await bridge.on_message_delete(sample_visitor_message, sample_session, platform_message_id=123)

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            assert "deleteMessage" in call_args[0][0]
            assert call_args[1]["json"]["message_id"] == 123

    @pytest.mark.asyncio
    async def test_returns_none_on_success(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that on_message_delete returns None on success."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": True, "result": True})

            result = await bridge.on_message_delete(sample_visitor_message, sample_session, platform_message_id=123)

            assert result is None

    @pytest.mark.asyncio
    async def test_handles_missing_platform_message_id(
        self, sample_session, sample_visitor_message, mock_pocketping, capsys
    ):
        """Test that missing platform_message_id is handled."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        await bridge.on_message_delete(sample_visitor_message, sample_session, platform_message_id=None)

        captured = capsys.readouterr()
        assert "Cannot delete message without platform_message_id" in captured.out


class TestTelegramBridgeErrorHandling:
    """Tests for TelegramBridge error handling."""

    @pytest.mark.asyncio
    async def test_prints_warning_but_doesnt_raise_on_api_failure(
        self, sample_session, sample_visitor_message, mock_pocketping, capsys
    ):
        """Test that API failure prints warning but doesn't raise."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(
                200, json={"ok": False, "description": "Bad Request: chat not found"}
            )

            # Should not raise
            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            captured = capsys.readouterr()
            assert "Bad Request" in captured.out
            assert isinstance(result, BridgeMessageResult)

    @pytest.mark.asyncio
    async def test_handles_network_errors(self, sample_session, sample_visitor_message, mock_pocketping, capsys):
        """Test that network errors are handled gracefully."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = httpx.ConnectError("Connection refused")

            # Should not raise
            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            captured = capsys.readouterr()
            assert "HTTP error" in captured.out
            assert isinstance(result, BridgeMessageResult)

    @pytest.mark.asyncio
    async def test_handles_invalid_responses(self, sample_session, sample_visitor_message, mock_pocketping, capsys):
        """Test that invalid JSON responses are handled."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            # Create a response that will fail JSON parsing
            mock_response = MagicMock()
            mock_response.json.side_effect = ValueError("Invalid JSON")
            mock_post.return_value = mock_response

            # Should not raise
            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            captured = capsys.readouterr()
            assert "error" in captured.out.lower()
            assert isinstance(result, BridgeMessageResult)


# ─────────────────────────────────────────────────────────────────
# DiscordBridge Tests
# ─────────────────────────────────────────────────────────────────


class TestDiscordBridgeConstructor:
    """Tests for DiscordBridge constructor validation."""

    def test_creates_bridge_with_webhook_url(self):
        """Test that bridge can be created with webhook URL."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc-token-xyz")

        assert bridge._mode == "webhook"
        assert bridge._webhook_id == "123"
        assert bridge._webhook_token == "abc-token-xyz"
        assert bridge.name == "discord"

    def test_creates_bridge_with_bot_token(self):
        """Test that bridge can be created with bot token and channel ID."""
        bridge = DiscordBridge(bot_token="bot-token-123", channel_id="456789")

        assert bridge._mode == "bot"
        assert bridge._bot_token == "bot-token-123"
        assert bridge._channel_id == "456789"

    def test_uses_default_options(self):
        """Test that default options are applied."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")

        assert bridge._username is None
        assert bridge._avatar_url is None

    def test_accepts_custom_options(self):
        """Test that custom options are accepted."""
        bridge = DiscordBridge(
            webhook_url="https://discord.com/api/webhooks/123/abc",
            username="PocketPing Bot",
            avatar_url="https://example.com/avatar.png",
        )

        assert bridge._username == "PocketPing Bot"
        assert bridge._avatar_url == "https://example.com/avatar.png"

    def test_raises_error_for_invalid_config(self):
        """Test that invalid configuration raises ValueError."""
        with pytest.raises(ValueError, match="Either webhook_url or"):
            DiscordBridge()

    def test_raises_error_for_invalid_webhook_url(self):
        """Test that invalid webhook URL raises ValueError."""
        with pytest.raises(ValueError, match="Invalid Discord webhook URL"):
            DiscordBridge(webhook_url="https://invalid-url.com/webhook")


class TestDiscordBridgeOnVisitorMessageWebhook:
    """Tests for DiscordBridge.on_visitor_message in webhook mode."""

    @pytest.mark.asyncio
    async def test_sends_message_to_webhook(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that visitor message is sent to Discord webhook."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"id": "msg-123", "channel_id": "456"})

            await bridge.on_visitor_message(sample_visitor_message, sample_session)

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            assert "webhooks" in call_args[0][0]
            assert "embeds" in call_args[1]["json"]

    @pytest.mark.asyncio
    async def test_returns_bridge_message_result_with_message_id(
        self, sample_session, sample_visitor_message, mock_pocketping
    ):
        """Test that on_visitor_message returns BridgeMessageResult with Discord message ID."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"id": "discord-msg-999", "channel_id": "456"})

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            assert isinstance(result, BridgeMessageResult)
            assert result.message_id == "discord-msg-999"

    @pytest.mark.asyncio
    async def test_handles_api_errors_gracefully(self, sample_session, sample_visitor_message, mock_pocketping, capsys):
        """Test that API errors are handled gracefully."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(404, text="Unknown Webhook")

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            assert isinstance(result, BridgeMessageResult)
            assert result.message_id is None

            captured = capsys.readouterr()
            assert "404" in captured.out


class TestDiscordBridgeOnVisitorMessageBot:
    """Tests for DiscordBridge.on_visitor_message in bot mode."""

    @pytest.mark.asyncio
    async def test_sends_message_via_bot_api(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that visitor message is sent via Discord Bot API."""
        bridge = DiscordBridge(bot_token="bot-token", channel_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"id": "msg-123"})

            await bridge.on_visitor_message(sample_visitor_message, sample_session)

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            assert "/channels/456/messages" in call_args[0][0]

    @pytest.mark.asyncio
    async def test_bot_mode_includes_auth_header(self, mock_pocketping):
        """Test that bot mode includes Authorization header."""
        bridge = DiscordBridge(bot_token="my-bot-token", channel_id="456")
        await bridge.init(mock_pocketping)

        assert bridge._client.headers["Authorization"] == "Bot my-bot-token"


class TestDiscordBridgeOnNewSession:
    """Tests for DiscordBridge.on_new_session."""

    @pytest.mark.asyncio
    async def test_sends_session_announcement(self, sample_session, mock_pocketping):
        """Test that new session announcement is sent."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"id": "msg-123"})

            await bridge.on_new_session(sample_session)

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            embeds = call_args[1]["json"]["embeds"]
            assert len(embeds) == 1
            assert "New chat session" in embeds[0]["title"]

    @pytest.mark.asyncio
    async def test_formats_session_info_correctly(self, sample_session_with_identity, mock_pocketping):
        """Test that session info is formatted correctly with identity."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"id": "msg-123"})

            await bridge.on_new_session(sample_session_with_identity)

            call_args = mock_post.call_args
            embeds = call_args[1]["json"]["embeds"]
            assert "John Doe" in embeds[0]["description"]


class TestDiscordBridgeOnMessageEdit:
    """Tests for DiscordBridge.on_message_edit."""

    @pytest.mark.asyncio
    async def test_calls_edit_api_with_correct_params_webhook(
        self, sample_session, sample_visitor_message, mock_pocketping
    ):
        """Test that edit API is called with correct parameters in webhook mode."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "patch", new_callable=AsyncMock) as mock_patch:
            mock_patch.return_value = httpx.Response(200, json={"id": "msg-123"})

            await bridge.on_message_edit(sample_visitor_message, sample_session, platform_message_id="msg-123")

            mock_patch.assert_called_once()
            call_args = mock_patch.call_args
            assert "msg-123" in call_args[0][0]

    @pytest.mark.asyncio
    async def test_calls_edit_api_with_correct_params_bot(
        self, sample_session, sample_visitor_message, mock_pocketping
    ):
        """Test that edit API is called with correct parameters in bot mode."""
        bridge = DiscordBridge(bot_token="bot-token", channel_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "patch", new_callable=AsyncMock) as mock_patch:
            mock_patch.return_value = httpx.Response(200, json={"id": "msg-123"})

            await bridge.on_message_edit(sample_visitor_message, sample_session, platform_message_id="msg-123")

            mock_patch.assert_called_once()
            call_args = mock_patch.call_args
            assert "/channels/456/messages/msg-123" in call_args[0][0]

    @pytest.mark.asyncio
    async def test_returns_none_on_success(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that on_message_edit returns None on success."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "patch", new_callable=AsyncMock) as mock_patch:
            mock_patch.return_value = httpx.Response(200, json={"id": "msg-123"})

            result = await bridge.on_message_edit(sample_visitor_message, sample_session, platform_message_id="msg-123")

            assert result is None

    @pytest.mark.asyncio
    async def test_handles_missing_platform_message_id(
        self, sample_session, sample_visitor_message, mock_pocketping, capsys
    ):
        """Test that missing platform_message_id is handled."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        await bridge.on_message_edit(sample_visitor_message, sample_session, platform_message_id=None)

        captured = capsys.readouterr()
        assert "Cannot edit message without platform_message_id" in captured.out


class TestDiscordBridgeOnMessageDelete:
    """Tests for DiscordBridge.on_message_delete."""

    @pytest.mark.asyncio
    async def test_calls_delete_api_with_correct_params_webhook(
        self, sample_session, sample_visitor_message, mock_pocketping
    ):
        """Test that delete API is called with correct parameters in webhook mode."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "delete", new_callable=AsyncMock) as mock_delete:
            mock_delete.return_value = httpx.Response(204)

            await bridge.on_message_delete(sample_visitor_message, sample_session, platform_message_id="msg-123")

            mock_delete.assert_called_once()
            call_args = mock_delete.call_args
            assert "msg-123" in call_args[0][0]

    @pytest.mark.asyncio
    async def test_calls_delete_api_with_correct_params_bot(
        self, sample_session, sample_visitor_message, mock_pocketping
    ):
        """Test that delete API is called with correct parameters in bot mode."""
        bridge = DiscordBridge(bot_token="bot-token", channel_id="456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "delete", new_callable=AsyncMock) as mock_delete:
            mock_delete.return_value = httpx.Response(204)

            await bridge.on_message_delete(sample_visitor_message, sample_session, platform_message_id="msg-123")

            mock_delete.assert_called_once()
            call_args = mock_delete.call_args
            assert "/channels/456/messages/msg-123" in call_args[0][0]

    @pytest.mark.asyncio
    async def test_returns_none_on_success(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that on_message_delete returns None on success."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "delete", new_callable=AsyncMock) as mock_delete:
            mock_delete.return_value = httpx.Response(204)

            result = await bridge.on_message_delete(
                sample_visitor_message, sample_session, platform_message_id="msg-123"
            )

            assert result is None

    @pytest.mark.asyncio
    async def test_handles_missing_platform_message_id(
        self, sample_session, sample_visitor_message, mock_pocketping, capsys
    ):
        """Test that missing platform_message_id is handled."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        await bridge.on_message_delete(sample_visitor_message, sample_session, platform_message_id=None)

        captured = capsys.readouterr()
        assert "Cannot delete message without platform_message_id" in captured.out


class TestDiscordBridgeErrorHandling:
    """Tests for DiscordBridge error handling."""

    @pytest.mark.asyncio
    async def test_prints_warning_but_doesnt_raise_on_api_failure(
        self, sample_session, sample_visitor_message, mock_pocketping, capsys
    ):
        """Test that API failure prints warning but doesn't raise."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(401, text="Unauthorized")

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            captured = capsys.readouterr()
            assert "401" in captured.out
            assert isinstance(result, BridgeMessageResult)

    @pytest.mark.asyncio
    async def test_handles_network_errors(self, sample_session, sample_visitor_message, mock_pocketping, capsys):
        """Test that network errors are handled gracefully."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = httpx.ConnectError("Connection refused")

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            captured = capsys.readouterr()
            assert "HTTP error" in captured.out
            assert isinstance(result, BridgeMessageResult)

    @pytest.mark.asyncio
    async def test_handles_invalid_responses(self, sample_session, sample_visitor_message, mock_pocketping, capsys):
        """Test that invalid JSON responses are handled."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.side_effect = ValueError("Invalid JSON")
            mock_post.return_value = mock_response

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            captured = capsys.readouterr()
            assert "error" in captured.out.lower()
            assert isinstance(result, BridgeMessageResult)


# ─────────────────────────────────────────────────────────────────
# SlackBridge Tests
# ─────────────────────────────────────────────────────────────────


class TestSlackBridgeConstructor:
    """Tests for SlackBridge constructor validation."""

    def test_creates_bridge_with_webhook_url(self):
        """Test that bridge can be created with webhook URL."""
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T123/B456/xyz")

        assert bridge._mode == "webhook"
        assert bridge._webhook_url == "https://hooks.slack.com/services/T123/B456/xyz"
        assert bridge.name == "slack"

    def test_creates_bridge_with_bot_token(self):
        """Test that bridge can be created with bot token and channel ID."""
        bridge = SlackBridge(bot_token="xoxb-123-456-abc", channel_id="C0123456789")

        assert bridge._mode == "bot"
        assert bridge._bot_token == "xoxb-123-456-abc"
        assert bridge._channel_id == "C0123456789"

    def test_uses_default_options(self):
        """Test that default options are applied."""
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T123/B456/xyz")

        assert bridge._username is None
        assert bridge._icon_emoji is None
        assert bridge._icon_url is None

    def test_accepts_custom_options(self):
        """Test that custom options are accepted."""
        bridge = SlackBridge(
            webhook_url="https://hooks.slack.com/services/T123/B456/xyz",
            username="PocketPing Bot",
            icon_emoji=":robot_face:",
            icon_url="https://example.com/icon.png",
        )

        assert bridge._username == "PocketPing Bot"
        assert bridge._icon_emoji == ":robot_face:"
        assert bridge._icon_url == "https://example.com/icon.png"

    def test_raises_error_for_invalid_config(self):
        """Test that invalid configuration raises ValueError."""
        with pytest.raises(ValueError, match="Either webhook_url or"):
            SlackBridge()


class TestSlackBridgeOnVisitorMessageWebhook:
    """Tests for SlackBridge.on_visitor_message in webhook mode."""

    @pytest.mark.asyncio
    async def test_sends_message_to_webhook(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that visitor message is sent to Slack webhook."""
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T123/B456/xyz")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, text="ok")

            await bridge.on_visitor_message(sample_visitor_message, sample_session)

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            assert "hooks.slack.com" in call_args[0][0]
            assert "blocks" in call_args[1]["json"]

    @pytest.mark.asyncio
    async def test_returns_bridge_message_result_without_message_id_for_webhook(
        self, sample_session, sample_visitor_message, mock_pocketping
    ):
        """Test that webhook mode returns BridgeMessageResult without message ID (webhooks don't return IDs)."""
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T123/B456/xyz")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, text="ok")

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            assert isinstance(result, BridgeMessageResult)
            # Webhook mode doesn't return message ID
            assert result.message_id is None

    @pytest.mark.asyncio
    async def test_handles_api_errors_gracefully(self, sample_session, sample_visitor_message, mock_pocketping, capsys):
        """Test that API errors are handled gracefully."""
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T123/B456/xyz")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(404, text="channel_not_found")

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            assert isinstance(result, BridgeMessageResult)
            assert result.message_id is None

            captured = capsys.readouterr()
            assert "404" in captured.out


class TestSlackBridgeOnVisitorMessageBot:
    """Tests for SlackBridge.on_visitor_message in bot mode."""

    @pytest.mark.asyncio
    async def test_sends_message_via_bot_api(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that visitor message is sent via Slack Bot API."""
        bridge = SlackBridge(bot_token="xoxb-123", channel_id="C456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(
                200, json={"ok": True, "ts": "1234567890.123456", "channel": "C456"}
            )

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            assert "chat.postMessage" in call_args[0][0]
            assert isinstance(result, BridgeMessageResult)
            assert result.message_id == "1234567890.123456"

    @pytest.mark.asyncio
    async def test_bot_mode_includes_auth_header(self, mock_pocketping):
        """Test that bot mode includes Authorization header."""
        bridge = SlackBridge(bot_token="xoxb-my-token", channel_id="C456")
        await bridge.init(mock_pocketping)

        assert bridge._client.headers["Authorization"] == "Bearer xoxb-my-token"


class TestSlackBridgeOnNewSession:
    """Tests for SlackBridge.on_new_session."""

    @pytest.mark.asyncio
    async def test_sends_session_announcement(self, sample_session, mock_pocketping):
        """Test that new session announcement is sent."""
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T123/B456/xyz")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, text="ok")

            await bridge.on_new_session(sample_session)

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            blocks = call_args[1]["json"]["blocks"]
            # Should have header block with "New chat session"
            header_block = next((b for b in blocks if b["type"] == "header"), None)
            assert header_block is not None
            assert "New chat session" in header_block["text"]["text"]

    @pytest.mark.asyncio
    async def test_formats_session_info_correctly(self, sample_session_with_identity, mock_pocketping):
        """Test that session info is formatted correctly with identity."""
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T123/B456/xyz")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, text="ok")

            await bridge.on_new_session(sample_session_with_identity)

            call_args = mock_post.call_args
            blocks = call_args[1]["json"]["blocks"]
            section_block = next((b for b in blocks if b["type"] == "section"), None)
            assert section_block is not None
            assert "John Doe" in section_block["text"]["text"]


class TestSlackBridgeOnMessageEdit:
    """Tests for SlackBridge.on_message_edit."""

    @pytest.mark.asyncio
    async def test_calls_edit_api_with_correct_params(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that edit API is called with correct parameters in bot mode."""
        bridge = SlackBridge(bot_token="xoxb-123", channel_id="C456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": True, "ts": "1234567890.123456"})

            await bridge.on_message_edit(
                sample_visitor_message, sample_session, platform_message_id="1234567890.123456"
            )

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            assert "chat.update" in call_args[0][0]
            assert call_args[1]["json"]["ts"] == "1234567890.123456"
            assert call_args[1]["json"]["channel"] == "C456"

    @pytest.mark.asyncio
    async def test_returns_none_on_success(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that on_message_edit returns None on success."""
        bridge = SlackBridge(bot_token="xoxb-123", channel_id="C456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": True, "ts": "1234567890.123456"})

            result = await bridge.on_message_edit(
                sample_visitor_message, sample_session, platform_message_id="1234567890.123456"
            )

            assert result is None

    @pytest.mark.asyncio
    async def test_returns_early_in_webhook_mode(self, sample_session, sample_visitor_message, mock_pocketping, capsys):
        """Test that message edit returns early in webhook mode (not supported)."""
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T123/B456/xyz")
        await bridge.init(mock_pocketping)

        await bridge.on_message_edit(sample_visitor_message, sample_session, platform_message_id="123")

        captured = capsys.readouterr()
        assert "only available in bot mode" in captured.out

    @pytest.mark.asyncio
    async def test_handles_missing_platform_message_id(
        self, sample_session, sample_visitor_message, mock_pocketping, capsys
    ):
        """Test that missing platform_message_id is handled."""
        bridge = SlackBridge(bot_token="xoxb-123", channel_id="C456")
        await bridge.init(mock_pocketping)

        await bridge.on_message_edit(sample_visitor_message, sample_session, platform_message_id=None)

        captured = capsys.readouterr()
        assert "Cannot edit message without platform_message_id" in captured.out


class TestSlackBridgeOnMessageDelete:
    """Tests for SlackBridge.on_message_delete."""

    @pytest.mark.asyncio
    async def test_calls_delete_api_with_correct_params(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that delete API is called with correct parameters in bot mode."""
        bridge = SlackBridge(bot_token="xoxb-123", channel_id="C456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": True})

            await bridge.on_message_delete(
                sample_visitor_message, sample_session, platform_message_id="1234567890.123456"
            )

            mock_post.assert_called_once()
            call_args = mock_post.call_args
            assert "chat.delete" in call_args[0][0]
            assert call_args[1]["json"]["ts"] == "1234567890.123456"
            assert call_args[1]["json"]["channel"] == "C456"

    @pytest.mark.asyncio
    async def test_returns_none_on_success(self, sample_session, sample_visitor_message, mock_pocketping):
        """Test that on_message_delete returns None on success."""
        bridge = SlackBridge(bot_token="xoxb-123", channel_id="C456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": True})

            result = await bridge.on_message_delete(
                sample_visitor_message, sample_session, platform_message_id="1234567890.123456"
            )

            assert result is None

    @pytest.mark.asyncio
    async def test_returns_early_in_webhook_mode(self, sample_session, sample_visitor_message, mock_pocketping, capsys):
        """Test that message delete returns early in webhook mode (not supported)."""
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T123/B456/xyz")
        await bridge.init(mock_pocketping)

        await bridge.on_message_delete(sample_visitor_message, sample_session, platform_message_id="123")

        captured = capsys.readouterr()
        assert "only available in bot mode" in captured.out

    @pytest.mark.asyncio
    async def test_handles_missing_platform_message_id(
        self, sample_session, sample_visitor_message, mock_pocketping, capsys
    ):
        """Test that missing platform_message_id is handled."""
        bridge = SlackBridge(bot_token="xoxb-123", channel_id="C456")
        await bridge.init(mock_pocketping)

        await bridge.on_message_delete(sample_visitor_message, sample_session, platform_message_id=None)

        captured = capsys.readouterr()
        assert "Cannot delete message without platform_message_id" in captured.out


class TestSlackBridgeErrorHandling:
    """Tests for SlackBridge error handling."""

    @pytest.mark.asyncio
    async def test_prints_warning_but_doesnt_raise_on_api_failure(
        self, sample_session, sample_visitor_message, mock_pocketping, capsys
    ):
        """Test that API failure prints warning but doesn't raise."""
        bridge = SlackBridge(bot_token="xoxb-123", channel_id="C456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(200, json={"ok": False, "error": "channel_not_found"})

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            captured = capsys.readouterr()
            assert "channel_not_found" in captured.out
            assert isinstance(result, BridgeMessageResult)

    @pytest.mark.asyncio
    async def test_handles_network_errors(self, sample_session, sample_visitor_message, mock_pocketping, capsys):
        """Test that network errors are handled gracefully."""
        bridge = SlackBridge(bot_token="xoxb-123", channel_id="C456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = httpx.ConnectError("Connection refused")

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            captured = capsys.readouterr()
            assert "HTTP error" in captured.out
            assert isinstance(result, BridgeMessageResult)

    @pytest.mark.asyncio
    async def test_handles_invalid_responses(self, sample_session, sample_visitor_message, mock_pocketping, capsys):
        """Test that invalid JSON responses are handled."""
        bridge = SlackBridge(bot_token="xoxb-123", channel_id="C456")
        await bridge.init(mock_pocketping)

        with patch.object(bridge._client, "post", new_callable=AsyncMock) as mock_post:
            mock_response = MagicMock()
            mock_response.json.side_effect = ValueError("Invalid JSON")
            mock_post.return_value = mock_response

            result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

            captured = capsys.readouterr()
            assert "error" in captured.out.lower()
            assert isinstance(result, BridgeMessageResult)


# ─────────────────────────────────────────────────────────────────
# Bridge Lifecycle Tests
# ─────────────────────────────────────────────────────────────────


class TestBridgeLifecycle:
    """Tests for bridge initialization and destruction."""

    @pytest.mark.asyncio
    async def test_telegram_init_creates_client(self, mock_pocketping):
        """Test that TelegramBridge.init creates httpx client."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")

        assert bridge._client is None

        await bridge.init(mock_pocketping)

        assert bridge._client is not None
        assert isinstance(bridge._client, httpx.AsyncClient)

        await bridge.destroy()

    @pytest.mark.asyncio
    async def test_telegram_destroy_closes_client(self, mock_pocketping):
        """Test that TelegramBridge.destroy closes httpx client."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")
        await bridge.init(mock_pocketping)

        await bridge.destroy()

        assert bridge._client is None

    @pytest.mark.asyncio
    async def test_discord_init_creates_client(self, mock_pocketping):
        """Test that DiscordBridge.init creates httpx client."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")

        assert bridge._client is None

        await bridge.init(mock_pocketping)

        assert bridge._client is not None
        assert isinstance(bridge._client, httpx.AsyncClient)

        await bridge.destroy()

    @pytest.mark.asyncio
    async def test_discord_destroy_closes_client(self, mock_pocketping):
        """Test that DiscordBridge.destroy closes httpx client."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")
        await bridge.init(mock_pocketping)

        await bridge.destroy()

        assert bridge._client is None

    @pytest.mark.asyncio
    async def test_slack_init_creates_client(self, mock_pocketping):
        """Test that SlackBridge.init creates httpx client."""
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T123/B456/xyz")

        assert bridge._client is None

        await bridge.init(mock_pocketping)

        assert bridge._client is not None
        assert isinstance(bridge._client, httpx.AsyncClient)

        await bridge.destroy()

    @pytest.mark.asyncio
    async def test_slack_destroy_closes_client(self, mock_pocketping):
        """Test that SlackBridge.destroy closes httpx client."""
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T123/B456/xyz")
        await bridge.init(mock_pocketping)

        await bridge.destroy()

        assert bridge._client is None


# ─────────────────────────────────────────────────────────────────
# Bridge Not Initialized Tests
# ─────────────────────────────────────────────────────────────────


class TestBridgeNotInitialized:
    """Tests for bridges when not initialized."""

    @pytest.mark.asyncio
    async def test_telegram_returns_none_when_not_initialized(self, sample_session, sample_visitor_message, capsys):
        """Test that TelegramBridge returns None when not initialized."""
        bridge = TelegramBridge(bot_token="123:ABC", chat_id="456")

        # Don't call init
        result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

        assert isinstance(result, BridgeMessageResult)
        captured = capsys.readouterr()
        assert "not initialized" in captured.out

    @pytest.mark.asyncio
    async def test_discord_returns_none_when_not_initialized(self, sample_session, sample_visitor_message, capsys):
        """Test that DiscordBridge returns None when not initialized."""
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/123/abc")

        # Don't call init
        result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

        assert isinstance(result, BridgeMessageResult)
        captured = capsys.readouterr()
        assert "not initialized" in captured.out

    @pytest.mark.asyncio
    async def test_slack_returns_none_when_not_initialized(self, sample_session, sample_visitor_message, capsys):
        """Test that SlackBridge returns None when not initialized."""
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T123/B456/xyz")

        # Don't call init
        result = await bridge.on_visitor_message(sample_visitor_message, sample_session)

        assert isinstance(result, BridgeMessageResult)
        captured = capsys.readouterr()
        assert "not initialized" in captured.out

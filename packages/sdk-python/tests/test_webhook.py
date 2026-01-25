"""Tests for webhook forwarding functionality."""

import hashlib
import hmac
import json
import time
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from pocketping import CustomEvent, PocketPing
from pocketping.models import ConnectRequest, SessionMetadata
from pocketping.webhooks import WebhookConfig, WebhookHandler


class TestWebhookConfiguration:
    """Tests for webhook configuration."""

    def test_webhook_url_default_none(self):
        """Test that webhook_url is None by default."""
        pp = PocketPing()
        assert pp.webhook_url is None

    def test_webhook_url_can_be_set(self):
        """Test that webhook_url can be configured."""
        pp = PocketPing(webhook_url="https://webhook.example.com/events")
        assert pp.webhook_url == "https://webhook.example.com/events"

    def test_webhook_secret_can_be_set(self):
        """Test that webhook_secret can be configured."""
        pp = PocketPing(
            webhook_url="https://webhook.example.com/events",
            webhook_secret="my-secret-key",
        )
        assert pp.webhook_secret == "my-secret-key"

    def test_webhook_timeout_default(self):
        """Test that webhook_timeout defaults to 5.0 seconds."""
        pp = PocketPing(webhook_url="https://webhook.example.com/events")
        assert pp.webhook_timeout == 5.0

    def test_webhook_timeout_can_be_set(self):
        """Test that webhook_timeout can be configured."""
        pp = PocketPing(
            webhook_url="https://webhook.example.com/events",
            webhook_timeout=10.0,
        )
        assert pp.webhook_timeout == 10.0


class TestWebhookForwarding:
    """Tests for webhook forwarding."""

    @pytest.fixture
    def pp_with_webhook(self):
        """Create a PocketPing instance with webhook configured."""
        return PocketPing(webhook_url="https://webhook.example.com/events")

    @pytest.fixture
    async def session(self, pp_with_webhook):
        """Create a session for testing."""
        request = ConnectRequest(
            visitor_id="visitor-123",
            metadata=SessionMetadata(
                url="https://example.com/pricing",
                country="France",
                browser="Chrome",
            ),
        )
        response = await pp_with_webhook.handle_connect(request)
        return await pp_with_webhook.storage.get_session(response.session_id)

    @pytest.mark.asyncio
    async def test_webhook_not_called_when_not_configured(self):
        """Test that webhook is not called when webhookUrl is not configured."""
        pp = PocketPing()  # No webhook_url

        with patch("httpx.AsyncClient") as mock_client:
            request = ConnectRequest(visitor_id="visitor-1")
            response = await pp.handle_connect(request)

            event = CustomEvent(name="test_event", data={"key": "value"})
            await pp.handle_custom_event(response.session_id, event)

            # Wait for any background tasks
            import asyncio

            await asyncio.sleep(0.1)

            mock_client.assert_not_called()

    @pytest.mark.asyncio
    async def test_webhook_called_when_configured(self, pp_with_webhook, session):
        """Test that webhook is called when configured."""
        with patch("httpx.AsyncClient") as MockClient:
            mock_response = MagicMock()
            mock_response.is_success = True
            mock_response.status_code = 200

            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(return_value=mock_response)
            mock_instance.aclose = AsyncMock()
            MockClient.return_value = mock_instance

            event = CustomEvent(name="clicked_pricing", data={"plan": "pro"})
            await pp_with_webhook._forward_to_webhook(event, session)

            mock_instance.post.assert_called_once()
            call_args = mock_instance.post.call_args

            assert call_args[0][0] == "https://webhook.example.com/events"
            assert "application/json" in call_args[1]["headers"]["Content-Type"]

    @pytest.mark.asyncio
    async def test_webhook_payload_structure(self, pp_with_webhook, session):
        """Test that webhook payload has correct structure."""
        with patch("httpx.AsyncClient") as MockClient:
            mock_response = MagicMock()
            mock_response.is_success = True

            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(return_value=mock_response)
            mock_instance.aclose = AsyncMock()
            MockClient.return_value = mock_instance

            event = CustomEvent(
                name="clicked_pricing",
                data={"plan": "enterprise", "seats": 50},
                timestamp=datetime(2026, 1, 21, 12, 0, 0),
            )
            await pp_with_webhook._forward_to_webhook(event, session)

            call_args = mock_instance.post.call_args
            body = json.loads(call_args[1]["content"])

            # Verify event structure
            assert body["event"]["name"] == "clicked_pricing"
            assert body["event"]["data"] == {"plan": "enterprise", "seats": 50}
            assert body["event"]["timestamp"] is not None

            # Verify session structure
            assert body["session"]["id"] == session.id
            assert body["session"]["visitorId"] == session.visitor_id
            assert body["session"]["metadata"]["url"] == "https://example.com/pricing"

            # Verify sentAt
            assert "sentAt" in body


class TestWebhookSignature:
    """Tests for HMAC signature."""

    @pytest.fixture
    def pp_with_secret(self):
        """Create a PocketPing instance with webhook and secret configured."""
        return PocketPing(
            webhook_url="https://webhook.example.com/events",
            webhook_secret="my-secret-key",
        )

    @pytest.fixture
    async def session(self, pp_with_secret):
        """Create a session for testing."""
        request = ConnectRequest(visitor_id="visitor-123")
        response = await pp_with_secret.handle_connect(request)
        return await pp_with_secret.storage.get_session(response.session_id)

    @pytest.mark.asyncio
    async def test_signature_header_added_when_secret_set(self, pp_with_secret, session):
        """Test that X-PocketPing-Signature header is added when secret is set."""
        with patch("httpx.AsyncClient") as MockClient:
            mock_response = MagicMock()
            mock_response.is_success = True

            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(return_value=mock_response)
            mock_instance.aclose = AsyncMock()
            MockClient.return_value = mock_instance

            event = CustomEvent(name="test_event", data={"foo": "bar"})
            await pp_with_secret._forward_to_webhook(event, session)

            call_args = mock_instance.post.call_args
            headers = call_args[1]["headers"]

            assert "X-PocketPing-Signature" in headers
            assert headers["X-PocketPing-Signature"].startswith("sha256=")

    @pytest.mark.asyncio
    async def test_signature_is_correct(self, pp_with_secret, session):
        """Test that the signature is correctly computed."""
        with patch("httpx.AsyncClient") as MockClient:
            mock_response = MagicMock()
            mock_response.is_success = True

            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(return_value=mock_response)
            mock_instance.aclose = AsyncMock()
            MockClient.return_value = mock_instance

            event = CustomEvent(name="test_event", data={"foo": "bar"})
            await pp_with_secret._forward_to_webhook(event, session)

            call_args = mock_instance.post.call_args
            body = call_args[1]["content"]
            signature_header = call_args[1]["headers"]["X-PocketPing-Signature"]

            # Compute expected signature
            expected_signature = hmac.new(
                "my-secret-key".encode(),
                body.encode(),
                hashlib.sha256,
            ).hexdigest()

            assert signature_header == f"sha256={expected_signature}"

    @pytest.mark.asyncio
    async def test_no_signature_header_when_no_secret(self):
        """Test that no signature header when secret is not set."""
        pp = PocketPing(webhook_url="https://webhook.example.com/events")

        request = ConnectRequest(visitor_id="visitor-123")
        response = await pp.handle_connect(request)
        session = await pp.storage.get_session(response.session_id)

        with patch("httpx.AsyncClient") as MockClient:
            mock_response = MagicMock()
            mock_response.is_success = True

            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(return_value=mock_response)
            mock_instance.aclose = AsyncMock()
            MockClient.return_value = mock_instance

            event = CustomEvent(name="test_event", data={})
            await pp._forward_to_webhook(event, session)

            call_args = mock_instance.post.call_args
            headers = call_args[1]["headers"]

            assert "X-PocketPing-Signature" not in headers


class TestTelegramWebhookInbound:
    """Tests for Telegram webhook handling."""

    def test_edited_message_triggers_edit_callback(self):
        """Test that edited_message updates call on_operator_message_edit."""
        on_edit = MagicMock()
        handler = WebhookHandler(
            WebhookConfig(
                telegram_bot_token="test-token",
                on_operator_message_edit=on_edit,
            )
        )

        payload = {
            "edited_message": {
                "message_id": 123,
                "message_thread_id": 456,
                "text": "Updated message",
                "edit_date": 1700000000,
            }
        }

        result = handler.handle_telegram_webhook(payload)

        assert result == {"ok": True}
        assert on_edit.call_count == 1
        args = on_edit.call_args[0]
        assert args[0] == "456"
        assert args[1] == "123"
        assert args[2] == "Updated message"
        assert args[3] == "telegram"
        expected_time = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(1700000000))
        assert args[4] == expected_time

    def test_delete_command_triggers_delete_callback(self):
        """Test that /delete replies call on_operator_message_delete."""
        on_delete = MagicMock()
        handler = WebhookHandler(
            WebhookConfig(
                telegram_bot_token="test-token",
                on_operator_message_delete=on_delete,
            )
        )

        payload = {
            "message": {
                "message_id": 200,
                "message_thread_id": 456,
                "text": "/delete",
                "reply_to_message": {"message_id": 999},
            }
        }

        result = handler.handle_telegram_webhook(payload)

        assert result == {"ok": True}
        assert on_delete.call_count == 1
        args = on_delete.call_args[0]
        assert args[0] == "456"
        assert args[1] == "999"
        assert args[2] == "telegram"
        assert isinstance(args[3], str)

    def test_reaction_delete_triggers_delete_callback(self):
        """Test that 🗑 reactions trigger on_operator_message_delete."""
        on_delete = MagicMock()
        handler = WebhookHandler(
            WebhookConfig(
                telegram_bot_token="test-token",
                on_operator_message_delete=on_delete,
            )
        )

        payload = {
            "message_reaction": {
                "message_id": 999,
                "message_thread_id": 456,
                "new_reaction": [{"type": "emoji", "emoji": "🗑️"}],
                "date": 1700000000,
            }
        }

        result = handler.handle_telegram_webhook(payload)

        assert result == {"ok": True}
        assert on_delete.call_count == 1
        args = on_delete.call_args[0]
        assert args[0] == "456"
        assert args[1] == "999"
        assert args[2] == "telegram"
        expected_time = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(1700000000))
        assert args[3] == expected_time


class TestWebhookErrorHandling:
    """Tests for webhook error handling."""

    @pytest.fixture
    def pp_with_webhook(self):
        """Create a PocketPing instance with webhook configured."""
        return PocketPing(webhook_url="https://webhook.example.com/events")

    @pytest.fixture
    async def session(self, pp_with_webhook):
        """Create a session for testing."""
        request = ConnectRequest(visitor_id="visitor-123")
        response = await pp_with_webhook.handle_connect(request)
        return await pp_with_webhook.storage.get_session(response.session_id)

    @pytest.mark.asyncio
    async def test_error_logged_on_non_success_status(self, pp_with_webhook, session, capsys):
        """Test that error is logged when webhook returns non-success status."""
        with patch("httpx.AsyncClient") as MockClient:
            mock_response = MagicMock()
            mock_response.is_success = False
            mock_response.status_code = 500
            mock_response.text = "Internal Server Error"

            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(return_value=mock_response)
            mock_instance.aclose = AsyncMock()
            MockClient.return_value = mock_instance

            event = CustomEvent(name="test_event", data={})
            await pp_with_webhook._forward_to_webhook(event, session)

            captured = capsys.readouterr()
            assert "500" in captured.out
            assert "Internal Server Error" in captured.out

    @pytest.mark.asyncio
    async def test_error_logged_on_timeout(self, session, capsys):
        """Test that error is logged on timeout."""
        import httpx

        pp = PocketPing(
            webhook_url="https://webhook.example.com/events",
            webhook_timeout=0.1,
        )

        # Re-create session for this pp instance
        request = ConnectRequest(visitor_id="visitor-456")
        response = await pp.handle_connect(request)
        session = await pp.storage.get_session(response.session_id)

        with patch("httpx.AsyncClient") as MockClient:
            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(side_effect=httpx.TimeoutException("Timeout"))
            mock_instance.aclose = AsyncMock()
            MockClient.return_value = mock_instance

            event = CustomEvent(name="test_event", data={})
            await pp._forward_to_webhook(event, session)

            captured = capsys.readouterr()
            assert "timed out" in captured.out

    @pytest.mark.asyncio
    async def test_error_logged_on_network_error(self, pp_with_webhook, session, capsys):
        """Test that error is logged on network error."""
        with patch("httpx.AsyncClient") as MockClient:
            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(side_effect=Exception("Network error"))
            mock_instance.aclose = AsyncMock()
            MockClient.return_value = mock_instance

            event = CustomEvent(name="test_event", data={})
            await pp_with_webhook._forward_to_webhook(event, session)

            captured = capsys.readouterr()
            assert "Network error" in captured.out

    @pytest.mark.asyncio
    async def test_webhook_does_not_raise_on_error(self, pp_with_webhook, session):
        """Test that webhook errors don't raise exceptions (non-blocking)."""
        with patch("httpx.AsyncClient") as MockClient:
            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(side_effect=Exception("Catastrophic failure"))
            mock_instance.aclose = AsyncMock()
            MockClient.return_value = mock_instance

            event = CustomEvent(name="test_event", data={})

            # Should not raise
            await pp_with_webhook._forward_to_webhook(event, session)


class TestWebhookLifecycle:
    """Tests for webhook client lifecycle."""

    @pytest.mark.asyncio
    async def test_http_client_initialized_on_start(self):
        """Test that HTTP client is initialized on start() when webhook is configured."""
        pp = PocketPing(webhook_url="https://webhook.example.com/events")
        assert pp._http_client is None

        await pp.start()
        assert pp._http_client is not None

        await pp.stop()

    @pytest.mark.asyncio
    async def test_http_client_closed_on_stop(self):
        """Test that HTTP client is closed on stop()."""
        pp = PocketPing(webhook_url="https://webhook.example.com/events")

        await pp.start()
        client = pp._http_client

        with patch.object(client, "aclose", new_callable=AsyncMock) as mock_close:
            await pp.stop()
            mock_close.assert_called_once()

    @pytest.mark.asyncio
    async def test_http_client_not_initialized_when_no_webhook(self):
        """Test that HTTP client is not initialized when webhook is not configured."""
        pp = PocketPing()  # No webhook_url

        await pp.start()
        assert pp._http_client is None

        await pp.stop()

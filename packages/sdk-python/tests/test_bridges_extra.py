"""Extra bridge coverage: operator/typing/custom-event/identity/reply paths.

Covers the cross-bridge sync methods, typing indicators, AI takeover, custom
events, identity updates and reply-lookup branches on the Telegram, Discord and
Slack bridges via mocked httpx clients.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from pocketping.bridges.base import CompositeBridge
from pocketping.bridges.discord import DiscordBridge
from pocketping.bridges.slack import SlackBridge
from pocketping.bridges.telegram import TelegramBridge
from pocketping.models import (
    BridgeMessageResult,
    CustomEvent,
    Message,
    MessageStatus,
    Sender,
    Session,
    SessionMetadata,
    UserIdentity,
)
from pocketping.storage import BridgeMessageIds


@pytest.fixture
def session():
    return Session(
        id="sess-123456789",
        visitor_id="visitor-abcdef0123",
        created_at=datetime.now(timezone.utc),
        last_activity=datetime.now(timezone.utc),
        metadata=SessionMetadata(url="https://example.com", user_agent="Chrome/120 Windows"),
    )


@pytest.fixture
def session_with_phone():
    return Session(
        id="sess-phone",
        visitor_id="visitor-phone",
        created_at=datetime.now(timezone.utc),
        last_activity=datetime.now(timezone.utc),
        identity=UserIdentity(id="u-1", name="Jane", email="jane@example.com"),
        user_phone="+33612345678",
        metadata=SessionMetadata(url="https://example.com"),
    )


@pytest.fixture
def visitor_msg(session):
    return Message(
        id="m-1",
        session_id=session.id,
        content="Hi there",
        sender=Sender.VISITOR,
        timestamp=datetime.now(timezone.utc),
        status=MessageStatus.SENT,
    )


@pytest.fixture
def operator_msg(session):
    return Message(
        id="m-op",
        session_id=session.id,
        content="How can I help?",
        sender=Sender.OPERATOR,
        timestamp=datetime.now(timezone.utc),
        status=MessageStatus.SENT,
    )


@pytest.fixture
def custom_event():
    return CustomEvent(name="cart_abandoned", data={"items": 3})


def _ok_telegram():
    return httpx.Response(200, json={"ok": True, "result": {"message_id": 7}})


def _ok_discord():
    return httpx.Response(200, json={"id": "d-7"})


def _ok_slack():
    return httpx.Response(200, json={"ok": True, "ts": "1.23"})


# ─────────────────────────────────────────────────────────────────
# Telegram extra paths
# ─────────────────────────────────────────────────────────────────


class TestTelegramExtra:
    @pytest.mark.asyncio
    async def test_on_operator_message_from_other_bridge(self, session, operator_msg):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_telegram())) as mp:
            await bridge.on_operator_message(operator_msg, session, source_bridge="slack", operator_name="Bob")
            assert "Bob" in mp.call_args[1]["json"]["text"]
            assert "via slack" in mp.call_args[1]["json"]["text"]

    @pytest.mark.asyncio
    async def test_on_operator_message_skips_own_bridge(self, session, operator_msg):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock()) as mp:
            await bridge.on_operator_message(operator_msg, session, source_bridge="telegram")
            mp.assert_not_called()

    @pytest.mark.asyncio
    async def test_on_typing_sends_chat_action(self, session):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_telegram())) as mp:
            await bridge.on_typing("sess", True)
            assert "sendChatAction" in mp.call_args[0][0]

    @pytest.mark.asyncio
    async def test_on_typing_noop_when_not_typing(self, session):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock()) as mp:
            await bridge.on_typing("sess", False)
            mp.assert_not_called()

    @pytest.mark.asyncio
    async def test_on_ai_takeover(self, session):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_telegram())) as mp:
            await bridge.on_ai_takeover(session, "operator offline")
            assert "AI Takeover" in mp.call_args[1]["json"]["text"]

    @pytest.mark.asyncio
    async def test_on_custom_event(self, session, custom_event):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_telegram())) as mp:
            await bridge.on_custom_event(custom_event, session)
            assert "cart_abandoned" in mp.call_args[1]["json"]["text"]

    @pytest.mark.asyncio
    async def test_on_identity_update(self, session_with_phone):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_telegram())) as mp:
            await bridge.on_identity_update(session_with_phone)
            text = mp.call_args[1]["json"]["text"]
            assert "jane@example.com" in text
            assert "+33612345678" in text

    @pytest.mark.asyncio
    async def test_on_identity_update_no_identity_noop(self, session):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock()) as mp:
            await bridge.on_identity_update(session)
            mp.assert_not_called()

    @pytest.mark.asyncio
    async def test_on_message_read_noop(self, session):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        await bridge.init(MagicMock())
        # No exception; pure no-op
        await bridge.on_message_read(session.id, ["m1"], MessageStatus.READ, session)

    @pytest.mark.asyncio
    async def test_visitor_message_with_reply_lookup(self, session):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        pp = MagicMock()
        pp.storage.get_bridge_message_ids = AsyncMock(
            return_value=BridgeMessageIds(telegram_message_id=42)
        )
        await bridge.init(pp)
        msg = Message(
            id="m2", session_id=session.id, content="reply", sender=Sender.VISITOR,
            reply_to="m1", timestamp=datetime.now(timezone.utc), status=MessageStatus.SENT,
        )
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_telegram())) as mp:
            await bridge.on_visitor_message(msg, session)
            assert mp.call_args[1]["json"]["reply_to_message_id"] == 42

    @pytest.mark.asyncio
    async def test_visitor_message_reply_lookup_error(self, session, capsys):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        pp = MagicMock()
        pp.storage.get_bridge_message_ids = AsyncMock(side_effect=RuntimeError("db down"))
        await bridge.init(pp)
        msg = Message(
            id="m2", session_id=session.id, content="reply", sender=Sender.VISITOR,
            reply_to="m1", timestamp=datetime.now(timezone.utc), status=MessageStatus.SENT,
        )
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_telegram())):
            await bridge.on_visitor_message(msg, session)
        assert "reply lookup error" in capsys.readouterr().out

    @pytest.mark.asyncio
    async def test_format_session_text_with_identity_name(self, session_with_phone):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        text = bridge._format_session_text(session_with_phone)
        assert "Jane" in text

    def test_parse_user_agent_variants(self):
        bridge = TelegramBridge(bot_token="t", chat_id="c")
        assert "Firefox" in bridge._parse_user_agent("Firefox/120")
        assert "Edge" in bridge._parse_user_agent("Edg/120")
        assert "Safari" in bridge._parse_user_agent("Safari/605")
        assert "iOS" in bridge._parse_user_agent("iPhone Safari/605")
        assert "Android" in bridge._parse_user_agent("Android Chrome/120")


# ─────────────────────────────────────────────────────────────────
# Discord extra paths
# ─────────────────────────────────────────────────────────────────


class TestDiscordExtra:
    @pytest.mark.asyncio
    async def test_on_operator_message(self, session, operator_msg):
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/1/abc")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_discord())) as mp:
            await bridge.on_operator_message(operator_msg, session, source_bridge="slack", operator_name="Bob")
            embeds = mp.call_args[1]["json"]["embeds"]
            assert "Bob via slack" in embeds[0]["author"]["name"]

    @pytest.mark.asyncio
    async def test_on_operator_message_skips_own(self, session, operator_msg):
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/1/abc")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock()) as mp:
            await bridge.on_operator_message(operator_msg, session, source_bridge="discord")
            mp.assert_not_called()

    @pytest.mark.asyncio
    async def test_on_typing_bot_mode(self, session):
        bridge = DiscordBridge(bot_token="b", channel_id="456")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_discord())) as mp:
            await bridge.on_typing("sess", True)
            assert "/channels/456/typing" in mp.call_args[0][0]

    @pytest.mark.asyncio
    async def test_on_typing_webhook_mode_noop(self, session):
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/1/abc")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock()) as mp:
            await bridge.on_typing("sess", True)
            mp.assert_not_called()

    @pytest.mark.asyncio
    async def test_on_ai_takeover(self, session):
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/1/abc")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_discord())) as mp:
            await bridge.on_ai_takeover(session, "reason")
            assert mp.call_args[1]["json"]["embeds"][0]["title"] == "AI Takeover"

    @pytest.mark.asyncio
    async def test_on_custom_event(self, session, custom_event):
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/1/abc")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_discord())) as mp:
            await bridge.on_custom_event(custom_event, session)
            assert "cart_abandoned" in mp.call_args[1]["json"]["embeds"][0]["description"]

    @pytest.mark.asyncio
    async def test_on_identity_update(self, session_with_phone):
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/1/abc")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_discord())) as mp:
            await bridge.on_identity_update(session_with_phone)
            desc = mp.call_args[1]["json"]["embeds"][0]["description"]
            assert "jane@example.com" in desc and "+33612345678" in desc

    @pytest.mark.asyncio
    async def test_on_identity_update_no_identity(self, session):
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/1/abc")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock()) as mp:
            await bridge.on_identity_update(session)
            mp.assert_not_called()

    @pytest.mark.asyncio
    async def test_visitor_message_reply_lookup(self, session):
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/1/abc")
        pp = MagicMock()
        pp.storage.get_bridge_message_ids = AsyncMock(
            return_value=BridgeMessageIds(discord_message_id="d-99")
        )
        await bridge.init(pp)
        msg = Message(
            id="m2", session_id=session.id, content="reply", sender=Sender.VISITOR,
            reply_to="m1", timestamp=datetime.now(timezone.utc), status=MessageStatus.SENT,
        )
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_discord())) as mp:
            await bridge.on_visitor_message(msg, session)
            assert mp.call_args[1]["json"]["message_reference"]["message_id"] == "d-99"

    @pytest.mark.asyncio
    async def test_bot_request_get_branch(self, session):
        bridge = DiscordBridge(bot_token="b", channel_id="456")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "get", new=AsyncMock(return_value=_ok_discord())) as mp:
            result = await bridge._bot_request("GET", "/channels/456")
            assert result == {"id": "d-7"}
            mp.assert_called_once()

    @pytest.mark.asyncio
    async def test_bot_request_unknown_method(self, session):
        bridge = DiscordBridge(bot_token="b", channel_id="456")
        await bridge.init(MagicMock())
        assert await bridge._bot_request("OPTIONS", "/x") is None

    @pytest.mark.asyncio
    async def test_webhook_request_unknown_method(self, session):
        bridge = DiscordBridge(webhook_url="https://discord.com/api/webhooks/1/abc")
        await bridge.init(MagicMock())
        assert await bridge._webhook_request("OPTIONS") is None

    @pytest.mark.asyncio
    async def test_bot_request_204_returns_success(self, session):
        bridge = DiscordBridge(bot_token="b", channel_id="456")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=httpx.Response(204))):
            result = await bridge._bot_request("POST", "/x", json_data={})
            assert result == {"success": True}


# ─────────────────────────────────────────────────────────────────
# Slack extra paths
# ─────────────────────────────────────────────────────────────────


class TestSlackExtra:
    @pytest.mark.asyncio
    async def test_on_operator_message(self, session, operator_msg):
        bridge = SlackBridge(bot_token="xoxb", channel_id="C1")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_slack())) as mp:
            await bridge.on_operator_message(operator_msg, session, source_bridge="telegram", operator_name="Bob")
            assert "Bob via telegram" in mp.call_args[1]["json"]["text"]

    @pytest.mark.asyncio
    async def test_on_operator_message_skips_own(self, session, operator_msg):
        bridge = SlackBridge(bot_token="xoxb", channel_id="C1")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock()) as mp:
            await bridge.on_operator_message(operator_msg, session, source_bridge="slack")
            mp.assert_not_called()

    @pytest.mark.asyncio
    async def test_on_typing_noop(self, session):
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T/B/x")
        await bridge.init(MagicMock())
        # Slack typing is a no-op; just confirm no error.
        await bridge.on_typing("sess", True)

    @pytest.mark.asyncio
    async def test_on_ai_takeover(self, session):
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T/B/x")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=httpx.Response(200, text="ok"))) as mp:
            await bridge.on_ai_takeover(session, "reason")
            assert "AI Takeover" in mp.call_args[1]["json"]["text"]

    @pytest.mark.asyncio
    async def test_on_custom_event(self, session, custom_event):
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T/B/x")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=httpx.Response(200, text="ok"))) as mp:
            await bridge.on_custom_event(custom_event, session)
            assert "cart_abandoned" in mp.call_args[1]["json"]["text"]

    @pytest.mark.asyncio
    async def test_on_identity_update(self, session_with_phone):
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T/B/x")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=httpx.Response(200, text="ok"))) as mp:
            await bridge.on_identity_update(session_with_phone)
            blocks = mp.call_args[1]["json"]["blocks"]
            joined = " ".join(str(b) for b in blocks)
            assert "jane@example.com" in joined and "+33612345678" in joined

    @pytest.mark.asyncio
    async def test_on_identity_update_no_identity(self, session):
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T/B/x")
        await bridge.init(MagicMock())
        with patch.object(bridge._client, "post", new=AsyncMock()) as mp:
            await bridge.on_identity_update(session)
            mp.assert_not_called()

    @pytest.mark.asyncio
    async def test_visitor_message_with_reply_quote(self, session):
        bridge = SlackBridge(bot_token="xoxb", channel_id="C1")
        pp = MagicMock()
        replied = Message(
            id="m1", session_id=session.id, content="original question", sender=Sender.OPERATOR,
            timestamp=datetime.now(timezone.utc), status=MessageStatus.SENT,
        )
        pp.storage.get_message = AsyncMock(return_value=replied)
        await bridge.init(pp)
        msg = Message(
            id="m2", session_id=session.id, content="my reply", sender=Sender.VISITOR,
            reply_to="m1", timestamp=datetime.now(timezone.utc), status=MessageStatus.SENT,
        )
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_slack())) as mp:
            await bridge.on_visitor_message(msg, session)
            blocks = mp.call_args[1]["json"]["blocks"]
            quote = str(blocks[0])
            assert "Support" in quote and "original question" in quote

    @pytest.mark.asyncio
    async def test_visitor_message_reply_to_deleted(self, session):
        bridge = SlackBridge(bot_token="xoxb", channel_id="C1")
        pp = MagicMock()
        replied = Message(
            id="m1", session_id=session.id, content="x" * 200, sender=Sender.VISITOR,
            deleted_at=datetime.now(timezone.utc),
            timestamp=datetime.now(timezone.utc), status=MessageStatus.SENT,
        )
        pp.storage.get_message = AsyncMock(return_value=replied)
        await bridge.init(pp)
        msg = Message(
            id="m2", session_id=session.id, content="reply", sender=Sender.VISITOR,
            reply_to="m1", timestamp=datetime.now(timezone.utc), status=MessageStatus.SENT,
        )
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_slack())) as mp:
            await bridge.on_visitor_message(msg, session)
            quote = str(mp.call_args[1]["json"]["blocks"][0])
            assert "Message deleted" in quote

    @pytest.mark.asyncio
    async def test_visitor_message_reply_lookup_error(self, session, capsys):
        bridge = SlackBridge(bot_token="xoxb", channel_id="C1")
        pp = MagicMock()
        pp.storage.get_message = AsyncMock(side_effect=RuntimeError("boom"))
        await bridge.init(pp)
        msg = Message(
            id="m2", session_id=session.id, content="reply", sender=Sender.VISITOR,
            reply_to="m1", timestamp=datetime.now(timezone.utc), status=MessageStatus.SENT,
        )
        with patch.object(bridge._client, "post", new=AsyncMock(return_value=_ok_slack())):
            await bridge.on_visitor_message(msg, session)
        assert "reply lookup error" in capsys.readouterr().out

    @pytest.mark.asyncio
    async def test_update_message_webhook_mode_returns_none(self, session):
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T/B/x")
        await bridge.init(MagicMock())
        assert await bridge._update_message("1.23", text="x") is None

    @pytest.mark.asyncio
    async def test_delete_message_webhook_mode_returns_false(self, session):
        bridge = SlackBridge(webhook_url="https://hooks.slack.com/services/T/B/x")
        await bridge.init(MagicMock())
        assert await bridge._delete_message("1.23") is False


# ─────────────────────────────────────────────────────────────────
# CompositeBridge
# ─────────────────────────────────────────────────────────────────


def _mock_bridge(name="m"):
    b = MagicMock()
    b.name = name
    b.init = AsyncMock()
    b.on_new_session = AsyncMock()
    b.on_visitor_message = AsyncMock(return_value=BridgeMessageResult(message_id="x"))
    b.on_operator_message = AsyncMock()
    b.on_message_read = AsyncMock()
    b.on_message_edit = AsyncMock()
    b.on_message_delete = AsyncMock()
    b.on_custom_event = AsyncMock()
    b.on_identity_update = AsyncMock()
    b.on_typing = AsyncMock()
    b.on_ai_takeover = AsyncMock()
    b.destroy = AsyncMock()
    return b


class TestCompositeBridge:
    @pytest.mark.asyncio
    async def test_forwards_all_events(self, session, visitor_msg, operator_msg, custom_event):
        b1, b2 = _mock_bridge("b1"), _mock_bridge("b2")
        comp = CompositeBridge([b1, b2])
        assert comp.name == "composite"

        await comp.init(MagicMock())
        await comp.on_new_session(session)
        result = await comp.on_visitor_message(visitor_msg, session)
        assert result.message_id == "x"
        await comp.on_operator_message(operator_msg, session, "slack", "Bob")
        await comp.on_message_read(session.id, ["m1"], MessageStatus.READ, session)
        await comp.on_message_edit(visitor_msg, session, "p1")
        await comp.on_message_delete(visitor_msg, session, "p1")
        await comp.on_custom_event(custom_event, session)
        await comp.on_identity_update(session)
        await comp.on_typing("sess", True)
        await comp.on_ai_takeover(session, "reason")
        await comp.destroy()

        b1.on_new_session.assert_awaited_once()
        b2.on_ai_takeover.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_no_results_returns_empty(self, session, visitor_msg):
        b = _mock_bridge()
        b.on_visitor_message = AsyncMock(return_value=None)
        comp = CompositeBridge([b])
        result = await comp.on_visitor_message(visitor_msg, session)
        assert isinstance(result, BridgeMessageResult)
        assert result.message_id is None

    @pytest.mark.asyncio
    async def test_swallows_bridge_errors(self, session, visitor_msg, operator_msg, custom_event, capsys):
        b = _mock_bridge("boom")
        b.on_new_session = AsyncMock(side_effect=RuntimeError("x"))
        b.on_visitor_message = AsyncMock(side_effect=RuntimeError("x"))
        b.on_operator_message = AsyncMock(side_effect=RuntimeError("x"))
        b.on_message_read = AsyncMock(side_effect=RuntimeError("x"))
        b.on_message_edit = AsyncMock(side_effect=RuntimeError("x"))
        b.on_message_delete = AsyncMock(side_effect=RuntimeError("x"))
        b.on_custom_event = AsyncMock(side_effect=RuntimeError("x"))
        b.on_identity_update = AsyncMock(side_effect=RuntimeError("x"))
        b.on_typing = AsyncMock(side_effect=RuntimeError("x"))
        b.on_ai_takeover = AsyncMock(side_effect=RuntimeError("x"))
        comp = CompositeBridge([b])

        await comp.on_new_session(session)
        await comp.on_visitor_message(visitor_msg, session)
        await comp.on_operator_message(operator_msg, session)
        await comp.on_message_read(session.id, ["m"], MessageStatus.READ, session)
        await comp.on_message_edit(visitor_msg, session, "p")
        await comp.on_message_delete(visitor_msg, session, "p")
        await comp.on_custom_event(custom_event, session)
        await comp.on_identity_update(session)
        await comp.on_typing("s", True)
        await comp.on_ai_takeover(session, "r")
        assert "error" in capsys.readouterr().out.lower()

    def test_add_bridge(self):
        b1 = _mock_bridge("b1")
        comp = CompositeBridge([b1])
        comp.add_bridge(_mock_bridge("b2"))
        assert len(comp._bridges) == 2

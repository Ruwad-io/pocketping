"""Extra core coverage: presence loop, timed AI takeover, operator actions, simple handlers."""

import asyncio
from datetime import datetime, timezone

import pytest

from pocketping import PocketPing
from pocketping.ai.base import AIProvider
from pocketping.models import (
    ConnectRequest,
    Message,
    Sender,
    SendMessageRequest,
    TypingRequest,
)
from pocketping.storage import MemoryStorage


class FakeProvider(AIProvider):
    def __init__(self, reply="AI reply"):
        self._reply = reply
        self.calls = []

    @property
    def name(self):
        return "fake"

    async def generate_response(self, messages, system_prompt=None):
        self.calls.append((list(messages), system_prompt))
        return self._reply


async def _connect(pp, visitor="v1"):
    resp = await pp.handle_connect(ConnectRequest(visitor_id=visitor))
    return resp.session_id


# ─────────────────────────────────────────────────────────────────
# Simple handlers
# ─────────────────────────────────────────────────────────────────


class TestSimpleHandlers:
    @pytest.mark.asyncio
    async def test_handle_typing(self):
        pp = PocketPing(storage=MemoryStorage())
        sid = await _connect(pp)
        result = await pp.handle_typing(
            TypingRequest(session_id=sid, sender=Sender.VISITOR, is_typing=True)
        )
        assert result == {"ok": True}

    @pytest.mark.asyncio
    async def test_handle_presence(self):
        pp = PocketPing(storage=MemoryStorage())
        pp.set_operator_online(True)
        result = await pp.handle_presence()
        assert result.online is True
        assert result.ai_enabled is False

    @pytest.mark.asyncio
    async def test_handle_presence_ai_enabled(self):
        pp = PocketPing(storage=MemoryStorage(), ai_provider=FakeProvider(), ai_takeover_delay=99)
        result = await pp.handle_presence()
        assert result.ai_enabled is True
        assert result.ai_active_after == 99

    @pytest.mark.asyncio
    async def test_handle_get_messages_pagination(self):
        pp = PocketPing(storage=MemoryStorage())
        sid = await _connect(pp)
        for _ in range(3):
            await pp.handle_message(
                SendMessageRequest(session_id=sid, content="m", sender=Sender.VISITOR)
            )
        result = await pp.handle_get_messages(sid, limit=2)
        assert len(result["messages"]) == 2
        assert result["hasMore"] is True

    @pytest.mark.asyncio
    async def test_is_operator_online_toggle(self):
        pp = PocketPing(storage=MemoryStorage())
        assert pp.is_operator_online() is False
        pp.set_operator_online(True)
        assert pp.is_operator_online() is True


# ─────────────────────────────────────────────────────────────────
# Operator actions
# ─────────────────────────────────────────────────────────────────


class TestOperatorActions:
    @pytest.mark.asyncio
    async def test_send_operator_message_notifies_bridges(self):
        from unittest.mock import AsyncMock, MagicMock

        bridge = MagicMock()
        bridge.name = "telegram"
        bridge.init = AsyncMock()
        bridge.on_new_session = AsyncMock()
        bridge.on_operator_message = AsyncMock()
        pp = PocketPing(storage=MemoryStorage(), bridges=[bridge])
        sid = await _connect(pp)

        message = await pp.send_operator_message(sid, "Hi from operator", operator_name="Alice")
        assert message.sender == Sender.OPERATOR
        assert message.content == "Hi from operator"
        bridge.on_operator_message.assert_awaited()

    @pytest.mark.asyncio
    async def test_set_operator_online_broadcasts(self):
        from unittest.mock import AsyncMock, MagicMock

        pp = PocketPing(storage=MemoryStorage())
        sid = await _connect(pp)
        # Register a fake websocket so the broadcast loop iterates.
        ws = MagicMock()
        ws.send_text = AsyncMock()
        pp.register_websocket(sid, ws)
        pp.set_operator_online(True)
        # Give scheduled broadcast tasks a chance to run.
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert pp.is_operator_online() is True


# ─────────────────────────────────────────────────────────────────
# AI takeover by delay + presence loop
# ─────────────────────────────────────────────────────────────────


class TestAiTakeoverTimed:
    @pytest.mark.asyncio
    async def test_check_ai_takeover_due_after_delay(self):
        pp = PocketPing(storage=MemoryStorage(), ai_provider=FakeProvider(), ai_takeover_delay=0)
        sid = await _connect(pp)
        await pp.storage.save_message(
            Message(id="m1", session_id=sid, content="help?", sender=Sender.VISITOR,
                    timestamp=datetime.now(timezone.utc))
        )
        session = await pp.storage.get_session(sid)
        assert await pp._check_ai_takeover(session) is True

    @pytest.mark.asyncio
    async def test_check_ai_takeover_no_provider(self):
        pp = PocketPing(storage=MemoryStorage())
        sid = await _connect(pp)
        session = await pp.storage.get_session(sid)
        assert await pp._check_ai_takeover(session) is False

    @pytest.mark.asyncio
    async def test_check_ai_takeover_already_active(self):
        pp = PocketPing(storage=MemoryStorage(), ai_provider=FakeProvider(), ai_takeover_delay=0)
        sid = await _connect(pp)
        session = await pp.storage.get_session(sid)
        session.ai_active = True
        assert await pp._check_ai_takeover(session) is False

    @pytest.mark.asyncio
    async def test_check_ai_takeover_no_messages(self):
        pp = PocketPing(storage=MemoryStorage(), ai_provider=FakeProvider(), ai_takeover_delay=0)
        sid = await _connect(pp)
        session = await pp.storage.get_session(sid)
        assert await pp._check_ai_takeover(session) is False

    @pytest.mark.asyncio
    async def test_check_ai_takeover_answered_returns_false(self):
        pp = PocketPing(storage=MemoryStorage(), ai_provider=FakeProvider(), ai_takeover_delay=0)
        sid = await _connect(pp)
        now = datetime.now(timezone.utc)
        await pp.storage.save_message(
            Message(id="m1", session_id=sid, content="help?", sender=Sender.VISITOR, timestamp=now)
        )
        await pp.storage.save_message(
            Message(id="m2", session_id=sid, content="here", sender=Sender.OPERATOR, timestamp=now)
        )
        session = await pp.storage.get_session(sid)
        # Last response is not older than visitor message -> not due.
        assert await pp._check_ai_takeover(session) is False

    @pytest.mark.asyncio
    async def test_trigger_ai_response_creates_message(self):
        provider = FakeProvider(reply="Auto reply")
        pp = PocketPing(storage=MemoryStorage(), ai_provider=provider, ai_takeover_delay=0)
        sid = await _connect(pp)
        await pp.storage.save_message(
            Message(id="m1", session_id=sid, content="help?", sender=Sender.VISITOR,
                    timestamp=datetime.now(timezone.utc))
        )
        session = await pp.storage.get_session(sid)
        await pp._trigger_ai_response(session)

        messages = await pp.storage.get_messages(sid)
        ai = [m for m in messages if m.sender == Sender.AI]
        assert len(ai) == 1
        assert ai[0].content == "Auto reply"
        assert (await pp.storage.get_session(sid)).ai_active is True

    @pytest.mark.asyncio
    async def test_trigger_ai_response_no_provider_noop(self):
        pp = PocketPing(storage=MemoryStorage())
        sid = await _connect(pp)
        session = await pp.storage.get_session(sid)
        await pp._trigger_ai_response(session)  # no error, no AI message
        assert [m for m in await pp.storage.get_messages(sid) if m.sender == Sender.AI] == []

    @pytest.mark.asyncio
    async def test_start_runs_presence_loop_and_triggers_takeover(self, monkeypatch):
        provider = FakeProvider(reply="Hello from AI")
        pp = PocketPing(storage=MemoryStorage(), ai_provider=provider, ai_takeover_delay=0)
        pp.set_operator_online(False)
        sid = await _connect(pp)
        await pp.storage.save_message(
            Message(id="m1", session_id=sid, content="anyone?", sender=Sender.VISITOR,
                    timestamp=datetime.now(timezone.utc))
        )

        # Avoid the 30s wait inside the loop.
        real_sleep = asyncio.sleep

        async def fast_sleep(seconds):
            await real_sleep(0)

        monkeypatch.setattr("pocketping.core.asyncio.sleep", fast_sleep)

        await pp.start()
        # Let the loop iterate a few times.
        for _ in range(5):
            await real_sleep(0)
        await pp.stop()

        messages = await pp.storage.get_messages(sid)
        assert any(m.sender == Sender.AI for m in messages)


# ─────────────────────────────────────────────────────────────────
# Lifecycle without webhook
# ─────────────────────────────────────────────────────────────────


class TestLifecycle:
    @pytest.mark.asyncio
    async def test_start_stop_no_webhook(self, monkeypatch):
        pp = PocketPing(storage=MemoryStorage())

        async def fast_sleep(seconds):
            await asyncio.sleep(0)

        monkeypatch.setattr("pocketping.core.asyncio.sleep", fast_sleep)
        await pp.start()
        await pp.stop()
        assert pp._http_client is None

    @pytest.mark.asyncio
    async def test_start_initializes_webhook_client(self, monkeypatch):
        pp = PocketPing(storage=MemoryStorage(), webhook_url="https://hook.example.com")

        async def fast_sleep(seconds):
            await asyncio.sleep(0)

        monkeypatch.setattr("pocketping.core.asyncio.sleep", fast_sleep)
        await pp.start()
        assert pp._http_client is not None
        await pp.stop()

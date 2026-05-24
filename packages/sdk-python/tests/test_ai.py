"""Tests for the AI fallback feature: providers + handle_message wiring."""

import json

import httpx
import pytest

from pocketping import PocketPing
from pocketping.ai import AnthropicProvider, GeminiProvider, OpenAIProvider
from pocketping.ai.base import AIProvider
from pocketping.models import (
    ConnectRequest,
    Message,
    Sender,
    SendMessageRequest,
)
from pocketping.storage import MemoryStorage

# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────


def _msg(content: str, sender: Sender) -> Message:
    return Message(id=f"m-{sender.value}", session_id="s1", content=content, sender=sender)


def _patch_httpx(monkeypatch, handler):
    """Route all httpx.AsyncClient requests through a MockTransport handler.

    The handler records each request and returns an httpx.Response.
    """
    original_init = httpx.AsyncClient.__init__

    def patched_init(self, *args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        # Drop transport-incompatible kwargs that AsyncClient still accepts.
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)


class FakeProvider(AIProvider):
    """Tiny in-test AI provider for wiring tests."""

    def __init__(self, reply: str = "AI says hi", raise_error: bool = False):
        self._reply = reply
        self._raise = raise_error
        self.calls: list[tuple[list[Message], str | None]] = []

    @property
    def name(self) -> str:
        return "fake"

    async def generate_response(self, messages, system_prompt=None) -> str:
        self.calls.append((list(messages), system_prompt))
        if self._raise:
            raise RuntimeError("boom")
        return self._reply


# ─────────────────────────────────────────────────────────────────
# Provider tests (mocked HTTP)
# ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_openai_provider_builds_request_and_parses_response(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        captured["headers"] = dict(request.headers)
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "Hello from GPT"}}]})

    _patch_httpx(monkeypatch, handler)

    provider = OpenAIProvider(api_key="sk-test", model="gpt-4o-mini")
    messages = [_msg("Hi there", Sender.VISITOR)]
    result = await provider.generate_response(messages, "You are helpful")

    assert result == "Hello from GPT"
    assert captured["method"] == "POST"
    assert captured["url"] == "https://api.openai.com/v1/chat/completions"
    assert captured["headers"]["authorization"] == "Bearer sk-test"
    body = captured["body"]
    assert body["model"] == "gpt-4o-mini"
    assert body["max_tokens"] == 1000
    assert body["temperature"] == 0.7
    # system prompt first, then visitor message mapped to user role
    assert body["messages"][0] == {"role": "system", "content": "You are helpful"}
    assert body["messages"][1] == {"role": "user", "content": "Hi there"}


@pytest.mark.asyncio
async def test_openai_provider_maps_operator_to_assistant(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    _patch_httpx(monkeypatch, handler)

    provider = OpenAIProvider(api_key="sk-test")
    messages = [_msg("hello", Sender.VISITOR), _msg("reply", Sender.OPERATOR)]
    await provider.generate_response(messages)

    roles = [m["role"] for m in captured["body"]["messages"]]
    assert roles == ["user", "assistant"]


@pytest.mark.asyncio
async def test_openai_provider_uses_custom_base_url(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"choices": [{"message": {"content": "x"}}]})

    _patch_httpx(monkeypatch, handler)

    provider = OpenAIProvider(api_key="sk-test", base_url="http://localhost:9999/v1")
    await provider.generate_response([_msg("hi", Sender.VISITOR)])
    assert captured["url"] == "http://localhost:9999/v1/chat/completions"


@pytest.mark.asyncio
async def test_anthropic_provider_builds_request_and_parses_response(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"content": [{"text": "Hello from Claude"}]})

    _patch_httpx(monkeypatch, handler)

    provider = AnthropicProvider(api_key="ak-test", model="claude-sonnet-4-20250514")
    messages = [_msg("Need help", Sender.VISITOR), _msg("Sure", Sender.OPERATOR)]
    result = await provider.generate_response(messages, "Custom system")

    assert result == "Hello from Claude"
    assert captured["url"] == "https://api.anthropic.com/v1/messages"
    assert captured["headers"]["x-api-key"] == "ak-test"
    assert captured["headers"]["anthropic-version"] == "2023-06-01"
    body = captured["body"]
    assert body["model"] == "claude-sonnet-4-20250514"
    assert body["max_tokens"] == 1000
    # system goes in the top-level field, NOT in messages array
    assert body["system"] == "Custom system"
    roles = [m["role"] for m in body["messages"]]
    assert roles == ["user", "assistant"]
    assert all(m["role"] != "system" for m in body["messages"])


@pytest.mark.asyncio
async def test_anthropic_provider_default_system_prompt(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"content": [{"text": "ok"}]})

    _patch_httpx(monkeypatch, handler)

    provider = AnthropicProvider(api_key="ak-test")
    await provider.generate_response([_msg("hi", Sender.VISITOR)])
    assert captured["body"]["system"] == "You are a helpful customer support assistant."


@pytest.mark.asyncio
async def test_anthropic_is_available_with_key():
    provider = AnthropicProvider(api_key="ak-test")
    assert await provider.is_available() is True
    empty = AnthropicProvider(api_key="")
    assert await empty.is_available() is False


@pytest.mark.asyncio
async def test_gemini_provider_builds_request_and_parses_response(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": "Hello from Gemini"}]}}]},
        )

    _patch_httpx(monkeypatch, handler)

    provider = GeminiProvider(api_key="gk-test", model="gemini-1.5-flash")
    messages = [_msg("Hi", Sender.VISITOR), _msg("Hello", Sender.OPERATOR)]
    result = await provider.generate_response(messages, "Be nice")

    assert result == "Hello from Gemini"
    assert "models/gemini-1.5-flash:generateContent" in captured["url"]
    assert "key=gk-test" in captured["url"]
    body = captured["body"]
    roles = [c["role"] for c in body["contents"]]
    assert roles == ["user", "model"]
    assert body["generationConfig"]["maxOutputTokens"] == 1000
    # system prompt prepended to first user message
    assert body["contents"][0]["parts"][0]["text"].startswith("Be nice\n\nUser: Hi")


# ─────────────────────────────────────────────────────────────────
# Fallback wiring tests (fake provider)
# ─────────────────────────────────────────────────────────────────


async def _connect(pp: PocketPing) -> str:
    resp = await pp.handle_connect(ConnectRequest(visitor_id="v1"))
    return resp.session_id


@pytest.mark.asyncio
async def test_fallback_triggers_when_operator_offline():
    storage = MemoryStorage()
    provider = FakeProvider(reply="AI says hi")
    pp = PocketPing(storage=storage, ai_provider=provider, ai_takeover_delay=0)
    pp.set_operator_online(False)

    session_id = await _connect(pp)
    await pp.handle_message(
        SendMessageRequest(session_id=session_id, content="Hello?", sender=Sender.VISITOR)
    )

    messages = await storage.get_messages(session_id)
    ai_messages = [m for m in messages if m.sender == Sender.AI]
    assert len(ai_messages) == 1
    assert ai_messages[0].content == "AI says hi"

    session = await storage.get_session(session_id)
    assert session.ai_active is True
    assert len(provider.calls) == 1


@pytest.mark.asyncio
async def test_no_fallback_when_operator_online():
    storage = MemoryStorage()
    provider = FakeProvider(reply="AI says hi")
    pp = PocketPing(storage=storage, ai_provider=provider, ai_takeover_delay=0)
    pp.set_operator_online(True)

    session_id = await _connect(pp)
    await pp.handle_message(
        SendMessageRequest(session_id=session_id, content="Hello?", sender=Sender.VISITOR)
    )

    messages = await storage.get_messages(session_id)
    ai_messages = [m for m in messages if m.sender == Sender.AI]
    assert ai_messages == []
    assert provider.calls == []


@pytest.mark.asyncio
async def test_no_fallback_without_provider():
    storage = MemoryStorage()
    pp = PocketPing(storage=storage, ai_takeover_delay=0)
    pp.set_operator_online(False)

    session_id = await _connect(pp)
    await pp.handle_message(
        SendMessageRequest(session_id=session_id, content="Hello?", sender=Sender.VISITOR)
    )

    messages = await storage.get_messages(session_id)
    assert [m for m in messages if m.sender == Sender.AI] == []


@pytest.mark.asyncio
async def test_no_fallback_when_takeover_not_due():
    storage = MemoryStorage()
    provider = FakeProvider()
    # 300s delay; operator just acted, so takeover is not due yet.
    pp = PocketPing(storage=storage, ai_provider=provider, ai_takeover_delay=300)
    pp.set_operator_online(False)

    session_id = await _connect(pp)
    # Operator message records recent activity for the session.
    await pp.handle_message(
        SendMessageRequest(session_id=session_id, content="hi", sender=Sender.OPERATOR)
    )
    await pp.handle_message(
        SendMessageRequest(session_id=session_id, content="follow up", sender=Sender.VISITOR)
    )

    messages = await storage.get_messages(session_id)
    assert [m for m in messages if m.sender == Sender.AI] == []
    assert provider.calls == []


@pytest.mark.asyncio
async def test_operator_message_disables_ai():
    storage = MemoryStorage()
    provider = FakeProvider(reply="AI says hi")
    pp = PocketPing(storage=storage, ai_provider=provider, ai_takeover_delay=0)
    pp.set_operator_online(False)

    session_id = await _connect(pp)
    await pp.handle_message(
        SendMessageRequest(session_id=session_id, content="Hello?", sender=Sender.VISITOR)
    )
    session = await storage.get_session(session_id)
    assert session.ai_active is True

    # Operator replies -> AI disabled.
    await pp.handle_message(
        SendMessageRequest(session_id=session_id, content="I'm here now", sender=Sender.OPERATOR)
    )
    session = await storage.get_session(session_id)
    assert session.ai_active is False


@pytest.mark.asyncio
async def test_provider_error_handled_gracefully():
    storage = MemoryStorage()
    provider = FakeProvider(raise_error=True)
    pp = PocketPing(storage=storage, ai_provider=provider, ai_takeover_delay=0)
    pp.set_operator_online(False)

    session_id = await _connect(pp)
    # Should not raise.
    await pp.handle_message(
        SendMessageRequest(session_id=session_id, content="Hello?", sender=Sender.VISITOR)
    )

    messages = await storage.get_messages(session_id)
    assert [m for m in messages if m.sender == Sender.AI] == []
    assert len(provider.calls) == 1


@pytest.mark.asyncio
async def test_empty_reply_creates_no_message():
    storage = MemoryStorage()
    provider = FakeProvider(reply="")
    pp = PocketPing(storage=storage, ai_provider=provider, ai_takeover_delay=0)
    pp.set_operator_online(False)

    session_id = await _connect(pp)
    await pp.handle_message(
        SendMessageRequest(session_id=session_id, content="Hello?", sender=Sender.VISITOR)
    )

    messages = await storage.get_messages(session_id)
    assert [m for m in messages if m.sender == Sender.AI] == []


@pytest.mark.asyncio
async def test_fallback_notifies_bridges_via_operator_path():
    from unittest.mock import AsyncMock, MagicMock

    storage = MemoryStorage()
    provider = FakeProvider(reply="AI says hi")
    bridge = MagicMock()
    bridge.name = "test-bridge"
    bridge.init = AsyncMock()
    bridge.on_new_session = AsyncMock()
    bridge.on_visitor_message = AsyncMock()
    bridge.on_operator_message = AsyncMock()

    pp = PocketPing(storage=storage, ai_provider=provider, ai_takeover_delay=0, bridges=[bridge])
    pp.set_operator_online(False)

    session_id = await _connect(pp)
    await pp.handle_message(
        SendMessageRequest(session_id=session_id, content="Hello?", sender=Sender.VISITOR)
    )

    bridge.on_operator_message.assert_awaited_once()
    args = bridge.on_operator_message.await_args.args
    ai_message, _session, source_bridge, operator_name = args
    assert ai_message.sender == Sender.AI
    assert ai_message.content == "AI says hi"
    assert source_bridge == "ai"
    assert operator_name == "AI"

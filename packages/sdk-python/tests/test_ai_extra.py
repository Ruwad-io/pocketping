"""Extra AI provider coverage: is_available branches and empty-response paths."""

import httpx
import pytest

from pocketping.ai import AnthropicProvider, GeminiProvider, OpenAIProvider
from pocketping.models import Message, Sender


def _msg(content: str, sender: Sender = Sender.VISITOR) -> Message:
    return Message(id="m", session_id="s", content=content, sender=sender)


def _patch_httpx(monkeypatch, handler):
    original_init = httpx.AsyncClient.__init__

    def patched_init(self, *args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)


# ─────────────────────────────────────────────────────────────────
# OpenAI
# ─────────────────────────────────────────────────────────────────


class TestOpenAIExtra:
    @pytest.mark.asyncio
    async def test_empty_choices_returns_empty_string(self, monkeypatch):
        _patch_httpx(monkeypatch, lambda req: httpx.Response(200, json={"choices": []}))
        provider = OpenAIProvider(api_key="sk")
        assert await provider.generate_response([_msg("hi")]) == ""

    @pytest.mark.asyncio
    async def test_missing_content_returns_empty(self, monkeypatch):
        _patch_httpx(monkeypatch, lambda req: httpx.Response(200, json={"choices": [{"message": {}}]}))
        provider = OpenAIProvider(api_key="sk")
        assert await provider.generate_response([_msg("hi")]) == ""

    @pytest.mark.asyncio
    async def test_is_available_true(self, monkeypatch):
        _patch_httpx(monkeypatch, lambda req: httpx.Response(200, json={"data": []}))
        provider = OpenAIProvider(api_key="sk")
        assert await provider.is_available() is True

    @pytest.mark.asyncio
    async def test_is_available_false_on_error_status(self, monkeypatch):
        _patch_httpx(monkeypatch, lambda req: httpx.Response(401, json={}))
        provider = OpenAIProvider(api_key="sk")
        assert await provider.is_available() is False

    @pytest.mark.asyncio
    async def test_is_available_false_on_exception(self, monkeypatch):
        def boom(req):
            raise httpx.ConnectError("down")

        _patch_httpx(monkeypatch, boom)
        provider = OpenAIProvider(api_key="sk")
        assert await provider.is_available() is False

    def test_name(self):
        assert OpenAIProvider(api_key="sk").name == "openai"


# ─────────────────────────────────────────────────────────────────
# Gemini
# ─────────────────────────────────────────────────────────────────


class TestGeminiExtra:
    @pytest.mark.asyncio
    async def test_empty_candidates(self, monkeypatch):
        _patch_httpx(monkeypatch, lambda req: httpx.Response(200, json={"candidates": []}))
        provider = GeminiProvider(api_key="gk")
        assert await provider.generate_response([_msg("hi")]) == ""

    @pytest.mark.asyncio
    async def test_empty_parts(self, monkeypatch):
        _patch_httpx(
            monkeypatch,
            lambda req: httpx.Response(200, json={"candidates": [{"content": {"parts": []}}]}),
        )
        provider = GeminiProvider(api_key="gk")
        assert await provider.generate_response([_msg("hi")]) == ""

    @pytest.mark.asyncio
    async def test_no_system_prompt_no_prepend(self, monkeypatch):
        captured = {}

        def handler(req):
            import json

            captured["body"] = json.loads(req.content)
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "ok"}]}}]})

        _patch_httpx(monkeypatch, handler)
        provider = GeminiProvider(api_key="gk")
        await provider.generate_response([_msg("plain")])
        assert captured["body"]["contents"][0]["parts"][0]["text"] == "plain"

    @pytest.mark.asyncio
    async def test_is_available_true(self, monkeypatch):
        _patch_httpx(monkeypatch, lambda req: httpx.Response(200, json={}))
        assert await GeminiProvider(api_key="gk").is_available() is True

    @pytest.mark.asyncio
    async def test_is_available_false_on_exception(self, monkeypatch):
        def boom(req):
            raise httpx.ConnectError("down")

        _patch_httpx(monkeypatch, boom)
        assert await GeminiProvider(api_key="gk").is_available() is False

    def test_name(self):
        assert GeminiProvider(api_key="gk").name == "gemini"


# ─────────────────────────────────────────────────────────────────
# Anthropic
# ─────────────────────────────────────────────────────────────────


class TestAnthropicExtra:
    @pytest.mark.asyncio
    async def test_empty_content(self, monkeypatch):
        _patch_httpx(monkeypatch, lambda req: httpx.Response(200, json={"content": []}))
        provider = AnthropicProvider(api_key="ak")
        assert await provider.generate_response([_msg("hi")]) == ""

    @pytest.mark.asyncio
    async def test_missing_text(self, monkeypatch):
        _patch_httpx(monkeypatch, lambda req: httpx.Response(200, json={"content": [{}]}))
        provider = AnthropicProvider(api_key="ak")
        assert await provider.generate_response([_msg("hi")]) == ""

    def test_custom_base_url_stripped(self):
        provider = AnthropicProvider(api_key="ak", base_url="https://proxy/v1/")
        assert provider.base_url == "https://proxy/v1"

    def test_name(self):
        assert AnthropicProvider(api_key="ak").name == "anthropic"

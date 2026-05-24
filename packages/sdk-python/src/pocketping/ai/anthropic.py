"""Anthropic Claude provider for AI fallback."""

from typing import Optional

import httpx

from pocketping.ai.base import AIProvider
from pocketping.models import Message, Sender

DEFAULT_BASE_URL = "https://api.anthropic.com/v1"
DEFAULT_SYSTEM_PROMPT = "You are a helpful customer support assistant."


class AnthropicProvider(AIProvider):
    """Anthropic Claude provider (raw HTTP via httpx)."""

    def __init__(
        self,
        api_key: str,
        model: str = "claude-sonnet-4-20250514",
        base_url: Optional[str] = None,
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")

    @property
    def name(self) -> str:
        return "anthropic"

    async def generate_response(self, messages: list[Message], system_prompt: str | None = None) -> str:
        anthropic_messages: list[dict[str, str]] = []

        for msg in messages:
            role = "user" if msg.sender == Sender.VISITOR else "assistant"
            anthropic_messages.append({"role": role, "content": msg.content})

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.base_url}/messages",
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": self.model,
                    "max_tokens": 1000,
                    "system": system_prompt or DEFAULT_SYSTEM_PROMPT,
                    "messages": anthropic_messages,
                },
            )
            response.raise_for_status()
            data = response.json()

        content = data.get("content") or []
        if not content:
            return ""
        return content[0].get("text") or ""

    async def is_available(self) -> bool:
        # Anthropic doesn't have a simple health check endpoint;
        # assume available if an API key is set.
        return bool(self.api_key)

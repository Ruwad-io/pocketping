"""OpenAI provider for AI fallback."""

from typing import Optional

import httpx

from pocketping.ai.base import AIProvider
from pocketping.models import Message, Sender

DEFAULT_BASE_URL = "https://api.openai.com/v1"


class OpenAIProvider(AIProvider):
    """OpenAI GPT provider (raw HTTP via httpx)."""

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o-mini",
        base_url: Optional[str] = None,
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")

    @property
    def name(self) -> str:
        return "openai"

    async def generate_response(self, messages: list[Message], system_prompt: str | None = None) -> str:
        openai_messages: list[dict[str, str]] = []

        if system_prompt:
            openai_messages.append({"role": "system", "content": system_prompt})

        for msg in messages:
            role = "user" if msg.sender == Sender.VISITOR else "assistant"
            openai_messages.append({"role": role, "content": msg.content})

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}",
                },
                json={
                    "model": self.model,
                    "messages": openai_messages,
                    "max_tokens": 1000,
                    "temperature": 0.7,
                },
            )
            response.raise_for_status()
            data = response.json()

        choices = data.get("choices") or []
        if not choices:
            return ""
        return (choices[0].get("message") or {}).get("content") or ""

    async def is_available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{self.base_url}/models",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                return response.is_success
        except Exception:
            return False

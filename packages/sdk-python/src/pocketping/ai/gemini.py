"""Google Gemini provider for AI fallback."""

from typing import Optional

import httpx

from pocketping.ai.base import AIProvider
from pocketping.models import Message, Sender

DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


class GeminiProvider(AIProvider):
    """Google Gemini provider (raw HTTP via httpx)."""

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-1.5-flash",
        base_url: Optional[str] = None,
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")

    @property
    def name(self) -> str:
        return "gemini"

    async def generate_response(self, messages: list[Message], system_prompt: str | None = None) -> str:
        contents: list[dict] = []

        for msg in messages:
            role = "user" if msg.sender == Sender.VISITOR else "model"
            contents.append({"role": role, "parts": [{"text": msg.content}]})

        # Prepend system prompt to first user message if provided.
        if system_prompt and contents and contents[0]["role"] == "user":
            first_text = contents[0]["parts"][0]["text"]
            contents[0]["parts"][0]["text"] = f"{system_prompt}\n\nUser: {first_text}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key}",
                headers={"Content-Type": "application/json"},
                json={
                    "contents": contents,
                    "generationConfig": {
                        "maxOutputTokens": 1000,
                        "temperature": 0.7,
                    },
                },
            )
            response.raise_for_status()
            data = response.json()

        candidates = data.get("candidates") or []
        if not candidates:
            return ""
        parts = ((candidates[0].get("content") or {}).get("parts")) or []
        if not parts:
            return ""
        return parts[0].get("text") or ""

    async def is_available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(f"{self.base_url}/models?key={self.api_key}")
                return response.is_success
        except Exception:
            return False

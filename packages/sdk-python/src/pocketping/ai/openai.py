"""OpenAI provider for AI fallback."""

from typing import Optional

from pocketping.ai.base import AIProvider
from pocketping.models import Message, Sender


class OpenAIProvider(AIProvider):
    """OpenAI GPT provider."""

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o-mini",
        base_url: Optional[str] = None,
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url
        self._client = None

    @property
    def name(self) -> str:
        return "openai"

    def _get_client(self):
        if self._client is None:
            try:
                from openai import AsyncOpenAI
            except ImportError:
                raise ImportError("openai package required. Install with: pip install pocketping[ai]")
            self._client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
        return self._client

    async def generate_response(self, messages: list[Message], system_prompt: str | None = None) -> str:
        client = self._get_client()

        # Convert messages to OpenAI format
        openai_messages = []

        if system_prompt:
            openai_messages.append({"role": "system", "content": system_prompt})

        for msg in messages:
            role = "user" if msg.sender == Sender.VISITOR else "assistant"
            openai_messages.append({"role": role, "content": msg.content})

        response = await client.chat.completions.create(
            model=self.model,
            messages=openai_messages,
            max_tokens=1000,
            temperature=0.7,
        )

        return response.choices[0].message.content or ""

    async def is_available(self) -> bool:
        try:
            client = self._get_client()
            # Simple test - list models
            await client.models.list()
            return True
        except Exception:
            return False

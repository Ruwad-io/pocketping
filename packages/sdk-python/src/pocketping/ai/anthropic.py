"""Anthropic Claude provider for AI fallback."""

from pocketping.ai.base import AIProvider
from pocketping.models import Message, Sender


class AnthropicProvider(AIProvider):
    """Anthropic Claude provider."""

    def __init__(
        self,
        api_key: str,
        model: str = "claude-sonnet-4-20250514",
    ):
        self.api_key = api_key
        self.model = model
        self._client = None

    @property
    def name(self) -> str:
        return "anthropic"

    def _get_client(self):
        if self._client is None:
            try:
                from anthropic import AsyncAnthropic
            except ImportError:
                raise ImportError("anthropic package required. Install with: pip install pocketping[ai]")
            self._client = AsyncAnthropic(api_key=self.api_key)
        return self._client

    async def generate_response(self, messages: list[Message], system_prompt: str | None = None) -> str:
        client = self._get_client()

        # Convert messages to Anthropic format
        anthropic_messages = []

        for msg in messages:
            role = "user" if msg.sender == Sender.VISITOR else "assistant"
            anthropic_messages.append({"role": role, "content": msg.content})

        response = await client.messages.create(
            model=self.model,
            max_tokens=1000,
            system=system_prompt or "You are a helpful customer support assistant.",
            messages=anthropic_messages,
        )

        return response.content[0].text

    async def is_available(self) -> bool:
        try:
            self._get_client()
            return True
        except Exception:
            return False

"""Base AI provider interface."""

from abc import ABC, abstractmethod

from pocketping.models import Message


class AIProvider(ABC):
    """Abstract base class for AI providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name."""
        pass

    @abstractmethod
    async def generate_response(self, messages: list[Message], system_prompt: str | None = None) -> str:
        """Generate a response to the conversation."""
        pass

    async def is_available(self) -> bool:
        """Check if the provider is available."""
        return True

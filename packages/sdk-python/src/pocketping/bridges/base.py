"""Base bridge classes."""

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from pocketping.core import PocketPing
    from pocketping.models import Message, Session


class Bridge(ABC):
    """Abstract base class for notification bridges."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique name for this bridge."""
        pass

    async def init(self, pocketping: "PocketPing") -> None:
        """Called when the bridge is added to PocketPing."""
        pass

    async def on_new_session(self, session: "Session") -> None:
        """Called when a new chat session is created."""
        pass

    async def on_message(self, message: "Message", session: "Session") -> None:
        """Called when a visitor sends a message."""
        pass

    async def on_typing(self, session_id: str, is_typing: bool) -> None:
        """Called when visitor starts/stops typing."""
        pass

    async def on_ai_takeover(self, session: "Session", reason: str) -> None:
        """Called when AI takes over a conversation."""
        pass

    async def on_operator_message(
        self,
        message: "Message",
        session: "Session",
        source_bridge: str,
        operator_name: str | None = None,
    ) -> None:
        """Called when an operator sends a message (from any bridge).

        This enables cross-bridge synchronization - when someone responds
        on Telegram, Discord and Slack can show that response too.

        Args:
            message: The operator's message
            session: The session this message belongs to
            source_bridge: Name of the bridge that originated the message
            operator_name: Optional name of the operator who sent the message
        """
        pass

    async def destroy(self) -> None:
        """Cleanup when bridge is removed."""
        pass


class CompositeBridge(Bridge):
    """A bridge that forwards events to multiple bridges."""

    def __init__(self, bridges: list[Bridge]):
        self._bridges = bridges

    @property
    def name(self) -> str:
        return "composite"

    async def init(self, pocketping: "PocketPing") -> None:
        for bridge in self._bridges:
            await bridge.init(pocketping)

    async def on_new_session(self, session: "Session") -> None:
        for bridge in self._bridges:
            try:
                await bridge.on_new_session(session)
            except Exception as e:
                print(f"[PocketPing] Bridge {bridge.name} error: {e}")

    async def on_message(self, message: "Message", session: "Session") -> None:
        for bridge in self._bridges:
            try:
                await bridge.on_message(message, session)
            except Exception as e:
                print(f"[PocketPing] Bridge {bridge.name} error: {e}")

    async def on_typing(self, session_id: str, is_typing: bool) -> None:
        for bridge in self._bridges:
            try:
                await bridge.on_typing(session_id, is_typing)
            except Exception as e:
                print(f"[PocketPing] Bridge {bridge.name} error: {e}")

    async def on_ai_takeover(self, session: "Session", reason: str) -> None:
        for bridge in self._bridges:
            try:
                await bridge.on_ai_takeover(session, reason)
            except Exception as e:
                print(f"[PocketPing] Bridge {bridge.name} error: {e}")

    async def on_operator_message(
        self,
        message: "Message",
        session: "Session",
        source_bridge: str,
        operator_name: str | None = None,
    ) -> None:
        for bridge in self._bridges:
            try:
                await bridge.on_operator_message(message, session, source_bridge, operator_name)
            except Exception as e:
                print(f"[PocketPing] Bridge {bridge.name} error: {e}")

    async def destroy(self) -> None:
        for bridge in self._bridges:
            await bridge.destroy()

    def add_bridge(self, bridge: Bridge) -> None:
        self._bridges.append(bridge)

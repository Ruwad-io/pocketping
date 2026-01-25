"""Storage adapters for PocketPing."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from pocketping.models import Message, Session


@dataclass
class BridgeMessageIds:
    """Bridge message IDs for edit/delete sync."""

    telegram_message_id: Optional[int] = None
    discord_message_id: Optional[str] = None
    slack_message_ts: Optional[str] = None


class Storage(ABC):
    """Abstract base class for storage adapters."""

    @abstractmethod
    async def create_session(self, session: Session) -> None:
        """Create a new session."""
        pass

    @abstractmethod
    async def get_session(self, session_id: str) -> Optional[Session]:
        """Get a session by ID."""
        pass

    @abstractmethod
    async def update_session(self, session: Session) -> None:
        """Update an existing session."""
        pass

    @abstractmethod
    async def delete_session(self, session_id: str) -> None:
        """Delete a session."""
        pass

    @abstractmethod
    async def save_message(self, message: Message) -> None:
        """Save a message."""
        pass

    @abstractmethod
    async def get_messages(self, session_id: str, after: Optional[str] = None, limit: int = 50) -> list[Message]:
        """Get messages for a session."""
        pass

    @abstractmethod
    async def get_message(self, message_id: str) -> Optional[Message]:
        """Get a message by ID."""
        pass

    async def update_message(self, message: Message) -> None:
        """Update an existing message (for edit/delete). Optional to implement."""
        await self.save_message(message)

    async def save_bridge_message_ids(self, message_id: str, bridge_ids: BridgeMessageIds) -> None:
        """Save bridge message IDs for a message. Optional to implement."""
        pass

    async def get_bridge_message_ids(self, message_id: str) -> Optional[BridgeMessageIds]:
        """Get bridge message IDs for a message. Optional to implement."""
        return None

    async def cleanup_old_sessions(self, older_than: datetime) -> int:
        """Clean up old sessions. Optional to implement."""
        return 0

    async def get_session_by_visitor_id(self, visitor_id: str) -> Optional[Session]:
        """Get the most recent session for a visitor. Optional to implement."""
        return None


class MemoryStorage(Storage):
    """In-memory storage adapter. Useful for development and testing."""

    def __init__(self):
        self._sessions: dict[str, Session] = {}
        self._messages: dict[str, list[Message]] = {}
        self._message_by_id: dict[str, Message] = {}
        self._bridge_message_ids: dict[str, BridgeMessageIds] = {}

    async def create_session(self, session: Session) -> None:
        self._sessions[session.id] = session
        self._messages[session.id] = []

    async def get_session(self, session_id: str) -> Optional[Session]:
        return self._sessions.get(session_id)

    async def update_session(self, session: Session) -> None:
        self._sessions[session.id] = session

    async def delete_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        self._messages.pop(session_id, None)

    async def save_message(self, message: Message) -> None:
        if message.session_id not in self._messages:
            self._messages[message.session_id] = []
        self._messages[message.session_id].append(message)
        self._message_by_id[message.id] = message

    async def get_messages(self, session_id: str, after: Optional[str] = None, limit: int = 50) -> list[Message]:
        messages = self._messages.get(session_id, [])

        if after:
            start_index = 0
            for i, msg in enumerate(messages):
                if msg.id == after:
                    start_index = i + 1
                    break
            messages = messages[start_index:]

        return messages[:limit]

    async def get_message(self, message_id: str) -> Optional[Message]:
        return self._message_by_id.get(message_id)

    async def update_message(self, message: Message) -> None:
        self._message_by_id[message.id] = message
        # Also update in the session's messages array
        if message.session_id in self._messages:
            for i, m in enumerate(self._messages[message.session_id]):
                if m.id == message.id:
                    self._messages[message.session_id][i] = message
                    break

    async def save_bridge_message_ids(self, message_id: str, bridge_ids: BridgeMessageIds) -> None:
        existing = self._bridge_message_ids.get(message_id)
        if existing:
            # Merge with existing
            if bridge_ids.telegram_message_id is not None:
                existing.telegram_message_id = bridge_ids.telegram_message_id
            if bridge_ids.discord_message_id is not None:
                existing.discord_message_id = bridge_ids.discord_message_id
            if bridge_ids.slack_message_ts is not None:
                existing.slack_message_ts = bridge_ids.slack_message_ts
        else:
            self._bridge_message_ids[message_id] = bridge_ids

    async def get_bridge_message_ids(self, message_id: str) -> Optional[BridgeMessageIds]:
        return self._bridge_message_ids.get(message_id)

    async def cleanup_old_sessions(self, older_than: datetime) -> int:
        count = 0
        to_delete = []
        for session_id, session in self._sessions.items():
            if session.last_activity < older_than:
                to_delete.append(session_id)
                count += 1

        for session_id in to_delete:
            await self.delete_session(session_id)

        return count

    async def get_all_sessions(self) -> list[Session]:
        """Get all sessions. Useful for admin/debug."""
        return list(self._sessions.values())

    async def get_session_count(self) -> int:
        """Get total session count."""
        return len(self._sessions)

    async def get_session_by_visitor_id(self, visitor_id: str) -> Optional[Session]:
        """Get the most recent session for a visitor."""
        visitor_sessions = [s for s in self._sessions.values() if s.visitor_id == visitor_id]
        if not visitor_sessions:
            return None
        # Return most recent by last_activity
        return max(visitor_sessions, key=lambda s: s.last_activity)

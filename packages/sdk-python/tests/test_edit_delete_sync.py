"""Integration tests for edit/delete bridge sync.

These tests exercise a REAL Bridge subclass through the full
handle_message -> handle_edit_message / handle_delete_message flow.

Regression guard: a previous bug called bridge.on_message_edit with the
wrong signature (message_id, content, bridge_id) instead of
(message, session, platform_message_id), and never persisted the platform
message IDs returned by on_visitor_message. Both made edit/delete sync a
silent no-op that the mock-based bridge tests did not catch.
"""

from datetime import datetime, timezone

import pytest

from pocketping import PocketPing
from pocketping.bridges import Bridge
from pocketping.models import (
    BridgeMessageResult,
    DeleteMessageRequest,
    EditMessageRequest,
    Message,
    Sender,
    SendMessageRequest,
    Session,
    SessionMetadata,
)
from pocketping.storage import MemoryStorage

PLATFORM_MESSAGE_ID = 999


class RecordingTelegramBridge(Bridge):
    """A real bridge (telegram) that records the calls it receives."""

    def __init__(self) -> None:
        self.edit_calls: list[tuple[Message, Session, object]] = []
        self.delete_calls: list[tuple[Message, Session, object]] = []

    @property
    def name(self) -> str:
        return "telegram"

    async def on_visitor_message(self, message, session):
        return BridgeMessageResult(message_id=PLATFORM_MESSAGE_ID)

    async def on_message_edit(self, message, session, platform_message_id=None):
        # If core passed the wrong types, accessing .content / .visitor_id raises.
        assert isinstance(message, Message)
        assert isinstance(session, Session)
        _ = message.content
        _ = session.visitor_id
        self.edit_calls.append((message, session, platform_message_id))

    async def on_message_delete(self, message, session, platform_message_id=None):
        assert isinstance(message, Message)
        assert isinstance(session, Session)
        self.delete_calls.append((message, session, platform_message_id))


@pytest.fixture
def session() -> Session:
    now = datetime.now(timezone.utc)
    return Session(
        id="sess-sync-1",
        visitor_id="vis-sync-1",
        created_at=now,
        last_activity=now,
        operator_online=False,
        ai_active=False,
        metadata=SessionMetadata(url="https://example.com"),
    )


@pytest.mark.asyncio
async def test_visitor_message_persists_bridge_ids(session):
    bridge = RecordingTelegramBridge()
    storage = MemoryStorage()
    pp = PocketPing(storage=storage, bridges=[bridge])
    await storage.create_session(session)

    resp = await pp.handle_message(
        SendMessageRequest(session_id=session.id, content="hi", sender=Sender.VISITOR)
    )

    ids = await storage.get_bridge_message_ids(resp.message_id)
    assert ids is not None
    assert ids.telegram_message_id == PLATFORM_MESSAGE_ID


@pytest.mark.asyncio
async def test_edit_syncs_to_bridge_with_correct_signature(session):
    bridge = RecordingTelegramBridge()
    storage = MemoryStorage()
    pp = PocketPing(storage=storage, bridges=[bridge])
    await storage.create_session(session)

    resp = await pp.handle_message(
        SendMessageRequest(session_id=session.id, content="hi", sender=Sender.VISITOR)
    )
    await pp.handle_edit_message(
        EditMessageRequest(session_id=session.id, message_id=resp.message_id, content="edited!")
    )

    assert len(bridge.edit_calls) == 1
    msg, sess, platform_id = bridge.edit_calls[0]
    assert msg.content == "edited!"
    assert sess.id == session.id
    assert platform_id == PLATFORM_MESSAGE_ID


@pytest.mark.asyncio
async def test_delete_syncs_to_bridge_with_correct_signature(session):
    bridge = RecordingTelegramBridge()
    storage = MemoryStorage()
    pp = PocketPing(storage=storage, bridges=[bridge])
    await storage.create_session(session)

    resp = await pp.handle_message(
        SendMessageRequest(session_id=session.id, content="hi", sender=Sender.VISITOR)
    )
    await pp.handle_delete_message(
        DeleteMessageRequest(session_id=session.id, message_id=resp.message_id)
    )

    assert len(bridge.delete_calls) == 1
    msg, sess, platform_id = bridge.delete_calls[0]
    assert sess.id == session.id
    assert platform_id == PLATFORM_MESSAGE_ID

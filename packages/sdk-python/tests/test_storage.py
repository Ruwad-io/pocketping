"""Tests for storage adapters: MemoryStorage edges and Storage base defaults."""

from datetime import datetime, timedelta, timezone
from typing import Optional

import pytest

from pocketping.models import (
    Attachment,
    AttachmentStatus,
    Message,
    MessageStatus,
    Sender,
    Session,
    SessionMetadata,
)
from pocketping.storage import BridgeMessageIds, MemoryStorage, Storage


def _session(sid: str, visitor: str = "v", last_activity: Optional[datetime] = None) -> Session:
    now = datetime.now(timezone.utc)
    return Session(
        id=sid,
        visitor_id=visitor,
        created_at=now,
        last_activity=last_activity or now,
        metadata=SessionMetadata(url="https://x.com"),
    )


def _message(mid: str, sid: str) -> Message:
    return Message(
        id=mid,
        session_id=sid,
        content="hi",
        sender=Sender.VISITOR,
        timestamp=datetime.now(timezone.utc),
        status=MessageStatus.SENT,
    )


def _attachment(aid: str, message_id: Optional[str] = None) -> Attachment:
    return Attachment(
        id=aid,
        message_id=message_id,
        filename="f.png",
        mime_type="image/png",
        size=10,
        url="https://x.com/f.png",
        status=AttachmentStatus.READY,
        created_at=datetime.now(timezone.utc),
    )


# ─────────────────────────────────────────────────────────────────
# MemoryStorage sessions
# ─────────────────────────────────────────────────────────────────


class TestMemoryStorageSessions:
    @pytest.mark.asyncio
    async def test_create_and_get_session(self):
        s = MemoryStorage()
        await s.create_session(_session("s1"))
        got = await s.get_session("s1")
        assert got is not None and got.id == "s1"

    @pytest.mark.asyncio
    async def test_get_missing_session_returns_none(self):
        assert await MemoryStorage().get_session("nope") is None

    @pytest.mark.asyncio
    async def test_update_session(self):
        s = MemoryStorage()
        await s.create_session(_session("s1"))
        sess = await s.get_session("s1")
        sess.operator_online = True
        await s.update_session(sess)
        assert (await s.get_session("s1")).operator_online is True

    @pytest.mark.asyncio
    async def test_delete_session_removes_messages(self):
        s = MemoryStorage()
        await s.create_session(_session("s1"))
        await s.save_message(_message("m1", "s1"))
        await s.delete_session("s1")
        assert await s.get_session("s1") is None
        assert await s.get_messages("s1") == []

    @pytest.mark.asyncio
    async def test_get_all_sessions_and_count(self):
        s = MemoryStorage()
        await s.create_session(_session("s1"))
        await s.create_session(_session("s2"))
        assert await s.get_session_count() == 2
        ids = {x.id for x in await s.get_all_sessions()}
        assert ids == {"s1", "s2"}

    @pytest.mark.asyncio
    async def test_get_session_by_visitor_id_returns_most_recent(self):
        s = MemoryStorage()
        old = _session("s1", "vX", last_activity=datetime.now(timezone.utc) - timedelta(days=1))
        new = _session("s2", "vX", last_activity=datetime.now(timezone.utc))
        await s.create_session(old)
        await s.create_session(new)
        result = await s.get_session_by_visitor_id("vX")
        assert result.id == "s2"

    @pytest.mark.asyncio
    async def test_get_session_by_visitor_id_none_when_missing(self):
        assert await MemoryStorage().get_session_by_visitor_id("ghost") is None

    @pytest.mark.asyncio
    async def test_cleanup_old_sessions(self):
        s = MemoryStorage()
        old = _session("old", last_activity=datetime.now(timezone.utc) - timedelta(days=10))
        fresh = _session("fresh", last_activity=datetime.now(timezone.utc))
        await s.create_session(old)
        await s.create_session(fresh)
        cutoff = datetime.now(timezone.utc) - timedelta(days=1)
        removed = await s.cleanup_old_sessions(cutoff)
        assert removed == 1
        assert await s.get_session("old") is None
        assert await s.get_session("fresh") is not None


# ─────────────────────────────────────────────────────────────────
# MemoryStorage messages
# ─────────────────────────────────────────────────────────────────


class TestMemoryStorageMessages:
    @pytest.mark.asyncio
    async def test_save_message_to_unknown_session_creates_list(self):
        s = MemoryStorage()
        await s.save_message(_message("m1", "orphan"))
        assert len(await s.get_messages("orphan")) == 1

    @pytest.mark.asyncio
    async def test_get_messages_after_cursor(self):
        s = MemoryStorage()
        for i in range(5):
            await s.save_message(_message(f"m{i}", "s1"))
        result = await s.get_messages("s1", after="m1")
        assert [m.id for m in result] == ["m2", "m3", "m4"]

    @pytest.mark.asyncio
    async def test_get_messages_limit(self):
        s = MemoryStorage()
        for i in range(10):
            await s.save_message(_message(f"m{i}", "s1"))
        assert len(await s.get_messages("s1", limit=3)) == 3

    @pytest.mark.asyncio
    async def test_get_message_by_id(self):
        s = MemoryStorage()
        await s.save_message(_message("m1", "s1"))
        assert (await s.get_message("m1")).id == "m1"
        assert await s.get_message("nope") is None

    @pytest.mark.asyncio
    async def test_update_message_replaces_in_session(self):
        s = MemoryStorage()
        await s.save_message(_message("m1", "s1"))
        msg = await s.get_message("m1")
        msg.content = "edited"
        await s.update_message(msg)
        assert (await s.get_message("m1")).content == "edited"
        assert (await s.get_messages("s1"))[0].content == "edited"

    @pytest.mark.asyncio
    async def test_hydrate_attachments_on_get(self):
        s = MemoryStorage()
        await s.save_message(_message("m1", "s1"))
        await s.save_attachment(_attachment("a1", message_id="m1"))
        msg = await s.get_message("m1")
        assert msg.attachments and msg.attachments[0].id == "a1"


# ─────────────────────────────────────────────────────────────────
# Bridge message IDs + attachments
# ─────────────────────────────────────────────────────────────────


class TestMemoryStorageBridgeIdsAndAttachments:
    @pytest.mark.asyncio
    async def test_save_and_get_bridge_ids(self):
        s = MemoryStorage()
        await s.save_bridge_message_ids("m1", BridgeMessageIds(telegram_message_id=7))
        ids = await s.get_bridge_message_ids("m1")
        assert ids.telegram_message_id == 7

    @pytest.mark.asyncio
    async def test_bridge_ids_merge(self):
        s = MemoryStorage()
        await s.save_bridge_message_ids("m1", BridgeMessageIds(telegram_message_id=7))
        await s.save_bridge_message_ids("m1", BridgeMessageIds(discord_message_id="d", slack_message_ts="1.2"))
        ids = await s.get_bridge_message_ids("m1")
        assert ids.telegram_message_id == 7
        assert ids.discord_message_id == "d"
        assert ids.slack_message_ts == "1.2"

    @pytest.mark.asyncio
    async def test_bridge_ids_missing_returns_none(self):
        assert await MemoryStorage().get_bridge_message_ids("nope") is None

    @pytest.mark.asyncio
    async def test_save_get_update_attachment(self):
        s = MemoryStorage()
        await s.save_attachment(_attachment("a1", message_id="m1"))
        assert (await s.get_attachment("a1")).id == "a1"
        att = await s.get_attachment("a1")
        att.status = AttachmentStatus.FAILED
        await s.update_attachment(att)
        assert (await s.get_attachment("a1")).status == AttachmentStatus.FAILED

    @pytest.mark.asyncio
    async def test_get_message_attachments(self):
        s = MemoryStorage()
        await s.save_attachment(_attachment("a1", message_id="m1"))
        await s.save_attachment(_attachment("a2", message_id="m1"))
        await s.save_attachment(_attachment("a3", message_id="m2"))
        result = await s.get_message_attachments("m1")
        assert {a.id for a in result} == {"a1", "a2"}

    @pytest.mark.asyncio
    async def test_get_attachment_missing(self):
        assert await MemoryStorage().get_attachment("nope") is None


# ─────────────────────────────────────────────────────────────────
# Storage abstract base default implementations
# ─────────────────────────────────────────────────────────────────


class MinimalStorage(Storage):
    """Concrete subclass implementing only the abstract methods.

    Exercises the optional default implementations on the base class.
    """

    def __init__(self):
        self.saved: list[Message] = []

    async def create_session(self, session):
        pass

    async def get_session(self, session_id):
        return None

    async def update_session(self, session):
        pass

    async def delete_session(self, session_id):
        pass

    async def save_message(self, message):
        self.saved.append(message)

    async def get_messages(self, session_id, after=None, limit=50):
        return []

    async def get_message(self, message_id):
        return None


class TestStorageBaseDefaults:
    @pytest.mark.asyncio
    async def test_update_message_falls_back_to_save(self):
        s = MinimalStorage()
        msg = _message("m1", "s1")
        await s.update_message(msg)
        assert s.saved == [msg]

    @pytest.mark.asyncio
    async def test_optional_methods_have_safe_defaults(self):
        s = MinimalStorage()
        # save_* are no-ops; get_* return None/[].
        await s.save_bridge_message_ids("m1", BridgeMessageIds())
        assert await s.get_bridge_message_ids("m1") is None
        await s.save_attachment(_attachment("a1"))
        assert await s.get_attachment("a1") is None
        assert await s.get_message_attachments("m1") == []
        await s.update_attachment(_attachment("a1"))  # falls back to save_attachment
        assert await s.cleanup_old_sessions(datetime.now(timezone.utc)) == 0
        assert await s.get_session_by_visitor_id("v") is None

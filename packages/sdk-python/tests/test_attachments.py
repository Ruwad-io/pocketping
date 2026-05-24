"""Tests for the File Attachments feature (SDK_SPEC.md §14).

Covers the 8 required attachment scenarios:
1. Creates upload request with presigned URL
2. Marks attachment as ready after upload
3. Links attachments to a message
4. Returns attachments with a message
5. Rejects invalid MIME types
6. Rejects files over the size limit
7. Handles upload failure gracefully
8. Syncs attachments to bridges
"""

from datetime import datetime, timezone

import pytest

from pocketping import PocketPing
from pocketping.bridges import Bridge
from pocketping.core import MAX_ATTACHMENT_SIZE
from pocketping.models import (
    AttachmentStatus,
    Message,
    Sender,
    SendMessageRequest,
    Session,
    SessionMetadata,
    UploadRequest,
)
from pocketping.storage import MemoryStorage


@pytest.fixture
def session() -> Session:
    now = datetime.now(timezone.utc)
    return Session(
        id="sess-att-1",
        visitor_id="vis-att-1",
        created_at=now,
        last_activity=now,
        operator_online=False,
        ai_active=False,
        metadata=SessionMetadata(url="https://example.com"),
    )


@pytest.fixture
async def setup(session):
    """Return a (pocketping, storage, session) tuple with the session persisted."""
    storage = MemoryStorage()
    pp = PocketPing(storage=storage)
    await storage.create_session(session)
    return pp, storage, session


async def _make_pending_attachment(pp: PocketPing, session: Session, **overrides):
    """Helper: create an upload request and return the UploadResponse."""
    req = UploadRequest(
        session_id=session.id,
        filename=overrides.get("filename", "photo.png"),
        mime_type=overrides.get("mime_type", "image/png"),
        size=overrides.get("size", 1024),
    )
    return await pp.handle_upload_request(req)


# 1. Creates upload request with presigned URL
@pytest.mark.asyncio
async def test_creates_upload_request_with_presigned_url(setup):
    pp, storage, session = setup

    resp = await _make_pending_attachment(pp, session)

    assert resp.attachment_id
    # uploadUrl contains the attachmentId
    assert resp.attachment_id in resp.upload_url
    assert resp.upload_url == f"{pp.upload_base_url}/{resp.attachment_id}"
    # expiresAt is in the future
    assert resp.expires_at > datetime.now(timezone.utc)

    # The attachment is persisted as pending
    stored = await storage.get_attachment(resp.attachment_id)
    assert stored is not None
    assert stored.status == AttachmentStatus.PENDING
    assert stored.message_id is None


# 2. Marks attachment as ready after upload
@pytest.mark.asyncio
async def test_marks_attachment_ready_after_upload(setup):
    pp, storage, session = setup

    resp = await _make_pending_attachment(pp, session)
    attachment = await pp.handle_upload_complete(resp.attachment_id)

    assert attachment.status == AttachmentStatus.READY
    stored = await storage.get_attachment(resp.attachment_id)
    assert stored.status == AttachmentStatus.READY


# 3. Links attachments to a message
@pytest.mark.asyncio
async def test_links_attachments_to_message(setup):
    pp, storage, session = setup

    resp = await _make_pending_attachment(pp, session)
    await pp.handle_upload_complete(resp.attachment_id)

    msg_resp = await pp.handle_message(
        SendMessageRequest(
            session_id=session.id,
            content="Here is a file",
            sender=Sender.VISITOR,
            attachment_ids=[resp.attachment_id],
        )
    )

    stored = await storage.get_attachment(resp.attachment_id)
    assert stored.message_id == msg_resp.message_id


# 4. Returns attachments with a message
@pytest.mark.asyncio
async def test_returns_attachments_with_message(setup):
    pp, storage, session = setup

    resp = await _make_pending_attachment(pp, session)
    await pp.handle_upload_complete(resp.attachment_id)

    msg_resp = await pp.handle_message(
        SendMessageRequest(
            session_id=session.id,
            content="With attachment",
            sender=Sender.VISITOR,
            attachment_ids=[resp.attachment_id],
        )
    )

    # via get_messages
    messages = await storage.get_messages(session.id)
    target = next(m for m in messages if m.id == msg_resp.message_id)
    assert target.attachments is not None
    assert any(a.id == resp.attachment_id for a in target.attachments)

    # via handle_connect (returns messages with attachments populated)
    from pocketping.models import ConnectRequest

    connect = await pp.handle_connect(ConnectRequest(visitor_id=session.visitor_id, session_id=session.id))
    connected = next(m for m in connect.messages if m.id == msg_resp.message_id)
    assert connected.attachments is not None
    assert any(a.id == resp.attachment_id for a in connected.attachments)


# 5. Rejects invalid MIME types
@pytest.mark.asyncio
async def test_rejects_invalid_mime_types(setup):
    pp, storage, session = setup

    with pytest.raises(ValueError):
        await pp.handle_upload_request(
            UploadRequest(
                session_id=session.id,
                filename="evil.exe",
                mime_type="application/x-msdownload",
                size=1024,
            )
        )


# 6. Rejects files over the size limit
@pytest.mark.asyncio
async def test_rejects_files_over_size_limit(setup):
    pp, storage, session = setup

    with pytest.raises(ValueError):
        await pp.handle_upload_request(
            UploadRequest(
                session_id=session.id,
                filename="big.png",
                mime_type="image/png",
                size=MAX_ATTACHMENT_SIZE + 1,
            )
        )


# 6b. Rejects zero/negative size (boundary)
@pytest.mark.asyncio
async def test_rejects_zero_size(setup):
    pp, storage, session = setup

    with pytest.raises(ValueError):
        await pp.handle_upload_request(
            UploadRequest(
                session_id=session.id,
                filename="empty.png",
                mime_type="image/png",
                size=0,
            )
        )


# Upload request fails when session is unknown
@pytest.mark.asyncio
async def test_upload_request_unknown_session(setup):
    pp, storage, session = setup

    with pytest.raises(ValueError):
        await pp.handle_upload_request(
            UploadRequest(
                session_id="does-not-exist",
                filename="photo.png",
                mime_type="image/png",
                size=1024,
            )
        )


# 7. Handles upload failure gracefully
@pytest.mark.asyncio
async def test_handles_upload_failure_gracefully(setup):
    pp, storage, session = setup

    resp = await _make_pending_attachment(pp, session)
    failed = await pp.handle_upload_failed(resp.attachment_id)
    assert failed.status == AttachmentStatus.FAILED

    # get_attachment of an unknown id returns None without crashing
    assert await storage.get_attachment("unknown-id") is None


# 8. Syncs attachments to bridges
@pytest.mark.asyncio
async def test_syncs_attachments_to_bridges(setup):
    pp, storage, session = setup

    class RecordingBridge(Bridge):
        def __init__(self) -> None:
            self.visitor_messages: list[Message] = []

        @property
        def name(self) -> str:
            return "telegram"

        async def on_visitor_message(self, message, session):
            self.visitor_messages.append(message)
            return None

    bridge = RecordingBridge()
    pp.bridges = [bridge]

    resp = await _make_pending_attachment(pp, session, filename="report.pdf", mime_type="application/pdf")
    await pp.handle_upload_complete(resp.attachment_id)

    await pp.handle_message(
        SendMessageRequest(
            session_id=session.id,
            content="See attached report",
            sender=Sender.VISITOR,
            attachment_ids=[resp.attachment_id],
        )
    )

    assert len(bridge.visitor_messages) == 1
    received = bridge.visitor_messages[0]
    assert received.attachments is not None
    assert any(a.id == resp.attachment_id for a in received.attachments)

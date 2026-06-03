"""Tests for CSAT ratings and SDK stats."""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from pocketping import PocketPing
from pocketping.bridges import Bridge
from pocketping.models import ConnectRequest, CsatRequest, Message, Sender, SendMessageRequest, Session, SessionCsat
from pocketping.stats import compute_stats
from pocketping.storage import Storage


class NotifyBridge(Bridge):
    """A bridge that records notify_disconnect captions."""

    def __init__(self):
        self.disconnect_calls: list[tuple[Session, str]] = []

    @property
    def name(self) -> str:
        return "telegram"

    async def on_visitor_message(self, message, session):
        return None

    async def notify_disconnect(self, session: Session, message: str) -> None:
        self.disconnect_calls.append((session, message))


async def _new_session(pp: PocketPing, visitor_id: str = "v1") -> str:
    response = await pp.handle_connect(ConnectRequest(visitor_id=visitor_id))
    return response.session_id


class TestCsat:
    @pytest.fixture
    def bridge(self):
        return NotifyBridge()

    @pytest.fixture
    def pp(self, bridge):
        return PocketPing(bridges=[bridge])

    @pytest.mark.asyncio
    async def test_request_csat_sets_pending_and_broadcasts(self, pp):
        session_id = await _new_session(pp)
        pp._broadcast_to_session = AsyncMock()

        await pp.request_csat(session_id)

        session = await pp.get_session(session_id)
        assert session.csat is not None
        assert session.csat.pending is True
        assert isinstance(session.csat.requested_at, datetime)

        pp._broadcast_to_session.assert_awaited_once()
        broadcast_session_id, event = pp._broadcast_to_session.await_args[0]
        assert broadcast_session_id == session_id
        assert event.type == "csat_request"

    @pytest.mark.asyncio
    async def test_handle_csat_stores_clears_pending_notifies_and_callback(self, bridge):
        on_csat = AsyncMock()
        pp = PocketPing(bridges=[bridge], on_csat=on_csat)
        session_id = await _new_session(pp)
        await pp.request_csat(session_id)

        res = await pp.handle_csat(CsatRequest(session_id=session_id, score=5, comment="  great  "))
        assert res.ok is True
        assert res.already_rated is None

        session = await pp.get_session(session_id)
        assert session.csat.score == 5
        assert session.csat.comment == "great"
        assert session.csat.pending is False
        assert isinstance(session.csat.responded_at, datetime)

        assert bridge.disconnect_calls[-1][1] == '⭐ 😍 5/5 — "great"'
        on_csat.assert_awaited_once()
        callback_session, rating = on_csat.await_args[0]
        assert rating == {"score": 5, "comment": "great"}

    @pytest.mark.asyncio
    async def test_handle_csat_rejects_out_of_range_score(self, pp):
        session_id = await _new_session(pp)
        with pytest.raises(ValueError, match="1-5"):
            await pp.handle_csat(CsatRequest(session_id=session_id, score=0))
        with pytest.raises(ValueError, match="1-5"):
            await pp.handle_csat(CsatRequest(session_id=session_id, score=6))

    @pytest.mark.asyncio
    async def test_handle_csat_is_idempotent_once_rated(self, pp):
        session_id = await _new_session(pp)
        await pp.handle_csat(CsatRequest(session_id=session_id, score=4))

        second = await pp.handle_csat(CsatRequest(session_id=session_id, score=1))
        assert second.ok is True
        assert second.already_rated is True

        session = await pp.get_session(session_id)
        assert session.csat.score == 4  # unchanged

    @pytest.mark.asyncio
    async def test_missing_session_raises(self, pp):
        with pytest.raises(ValueError, match="Session not found"):
            await pp.handle_csat(CsatRequest(session_id="nope", score=3))
        with pytest.raises(ValueError, match="Session not found"):
            await pp.request_csat("nope")


class TestGetStats:
    @pytest.mark.asyncio
    async def test_computes_conversations_response_rate_unanswered_and_csat(self):
        pp = PocketPing()
        a = await pp.handle_connect(ConnectRequest(visitor_id="va"))
        b = await pp.handle_connect(ConnectRequest(visitor_id="vb"))

        # Session A: visitor msg + operator reply + 5-star rating
        await pp.handle_message(SendMessageRequest(session_id=a.session_id, content="hi", sender=Sender.VISITOR))
        await pp.send_operator_message(a.session_id, "hello!")
        await pp.handle_csat(CsatRequest(session_id=a.session_id, score=5))

        # Session B: visitor msg only (unanswered)
        await pp.handle_message(SendMessageRequest(session_id=b.session_id, content="anyone?", sender=Sender.VISITOR))

        stats = await pp.get_stats()
        assert stats.conversations == 2
        assert stats.response_rate == 0.5
        assert stats.unanswered_now == 1
        assert stats.csat.percent == 1
        assert stats.csat.average == 5
        assert stats.csat.responses == 1
        assert len(stats.conversations_sparkline) == 7

    def test_messages_outside_window_are_excluded_from_count(self):
        from_ = datetime(2026, 1, 10)
        to = datetime(2026, 1, 17)
        session = Session(id="s1", visitor_id="v1", created_at=datetime(2026, 1, 11))
        msgs = [
            # Inside the window.
            Message(id="m1", session_id="s1", content="hi", sender=Sender.VISITOR, timestamp=datetime(2026, 1, 11)),
            Message(id="m2", session_id="s1", content="reply", sender=Sender.OPERATOR, timestamp=datetime(2026, 1, 12)),
            # Sent after the window closes (long-lived session) — must not be counted.
            Message(id="m3", session_id="s1", content="later", sender=Sender.VISITOR, timestamp=datetime(2026, 1, 20)),
            # Sent before the window opens — must not be counted.
            Message(id="m0", session_id="s1", content="early", sender=Sender.VISITOR, timestamp=datetime(2026, 1, 5)),
        ]

        stats = compute_stats([(session, msgs)], from_, to)

        assert stats.conversations == 1
        assert stats.messages == 2

    def test_csat_submitted_outside_window_is_excluded_from_responses(self):
        from_ = datetime(2026, 1, 10)
        to = datetime(2026, 1, 17)
        # Conversation created in the window, but the rating was submitted after it closed.
        late = Session(
            id="late",
            visitor_id="v1",
            created_at=datetime(2026, 1, 11),
            csat=SessionCsat(score=5, responded_at=datetime(2026, 1, 25)),
        )
        # Rating submitted within the window — counted.
        on_time = Session(
            id="ontime",
            visitor_id="v2",
            created_at=datetime(2026, 1, 12),
            csat=SessionCsat(score=4, responded_at=datetime(2026, 1, 13)),
        )
        # Score set but never responded (responded_at is None) — excluded.
        unanswered = Session(
            id="unanswered",
            visitor_id="v3",
            created_at=datetime(2026, 1, 12),
            csat=SessionCsat(score=3, responded_at=None),
        )

        stats = compute_stats([(late, []), (on_time, []), (unanswered, [])], from_, to)

        assert stats.csat.responses == 1
        assert stats.csat.average == 4

    @pytest.mark.asyncio
    async def test_default_window_is_last_7_days(self):
        pp = PocketPing()
        stats = await pp.get_stats()
        start = datetime.fromisoformat(stats.from_)
        end = datetime.fromisoformat(stats.to)
        assert abs((end - start) - timedelta(days=7)) < timedelta(seconds=1)

    @pytest.mark.asyncio
    async def test_raises_helpful_error_when_storage_cannot_list_sessions(self):
        class MinimalStorage(Storage):
            async def create_session(self, session):
                pass

            async def get_session(self, session_id):
                return None

            async def update_session(self, session):
                pass

            async def delete_session(self, session_id):
                pass

            async def save_message(self, message):
                pass

            async def get_messages(self, session_id, after=None, limit=50):
                return []

            async def get_message(self, message_id):
                return None

        pp = PocketPing(storage=MinimalStorage())
        with pytest.raises(ValueError, match="list_sessions"):
            await pp.get_stats()

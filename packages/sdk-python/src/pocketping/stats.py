"""Mini support stats for self-hosted SDK deployments.

Mirrors the SaaS ``/api/v1/stats`` shape (minus the per-project breakdown, since
an SDK owns a single deployment). Small, honest numbers, computed over the
customer's store.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from pocketping.models import Message, Sender, Session

DAY_SECONDS = 24 * 60 * 60


class CsatStats(BaseModel):
    """CSAT rollup within the stats window."""

    model_config = ConfigDict(populate_by_name=True)

    percent: Optional[float] = None
    """CSAT% = ratings >=4 / responses (0..1), None when no responses."""
    average: Optional[float] = None
    """Mean score 1..5, None when no responses."""
    responses: int = 0
    """Ratings submitted in the window."""


class SdkStats(BaseModel):
    """Mini support stats over a time window."""

    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    """Inclusive window start (ISO-8601)."""
    to: str
    """Window end (ISO-8601)."""
    conversations: int
    """Conversations started in the window."""
    conversations_sparkline: list[int] = Field(alias="conversationsSparkline")
    """Daily conversation counts (oldest -> newest)."""
    messages: int
    """Messages (any sender) in the window."""
    response_rate: float = Field(alias="responseRate")
    """Share of windowed conversations with >=1 operator/AI reply (0..1)."""
    median_first_response_seconds: Optional[float] = Field(alias="medianFirstResponseSeconds")
    """Median visitor-first -> operator-first reply, in seconds (None if none)."""
    unanswered_now: int = Field(alias="unansweredNow")
    """Conversations whose latest message is still from the visitor."""
    csat: CsatStats


def _median(values: list[float]) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 0:
        return (ordered[mid - 1] + ordered[mid]) / 2
    return ordered[mid]


def compute_stats(
    entries: list[tuple[Session, list[Message]]],
    from_: datetime,
    to: datetime,
) -> SdkStats:
    """Compute stats from session+message pairs already loaded from storage.

    Pure function — no I/O — so it's trivially testable.
    """
    days = max(1, -(-int((to - from_).total_seconds()) // DAY_SECONDS))  # ceil
    buckets = [0] * days

    conversations = 0
    messages = 0
    answered = 0
    unanswered_now = 0
    frt_seconds: list[float] = []
    csat_scores: list[int] = []

    for session, msgs in entries:
        created = session.created_at
        if created < from_ or created > to:
            continue
        conversations += 1

        idx = int((created - from_).total_seconds()) // DAY_SECONDS
        if 0 <= idx < days:
            buckets[idx] += 1

        ordered = sorted(msgs, key=lambda m: m.timestamp)
        messages += sum(1 for m in ordered if from_ <= m.timestamp <= to)

        first_visitor: Optional[datetime] = None
        first_operator: Optional[datetime] = None
        for m in ordered:
            if m.sender == Sender.VISITOR and first_visitor is None:
                first_visitor = m.timestamp
            elif m.sender in (Sender.OPERATOR, Sender.AI) and first_operator is None:
                first_operator = m.timestamp
            if first_visitor and first_operator:
                break

        if first_operator:
            answered += 1
        if first_visitor and first_operator and first_operator >= first_visitor:
            frt_seconds.append((first_operator - first_visitor).total_seconds())

        if ordered and ordered[-1].sender == Sender.VISITOR:
            unanswered_now += 1

        if session.csat and session.csat.score is not None:
            responded_at = session.csat.responded_at
            if responded_at is not None and from_ <= responded_at <= to:
                csat_scores.append(session.csat.score)

    responses = len(csat_scores)
    return SdkStats(
        from_=from_.isoformat(),
        to=to.isoformat(),
        conversations=conversations,
        conversations_sparkline=buckets,
        messages=messages,
        response_rate=0.0 if conversations == 0 else answered / conversations,
        median_first_response_seconds=_median(frt_seconds),
        unanswered_now=unanswered_now,
        csat=CsatStats(
            percent=None if responses == 0 else sum(1 for n in csat_scores if n >= 4) / responses,
            average=None if responses == 0 else sum(csat_scores) / responses,
            responses=responses,
        ),
    )

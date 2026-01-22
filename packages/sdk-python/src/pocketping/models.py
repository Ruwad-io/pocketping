"""Data models for PocketPing protocol."""

from datetime import datetime, timezone
from enum import Enum
from functools import partial
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


def _utc_now() -> datetime:
    """Return current UTC datetime (timezone-aware)."""
    return datetime.now(timezone.utc)


class Sender(str, Enum):
    VISITOR = "visitor"
    OPERATOR = "operator"
    AI = "ai"


class MessageStatus(str, Enum):
    SENDING = "sending"
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"


class UserIdentity(BaseModel):
    """User identity data from PocketPing.identify().

    The id field is required; all others are optional.
    Extra fields are allowed for custom data (plan, company, etc.).
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    email: Optional[str] = None
    name: Optional[str] = None


class SessionMetadata(BaseModel):
    """Metadata about the visitor's session."""

    model_config = ConfigDict(populate_by_name=True)

    # Page info
    url: Optional[str] = None
    referrer: Optional[str] = None
    page_title: Optional[str] = Field(None, alias="pageTitle")

    # Client info
    user_agent: Optional[str] = Field(None, alias="userAgent")
    timezone: Optional[str] = None
    language: Optional[str] = None
    screen_resolution: Optional[str] = Field(None, alias="screenResolution")

    # Geo info (populated server-side from IP)
    ip: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None

    # Device info (parsed from user agent or sent by client)
    device_type: Optional[str] = Field(None, alias="deviceType")  # desktop, mobile, tablet
    browser: Optional[str] = None
    os: Optional[str] = None


class Session(BaseModel):
    """A chat session with a visitor."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    visitor_id: str = Field(alias="visitorId")
    created_at: datetime = Field(default_factory=_utc_now, alias="createdAt")
    last_activity: datetime = Field(default_factory=_utc_now, alias="lastActivity")
    operator_online: bool = Field(False, alias="operatorOnline")
    ai_active: bool = Field(False, alias="aiActive")
    metadata: Optional[SessionMetadata] = None
    identity: Optional[UserIdentity] = None


class Message(BaseModel):
    """A chat message."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    session_id: str = Field(alias="sessionId")
    content: str
    sender: Sender
    timestamp: datetime = Field(default_factory=_utc_now)
    reply_to: Optional[str] = Field(None, alias="replyTo")
    metadata: Optional[dict[str, Any]] = None

    # Read receipt fields
    status: MessageStatus = Field(MessageStatus.SENT)
    delivered_at: Optional[datetime] = Field(None, alias="deliveredAt")
    read_at: Optional[datetime] = Field(None, alias="readAt")


# Request/Response models


class ConnectRequest(BaseModel):
    """Request to connect/create a session."""

    model_config = ConfigDict(populate_by_name=True)

    visitor_id: str = Field(alias="visitorId")
    session_id: Optional[str] = Field(None, alias="sessionId")
    metadata: Optional[SessionMetadata] = None
    identity: Optional[UserIdentity] = None


# ─────────────────────────────────────────────────────────────────
# Tracked Elements (SaaS auto-tracking)
# ─────────────────────────────────────────────────────────────────


class TrackedElement(BaseModel):
    """Tracked element configuration (for SaaS auto-tracking)."""

    model_config = ConfigDict(populate_by_name=True)

    selector: str
    """CSS selector for the element(s) to track."""

    event: Optional[str] = "click"
    """DOM event to listen for (default: 'click')."""

    name: str
    """Event name sent to backend."""

    widget_message: Optional[str] = Field(None, alias="widgetMessage")
    """If provided, opens widget with this message when triggered."""

    data: Optional[dict[str, Any]] = None
    """Additional data to send with the event."""


class TriggerOptions(BaseModel):
    """Options for trigger() method."""

    model_config = ConfigDict(populate_by_name=True)

    widget_message: Optional[str] = Field(None, alias="widgetMessage")
    """If provided, opens the widget and shows this message."""


class ConnectResponse(BaseModel):
    """Response after connecting."""

    model_config = ConfigDict(populate_by_name=True)

    session_id: str = Field(alias="sessionId")
    visitor_id: str = Field(alias="visitorId")
    operator_online: bool = Field(False, alias="operatorOnline")
    welcome_message: Optional[str] = Field(None, alias="welcomeMessage")
    messages: list[Message] = Field(default_factory=list)
    tracked_elements: Optional[list[TrackedElement]] = Field(None, alias="trackedElements")
    """Tracked elements configuration (for SaaS auto-tracking)."""


class SendMessageRequest(BaseModel):
    """Request to send a message."""

    model_config = ConfigDict(populate_by_name=True)

    session_id: str = Field(alias="sessionId")
    content: str = Field(max_length=4000)
    sender: Sender
    reply_to: Optional[str] = Field(None, alias="replyTo")


class SendMessageResponse(BaseModel):
    """Response after sending a message."""

    model_config = ConfigDict(populate_by_name=True)

    message_id: str = Field(alias="messageId")
    timestamp: datetime


class TypingRequest(BaseModel):
    """Request to send typing indicator."""

    model_config = ConfigDict(populate_by_name=True)

    session_id: str = Field(alias="sessionId")
    sender: Sender
    is_typing: bool = Field(True, alias="isTyping")


class ReadRequest(BaseModel):
    """Request to mark messages as read/delivered."""

    model_config = ConfigDict(populate_by_name=True)

    session_id: str = Field(alias="sessionId")
    message_ids: list[str] = Field(alias="messageIds")
    status: MessageStatus = Field(MessageStatus.READ)


class ReadResponse(BaseModel):
    """Response after marking messages as read."""

    model_config = ConfigDict(populate_by_name=True)

    updated: int  # Number of messages updated


class IdentifyRequest(BaseModel):
    """Request to identify a user."""

    model_config = ConfigDict(populate_by_name=True)

    session_id: str = Field(alias="sessionId")
    identity: UserIdentity


class IdentifyResponse(BaseModel):
    """Response after identifying a user."""

    model_config = ConfigDict(populate_by_name=True)

    ok: bool = True


class PresenceResponse(BaseModel):
    """Response for presence check."""

    model_config = ConfigDict(populate_by_name=True)

    online: bool
    operators: Optional[list[dict[str, str]]] = None
    ai_enabled: bool = Field(False, alias="aiEnabled")
    ai_active_after: Optional[int] = Field(None, alias="aiActiveAfter")


class WebSocketEvent(BaseModel):
    """WebSocket event structure."""

    type: str
    data: dict[str, Any]


class CustomEvent(BaseModel):
    """Custom event for bidirectional communication."""

    model_config = ConfigDict(populate_by_name=True)

    name: str
    data: Optional[dict[str, Any]] = None
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: Optional[str] = Field(None, alias="sessionId")


# Type alias for custom event handler
CustomEventHandler = Any  # Callable[[CustomEvent, Session], Any]


# ─────────────────────────────────────────────────────────────────
# Version Management
# ─────────────────────────────────────────────────────────────────


class VersionStatus(str, Enum):
    OK = "ok"
    OUTDATED = "outdated"
    DEPRECATED = "deprecated"
    UNSUPPORTED = "unsupported"


class VersionCheckResult(BaseModel):
    """Result of checking widget version against backend requirements."""

    model_config = ConfigDict(populate_by_name=True)

    status: VersionStatus
    message: Optional[str] = None
    min_version: Optional[str] = Field(None, alias="minVersion")
    latest_version: Optional[str] = Field(None, alias="latestVersion")
    can_continue: bool = Field(True, alias="canContinue")


class VersionWarning(BaseModel):
    """Version warning sent to widget."""

    model_config = ConfigDict(populate_by_name=True)

    severity: str  # "info", "warning", "error"
    message: str
    current_version: str = Field(alias="currentVersion")
    min_version: Optional[str] = Field(None, alias="minVersion")
    latest_version: Optional[str] = Field(None, alias="latestVersion")
    can_continue: bool = Field(True, alias="canContinue")
    upgrade_url: Optional[str] = Field(None, alias="upgradeUrl")

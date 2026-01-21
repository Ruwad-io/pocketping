"""Data models for PocketPing protocol."""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


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

    id: str
    email: Optional[str] = None
    name: Optional[str] = None

    class Config:
        extra = "allow"  # Allow custom fields
        populate_by_name = True


class SessionMetadata(BaseModel):
    """Metadata about the visitor's session."""

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

    class Config:
        populate_by_name = True


class Session(BaseModel):
    """A chat session with a visitor."""

    id: str
    visitor_id: str = Field(alias="visitorId")
    created_at: datetime = Field(default_factory=datetime.utcnow, alias="createdAt")
    last_activity: datetime = Field(default_factory=datetime.utcnow, alias="lastActivity")
    operator_online: bool = Field(False, alias="operatorOnline")
    ai_active: bool = Field(False, alias="aiActive")
    metadata: Optional[SessionMetadata] = None
    identity: Optional[UserIdentity] = None

    class Config:
        populate_by_name = True


class Message(BaseModel):
    """A chat message."""

    id: str
    session_id: str = Field(alias="sessionId")
    content: str
    sender: Sender
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    reply_to: Optional[str] = Field(None, alias="replyTo")
    metadata: Optional[dict[str, Any]] = None

    # Read receipt fields
    status: MessageStatus = Field(MessageStatus.SENT)
    delivered_at: Optional[datetime] = Field(None, alias="deliveredAt")
    read_at: Optional[datetime] = Field(None, alias="readAt")

    class Config:
        populate_by_name = True


# Request/Response models


class ConnectRequest(BaseModel):
    """Request to connect/create a session."""

    visitor_id: str = Field(alias="visitorId")
    session_id: Optional[str] = Field(None, alias="sessionId")
    metadata: Optional[SessionMetadata] = None
    identity: Optional[UserIdentity] = None

    class Config:
        populate_by_name = True


class ConnectResponse(BaseModel):
    """Response after connecting."""

    session_id: str = Field(alias="sessionId")
    visitor_id: str = Field(alias="visitorId")
    operator_online: bool = Field(False, alias="operatorOnline")
    welcome_message: Optional[str] = Field(None, alias="welcomeMessage")
    messages: list[Message] = Field(default_factory=list)

    class Config:
        populate_by_name = True


class SendMessageRequest(BaseModel):
    """Request to send a message."""

    session_id: str = Field(alias="sessionId")
    content: str = Field(max_length=4000)
    sender: Sender
    reply_to: Optional[str] = Field(None, alias="replyTo")

    class Config:
        populate_by_name = True


class SendMessageResponse(BaseModel):
    """Response after sending a message."""

    message_id: str = Field(alias="messageId")
    timestamp: datetime

    class Config:
        populate_by_name = True


class TypingRequest(BaseModel):
    """Request to send typing indicator."""

    session_id: str = Field(alias="sessionId")
    sender: Sender
    is_typing: bool = Field(True, alias="isTyping")

    class Config:
        populate_by_name = True


class ReadRequest(BaseModel):
    """Request to mark messages as read/delivered."""

    session_id: str = Field(alias="sessionId")
    message_ids: list[str] = Field(alias="messageIds")
    status: MessageStatus = Field(MessageStatus.READ)

    class Config:
        populate_by_name = True


class ReadResponse(BaseModel):
    """Response after marking messages as read."""

    updated: int  # Number of messages updated

    class Config:
        populate_by_name = True


class IdentifyRequest(BaseModel):
    """Request to identify a user."""

    session_id: str = Field(alias="sessionId")
    identity: UserIdentity

    class Config:
        populate_by_name = True


class IdentifyResponse(BaseModel):
    """Response after identifying a user."""

    ok: bool = True

    class Config:
        populate_by_name = True


class PresenceResponse(BaseModel):
    """Response for presence check."""

    online: bool
    operators: Optional[list[dict[str, str]]] = None
    ai_enabled: bool = Field(False, alias="aiEnabled")
    ai_active_after: Optional[int] = Field(None, alias="aiActiveAfter")

    class Config:
        populate_by_name = True


class WebSocketEvent(BaseModel):
    """WebSocket event structure."""

    type: str
    data: dict[str, Any]


class CustomEvent(BaseModel):
    """Custom event for bidirectional communication."""

    name: str
    data: Optional[dict[str, Any]] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    session_id: Optional[str] = Field(None, alias="sessionId")

    class Config:
        populate_by_name = True


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

    status: VersionStatus
    message: Optional[str] = None
    min_version: Optional[str] = Field(None, alias="minVersion")
    latest_version: Optional[str] = Field(None, alias="latestVersion")
    can_continue: bool = Field(True, alias="canContinue")

    class Config:
        populate_by_name = True


class VersionWarning(BaseModel):
    """Version warning sent to widget."""

    severity: str  # "info", "warning", "error"
    message: str
    current_version: str = Field(alias="currentVersion")
    min_version: Optional[str] = Field(None, alias="minVersion")
    latest_version: Optional[str] = Field(None, alias="latestVersion")
    can_continue: bool = Field(True, alias="canContinue")
    upgrade_url: Optional[str] = Field(None, alias="upgradeUrl")

    class Config:
        populate_by_name = True

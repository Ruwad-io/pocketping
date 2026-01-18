"""Data models for PocketPing protocol."""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class Sender(str, Enum):
    VISITOR = "visitor"
    OPERATOR = "operator"
    AI = "ai"


class SessionMetadata(BaseModel):
    """Metadata about the visitor's session."""

    url: Optional[str] = None
    referrer: Optional[str] = None
    user_agent: Optional[str] = Field(None, alias="userAgent")
    timezone: Optional[str] = None
    language: Optional[str] = None

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

    class Config:
        populate_by_name = True


# Request/Response models


class ConnectRequest(BaseModel):
    """Request to connect/create a session."""

    visitor_id: str = Field(alias="visitorId")
    session_id: Optional[str] = Field(None, alias="sessionId")
    metadata: Optional[SessionMetadata] = None

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

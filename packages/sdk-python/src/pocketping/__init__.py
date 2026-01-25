"""PocketPing - Real-time customer chat with mobile notifications."""

from pocketping.bridges import (
    Bridge,
    CompositeBridge,
    DiscordBridge,
    SlackBridge,
    TelegramBridge,
)
from pocketping.core import PocketPing
from pocketping.models import (
    BridgeMessageResult,
    ConnectRequest,
    ConnectResponse,
    CustomEvent,
    Message,
    PresenceResponse,
    SendMessageRequest,
    SendMessageResponse,
    Session,
    SessionMetadata,
    TrackedElement,
    TriggerOptions,
)
from pocketping.storage import MemoryStorage, Storage
from pocketping.utils.ip_filter import IpFilterConfig
from pocketping.webhooks import OperatorAttachment, WebhookConfig, WebhookHandler

__version__ = "0.1.0"

__all__ = [
    "PocketPing",
    "Message",
    "Session",
    "SessionMetadata",
    "ConnectRequest",
    "ConnectResponse",
    "SendMessageRequest",
    "SendMessageResponse",
    "PresenceResponse",
    "CustomEvent",
    "TrackedElement",
    "TriggerOptions",
    "Storage",
    "MemoryStorage",
    "Bridge",
    "CompositeBridge",
    "TelegramBridge",
    "DiscordBridge",
    "SlackBridge",
    "BridgeMessageResult",
    "IpFilterConfig",
    "WebhookHandler",
    "WebhookConfig",
    "OperatorAttachment",
]

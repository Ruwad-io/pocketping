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
    Attachment,
    AttachmentStatus,
    BridgeMessageResult,
    ConnectRequest,
    ConnectResponse,
    CsatRequest,
    CsatResponse,
    CustomEvent,
    Message,
    PresenceResponse,
    SendMessageRequest,
    SendMessageResponse,
    Session,
    SessionCsat,
    SessionMetadata,
    TrackedElement,
    TriggerOptions,
    UploadRequest,
    UploadResponse,
)
from pocketping.stats import CsatStats, SdkStats
from pocketping.storage import MemoryStorage, Storage
from pocketping.utils.bot_detection import (
    BotVerdict,
    detect_bot,
    is_datacenter_ip,
    is_headless_user_agent,
    is_hosting_org,
)
from pocketping.utils.ip_filter import IpFilterConfig
from pocketping.webhooks import OperatorAttachment, WebhookConfig, WebhookHandler

__version__ = "0.1.0"

__all__ = [
    "PocketPing",
    "Message",
    "Session",
    "SessionCsat",
    "SessionMetadata",
    "ConnectRequest",
    "ConnectResponse",
    "CsatRequest",
    "CsatResponse",
    "SdkStats",
    "CsatStats",
    "SendMessageRequest",
    "SendMessageResponse",
    "PresenceResponse",
    "CustomEvent",
    "Attachment",
    "AttachmentStatus",
    "UploadRequest",
    "UploadResponse",
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
    "BotVerdict",
    "detect_bot",
    "is_datacenter_ip",
    "is_headless_user_agent",
    "is_hosting_org",
    "WebhookHandler",
    "WebhookConfig",
    "OperatorAttachment",
]

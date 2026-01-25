"""Webhook handlers for receiving operator messages from bridges."""

import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal, Optional

import httpx


@dataclass
class OperatorAttachment:
    """Attachment from an operator message."""

    filename: str
    mime_type: str
    size: int
    data: bytes
    bridge_file_id: Optional[str] = None


# Callback type for operator messages
# Args: session_id, content, operator_name, source, attachments, reply_to_bridge_message_id
OperatorMessageCallback = Callable[
    [
        str,  # session_id (topic_id for Telegram, thread_ts for Slack, etc.)
        str,  # content
        str,  # operator_name
        Literal["telegram", "discord", "slack"],  # source
        list[OperatorAttachment],  # attachments
        Optional[int],  # reply_to_bridge_message_id (Telegram message_id being replied to)
    ],
    Optional[Awaitable[None]],
]

# Callback type for operator messages with bridge message ID
OperatorMessageWithIdsCallback = Callable[
    [
        str,  # session_id
        str,  # content
        str,  # operator_name
        Literal["telegram", "discord", "slack"],  # source
        list[OperatorAttachment],  # attachments
        Optional[int],  # reply_to_bridge_message_id
        str,  # bridge_message_id
    ],
    Optional[Awaitable[None]],
]

# Callback type for operator message edits
OperatorMessageEditCallback = Callable[
    [
        str,  # session_id
        str,  # bridge_message_id
        str,  # content
        Literal["telegram", "discord", "slack"],  # source
        str,  # edited_at (ISO string)
    ],
    Optional[Awaitable[None]],
]

# Callback type for operator message deletes
OperatorMessageDeleteCallback = Callable[
    [
        str,  # session_id
        str,  # bridge_message_id
        Literal["telegram", "discord", "slack"],  # source
        str,  # deleted_at (ISO string)
    ],
    Optional[Awaitable[None]],
]


@dataclass
class WebhookConfig:
    """Configuration for webhook handlers."""

    telegram_bot_token: Optional[str] = None
    slack_bot_token: Optional[str] = None
    discord_bot_token: Optional[str] = None
    on_operator_message: Optional[OperatorMessageCallback] = None
    on_operator_message_with_ids: Optional[OperatorMessageWithIdsCallback] = None
    on_operator_message_edit: Optional[OperatorMessageEditCallback] = None
    on_operator_message_delete: Optional[OperatorMessageDeleteCallback] = None
    allowed_bot_ids: Optional[list[str]] = None


@dataclass
class ParsedMedia:
    """Parsed media from a Telegram message."""

    file_id: str
    filename: str
    mime_type: str
    size: int


class WebhookHandler:
    """Handles incoming webhooks from bridges (Telegram, Slack, Discord)."""

    def __init__(self, config: WebhookConfig):
        self.config = config
        self._http_client: Optional[httpx.Client] = None

    @property
    def http_client(self) -> httpx.Client:
        """Lazy-initialize HTTP client."""
        if self._http_client is None:
            self._http_client = httpx.Client(timeout=30.0)
        return self._http_client

    def close(self) -> None:
        """Close the HTTP client."""
        if self._http_client is not None:
            self._http_client.close()
            self._http_client = None

    # ─────────────────────────────────────────────────────────────────
    # Telegram Webhook
    # ─────────────────────────────────────────────────────────────────

    def handle_telegram_webhook(self, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Handle an incoming Telegram webhook.

        Args:
            payload: The parsed JSON payload from Telegram

        Returns:
            Response dict (usually {"ok": True})

        Usage with FastAPI:
            @app.post("/webhooks/telegram")
            async def telegram_webhook(request: Request):
                payload = await request.json()
                return handler.handle_telegram_webhook(payload)
        """
        if not self.config.telegram_bot_token:
            return {"error": "Telegram not configured"}

        edited_message = payload.get("edited_message")
        if edited_message:
            text = edited_message.get("text", "")
            caption = edited_message.get("caption", "")

            if text.startswith("/"):
                return {"ok": True}

            if not text:
                text = caption

            if not text:
                return {"ok": True}

            topic_id = edited_message.get("message_thread_id")
            if not topic_id:
                return {"ok": True}

            if self.config.on_operator_message_edit:
                edit_date = edited_message.get("edit_date") or int(time.time())
                edited_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(edit_date))
                bridge_message_id = str(edited_message.get("message_id", ""))
                if bridge_message_id:
                    self.config.on_operator_message_edit(
                        str(topic_id), bridge_message_id, text, "telegram", edited_at
                    )

            return {"ok": True}

        message_reaction = payload.get("message_reaction")
        if message_reaction:
            new_reactions = message_reaction.get("new_reaction") or []
            emoji = new_reactions[0].get("emoji") if new_reactions else None
            topic_id = message_reaction.get("message_thread_id")

            if emoji and "🗑" in emoji and topic_id and self.config.on_operator_message_delete:
                reaction_date = message_reaction.get("date", int(time.time()))
                deleted_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(reaction_date))
                bridge_message_id = str(message_reaction.get("message_id", ""))
                if bridge_message_id:
                    self.config.on_operator_message_delete(
                        str(topic_id), bridge_message_id, "telegram", deleted_at
                    )

            return {"ok": True}

        message = payload.get("message")
        if not message:
            return {"ok": True}

        text = message.get("text", "")
        caption = message.get("caption", "")

        # Handle /delete command (reply-based)
        if text.startswith("/delete"):
            topic_id = message.get("message_thread_id")
            reply_to = message.get("reply_to_message") or {}
            reply_id = reply_to.get("message_id")
            if topic_id and reply_id and self.config.on_operator_message_delete:
                deleted_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                self.config.on_operator_message_delete(
                    str(topic_id), str(reply_id), "telegram", deleted_at
                )
            return {"ok": True}

        # Skip commands
        if text.startswith("/"):
            return {"ok": True}

        # Use caption if no text
        if not text:
            text = caption

        # Parse media
        media: Optional[ParsedMedia] = None
        if "photo" in message and message["photo"]:
            # Get largest photo
            largest = message["photo"][-1]
            media = ParsedMedia(
                file_id=largest["file_id"],
                filename=f"photo_{int(time.time())}.jpg",
                mime_type="image/jpeg",
                size=largest.get("file_size", 0),
            )
        elif "document" in message and message["document"]:
            doc = message["document"]
            media = ParsedMedia(
                file_id=doc["file_id"],
                filename=doc.get("file_name", f"document_{int(time.time())}"),
                mime_type=doc.get("mime_type", "application/octet-stream"),
                size=doc.get("file_size", 0),
            )
        elif "audio" in message and message["audio"]:
            audio = message["audio"]
            media = ParsedMedia(
                file_id=audio["file_id"],
                filename=audio.get("file_name", f"audio_{int(time.time())}.mp3"),
                mime_type=audio.get("mime_type", "audio/mpeg"),
                size=audio.get("file_size", 0),
            )
        elif "video" in message and message["video"]:
            video = message["video"]
            media = ParsedMedia(
                file_id=video["file_id"],
                filename=video.get("file_name", f"video_{int(time.time())}.mp4"),
                mime_type=video.get("mime_type", "video/mp4"),
                size=video.get("file_size", 0),
            )
        elif "voice" in message and message["voice"]:
            voice = message["voice"]
            media = ParsedMedia(
                file_id=voice["file_id"],
                filename=f"voice_{int(time.time())}.ogg",
                mime_type=voice.get("mime_type", "audio/ogg"),
                size=voice.get("file_size", 0),
            )

        # Skip if no content
        if not text and not media:
            return {"ok": True}

        # Get topic ID (session identifier)
        topic_id = message.get("message_thread_id")
        if not topic_id:
            return {"ok": True}

        # Get operator name
        from_user = message.get("from", {})
        operator_name = from_user.get("first_name", "Operator")

        # Get reply_to_message ID if present (for visual reply linking)
        reply_to_message_id: Optional[int] = None
        reply_to = message.get("reply_to_message")
        if reply_to:
            reply_to_message_id = reply_to.get("message_id")

        # Download media if present
        attachments: list[OperatorAttachment] = []
        if media:
            data = self._download_telegram_file(media.file_id)
            if data:
                attachments.append(
                    OperatorAttachment(
                        filename=media.filename,
                        mime_type=media.mime_type,
                        size=media.size,
                        data=data,
                        bridge_file_id=media.file_id,
                    )
                )

        # Call callback
        if self.config.on_operator_message:
            self.config.on_operator_message(
                str(topic_id), text, operator_name, "telegram", attachments, reply_to_message_id
            )
        if self.config.on_operator_message_with_ids:
            bridge_message_id = str(message.get("message_id", ""))
            if bridge_message_id:
                self.config.on_operator_message_with_ids(
                    str(topic_id),
                    text,
                    operator_name,
                    "telegram",
                    attachments,
                    reply_to_message_id,
                    bridge_message_id,
                )

        return {"ok": True}

    def _download_telegram_file(self, file_id: str) -> Optional[bytes]:
        """Download a file from Telegram."""
        try:
            bot_token = self.config.telegram_bot_token
            if not bot_token:
                return None

            # Get file path
            get_file_url = f"https://api.telegram.org/bot{bot_token}/getFile?file_id={file_id}"
            resp = self.http_client.get(get_file_url)
            result = resp.json()

            if not result.get("ok") or not result.get("result", {}).get("file_path"):
                return None

            file_path = result["result"]["file_path"]

            # Download file
            download_url = f"https://api.telegram.org/file/bot{bot_token}/{file_path}"
            file_resp = self.http_client.get(download_url)
            return file_resp.content
        except Exception as e:
            print(f"[WebhookHandler] Telegram file download error: {e}")
            return None

    # ─────────────────────────────────────────────────────────────────
    # Slack Webhook
    # ─────────────────────────────────────────────────────────────────

    def handle_slack_webhook(self, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Handle an incoming Slack webhook.

        Args:
            payload: The parsed JSON payload from Slack

        Returns:
            Response dict

        Usage with FastAPI:
            @app.post("/webhooks/slack")
            async def slack_webhook(request: Request):
                payload = await request.json()
                return handler.handle_slack_webhook(payload)
        """
        if not self.config.slack_bot_token:
            return {"error": "Slack not configured"}

        # Handle URL verification challenge
        if payload.get("type") == "url_verification" and payload.get("challenge"):
            return {"challenge": payload["challenge"]}

        # Handle event callbacks
        if payload.get("type") == "event_callback" and payload.get("event"):
            event = payload["event"]
            allowed_bot_ids = set(self.config.allowed_bot_ids or [])
            def is_allowed_bot(bot_id: Optional[str]) -> bool:
                return bool(bot_id) and bot_id in allowed_bot_ids

            if event.get("type") != "message":
                return {"ok": True}

            subtype = event.get("subtype")

            if subtype == "message_changed":
                if self.config.on_operator_message_edit:
                    message = event.get("message", {}) or {}
                    previous = event.get("previous_message", {}) or {}
                    bot_id = message.get("bot_id") or previous.get("bot_id") or event.get("bot_id")
                    if bot_id and not is_allowed_bot(bot_id):
                        return {"ok": True}

                    thread_ts = message.get("thread_ts") or previous.get("thread_ts")
                    message_ts = message.get("ts") or previous.get("ts")
                    text = message.get("text", "")

                    if thread_ts and message_ts:
                        edited_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                        self.config.on_operator_message_edit(
                            thread_ts, message_ts, text, "slack", edited_at
                        )

                return {"ok": True}

            if subtype == "message_deleted":
                if self.config.on_operator_message_delete:
                    previous = event.get("previous_message", {}) or {}
                    bot_id = previous.get("bot_id") or event.get("bot_id")
                    if bot_id and not is_allowed_bot(bot_id):
                        return {"ok": True}

                    thread_ts = previous.get("thread_ts")
                    message_ts = event.get("deleted_ts") or previous.get("ts")

                    if thread_ts and message_ts:
                        deleted_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                        self.config.on_operator_message_delete(
                            thread_ts, message_ts, "slack", deleted_at
                        )

                return {"ok": True}

            has_content = (
                event.get("type") == "message"
                and event.get("thread_ts")
                and (not event.get("bot_id") or is_allowed_bot(event.get("bot_id")))
                and not event.get("subtype")
            )
            files = event.get("files", [])
            has_files = len(files) > 0

            if has_content and (event.get("text") or has_files):
                thread_ts = event["thread_ts"]
                text = event.get("text", "")

                # Download files if present
                attachments: list[OperatorAttachment] = []
                if has_files:
                    for file in files:
                        data = self._download_slack_file(file)
                        if data:
                            attachments.append(
                                OperatorAttachment(
                                    filename=file.get("name", "file"),
                                    mime_type=file.get("mimetype", "application/octet-stream"),
                                    size=file.get("size", 0),
                                    data=data,
                                    bridge_file_id=file.get("id"),
                                )
                            )

                # Get operator name
                operator_name = "Operator"
                user_id = event.get("user")
                if user_id:
                    name = self._get_slack_user_name(user_id)
                    if name:
                        operator_name = name

                # Call callback (Slack reply support TODO)
                if self.config.on_operator_message:
                    self.config.on_operator_message(
                        thread_ts, text, operator_name, "slack", attachments, None
                    )
                if self.config.on_operator_message_with_ids:
                    message_ts = event.get("ts")
                    if message_ts:
                        self.config.on_operator_message_with_ids(
                            thread_ts,
                            text,
                            operator_name,
                            "slack",
                            attachments,
                            None,
                            message_ts,
                        )

        return {"ok": True}

    def _download_slack_file(self, file: dict[str, Any]) -> Optional[bytes]:
        """Download a file from Slack."""
        try:
            download_url = file.get("url_private_download") or file.get("url_private")
            if not download_url:
                return None

            resp = self.http_client.get(
                download_url,
                headers={"Authorization": f"Bearer {self.config.slack_bot_token}"},
            )
            if resp.status_code != 200:
                return None
            return resp.content
        except Exception as e:
            print(f"[WebhookHandler] Slack file download error: {e}")
            return None

    def _get_slack_user_name(self, user_id: str) -> Optional[str]:
        """Get a Slack user's display name."""
        try:
            url = f"https://slack.com/api/users.info?user={user_id}"
            resp = self.http_client.get(
                url,
                headers={"Authorization": f"Bearer {self.config.slack_bot_token}"},
            )
            result = resp.json()
            if not result.get("ok"):
                return None
            user = result.get("user", {})
            return user.get("real_name") or user.get("name")
        except Exception:
            return None

    # ─────────────────────────────────────────────────────────────────
    # Discord Webhook
    # ─────────────────────────────────────────────────────────────────

    def handle_discord_webhook(self, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Handle an incoming Discord webhook (interactions endpoint).

        Args:
            payload: The parsed JSON payload from Discord

        Returns:
            Response dict

        Usage with FastAPI:
            @app.post("/webhooks/discord")
            async def discord_webhook(request: Request):
                payload = await request.json()
                return handler.handle_discord_webhook(payload)
        """
        PING = 1
        APPLICATION_COMMAND = 2
        PONG = 1
        CHANNEL_MESSAGE = 4

        interaction_type = payload.get("type")

        # Handle PING (verification)
        if interaction_type == PING:
            return {"type": PONG}

        # Handle Application Commands (slash commands)
        if interaction_type == APPLICATION_COMMAND and payload.get("data"):
            data = payload["data"]
            if data.get("name") == "reply":
                thread_id = payload.get("channel_id")
                content = None
                for opt in data.get("options", []):
                    if opt.get("name") == "message":
                        content = opt.get("value")
                        break

                if thread_id and content:
                    # Get operator name
                    operator_name = "Operator"
                    member = payload.get("member", {})
                    user = member.get("user") or payload.get("user", {})
                    if user.get("username"):
                        operator_name = user["username"]

                    # Call callback (Discord reply support TODO)
                    if self.config.on_operator_message:
                        self.config.on_operator_message(
                            thread_id, content, operator_name, "discord", [], None
                        )

                    return {
                        "type": CHANNEL_MESSAGE,
                        "data": {"content": "✅ Message sent to visitor"},
                    }

        return {"type": PONG}

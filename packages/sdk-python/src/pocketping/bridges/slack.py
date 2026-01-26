"""Slack bridge for PocketPing using httpx."""

from typing import TYPE_CHECKING

import httpx

from pocketping.bridges.base import Bridge
from pocketping.models import BridgeMessageResult, Message, MessageStatus, Sender, Session

if TYPE_CHECKING:
    from pocketping.core import PocketPing


class SlackBridge(Bridge):
    """Slack notification bridge using httpx.

    Supports two modes:
    1. Webhook mode: Simple, no authentication needed, send-only
    2. Bot mode: Full API access with bot token, can edit/delete messages

    Webhook mode (recommended for simple notifications):
        from pocketping import PocketPing
        from pocketping.bridges import SlackBridge

        pp = PocketPing(
            bridges=[
                SlackBridge(
                    webhook_url="https://hooks.slack.com/services/T.../B.../xxx",
                    username="PocketPing",  # Optional custom username
                    icon_emoji=":robot_face:",  # Optional custom emoji
                )
            ]
        )

    Bot mode (for full functionality):
        pp = PocketPing(
            bridges=[
                SlackBridge(
                    bot_token="xoxb-your-bot-token",
                    channel_id="C0123456789",
                )
            ]
        )

    Setup (Webhook mode):
        1. Go to https://api.slack.com/apps
        2. Create a new app or select existing
        3. Go to "Incoming Webhooks" and activate
        4. Add a new webhook to your workspace
        5. Copy the webhook URL

    Setup (Bot mode):
        1. Go to https://api.slack.com/apps
        2. Create a new app
        3. Go to "OAuth & Permissions"
        4. Add scopes: chat:write, chat:write.customize
        5. Install to workspace and get Bot Token (xoxb-...)
        6. Invite bot to the channel: /invite @YourBot
        7. Get channel ID from channel details
    """

    def __init__(
        self,
        # Webhook mode
        webhook_url: str | None = None,
        *,
        username: str | None = None,
        icon_emoji: str | None = None,
        icon_url: str | None = None,
        # Bot mode
        bot_token: str | None = None,
        channel_id: str | None = None,
    ):
        """Initialize Slack bridge.

        Args:
            webhook_url: Slack webhook URL (for webhook mode)
            username: Custom username for messages
            icon_emoji: Custom emoji for messages (e.g., ":robot_face:")
            icon_url: Custom icon URL for messages
            bot_token: Slack bot token (xoxb-...) for bot mode
            channel_id: Channel ID to send messages to (for bot mode)
        """
        # Validate that either webhook or bot mode is configured
        if webhook_url:
            self._mode = "webhook"
            self._webhook_url = webhook_url
        elif bot_token and channel_id:
            self._mode = "bot"
            self._bot_token = bot_token
            self._channel_id = channel_id
        else:
            raise ValueError(
                "Either webhook_url or (bot_token + channel_id) must be provided"
            )

        self._username = username
        self._icon_emoji = icon_emoji
        self._icon_url = icon_url
        self._client: httpx.AsyncClient | None = None
        self._pocketping: "PocketPing | None" = None

        # Base URL for Slack API
        self._api_base = "https://slack.com/api"

    @property
    def name(self) -> str:
        return "slack"

    async def init(self, pocketping: "PocketPing") -> None:
        """Initialize the bridge with an httpx client."""
        self._pocketping = pocketping

        headers = {"Content-Type": "application/json"}
        if self._mode == "bot":
            headers["Authorization"] = f"Bearer {self._bot_token}"

        self._client = httpx.AsyncClient(
            timeout=30.0,
            headers=headers,
        )

    async def _webhook_request(self, payload: dict) -> bool:
        """Send a message via webhook.

        Args:
            payload: Message payload

        Returns:
            True if successful, False otherwise
        """
        if not self._client:
            print("[PocketPing] Slack bridge not initialized")
            return False

        try:
            response = await self._client.post(self._webhook_url, json=payload)

            if response.status_code != 200:
                print(f"[PocketPing] Slack webhook error: {response.status_code} - {response.text}")
                return False

            # Slack webhooks return "ok" as text on success
            return response.text == "ok"
        except httpx.HTTPError as e:
            print(f"[PocketPing] Slack HTTP error: {e}")
            return False
        except Exception as e:
            print(f"[PocketPing] Slack error: {e}")
            return False

    async def _api_request(
        self,
        method: str,
        **params,
    ) -> dict | None:
        """Make a request to the Slack API.

        Args:
            method: API method name (e.g., "chat.postMessage")
            **params: Parameters to send with the request

        Returns:
            API response as dict, or None on error
        """
        if not self._client:
            print("[PocketPing] Slack bridge not initialized")
            return None

        url = f"{self._api_base}/{method}"

        try:
            response = await self._client.post(url, json=params)
            data = response.json()

            if not data.get("ok"):
                error = data.get("error", "Unknown error")
                print(f"[PocketPing] Slack API error: {error}")
                return None

            return data
        except httpx.HTTPError as e:
            print(f"[PocketPing] Slack HTTP error: {e}")
            return None
        except Exception as e:
            print(f"[PocketPing] Slack error: {e}")
            return None

    async def _send_message(
        self,
        text: str | None = None,
        *,
        blocks: list[dict] | None = None,
        thread_ts: str | None = None,
    ) -> dict | None:
        """Send a message to Slack.

        Args:
            text: Plain text message (fallback)
            blocks: Block Kit blocks
            thread_ts: Thread timestamp to reply in

        Returns:
            API response with message details, or None on error
        """
        payload: dict = {}

        if text:
            payload["text"] = text
        if blocks:
            payload["blocks"] = blocks

        # Add common options
        if self._username:
            payload["username"] = self._username
        if self._icon_emoji:
            payload["icon_emoji"] = self._icon_emoji
        if self._icon_url:
            payload["icon_url"] = self._icon_url

        if self._mode == "webhook":
            success = await self._webhook_request(payload)
            # Webhooks don't return message ID
            return {"ok": success} if success else None
        else:
            payload["channel"] = self._channel_id
            if thread_ts:
                payload["thread_ts"] = thread_ts
            return await self._api_request("chat.postMessage", **payload)

    async def _update_message(
        self,
        ts: str,
        text: str | None = None,
        *,
        blocks: list[dict] | None = None,
    ) -> dict | None:
        """Update a message (bot mode only).

        Args:
            ts: Message timestamp to update
            text: New plain text message
            blocks: New Block Kit blocks

        Returns:
            API response, or None on error
        """
        if self._mode != "bot":
            print("[PocketPing] Slack: Message update only available in bot mode")
            return None

        params: dict = {
            "channel": self._channel_id,
            "ts": ts,
        }

        if text:
            params["text"] = text
        if blocks:
            params["blocks"] = blocks

        return await self._api_request("chat.update", **params)

    async def _delete_message(self, ts: str) -> bool:
        """Delete a message (bot mode only).

        Args:
            ts: Message timestamp to delete

        Returns:
            True if successful, False otherwise
        """
        if self._mode != "bot":
            print("[PocketPing] Slack: Message delete only available in bot mode")
            return False

        result = await self._api_request(
            "chat.delete",
            channel=self._channel_id,
            ts=ts,
        )
        return result is not None

    def _create_section_block(
        self,
        text: str,
        *,
        markdown: bool = True,
    ) -> dict:
        """Create a section block.

        Args:
            text: Block text
            markdown: Use markdown formatting

        Returns:
            Section block dict
        """
        return {
            "type": "section",
            "text": {
                "type": "mrkdwn" if markdown else "plain_text",
                "text": text,
            },
        }

    def _create_header_block(self, text: str) -> dict:
        """Create a header block.

        Args:
            text: Header text

        Returns:
            Header block dict
        """
        return {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": text,
                "emoji": True,
            },
        }

    def _create_context_block(self, elements: list[str]) -> dict:
        """Create a context block.

        Args:
            elements: List of text elements

        Returns:
            Context block dict
        """
        return {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": el}
                for el in elements
            ],
        }

    def _create_divider_block(self) -> dict:
        """Create a divider block."""
        return {"type": "divider"}

    async def on_new_session(self, session: Session) -> None:
        """Send notification for new chat session."""
        visitor_display = session.visitor_id[:8]
        if session.identity:
            if session.identity.name:
                visitor_display = session.identity.name
            elif session.identity.email:
                visitor_display = session.identity.email

        blocks = [
            self._create_header_block("New chat session"),
            self._create_section_block(f"*Visitor:* {visitor_display}"),
        ]

        if session.metadata and session.metadata.url:
            blocks.append(
                self._create_section_block(f"*Page:* {session.metadata.url}")
            )

        await self._send_message(
            text=f"New chat session from {visitor_display}",
            blocks=blocks,
        )

    async def on_visitor_message(
        self, message: Message, session: Session
    ) -> BridgeMessageResult | None:
        """Send visitor message to Slack.

        Returns:
            BridgeMessageResult with the Slack message timestamp
        """
        if message.sender != Sender.VISITOR:
            return None

        visitor_display = session.visitor_id[:8]
        if session.identity:
            if session.identity.name:
                visitor_display = session.identity.name
            elif session.identity.email:
                visitor_display = session.identity.email

        blocks = []
        if message.reply_to and self._pocketping:
            try:
                reply_target = await self._pocketping.storage.get_message(message.reply_to)
                if reply_target:
                    sender_label = (
                        "Visitor"
                        if reply_target.sender == Sender.VISITOR
                        else "Support"
                        if reply_target.sender == Sender.OPERATOR
                        else "AI"
                    )
                    preview = (
                        "Message deleted"
                        if reply_target.deleted_at
                        else (reply_target.content or "Message")
                    )
                    if len(preview) > 140:
                        preview = preview[:140] + "..."
                    quote = f"> *{sender_label}* — {preview}"
                    blocks.append(self._create_section_block(quote))
            except Exception as e:
                print(f"[PocketPing] Slack reply lookup error: {e}")

        blocks.extend(
            [
                self._create_section_block(message.content),
                self._create_context_block([f"From: {visitor_display}"]),
            ]
        )

        result = await self._send_message(
            text=f"{visitor_display}: {message.content}",
            blocks=blocks,
        )

        if result and "ts" in result:
            return BridgeMessageResult(message_id=result["ts"])

        return BridgeMessageResult()

    async def on_message_edit(
        self,
        message: Message,
        session: Session,
        platform_message_id: str | int | None = None,
    ) -> None:
        """Edit a message on Slack (bot mode only)."""
        if not platform_message_id:
            print("[PocketPing] Slack: Cannot edit message without platform_message_id")
            return

        if self._mode != "bot":
            print("[PocketPing] Slack: Message edit only available in bot mode")
            return

        visitor_display = session.visitor_id[:8]
        if session.identity:
            if session.identity.name:
                visitor_display = session.identity.name
            elif session.identity.email:
                visitor_display = session.identity.email

        blocks = [
            self._create_section_block(f"{message.content}\n_(edited)_"),
            self._create_context_block([f"From: {visitor_display}"]),
        ]

        await self._update_message(
            str(platform_message_id),
            text=f"{visitor_display}: {message.content} (edited)",
            blocks=blocks,
        )

    async def on_message_delete(
        self,
        message: Message,
        session: Session,
        platform_message_id: str | int | None = None,
    ) -> None:
        """Delete a message on Slack (bot mode only)."""
        if not platform_message_id:
            print("[PocketPing] Slack: Cannot delete message without platform_message_id")
            return

        if self._mode != "bot":
            print("[PocketPing] Slack: Message delete only available in bot mode")
            return

        await self._delete_message(str(platform_message_id))

    async def on_typing(self, session_id: str, is_typing: bool) -> None:
        """Handle typing indicator (Slack doesn't support this for bots)."""
        # Slack doesn't have a typing indicator API for bots
        pass

    async def on_ai_takeover(self, session: Session, reason: str) -> None:
        """Notify when AI takes over a conversation."""
        blocks = [
            self._create_header_block("AI Takeover"),
            self._create_section_block(
                f"*Session:* `{session.id[:8]}`\n*Reason:* {reason}"
            ),
        ]

        await self._send_message(
            text=f"AI Takeover - Session: {session.id[:8]} - Reason: {reason}",
            blocks=blocks,
        )

    async def on_operator_message(
        self,
        message: Message,
        session: Session,
        source_bridge: str | None = None,
        operator_name: str | None = None,
    ) -> None:
        """Show operator messages from other bridges (cross-bridge sync)."""
        # Skip if message is from this bridge
        if source_bridge == self.name:
            return

        name = operator_name or "Operator"
        source_text = f" via {source_bridge}" if source_bridge else ""

        blocks = [
            self._create_section_block(message.content),
            self._create_context_block([f"{name}{source_text}"]),
        ]

        await self._send_message(
            text=f"{name}{source_text}: {message.content}",
            blocks=blocks,
        )

    async def on_message_read(
        self,
        session_id: str,
        message_ids: list[str],
        status: MessageStatus,
        session: Session,
    ) -> None:
        """Handle read receipts (no-op for Slack in this implementation)."""
        # Slack doesn't have a built-in way to show read receipts
        # This could be extended to use reactions if in bot mode
        pass

    async def on_custom_event(self, event, session: Session) -> None:
        """Handle custom events."""
        blocks = [
            self._create_header_block("Custom Event"),
            self._create_section_block(
                f"*Event:* {event.name}\n*Session:* `{session.id[:8]}`"
            ),
        ]

        if event.data:
            blocks.append(
                self._create_section_block(f"```{event.data}```")
            )

        await self._send_message(
            text=f"Custom Event: {event.name}",
            blocks=blocks,
        )

    async def on_identity_update(self, session: Session) -> None:
        """Handle identity updates."""
        if not session.identity:
            return

        parts = []
        if session.identity.name:
            parts.append(f"*Name:* {session.identity.name}")
        if session.identity.email:
            parts.append(f"*Email:* {session.identity.email}")
        if session.user_phone:
            parts.append(f"*Phone:* {session.user_phone}")
        parts.append(f"*Session:* `{session.id[:8]}`")

        blocks = [
            self._create_header_block("Identity Updated"),
            self._create_section_block("\n".join(parts)),
        ]

        await self._send_message(
            text="Identity Updated",
            blocks=blocks,
        )

    async def destroy(self) -> None:
        """Close the httpx client."""
        if self._client:
            await self._client.aclose()
            self._client = None

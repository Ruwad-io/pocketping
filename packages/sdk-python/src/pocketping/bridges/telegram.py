"""Telegram bridge for PocketPing using httpx."""

from typing import TYPE_CHECKING

import httpx

from pocketping.bridges.base import Bridge
from pocketping.models import BridgeMessageResult, Message, MessageStatus, Sender, Session

if TYPE_CHECKING:
    from pocketping.core import PocketPing


class TelegramBridge(Bridge):
    """Telegram notification bridge using httpx.

    Sends notifications to Telegram via the Bot API using httpx.
    This is a lightweight implementation that only sends messages
    (no polling/webhooks for receiving operator replies).

    For bidirectional communication, use the full python-telegram-bot
    package or handle incoming webhooks separately.

    Usage:
        from pocketping import PocketPing
        from pocketping.bridges import TelegramBridge

        pp = PocketPing(
            bridges=[
                TelegramBridge(
                    bot_token="your_bot_token",
                    chat_id="your_chat_id",  # Can be user ID, group ID, or channel
                )
            ]
        )

    Setup:
        1. Create a bot with @BotFather on Telegram
        2. Get your chat_id (send a message to @userinfobot)
        3. For groups: add the bot to the group and get the group ID
    """

    def __init__(
        self,
        bot_token: str,
        chat_id: str | int,
        *,
        parse_mode: str = "HTML",
        disable_notification: bool = False,
    ):
        """Initialize Telegram bridge.

        Args:
            bot_token: Telegram bot token from @BotFather
            chat_id: Chat ID to send notifications to (user, group, or channel)
            parse_mode: Message parse mode ("HTML", "Markdown", "MarkdownV2")
            disable_notification: Send messages silently
        """
        self.bot_token = bot_token
        self.chat_id = str(chat_id)
        self.parse_mode = parse_mode
        self.disable_notification = disable_notification

        self._base_url = f"https://api.telegram.org/bot{bot_token}"
        self._client: httpx.AsyncClient | None = None
        self._pocketping: "PocketPing | None" = None

    @property
    def name(self) -> str:
        return "telegram"

    async def init(self, pocketping: "PocketPing") -> None:
        """Initialize the bridge with an httpx client."""
        self._pocketping = pocketping
        self._client = httpx.AsyncClient(timeout=30.0)

    async def _request(
        self,
        method: str,
        **params,
    ) -> dict | None:
        """Make a request to the Telegram Bot API.

        Args:
            method: API method name (e.g., "sendMessage")
            **params: Parameters to send with the request

        Returns:
            API response as dict, or None on error
        """
        if not self._client:
            print("[PocketPing] Telegram bridge not initialized")
            return None

        url = f"{self._base_url}/{method}"

        try:
            response = await self._client.post(url, json=params)
            data = response.json()

            if not data.get("ok"):
                error_desc = data.get("description", "Unknown error")
                print(f"[PocketPing] Telegram API error: {error_desc}")
                return None

            return data.get("result")
        except httpx.HTTPError as e:
            print(f"[PocketPing] Telegram HTTP error: {e}")
            return None
        except Exception as e:
            print(f"[PocketPing] Telegram error: {e}")
            return None

    async def _send_message(
        self,
        text: str,
        *,
        reply_to_message_id: int | None = None,
    ) -> dict | None:
        """Send a message to the configured chat.

        Args:
            text: Message text
            reply_to_message_id: Optional message ID to reply to

        Returns:
            API response with message details, or None on error
        """
        params = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": self.parse_mode,
            "disable_notification": self.disable_notification,
        }

        if reply_to_message_id:
            params["reply_to_message_id"] = reply_to_message_id

        return await self._request("sendMessage", **params)

    async def _edit_message(
        self,
        message_id: int,
        text: str,
    ) -> dict | None:
        """Edit a message.

        Args:
            message_id: ID of the message to edit
            text: New message text

        Returns:
            API response, or None on error
        """
        return await self._request(
            "editMessageText",
            chat_id=self.chat_id,
            message_id=message_id,
            text=text,
            parse_mode=self.parse_mode,
        )

    async def _delete_message(self, message_id: int) -> bool:
        """Delete a message.

        Args:
            message_id: ID of the message to delete

        Returns:
            True if successful, False otherwise
        """
        result = await self._request(
            "deleteMessage",
            chat_id=self.chat_id,
            message_id=message_id,
        )
        return result is True

    async def _send_chat_action(self, action: str = "typing") -> None:
        """Send a chat action (typing indicator).

        Args:
            action: Action to send (typing, upload_photo, etc.)
        """
        await self._request(
            "sendChatAction",
            chat_id=self.chat_id,
            action=action,
        )

    def _format_session_text(self, session: Session) -> str:
        """Format session information for the new session notification."""
        visitor_display = session.visitor_id[:8]
        if session.identity:
            if session.identity.name:
                visitor_display = session.identity.name
            elif session.identity.email:
                visitor_display = session.identity.email

        parts = [
            "<b>New chat session</b>",
            f"<b>Visitor:</b> {self._escape_html(visitor_display)}",
        ]

        if session.metadata:
            if session.metadata.url:
                parts.append(f"<b>Page:</b> {self._escape_html(session.metadata.url)}")
            if session.metadata.ip:
                parts.append(f"<b>IP:</b> <code>{session.metadata.ip}</code>")
            if session.metadata.country:
                location = session.metadata.country
                if session.metadata.city:
                    location = f"{session.metadata.city}, {location}"
                parts.append(f"<b>Location:</b> {self._escape_html(location)}")

        return "\n".join(parts)

    def _format_message_text(self, message: Message, session: Session) -> str:
        """Format a visitor message for Telegram."""
        visitor_display = session.visitor_id[:8]
        if session.identity:
            if session.identity.name:
                visitor_display = session.identity.name
            elif session.identity.email:
                visitor_display = session.identity.email

        content = self._escape_html(message.content)
        return f"<b>{self._escape_html(visitor_display)}:</b>\n{content}"

    def _escape_html(self, text: str) -> str:
        """Escape HTML special characters."""
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )

    async def on_new_session(self, session: Session) -> None:
        """Send notification for new chat session."""
        visitor_display = session.visitor_id[:8]
        if session.identity:
            if session.identity.name:
                visitor_display = session.identity.name
            elif session.identity.email:
                visitor_display = session.identity.email

        url_part = ""
        if session.metadata and session.metadata.url:
            url_part = f"\n<b>Page:</b> {self._escape_html(session.metadata.url)}"

        text = (
            f"<b>New chat session</b>\n"
            f"<b>Visitor:</b> {self._escape_html(visitor_display)}"
            f"{url_part}"
        )

        await self._send_message(text)

    async def on_visitor_message(
        self, message: Message, session: Session
    ) -> BridgeMessageResult | None:
        """Send visitor message to Telegram.

        Returns:
            BridgeMessageResult with the Telegram message ID
        """
        if message.sender != Sender.VISITOR:
            return None

        text = self._format_message_text(message, session)
        reply_to_message_id: int | None = None

        if message.reply_to and self._pocketping:
            try:
                bridge_ids = await self._pocketping.storage.get_bridge_message_ids(
                    message.reply_to
                )
                if bridge_ids and bridge_ids.telegram_message_id:
                    reply_to_message_id = bridge_ids.telegram_message_id
            except Exception as e:
                print(f"[PocketPing] Telegram reply lookup error: {e}")

        result = await self._send_message(text, reply_to_message_id=reply_to_message_id)

        if result and "message_id" in result:
            return BridgeMessageResult(message_id=result["message_id"])

        return BridgeMessageResult()

    async def on_message_edit(
        self,
        message: Message,
        session: Session,
        platform_message_id: str | int | None = None,
    ) -> None:
        """Edit a message on Telegram."""
        if not platform_message_id:
            print("[PocketPing] Telegram: Cannot edit message without platform_message_id")
            return

        visitor_display = session.visitor_id[:8]
        if session.identity:
            if session.identity.name:
                visitor_display = session.identity.name
            elif session.identity.email:
                visitor_display = session.identity.email

        content = self._escape_html(message.content)
        text = f"<b>{self._escape_html(visitor_display)}:</b>\n{content}\n<i>(edited)</i>"

        await self._edit_message(int(platform_message_id), text)

    async def on_message_delete(
        self,
        message: Message,
        session: Session,
        platform_message_id: str | int | None = None,
    ) -> None:
        """Delete a message on Telegram."""
        if not platform_message_id:
            print("[PocketPing] Telegram: Cannot delete message without platform_message_id")
            return

        await self._delete_message(int(platform_message_id))

    async def on_typing(self, session_id: str, is_typing: bool) -> None:
        """Send typing indicator to Telegram."""
        if is_typing:
            await self._send_chat_action("typing")

    async def on_ai_takeover(self, session: Session, reason: str) -> None:
        """Notify when AI takes over a conversation."""
        text = (
            f"<b>AI Takeover</b>\n"
            f"Session: <code>{session.id[:8]}</code>\n"
            f"Reason: {self._escape_html(reason)}"
        )
        await self._send_message(text)

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

        content = self._escape_html(message.content)
        text = f"<b>{self._escape_html(name)}</b>{source_text}:\n{content}"

        await self._send_message(text)

    async def on_message_read(
        self,
        session_id: str,
        message_ids: list[str],
        status: MessageStatus,
        session: Session,
    ) -> None:
        """Handle read receipts (no-op for Telegram in this implementation)."""
        # Telegram doesn't have a built-in way to show read receipts
        # This could be extended to use reactions if needed
        pass

    async def on_custom_event(self, event, session: Session) -> None:
        """Handle custom events."""
        text = (
            f"<b>Event:</b> {self._escape_html(event.name)}\n"
            f"Session: <code>{session.id[:8]}</code>"
        )
        if event.data:
            text += f"\nData: <code>{event.data}</code>"

        await self._send_message(text)

    async def on_identity_update(self, session: Session) -> None:
        """Handle identity updates."""
        if not session.identity:
            return

        parts = ["<b>Identity Updated</b>"]
        if session.identity.name:
            parts.append(f"Name: {self._escape_html(session.identity.name)}")
        if session.identity.email:
            parts.append(f"Email: {self._escape_html(session.identity.email)}")
        if session.user_phone:
            parts.append(f"Phone: {self._escape_html(session.user_phone)}")
        parts.append(f"Session: <code>{session.id[:8]}</code>")

        await self._send_message("\n".join(parts))

    async def destroy(self) -> None:
        """Close the httpx client."""
        if self._client:
            await self._client.aclose()
            self._client = None

"""Discord bridge for PocketPing using httpx."""

import re
from typing import TYPE_CHECKING

import httpx

from pocketping.bridges.base import Bridge
from pocketping.models import BridgeMessageResult, Message, MessageStatus, Sender, Session

if TYPE_CHECKING:
    from pocketping.core import PocketPing


class DiscordBridge(Bridge):
    """Discord notification bridge using httpx.

    Supports two modes:
    1. Webhook mode: Simple, no authentication needed, send-only
    2. Bot mode: Full API access with bot token, can edit/delete messages

    Webhook mode (recommended for simple notifications):
        from pocketping import PocketPing
        from pocketping.bridges import DiscordBridge

        pp = PocketPing(
            bridges=[
                DiscordBridge(
                    webhook_url="https://discord.com/api/webhooks/123/abc",
                    username="PocketPing",  # Optional custom username
                    avatar_url="https://example.com/avatar.png",  # Optional avatar
                )
            ]
        )

    Bot mode (for full functionality):
        pp = PocketPing(
            bridges=[
                DiscordBridge(
                    bot_token="your_bot_token",
                    channel_id="123456789",
                )
            ]
        )

    Setup (Webhook mode):
        1. Go to your Discord channel settings
        2. Click "Integrations" > "Webhooks" > "New Webhook"
        3. Copy the webhook URL

    Setup (Bot mode):
        1. Create a Discord application at https://discord.com/developers/applications
        2. Go to "Bot" and click "Add Bot"
        3. Copy the bot token
        4. Enable MESSAGE CONTENT INTENT if needed
        5. Invite the bot with permissions: Send Messages, Embed Links, Read Message History
        6. Get the channel ID (Enable Developer Mode, right-click channel, Copy ID)
    """

    def __init__(
        self,
        # Webhook mode
        webhook_url: str | None = None,
        *,
        username: str | None = None,
        avatar_url: str | None = None,
        # Bot mode
        bot_token: str | None = None,
        channel_id: str | None = None,
    ):
        """Initialize Discord bridge.

        Args:
            webhook_url: Discord webhook URL (for webhook mode)
            username: Custom username for webhook messages
            avatar_url: Custom avatar URL for webhook messages
            bot_token: Discord bot token (for bot mode)
            channel_id: Channel ID to send messages to (for bot mode)
        """
        # Validate that either webhook or bot mode is configured
        if webhook_url:
            self._mode = "webhook"
            self._webhook_url = webhook_url
            # Extract webhook ID and token from URL
            match = re.match(
                r"https://discord\.com/api/webhooks/(\d+)/([^/\s]+)",
                webhook_url,
            )
            if match:
                self._webhook_id = match.group(1)
                self._webhook_token = match.group(2)
            else:
                raise ValueError("Invalid Discord webhook URL")
        elif bot_token and channel_id:
            self._mode = "bot"
            self._bot_token = bot_token
            self._channel_id = channel_id
        else:
            raise ValueError(
                "Either webhook_url or (bot_token + channel_id) must be provided"
            )

        self._username = username
        self._avatar_url = avatar_url
        self._client: httpx.AsyncClient | None = None
        self._pocketping: "PocketPing | None" = None

        # Base URL for Discord API
        self._api_base = "https://discord.com/api/v10"

    @property
    def name(self) -> str:
        return "discord"

    async def init(self, pocketping: "PocketPing") -> None:
        """Initialize the bridge with an httpx client."""
        self._pocketping = pocketping

        headers = {}
        if self._mode == "bot":
            headers["Authorization"] = f"Bot {self._bot_token}"

        self._client = httpx.AsyncClient(
            timeout=30.0,
            headers=headers,
        )

    async def _webhook_request(
        self,
        method: str = "POST",
        *,
        json_data: dict | None = None,
        message_id: str | None = None,
    ) -> dict | None:
        """Make a request to the Discord webhook.

        Args:
            method: HTTP method
            json_data: JSON data to send
            message_id: Message ID for edit/delete operations

        Returns:
            API response as dict, or None on error
        """
        if not self._client:
            print("[PocketPing] Discord bridge not initialized")
            return None

        url = self._webhook_url
        if message_id:
            url = f"{url}/messages/{message_id}"

        # Add wait=true to get the message back
        if method == "POST" and "?" not in url:
            url = f"{url}?wait=true"

        try:
            if method == "POST":
                response = await self._client.post(url, json=json_data)
            elif method == "PATCH":
                response = await self._client.patch(url, json=json_data)
            elif method == "DELETE":
                response = await self._client.delete(url)
                return {"deleted": True} if response.status_code == 204 else None
            else:
                return None

            if response.status_code >= 400:
                error_text = response.text
                print(f"[PocketPing] Discord webhook error: {response.status_code} - {error_text}")
                return None

            if response.status_code == 204:
                return {"success": True}

            return response.json()
        except httpx.HTTPError as e:
            print(f"[PocketPing] Discord HTTP error: {e}")
            return None
        except Exception as e:
            print(f"[PocketPing] Discord error: {e}")
            return None

    async def _bot_request(
        self,
        method: str,
        endpoint: str,
        *,
        json_data: dict | None = None,
    ) -> dict | None:
        """Make a request to the Discord Bot API.

        Args:
            method: HTTP method
            endpoint: API endpoint (e.g., "/channels/123/messages")
            json_data: JSON data to send

        Returns:
            API response as dict, or None on error
        """
        if not self._client:
            print("[PocketPing] Discord bridge not initialized")
            return None

        url = f"{self._api_base}{endpoint}"

        try:
            if method == "POST":
                response = await self._client.post(url, json=json_data)
            elif method == "PATCH":
                response = await self._client.patch(url, json=json_data)
            elif method == "DELETE":
                response = await self._client.delete(url)
                return {"deleted": True} if response.status_code == 204 else None
            elif method == "GET":
                response = await self._client.get(url)
            else:
                return None

            if response.status_code >= 400:
                error_text = response.text
                print(f"[PocketPing] Discord API error: {response.status_code} - {error_text}")
                return None

            if response.status_code == 204:
                return {"success": True}

            return response.json()
        except httpx.HTTPError as e:
            print(f"[PocketPing] Discord HTTP error: {e}")
            return None
        except Exception as e:
            print(f"[PocketPing] Discord error: {e}")
            return None

    async def _send_message(
        self,
        content: str | None = None,
        *,
        embeds: list[dict] | None = None,
        reply_to_message_id: str | None = None,
    ) -> dict | None:
        """Send a message to Discord.

        Args:
            content: Plain text content
            embeds: List of embed objects

        Returns:
            API response with message details, or None on error
        """
        data: dict = {}

        if content:
            data["content"] = content
        if embeds:
            data["embeds"] = embeds
        if reply_to_message_id:
            data["message_reference"] = {"message_id": reply_to_message_id}

        # Add webhook-specific options
        if self._mode == "webhook":
            if self._username:
                data["username"] = self._username
            if self._avatar_url:
                data["avatar_url"] = self._avatar_url
            return await self._webhook_request("POST", json_data=data)
        else:
            return await self._bot_request(
                "POST",
                f"/channels/{self._channel_id}/messages",
                json_data=data,
            )

    async def _edit_message(
        self,
        message_id: str,
        content: str | None = None,
        *,
        embeds: list[dict] | None = None,
    ) -> dict | None:
        """Edit a message.

        Args:
            message_id: ID of the message to edit
            content: New plain text content
            embeds: New list of embed objects

        Returns:
            API response, or None on error
        """
        data: dict = {}
        if content:
            data["content"] = content
        if embeds:
            data["embeds"] = embeds

        if self._mode == "webhook":
            return await self._webhook_request("PATCH", json_data=data, message_id=message_id)
        else:
            return await self._bot_request(
                "PATCH",
                f"/channels/{self._channel_id}/messages/{message_id}",
                json_data=data,
            )

    async def _delete_message(self, message_id: str) -> bool:
        """Delete a message.

        Args:
            message_id: ID of the message to delete

        Returns:
            True if successful, False otherwise
        """
        if self._mode == "webhook":
            result = await self._webhook_request("DELETE", message_id=message_id)
        else:
            result = await self._bot_request(
                "DELETE",
                f"/channels/{self._channel_id}/messages/{message_id}",
            )
        return result is not None

    def _create_embed(
        self,
        *,
        title: str | None = None,
        description: str | None = None,
        color: int | None = None,
        footer: str | None = None,
        author_name: str | None = None,
        author_icon: str | None = None,
    ) -> dict:
        """Create a Discord embed object.

        Args:
            title: Embed title
            description: Embed description
            color: Embed color (integer)
            footer: Footer text
            author_name: Author name
            author_icon: Author icon URL

        Returns:
            Embed object dict
        """
        embed: dict = {}
        if title:
            embed["title"] = title
        if description:
            embed["description"] = description
        if color is not None:
            embed["color"] = color
        if footer:
            embed["footer"] = {"text": footer}
        if author_name:
            author: dict = {"name": author_name}
            if author_icon:
                author["icon_url"] = author_icon
            embed["author"] = author
        return embed

    async def on_new_session(self, session: Session) -> None:
        """Send notification for new chat session."""
        visitor_display = session.visitor_id[:8]
        if session.identity:
            if session.identity.name:
                visitor_display = session.identity.name
            elif session.identity.email:
                visitor_display = session.identity.email

        description_parts = [f"**Visitor:** {visitor_display}"]

        if session.metadata and session.metadata.url:
            description_parts.append(f"**Page:** {session.metadata.url}")

        embed = self._create_embed(
            title="New chat session",
            description="\n".join(description_parts),
            color=0x5865F2,  # Discord blurple
        )

        await self._send_message(embeds=[embed])

    async def on_visitor_message(
        self, message: Message, session: Session
    ) -> BridgeMessageResult | None:
        """Send visitor message to Discord.

        Returns:
            BridgeMessageResult with the Discord message ID
        """
        if message.sender != Sender.VISITOR:
            return None

        visitor_display = session.visitor_id[:8]
        if session.identity:
            if session.identity.name:
                visitor_display = session.identity.name
            elif session.identity.email:
                visitor_display = session.identity.email

        embed = self._create_embed(
            description=message.content,
            color=0x9B59B6,  # Purple
            author_name=f"{visitor_display}",
        )

        reply_to_message_id: str | None = None
        if message.reply_to and self._pocketping:
            try:
                bridge_ids = await self._pocketping.storage.get_bridge_message_ids(
                    message.reply_to
                )
                if bridge_ids and bridge_ids.discord_message_id:
                    reply_to_message_id = bridge_ids.discord_message_id
            except Exception as e:
                print(f"[PocketPing] Discord reply lookup error: {e}")

        result = await self._send_message(
            embeds=[embed],
            reply_to_message_id=reply_to_message_id,
        )

        if result and "id" in result:
            return BridgeMessageResult(message_id=result["id"])

        return BridgeMessageResult()

    async def on_message_edit(
        self,
        message: Message,
        session: Session,
        platform_message_id: str | int | None = None,
    ) -> None:
        """Edit a message on Discord."""
        if not platform_message_id:
            print("[PocketPing] Discord: Cannot edit message without platform_message_id")
            return

        visitor_display = session.visitor_id[:8]
        if session.identity:
            if session.identity.name:
                visitor_display = session.identity.name
            elif session.identity.email:
                visitor_display = session.identity.email

        embed = self._create_embed(
            description=f"{message.content}\n\n*(edited)*",
            color=0x9B59B6,  # Purple
            author_name=f"{visitor_display}",
        )

        await self._edit_message(str(platform_message_id), embeds=[embed])

    async def on_message_delete(
        self,
        message: Message,
        session: Session,
        platform_message_id: str | int | None = None,
    ) -> None:
        """Delete a message on Discord."""
        if not platform_message_id:
            print("[PocketPing] Discord: Cannot delete message without platform_message_id")
            return

        await self._delete_message(str(platform_message_id))

    async def on_typing(self, session_id: str, is_typing: bool) -> None:
        """Send typing indicator to Discord (bot mode only)."""
        if not is_typing or self._mode != "bot":
            return

        await self._bot_request(
            "POST",
            f"/channels/{self._channel_id}/typing",
        )

    async def on_ai_takeover(self, session: Session, reason: str) -> None:
        """Notify when AI takes over a conversation."""
        embed = self._create_embed(
            title="AI Takeover",
            description=f"Session: `{session.id[:8]}`\nReason: {reason}",
            color=0xFFA500,  # Orange
        )
        await self._send_message(embeds=[embed])

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

        embed = self._create_embed(
            description=message.content,
            color=0x99AAB5,  # Greyple
            author_name=f"{name}{source_text}",
        )

        await self._send_message(embeds=[embed])

    async def on_message_read(
        self,
        session_id: str,
        message_ids: list[str],
        status: MessageStatus,
        session: Session,
    ) -> None:
        """Handle read receipts (no-op for Discord in this implementation)."""
        # Discord doesn't have a built-in way to show read receipts
        # This could be extended to use reactions if in bot mode
        pass

    async def on_custom_event(self, event, session: Session) -> None:
        """Handle custom events."""
        description = f"**Event:** {event.name}\nSession: `{session.id[:8]}`"
        if event.data:
            description += f"\n```json\n{event.data}\n```"

        embed = self._create_embed(
            title="Custom Event",
            description=description,
            color=0x3498DB,  # Blue
        )

        await self._send_message(embeds=[embed])

    async def on_identity_update(self, session: Session) -> None:
        """Handle identity updates."""
        if not session.identity:
            return

        parts = []
        if session.identity.name:
            parts.append(f"**Name:** {session.identity.name}")
        if session.identity.email:
            parts.append(f"**Email:** {session.identity.email}")
        if session.user_phone:
            parts.append(f"**Phone:** {session.user_phone}")
        parts.append(f"Session: `{session.id[:8]}`")

        embed = self._create_embed(
            title="Identity Updated",
            description="\n".join(parts),
            color=0x2ECC71,  # Green
        )

        await self._send_message(embeds=[embed])

    async def destroy(self) -> None:
        """Close the httpx client."""
        if self._client:
            await self._client.aclose()
            self._client = None

"""Slack bridge for PocketPing."""

import asyncio
from typing import TYPE_CHECKING, Optional

from pocketping.bridges.base import Bridge
from pocketping.models import Message, Session, Sender

if TYPE_CHECKING:
    from pocketping.core import PocketPing


class SlackBridge(Bridge):
    """Slack notification bridge.

    Receives notifications in Slack and can reply directly using Slack's thread replies.

    Usage:
        from pocketping import PocketPing
        from pocketping.bridges.slack import SlackBridge

        pp = PocketPing(
            bridges=[
                SlackBridge(
                    bot_token="xoxb-your-bot-token",
                    app_token="xapp-your-app-token",  # For Socket Mode
                    channel_id="C0123456789",
                )
            ]
        )

    Setup:
        1. Create a Slack app at https://api.slack.com/apps
        2. Enable Socket Mode and get an App-Level Token (xapp-...)
        3. Add bot scopes: chat:write, channels:history, channels:read
        4. Install to workspace and get Bot Token (xoxb-...)
        5. Invite bot to the channel
    """

    def __init__(
        self,
        bot_token: str,
        app_token: str,
        channel_id: str,
        show_url: bool = True,
    ):
        self.bot_token = bot_token
        self.app_token = app_token
        self.channel_id = channel_id
        self.show_url = show_url
        self._pocketping: Optional["PocketPing"] = None
        self._client = None
        self._socket_client = None
        self._session_thread_map: dict[str, str] = {}  # session_id -> thread_ts
        self._thread_session_map: dict[str, str] = {}  # thread_ts -> session_id

    @property
    def name(self) -> str:
        return "slack"

    async def init(self, pocketping: "PocketPing") -> None:
        self._pocketping = pocketping

        try:
            from slack_sdk.web.async_client import AsyncWebClient
            from slack_sdk.socket_mode.aiohttp import SocketModeClient
            from slack_sdk.socket_mode.request import SocketModeRequest
            from slack_sdk.socket_mode.response import SocketModeResponse
        except ImportError:
            raise ImportError(
                "slack-sdk required. Install with: pip install pocketping[slack]"
            )

        self._client = AsyncWebClient(token=self.bot_token)
        self._socket_client = SocketModeClient(
            app_token=self.app_token,
            web_client=self._client,
        )

        # Handle message events
        async def handle_socket_event(client: SocketModeClient, req: SocketModeRequest):
            if req.type == "events_api":
                # Acknowledge the event
                response = SocketModeResponse(envelope_id=req.envelope_id)
                await client.send_socket_mode_response(response)

                event = req.payload.get("event", {})

                if event.get("type") == "message" and not event.get("bot_id"):
                    await self._handle_message_event(event)

                elif event.get("type") == "app_mention":
                    await self._handle_mention(event)

            elif req.type == "slash_commands":
                response = SocketModeResponse(envelope_id=req.envelope_id)
                await client.send_socket_mode_response(response)
                await self._handle_slash_command(req.payload)

        self._socket_client.socket_mode_request_listeners.append(handle_socket_event)

        # Start socket mode
        asyncio.create_task(self._socket_client.connect())

        # Send startup message
        await self._client.chat_postMessage(
            channel=self.channel_id,
            blocks=[
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": (
                            "🔔 *PocketPing Connected*\n\n"
                            "*Commands (mention me):*\n"
                            "• `@PocketPing online` - Mark yourself as available\n"
                            "• `@PocketPing offline` - Mark yourself as away\n"
                            "• `@PocketPing status` - View current status\n\n"
                            "_Reply in thread to respond to users._"
                        ),
                    },
                }
            ],
        )

    async def _handle_message_event(self, event: dict) -> None:
        """Handle incoming messages (thread replies)."""
        if not self._pocketping:
            return

        thread_ts = event.get("thread_ts")
        if not thread_ts:
            return  # Not a thread reply

        session_id = self._thread_session_map.get(thread_ts)
        if not session_id:
            return  # Not a tracked thread

        text = event.get("text", "")
        if not text:
            return

        try:
            await self._pocketping.send_operator_message(session_id, text)
            self._pocketping.set_operator_online(True)

            # React to confirm
            await self._client.reactions_add(
                channel=self.channel_id,
                name="white_check_mark",
                timestamp=event.get("ts"),
            )
        except Exception as e:
            await self._client.chat_postMessage(
                channel=self.channel_id,
                thread_ts=thread_ts,
                text=f"❌ Failed to send: {e}",
            )

    async def _handle_mention(self, event: dict) -> None:
        """Handle @mentions for commands."""
        if not self._pocketping:
            return

        text = event.get("text", "").lower()

        if "online" in text:
            self._pocketping.set_operator_online(True)
            await self._client.chat_postMessage(
                channel=self.channel_id,
                text="✅ You're now online. Users will see you as available.",
            )
        elif "offline" in text:
            self._pocketping.set_operator_online(False)
            await self._client.chat_postMessage(
                channel=self.channel_id,
                text="🌙 You're now offline. AI will handle conversations if configured.",
            )
        elif "status" in text:
            online = self._pocketping.is_operator_online()
            status = "🟢 Online" if online else "🔴 Offline"
            await self._client.chat_postMessage(
                channel=self.channel_id,
                text=f"📊 *Status*: {status}",
            )

    async def _handle_slash_command(self, payload: dict) -> None:
        """Handle slash commands."""
        # You can add custom slash commands here
        pass

    async def on_new_session(self, session: Session) -> None:
        if not self._client:
            return

        fields = [
            {
                "type": "mrkdwn",
                "text": f"*Session*\n`{session.id[:8]}...`",
            }
        ]

        if self.show_url and session.metadata and session.metadata.url:
            fields.append({
                "type": "mrkdwn",
                "text": f"*Page*\n{session.metadata.url}",
            })

        if session.metadata and session.metadata.referrer:
            fields.append({
                "type": "mrkdwn",
                "text": f"*From*\n{session.metadata.referrer}",
            })

        result = await self._client.chat_postMessage(
            channel=self.channel_id,
            blocks=[
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": "🆕 New Visitor",
                    },
                },
                {
                    "type": "section",
                    "fields": fields,
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": "_Reply in this thread to respond to the user_",
                        }
                    ],
                },
            ],
        )

        thread_ts = result.get("ts")
        if thread_ts:
            self._session_thread_map[session.id] = thread_ts
            self._thread_session_map[thread_ts] = session.id

    async def on_message(self, message: Message, session: Session) -> None:
        if message.sender != Sender.VISITOR or not self._client:
            return

        thread_ts = self._session_thread_map.get(session.id)

        text = f"💬 *Message*\n\n{message.content}"

        if not thread_ts:
            # Create new thread for this session
            result = await self._client.chat_postMessage(
                channel=self.channel_id,
                blocks=[
                    {
                        "type": "section",
                        "text": {"type": "mrkdwn", "text": text},
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": f"_Session: `{session.id[:8]}...`_",
                            }
                        ],
                    },
                ],
            )
            thread_ts = result.get("ts")
            if thread_ts:
                self._session_thread_map[session.id] = thread_ts
                self._thread_session_map[thread_ts] = session.id
        else:
            # Reply in existing thread
            await self._client.chat_postMessage(
                channel=self.channel_id,
                thread_ts=thread_ts,
                text=message.content,
            )

    async def on_ai_takeover(self, session: Session, reason: str) -> None:
        if not self._client:
            return

        thread_ts = self._session_thread_map.get(session.id)

        await self._client.chat_postMessage(
            channel=self.channel_id,
            thread_ts=thread_ts,
            blocks=[
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"🤖 *AI Takeover*\nSession: `{session.id[:8]}...`\nReason: {reason}",
                    },
                }
            ],
        )

    async def destroy(self) -> None:
        if self._socket_client:
            await self._socket_client.close()

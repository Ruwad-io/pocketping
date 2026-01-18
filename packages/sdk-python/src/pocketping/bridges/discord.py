"""Discord bridge for PocketPing."""

import asyncio
from typing import TYPE_CHECKING, Optional

from pocketping.bridges.base import Bridge
from pocketping.models import Message, Session, Sender

if TYPE_CHECKING:
    from pocketping.core import PocketPing


class DiscordBridge(Bridge):
    """Discord notification bridge.

    Receives notifications in Discord and can reply directly.

    Usage:
        from pocketping import PocketPing
        from pocketping.bridges.discord import DiscordBridge

        pp = PocketPing(
            bridges=[
                DiscordBridge(
                    bot_token="your_bot_token",
                    channel_id=123456789,  # Your Discord channel ID
                )
            ]
        )
    """

    def __init__(
        self,
        bot_token: str,
        channel_id: int,
        show_url: bool = True,
    ):
        self.bot_token = bot_token
        self.channel_id = channel_id
        self.show_url = show_url
        self._pocketping: Optional["PocketPing"] = None
        self._client = None
        self._channel = None
        self._session_message_map: dict[str, int] = {}  # session_id -> message_id
        self._message_session_map: dict[int, str] = {}  # message_id -> session_id
        self._ready = asyncio.Event()

    @property
    def name(self) -> str:
        return "discord"

    async def init(self, pocketping: "PocketPing") -> None:
        self._pocketping = pocketping

        try:
            import discord
            from discord.ext import commands
        except ImportError:
            raise ImportError(
                "discord.py required. Install with: pip install pocketping[discord]"
            )

        # Set up intents
        intents = discord.Intents.default()
        intents.message_content = True
        intents.messages = True

        self._client = commands.Bot(command_prefix="!", intents=intents)

        @self._client.event
        async def on_ready():
            self._channel = self._client.get_channel(self.channel_id)
            if self._channel:
                await self._channel.send(
                    embed=discord.Embed(
                        title="🔔 PocketPing Connected",
                        description=(
                            "**Commands:**\n"
                            "`!online` - Mark yourself as available\n"
                            "`!offline` - Mark yourself as away\n"
                            "`!status` - View current status\n\n"
                            "Reply to any message to respond to users."
                        ),
                        color=discord.Color.green(),
                    )
                )
            self._ready.set()

        @self._client.command(name="online")
        async def cmd_online(ctx):
            if ctx.channel.id != self.channel_id:
                return
            if self._pocketping:
                self._pocketping.set_operator_online(True)
            await ctx.send("✅ You're now online. Users will see you as available.")

        @self._client.command(name="offline")
        async def cmd_offline(ctx):
            if ctx.channel.id != self.channel_id:
                return
            if self._pocketping:
                self._pocketping.set_operator_online(False)
            await ctx.send("🌙 You're now offline. AI will handle conversations if configured.")

        @self._client.command(name="status")
        async def cmd_status(ctx):
            if ctx.channel.id != self.channel_id:
                return
            online = self._pocketping.is_operator_online() if self._pocketping else False
            status = "🟢 Online" if online else "🔴 Offline"
            await ctx.send(f"📊 **Status**: {status}")

        @self._client.event
        async def on_message(message):
            # Ignore own messages
            if message.author == self._client.user:
                return

            # Process commands
            await self._client.process_commands(message)

            # Handle replies
            if (
                message.channel.id == self.channel_id
                and message.reference
                and message.reference.message_id
            ):
                session_id = self._message_session_map.get(message.reference.message_id)
                if session_id and self._pocketping:
                    try:
                        await self._pocketping.send_operator_message(
                            session_id, message.content
                        )
                        self._pocketping.set_operator_online(True)
                        await message.add_reaction("✅")
                    except Exception as e:
                        await message.reply(f"❌ Failed: {e}")

        # Start bot in background
        asyncio.create_task(self._client.start(self.bot_token))

        # Wait for ready with timeout
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=30)
        except asyncio.TimeoutError:
            print("[PocketPing] Discord bot failed to connect in time")

    async def on_new_session(self, session: Session) -> None:
        if not self._channel:
            return

        try:
            import discord
        except ImportError:
            return

        description = f"Session: `{session.id[:8]}...`"

        if self.show_url and session.metadata and session.metadata.url:
            description += f"\nPage: {session.metadata.url}"

        if session.metadata and session.metadata.referrer:
            description += f"\nFrom: {session.metadata.referrer}"

        embed = discord.Embed(
            title="🆕 New Visitor",
            description=description,
            color=discord.Color.blue(),
        )
        embed.set_footer(text="Reply to any message from this user to respond")

        msg = await self._channel.send(embed=embed)
        self._session_message_map[session.id] = msg.id
        self._message_session_map[msg.id] = session.id

    async def on_message(self, message: Message, session: Session) -> None:
        if message.sender != Sender.VISITOR or not self._channel:
            return

        try:
            import discord
        except ImportError:
            return

        description = message.content
        description += f"\n\n*Session: `{session.id[:8]}...`*"

        if self.show_url and session.metadata and session.metadata.url:
            description += f"\n*Page: {session.metadata.url}*"

        embed = discord.Embed(
            title="💬 Message",
            description=description,
            color=discord.Color.purple(),
        )

        msg = await self._channel.send(embed=embed)
        self._session_message_map[session.id] = msg.id
        self._message_session_map[msg.id] = session.id

    async def on_ai_takeover(self, session: Session, reason: str) -> None:
        if not self._channel:
            return

        try:
            import discord
        except ImportError:
            return

        embed = discord.Embed(
            title="🤖 AI Takeover",
            description=f"Session: `{session.id[:8]}...`\nReason: {reason}",
            color=discord.Color.orange(),
        )
        await self._channel.send(embed=embed)

    async def destroy(self) -> None:
        if self._client:
            await self._client.close()

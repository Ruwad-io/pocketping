"""Discord bridge for PocketPing with Thread support."""

import asyncio
from typing import TYPE_CHECKING, Optional

from pocketping.bridges.base import Bridge
from pocketping.models import Message, Session, Sender

if TYPE_CHECKING:
    from pocketping.core import PocketPing


class DiscordBridge(Bridge):
    """Discord notification bridge with Thread support.

    Supports two modes:
    1. Thread mode (default): Each conversation gets its own thread
    2. Legacy mode: All notifications in channel (reply-based)

    Usage (Thread mode - recommended for teams):
        from pocketping import PocketPing
        from pocketping.bridges.discord import DiscordBridge

        pp = PocketPing(
            bridges=[
                DiscordBridge(
                    bot_token="your_bot_token",
                    channel_id=123456789,  # Your Discord channel ID
                    use_threads=True,  # Default
                )
            ]
        )

    Usage (Legacy mode - single operator):
        pp = PocketPing(
            bridges=[
                DiscordBridge(
                    bot_token="your_bot_token",
                    channel_id=123456789,
                    use_threads=False,
                )
            ]
        )

    Setup:
        1. Create a Discord bot at https://discord.com/developers/applications
        2. Enable MESSAGE CONTENT INTENT in Bot settings
        3. Generate invite URL with permissions: Send Messages, Create Public Threads,
           Send Messages in Threads, Read Message History, Add Reactions
        4. Invite bot to your server
        5. Get channel ID (Enable Developer Mode, right-click channel, Copy ID)
    """

    def __init__(
        self,
        bot_token: str,
        channel_id: int,
        use_threads: bool = True,
        show_url: bool = True,
        show_metadata: bool = True,
        auto_archive_duration: int = 1440,  # 24 hours in minutes
    ):
        """Initialize Discord bridge.

        Args:
            bot_token: Discord bot token
            channel_id: Channel ID where notifications are sent
            use_threads: Create a thread per conversation (recommended for teams)
            show_url: Show page URL in notifications
            show_metadata: Show visitor metadata (referrer, device, etc.)
            auto_archive_duration: Thread auto-archive time in minutes (60, 1440, 4320, 10080)
        """
        self.bot_token = bot_token
        self.channel_id = channel_id
        self.use_threads = use_threads
        self.show_url = show_url
        self.show_metadata = show_metadata
        self.auto_archive_duration = auto_archive_duration

        self._pocketping: Optional["PocketPing"] = None
        self._client = None
        self._channel = None
        self._ready = asyncio.Event()

        # Thread mode: session_id -> thread_id
        self._session_thread_map: dict[str, int] = {}
        # Thread mode: thread_id -> session_id
        self._thread_session_map: dict[int, str] = {}

        # Legacy mode: message mappings
        self._session_message_map: dict[str, int] = {}
        self._message_session_map: dict[int, str] = {}

        # Read receipts: track operator message IDs
        # pocketping_message_id -> (channel_id, discord_message_id)
        self._operator_message_map: dict[str, tuple[int, int]] = {}

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
                await self._send_startup_message()
            self._ready.set()

        # Add command handlers
        @self._client.command(name="online")
        async def cmd_online(ctx):
            if not self._is_valid_context(ctx):
                return
            if self._pocketping:
                self._pocketping.set_operator_online(True)
            await ctx.send("✅ You're now online. Users will see you as available.")

        @self._client.command(name="offline")
        async def cmd_offline(ctx):
            if not self._is_valid_context(ctx):
                return
            if self._pocketping:
                self._pocketping.set_operator_online(False)
            await ctx.send("🌙 You're now offline. AI will handle conversations if configured.")

        @self._client.command(name="status")
        async def cmd_status(ctx):
            if not self._is_valid_context(ctx):
                return
            online = self._pocketping.is_operator_online() if self._pocketping else False
            status = "🟢 Online" if online else "🔴 Offline"

            if self.use_threads:
                active = len(self._session_thread_map)
                await ctx.send(f"📊 **Status**: {status}\n💬 Active conversations: {active}")
            else:
                await ctx.send(f"📊 **Status**: {status}")

        @self._client.command(name="close")
        async def cmd_close(ctx):
            if not self.use_threads:
                await ctx.send("❌ This command only works in thread mode.")
                return

            # Check if we're in a thread
            if not isinstance(ctx.channel, discord.Thread):
                await ctx.send("❌ Use this command inside a conversation thread.")
                return

            thread_id = ctx.channel.id
            session_id = self._thread_session_map.get(thread_id)

            if not session_id:
                await ctx.send("❌ No active conversation in this thread.")
                return

            await ctx.send("✅ Conversation closed.")

            # Archive the thread
            try:
                await ctx.channel.edit(
                    name=f"🔴 Closed - {session_id[:8]}",
                    archived=True,
                )
            except Exception:
                pass

        @self._client.event
        async def on_message(message):
            # Ignore own messages
            if message.author == self._client.user:
                return

            # Process commands first
            await self._client.process_commands(message)

            # Skip if it's a command
            if message.content.startswith("!"):
                return

            if self.use_threads:
                await self._handle_thread_message(message)
            else:
                await self._handle_legacy_reply(message)

        # Start bot in background
        asyncio.create_task(self._client.start(self.bot_token))

        # Wait for ready with timeout
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=30)
        except asyncio.TimeoutError:
            print("[PocketPing] Discord bot failed to connect in time")

    def _is_valid_context(self, ctx) -> bool:
        """Check if command is from valid channel/thread."""
        if self.use_threads:
            # Accept commands from main channel or threads in that channel
            try:
                import discord
                if isinstance(ctx.channel, discord.Thread):
                    return ctx.channel.parent_id == self.channel_id
                return ctx.channel.id == self.channel_id
            except ImportError:
                return False
        else:
            return ctx.channel.id == self.channel_id

    async def _send_startup_message(self) -> None:
        """Send startup notification."""
        try:
            import discord
        except ImportError:
            return

        if self.use_threads:
            embed = discord.Embed(
                title="🔔 PocketPing Connected",
                description=(
                    "**Mode:** Threads 🧵\n\n"
                    "Each new visitor will get their own thread.\n"
                    "Just type in the thread to reply!\n\n"
                    "**Commands:**\n"
                    "`!online` - Mark yourself as available\n"
                    "`!offline` - Mark yourself as away\n"
                    "`!status` - View current status\n"
                    "`!close` - Close conversation (in thread)"
                ),
                color=discord.Color.green(),
            )
        else:
            embed = discord.Embed(
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

        await self._channel.send(embed=embed)

    # ============ Thread Mode Handlers ============

    async def _handle_thread_message(self, message) -> None:
        """Handle messages in threads - send to visitor."""
        try:
            import discord
        except ImportError:
            return

        if not isinstance(message.channel, discord.Thread):
            return

        if message.channel.parent_id != self.channel_id:
            return

        thread_id = message.channel.id
        session_id = self._thread_session_map.get(thread_id)

        if not session_id:
            return

        if not self._pocketping:
            return

        # Get operator name
        operator_name = message.author.display_name if message.author else "Operator"

        try:
            pp_message = await self._pocketping.send_operator_message(
                session_id,
                message.content,
                source_bridge=self.name,
                operator_name=operator_name,
            )
            self._pocketping.set_operator_online(True)

            # Track message for read receipts
            self._operator_message_map[pp_message.id] = (message.channel.id, message.id)

            await message.add_reaction("✅")
        except Exception as e:
            await message.reply(f"❌ Failed to send: {e}")

    async def _handle_legacy_reply(self, message) -> None:
        """Handle replies in legacy mode."""
        if message.channel.id != self.channel_id:
            return

        if not message.reference or not message.reference.message_id:
            return

        session_id = self._message_session_map.get(message.reference.message_id)

        if not session_id or not self._pocketping:
            return

        operator_name = message.author.display_name if message.author else "Operator"

        try:
            pp_message = await self._pocketping.send_operator_message(
                session_id,
                message.content,
                source_bridge=self.name,
                operator_name=operator_name,
            )
            self._pocketping.set_operator_online(True)

            # Track message for read receipts
            self._operator_message_map[pp_message.id] = (message.channel.id, message.id)

            await message.add_reaction("✅")
        except Exception as e:
            await message.reply(f"❌ Failed: {e}")

    # ============ Bridge Events ============

    async def on_new_session(self, session: Session) -> None:
        if not self._channel:
            return

        if self.use_threads:
            await self._create_thread(session)
        else:
            await self._send_legacy_notification(session)

    async def _create_thread(self, session: Session) -> None:
        """Create a new thread for this session."""
        try:
            import discord
        except ImportError:
            return

        # Build thread name
        page_info = ""
        if session.metadata and session.metadata.url:
            url = session.metadata.url
            if "/" in url:
                page_info = url.split("/")[-1] or "home"
                page_info = page_info.split("?")[0][:20]

        thread_name = f"🟢 {session.id[:8]}"
        if page_info:
            thread_name += f" • {page_info}"

        # Build welcome message
        description = ""

        if self.show_url and session.metadata and session.metadata.url:
            description += f"📍 **Page:** {session.metadata.url}\n"

        if self.show_metadata and session.metadata:
            meta = session.metadata
            if meta.referrer:
                description += f"↩️ **From:** {meta.referrer}\n"
            if meta.ip:
                description += f"🌐 **IP:** `{meta.ip}`\n"
            if meta.device_type or meta.browser or meta.os:
                device_icon = "📱" if meta.device_type in ("mobile", "tablet") else "💻"
                device_parts = [p for p in [meta.device_type, meta.browser, meta.os] if p]
                description += f"{device_icon} **Device:** {' • '.join(p.title() if p == meta.device_type else p for p in device_parts)}\n"
            if meta.language:
                description += f"🌍 **Language:** {meta.language}\n"
            if meta.timezone:
                description += f"🕐 **Timezone:** {meta.timezone}\n"
            if meta.screen_resolution:
                description += f"🖥️ **Screen:** {meta.screen_resolution}\n"

        description += f"\n*Session ID: `{session.id}`*"
        description += "\n\n💡 **Just type here to reply!**"

        embed = discord.Embed(
            title="🆕 New Conversation",
            description=description,
            color=discord.Color.blue(),
        )

        try:
            # Create a message first, then create thread from it
            msg = await self._channel.send(embed=embed)

            thread = await msg.create_thread(
                name=thread_name,
                auto_archive_duration=self.auto_archive_duration,
            )

            # Store mappings
            self._session_thread_map[session.id] = thread.id
            self._thread_session_map[thread.id] = session.id

            # Send initial message in thread
            await thread.send(
                "👋 Visitor connected! Messages will appear here.\n"
                "Type your response directly - no need to reply to specific messages."
            )

        except Exception as e:
            await self._channel.send(f"⚠️ Failed to create thread for session {session.id[:8]}: {e}")

    async def _send_legacy_notification(self, session: Session) -> None:
        """Send notification in legacy mode."""
        try:
            import discord
        except ImportError:
            return

        description = f"Session: `{session.id[:8]}...`"

        if self.show_url and session.metadata and session.metadata.url:
            description += f"\n📍 Page: {session.metadata.url}"

        if self.show_metadata and session.metadata:
            meta = session.metadata
            if meta.referrer:
                description += f"\n↩️ From: {meta.referrer}"
            if meta.ip:
                description += f"\n🌐 IP: `{meta.ip}`"
            if meta.device_type or meta.browser or meta.os:
                device_parts = [p for p in [meta.device_type, meta.browser, meta.os] if p]
                description += f"\n💻 Device: {' • '.join(p.title() if p == meta.device_type else p for p in device_parts)}"

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

        if self.use_threads:
            await self._send_thread_message(message, session)
        else:
            await self._send_legacy_message(message, session)

    async def _send_thread_message(self, message: Message, session: Session) -> None:
        """Send visitor message to the thread."""
        try:
            import discord
        except ImportError:
            return

        thread_id = self._session_thread_map.get(session.id)

        if not thread_id:
            # Thread doesn't exist, create it
            await self._create_thread(session)
            thread_id = self._session_thread_map.get(session.id)

        if not thread_id:
            return

        thread = self._client.get_channel(thread_id)
        if not thread:
            return

        embed = discord.Embed(
            description=message.content,
            color=discord.Color.purple(),
        )
        embed.set_author(name="👤 Visitor")

        await thread.send(embed=embed)

    async def _send_legacy_message(self, message: Message, session: Session) -> None:
        """Send visitor message in legacy mode."""
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

        if self.use_threads:
            thread_id = self._session_thread_map.get(session.id)
            if thread_id:
                thread = self._client.get_channel(thread_id)
                if thread:
                    await thread.send(embed=embed)
                    return

        await self._channel.send(embed=embed)

    async def on_operator_message(
        self,
        message: Message,
        session: Session,
        source_bridge: str,
        operator_name: str | None = None,
    ) -> None:
        """Show operator messages from other bridges (cross-bridge sync)."""
        # Skip if message is from this bridge
        if source_bridge == self.name or not self._channel:
            return

        try:
            import discord
        except ImportError:
            return

        # Format the synced message
        bridge_emoji = {"telegram": "✈️", "slack": "💬", "api": "🔌"}.get(source_bridge, "📨")
        name = operator_name or "Operator"

        embed = discord.Embed(
            description=message.content,
            color=discord.Color.greyple(),
        )
        embed.set_author(name=f"{bridge_emoji} {name} via {source_bridge}")

        if self.use_threads:
            thread_id = self._session_thread_map.get(session.id)
            if thread_id:
                thread = self._client.get_channel(thread_id)
                if thread:
                    await thread.send(embed=embed)
                    return

        await self._channel.send(embed=embed)

    async def on_message_read(
        self,
        session_id: str,
        message_ids: list[str],
        status: str,
        session: Session,
    ) -> None:
        """Update message reactions based on read receipt status.

        Status indicators:
        - ✅ = sent (default)
        - ☑️ = delivered to widget
        - 👁️ = read by visitor
        """
        if not self._client:
            return

        # Map status to reaction emoji
        status_reactions = {
            "delivered": "☑️",
            "read": "👁️",
        }

        reaction = status_reactions.get(status)
        if not reaction:
            return

        for message_id in message_ids:
            mapping = self._operator_message_map.get(message_id)
            if not mapping:
                continue

            channel_id, discord_msg_id = mapping

            try:
                channel = self._client.get_channel(channel_id)
                if channel:
                    msg = await channel.fetch_message(discord_msg_id)
                    if msg:
                        # Remove old reaction and add new one
                        try:
                            await msg.remove_reaction("✅", self._client.user)
                        except Exception:
                            pass
                        await msg.add_reaction(reaction)
            except Exception:
                # Message may be deleted or channel inaccessible
                pass

            # Clean up read messages from tracking
            if status == "read":
                self._operator_message_map.pop(message_id, None)

    async def destroy(self) -> None:
        if self._client:
            await self._client.close()

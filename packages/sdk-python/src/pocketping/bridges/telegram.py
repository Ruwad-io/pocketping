"""Telegram bridge for PocketPing with Forum Topics support."""

import asyncio
from typing import TYPE_CHECKING, Optional

from pocketping.bridges.base import Bridge
from pocketping.models import Message, Session, Sender

if TYPE_CHECKING:
    from pocketping.core import PocketPing


class TelegramBridge(Bridge):
    """Telegram notification bridge with Forum Topics support.

    Supports two modes:
    1. Legacy mode: All notifications in a single chat (reply-based)
    2. Forum mode: Each conversation gets its own topic (recommended for teams)

    Usage (Forum mode - recommended for multiple operators):
        from pocketping import PocketPing
        from pocketping.bridges.telegram import TelegramBridge

        pp = PocketPing(
            bridges=[
                TelegramBridge(
                    bot_token="your_bot_token",
                    forum_chat_id="your_supergroup_id",  # Supergroup with topics enabled
                )
            ]
        )

    Usage (Legacy mode - single operator):
        pp = PocketPing(
            bridges=[
                TelegramBridge(
                    bot_token="your_bot_token",
                    chat_ids=["your_chat_id"],
                )
            ]
        )

    Setup for Forum mode:
        1. Create a Telegram group
        2. Convert to Supergroup (Settings > Group Type)
        3. Enable Topics (Settings > Topics > Enable)
        4. Add your bot as admin with "Manage Topics" permission
        5. Get the chat_id (starts with -100)
    """

    def __init__(
        self,
        bot_token: str,
        chat_ids: str | list[str] | None = None,
        forum_chat_id: str | None = None,
        show_url: bool = True,
        show_metadata: bool = True,
    ):
        """Initialize Telegram bridge.

        Args:
            bot_token: Telegram bot token from @BotFather
            chat_ids: Chat ID(s) for legacy mode (single chat, reply-based)
            forum_chat_id: Supergroup ID for forum mode (one topic per conversation)
            show_url: Show page URL in notifications
            show_metadata: Show visitor metadata (referrer, timezone, etc.)
        """
        self.bot_token = bot_token
        self.forum_chat_id = forum_chat_id
        self.show_url = show_url
        self.show_metadata = show_metadata

        # Legacy mode support
        if chat_ids:
            self.chat_ids = [chat_ids] if isinstance(chat_ids, str) else chat_ids
        else:
            self.chat_ids = []

        # Determine mode
        self.use_forum = forum_chat_id is not None

        if not self.use_forum and not self.chat_ids:
            raise ValueError("Either forum_chat_id or chat_ids must be provided")

        self._pocketping: Optional["PocketPing"] = None
        self._app = None

        # Forum mode: session_id -> topic_id (message_thread_id)
        self._session_topic_map: dict[str, int] = {}
        # Forum mode: topic_id -> session_id (reverse lookup)
        self._topic_session_map: dict[int, str] = {}

        # Legacy mode: message mappings (kept for backward compatibility)
        self._session_message_map: dict[str, int] = {}
        self._message_session_map: dict[int, str] = {}

    @property
    def name(self) -> str:
        return "telegram"

    async def init(self, pocketping: "PocketPing") -> None:
        self._pocketping = pocketping

        try:
            from telegram import Update
            from telegram.ext import (
                Application,
                CommandHandler,
                MessageHandler,
                filters,
            )
        except ImportError:
            raise ImportError(
                "python-telegram-bot required. Install with: pip install pocketping[telegram]"
            )

        # Create bot application
        self._app = Application.builder().token(self.bot_token).build()

        # Add command handlers
        self._app.add_handler(CommandHandler("online", self._cmd_online))
        self._app.add_handler(CommandHandler("offline", self._cmd_offline))
        self._app.add_handler(CommandHandler("status", self._cmd_status))
        self._app.add_handler(CommandHandler("close", self._cmd_close))

        # Message handler - different behavior for forum vs legacy
        if self.use_forum:
            # Forum mode: handle all text messages in topics
            self._app.add_handler(
                MessageHandler(
                    filters.TEXT & ~filters.COMMAND & filters.ChatType.SUPERGROUP,
                    self._handle_forum_message
                )
            )
        else:
            # Legacy mode: only handle replies
            self._app.add_handler(
                MessageHandler(filters.TEXT & filters.REPLY, self._handle_reply)
            )

        # Start polling in background
        await self._app.initialize()
        await self._app.start()
        asyncio.create_task(self._app.updater.start_polling())

        # Send startup message
        await self._send_startup_message()

    async def _send_startup_message(self) -> None:
        """Send startup notification."""
        if self.use_forum:
            text = (
                "🔔 *PocketPing Connected*\n\n"
                "Mode: *Forum Topics* 🗂️\n\n"
                "Each new visitor will get their own topic.\n"
                "Just type in a topic to reply - no need to swipe-reply!\n\n"
                "Commands:\n"
                "/online - Mark yourself as available\n"
                "/offline - Mark yourself as away\n"
                "/status - View current status\n"
                "/close - Close current conversation (in topic)"
            )
            await self._app.bot.send_message(
                chat_id=self.forum_chat_id,
                text=text,
                parse_mode="Markdown",
            )
        else:
            text = (
                "🔔 *PocketPing Connected*\n\n"
                "Commands:\n"
                "/online - Mark yourself as available\n"
                "/offline - Mark yourself as away\n"
                "/status - View current status\n\n"
                "Reply to any message to respond to users."
            )
            for chat_id in self.chat_ids:
                await self._app.bot.send_message(
                    chat_id=chat_id,
                    text=text,
                    parse_mode="Markdown",
                )

    # ============ Command Handlers ============

    async def _cmd_online(self, update, context):
        if self._pocketping:
            self._pocketping.set_operator_online(True)
        await update.message.reply_text(
            "✅ You're now online. Users will see you as available."
        )

    async def _cmd_offline(self, update, context):
        if self._pocketping:
            self._pocketping.set_operator_online(False)
        await update.message.reply_text(
            "🌙 You're now offline. AI will handle conversations if configured."
        )

    async def _cmd_status(self, update, context):
        status = "online" if self._pocketping and self._pocketping.is_operator_online() else "offline"

        if self.use_forum:
            active_topics = len(self._session_topic_map)
            await update.message.reply_text(
                f"📊 *Status*: {status}\n"
                f"💬 Active conversations: {active_topics}",
                parse_mode="Markdown"
            )
        else:
            await update.message.reply_text(f"📊 *Status*: {status}", parse_mode="Markdown")

    async def _cmd_close(self, update, context):
        """Close a conversation (forum mode only)."""
        if not self.use_forum:
            await update.message.reply_text("❌ This command only works in forum mode.")
            return

        thread_id = update.message.message_thread_id
        if not thread_id:
            await update.message.reply_text("❌ Use this command inside a conversation topic.")
            return

        session_id = self._topic_session_map.get(thread_id)
        if not session_id:
            await update.message.reply_text("❌ No active conversation in this topic.")
            return

        # Send closing message
        await update.message.reply_text(
            "✅ Conversation marked as closed.\n"
            "The topic will remain for reference."
        )

        # Optionally close the topic (edit name to show closed)
        try:
            await self._app.bot.edit_forum_topic(
                chat_id=self.forum_chat_id,
                message_thread_id=thread_id,
                name=f"🔴 Closed - {session_id[:8]}",
            )
        except Exception:
            pass  # May fail if bot doesn't have permission

    # ============ Message Handlers ============

    async def _handle_forum_message(self, update, context):
        """Handle messages in forum topics - send to visitor."""
        if not self._pocketping or not update.message:
            return

        thread_id = update.message.message_thread_id
        if not thread_id:
            # Message in general topic, ignore
            return

        session_id = self._topic_session_map.get(thread_id)
        if not session_id:
            # Unknown topic, ignore
            return

        text = update.message.text
        if not text:
            return

        # Get operator name
        user = update.message.from_user
        operator_name = user.first_name if user else "Operator"

        try:
            await self._pocketping.send_operator_message(
                session_id,
                text,
                source_bridge=self.name,
                operator_name=operator_name,
            )
            self._pocketping.set_operator_online(True)

            # React with checkmark instead of sending a message
            try:
                await update.message.set_reaction("✅")
            except Exception:
                pass  # Reaction may fail on older clients

        except Exception as e:
            await update.message.reply_text(f"❌ Failed to send: {e}")

    async def _handle_reply(self, update, context):
        """Handle replies to notification messages (legacy mode)."""
        if not update.message.reply_to_message or not self._pocketping:
            return

        reply_to_id = update.message.reply_to_message.message_id
        session_id = self._message_session_map.get(reply_to_id)

        if session_id and update.message.text:
            user = update.message.from_user
            operator_name = user.first_name if user else "Operator"

            try:
                await self._pocketping.send_operator_message(
                    session_id,
                    update.message.text,
                    source_bridge=self.name,
                    operator_name=operator_name,
                )
                self._pocketping.set_operator_online(True)
                await update.message.reply_text("✓ Message sent")
            except Exception as e:
                await update.message.reply_text(f"❌ Failed: {e}")

    # ============ Bridge Events ============

    async def on_new_session(self, session: Session) -> None:
        if not self._app:
            return

        if self.use_forum:
            await self._create_forum_topic(session)
        else:
            await self._send_legacy_notification(session)

    async def _create_forum_topic(self, session: Session) -> None:
        """Create a new forum topic for this session."""
        # Build topic name
        page_info = ""
        if session.metadata and session.metadata.url:
            # Extract page name from URL
            url = session.metadata.url
            if "/" in url:
                page_info = url.split("/")[-1] or "home"
                page_info = page_info.split("?")[0][:20]  # Trim query params and limit length

        topic_name = f"🟢 {session.id[:8]}"
        if page_info:
            topic_name += f" • {page_info}"

        try:
            # Create the topic
            topic = await self._app.bot.create_forum_topic(
                chat_id=self.forum_chat_id,
                name=topic_name,
            )

            thread_id = topic.message_thread_id

            # Store mappings
            self._session_topic_map[session.id] = thread_id
            self._topic_session_map[thread_id] = session.id

            # Send welcome message in the topic
            text = "🆕 *New Conversation*\n\n"

            if self.show_url and session.metadata and session.metadata.url:
                text += f"📍 Page: {session.metadata.url}\n"

            if self.show_metadata and session.metadata:
                if session.metadata.referrer:
                    text += f"↩️ From: {session.metadata.referrer}\n"
                if session.metadata.timezone:
                    text += f"🕐 Timezone: {session.metadata.timezone}\n"
                if session.metadata.user_agent:
                    # Parse user agent for readable info
                    ua = session.metadata.user_agent
                    if "Mobile" in ua:
                        text += "📱 Device: Mobile\n"
                    else:
                        text += "💻 Device: Desktop\n"

            text += f"\n_Session ID: `{session.id}`_\n"
            text += "\n💡 *Just type here to reply - no need to swipe-reply!*"

            await self._app.bot.send_message(
                chat_id=self.forum_chat_id,
                message_thread_id=thread_id,
                text=text,
                parse_mode="Markdown",
            )

        except Exception as e:
            # Fallback: send to general if topic creation fails
            await self._app.bot.send_message(
                chat_id=self.forum_chat_id,
                text=f"⚠️ Failed to create topic for session {session.id[:8]}: {e}",
            )

    async def _send_legacy_notification(self, session: Session) -> None:
        """Send notification in legacy mode (no topics)."""
        text = f"🆕 *New Visitor*\n\nSession: `{session.id[:8]}...`"

        if self.show_url and session.metadata and session.metadata.url:
            text += f"\nPage: {session.metadata.url}"

        if session.metadata and session.metadata.referrer:
            text += f"\nFrom: {session.metadata.referrer}"

        text += "\n\n_Reply to any message from this user to respond._"

        for chat_id in self.chat_ids:
            msg = await self._app.bot.send_message(
                chat_id=chat_id, text=text, parse_mode="Markdown"
            )
            self._session_message_map[session.id] = msg.message_id
            self._message_session_map[msg.message_id] = session.id

    async def on_message(self, message: Message, session: Session) -> None:
        if message.sender != Sender.VISITOR or not self._app:
            return

        if self.use_forum:
            await self._send_forum_message(message, session)
        else:
            await self._send_legacy_message(message, session)

    async def _send_forum_message(self, message: Message, session: Session) -> None:
        """Send visitor message to the forum topic."""
        thread_id = self._session_topic_map.get(session.id)

        if not thread_id:
            # Topic doesn't exist yet, create it
            await self._create_forum_topic(session)
            thread_id = self._session_topic_map.get(session.id)

        if not thread_id:
            return

        text = f"👤 *Visitor*:\n{message.content}"

        await self._app.bot.send_message(
            chat_id=self.forum_chat_id,
            message_thread_id=thread_id,
            text=text,
            parse_mode="Markdown",
        )

    async def _send_legacy_message(self, message: Message, session: Session) -> None:
        """Send visitor message in legacy mode."""
        text = f"💬 *Message*\n\n{message.content}"
        text += f"\n\n_Session: `{session.id[:8]}...`_"

        if self.show_url and session.metadata and session.metadata.url:
            text += f"\n_Page: {session.metadata.url}_"

        for chat_id in self.chat_ids:
            msg = await self._app.bot.send_message(
                chat_id=chat_id,
                text=text,
                parse_mode="Markdown",
                reply_markup={"force_reply": True, "selective": True},
            )
            self._session_message_map[session.id] = msg.message_id
            self._message_session_map[msg.message_id] = session.id

    async def on_ai_takeover(self, session: Session, reason: str) -> None:
        if not self._app:
            return

        text = f"🤖 *AI Takeover*\n\nSession `{session.id[:8]}...`\nReason: {reason}"

        if self.use_forum:
            thread_id = self._session_topic_map.get(session.id)
            if thread_id:
                await self._app.bot.send_message(
                    chat_id=self.forum_chat_id,
                    message_thread_id=thread_id,
                    text=text,
                    parse_mode="Markdown",
                )
        else:
            for chat_id in self.chat_ids:
                await self._app.bot.send_message(
                    chat_id=chat_id,
                    text=text,
                    parse_mode="Markdown",
                )

    async def on_operator_message(
        self,
        message: Message,
        session: Session,
        source_bridge: str,
        operator_name: str | None = None,
    ) -> None:
        """Show operator messages from other bridges (cross-bridge sync)."""
        # Skip if message is from this bridge (we already showed it)
        if source_bridge == self.name or not self._app:
            return

        # Format the synced message
        bridge_emoji = {"discord": "🎮", "slack": "💬", "api": "🔌"}.get(source_bridge, "📨")
        name = operator_name or "Operator"
        text = f"{bridge_emoji} *{name}* _via {source_bridge}_:\n{message.content}"

        if self.use_forum:
            thread_id = self._session_topic_map.get(session.id)
            if thread_id:
                await self._app.bot.send_message(
                    chat_id=self.forum_chat_id,
                    message_thread_id=thread_id,
                    text=text,
                    parse_mode="Markdown",
                )
        else:
            for chat_id in self.chat_ids:
                await self._app.bot.send_message(
                    chat_id=chat_id,
                    text=text,
                    parse_mode="Markdown",
                )

    async def destroy(self) -> None:
        if self._app:
            await self._app.stop()
            await self._app.shutdown()

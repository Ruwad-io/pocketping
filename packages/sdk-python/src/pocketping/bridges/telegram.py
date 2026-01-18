"""Telegram bridge for PocketPing."""

import asyncio
from typing import TYPE_CHECKING, Optional

from pocketping.bridges.base import Bridge
from pocketping.models import Message, Session, Sender

if TYPE_CHECKING:
    from pocketping.core import PocketPing


class TelegramBridge(Bridge):
    """Telegram notification bridge.

    Receives notifications in Telegram and can reply directly.

    Usage:
        from pocketping import PocketPing
        from pocketping.bridges.telegram import TelegramBridge

        pp = PocketPing(
            bridges=[
                TelegramBridge(
                    bot_token="your_bot_token",
                    chat_ids=["your_chat_id"],
                )
            ]
        )
    """

    def __init__(
        self,
        bot_token: str,
        chat_ids: str | list[str],
        show_url: bool = True,
    ):
        self.bot_token = bot_token
        self.chat_ids = [chat_ids] if isinstance(chat_ids, str) else chat_ids
        self.show_url = show_url
        self._pocketping: Optional["PocketPing"] = None
        self._bot = None
        self._app = None
        self._session_message_map: dict[str, int] = {}  # session_id -> message_id
        self._message_session_map: dict[int, str] = {}  # message_id -> session_id

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
                ContextTypes,
            )
        except ImportError:
            raise ImportError(
                "python-telegram-bot required. Install with: pip install pocketping[telegram]"
            )

        # Create bot application
        self._app = Application.builder().token(self.bot_token).build()

        # Add handlers
        self._app.add_handler(CommandHandler("online", self._cmd_online))
        self._app.add_handler(CommandHandler("offline", self._cmd_offline))
        self._app.add_handler(CommandHandler("status", self._cmd_status))
        self._app.add_handler(
            MessageHandler(filters.TEXT & filters.REPLY, self._handle_reply)
        )

        # Start polling in background
        await self._app.initialize()
        await self._app.start()
        asyncio.create_task(self._app.updater.start_polling())

        # Send startup message
        for chat_id in self.chat_ids:
            await self._app.bot.send_message(
                chat_id=chat_id,
                text=(
                    "🔔 *PocketPing Connected*\n\n"
                    "Commands:\n"
                    "/online - Mark yourself as available\n"
                    "/offline - Mark yourself as away\n"
                    "/status - View current status\n\n"
                    "Reply to any message to respond to users."
                ),
                parse_mode="Markdown",
            )

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
        await update.message.reply_text(f"📊 *Status*: {status}", parse_mode="Markdown")

    async def _handle_reply(self, update, context):
        """Handle replies to notification messages."""
        if not update.message.reply_to_message or not self._pocketping:
            return

        reply_to_id = update.message.reply_to_message.message_id
        session_id = self._message_session_map.get(reply_to_id)

        if session_id and update.message.text:
            try:
                await self._pocketping.send_operator_message(
                    session_id, update.message.text
                )
                self._pocketping.set_operator_online(True)
                await update.message.reply_text("✓ Message sent")
            except Exception as e:
                await update.message.reply_text(f"❌ Failed: {e}")

    async def on_new_session(self, session: Session) -> None:
        if not self._app:
            return

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

        for chat_id in self.chat_ids:
            await self._app.bot.send_message(
                chat_id=chat_id,
                text=f"🤖 *AI Takeover*\n\nSession `{session.id[:8]}...`\nReason: {reason}",
                parse_mode="Markdown",
            )

    async def destroy(self) -> None:
        if self._app:
            await self._app.stop()
            await self._app.shutdown()

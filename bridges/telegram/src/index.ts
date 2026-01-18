import TelegramBot from 'node-telegram-bot-api';
import type { Bridge } from '@pocketping/sdk';
import type { PocketPing, Session, Message } from '@pocketping/sdk';

export interface TelegramBridgeConfig {
  /** Telegram bot token from @BotFather */
  botToken: string;

  /** Chat ID(s) to send notifications to */
  chatIds: string | string[];

  /** Custom message templates */
  templates?: {
    newSession?: (session: Session) => string;
    message?: (message: Message, session: Session) => string;
  };

  /** Show page URL in notifications */
  showUrl?: boolean;

  /** Enable inline reply buttons */
  inlineReply?: boolean;
}

export class TelegramBridge implements Bridge {
  name = 'telegram';

  private bot: TelegramBot;
  private chatIds: string[];
  private config: TelegramBridgeConfig;
  private pocketping: PocketPing | null = null;
  private sessionChatMap: Map<string, number> = new Map(); // sessionId -> telegram message id

  constructor(config: TelegramBridgeConfig) {
    this.config = config;
    this.chatIds = Array.isArray(config.chatIds) ? config.chatIds : [config.chatIds];
    this.bot = new TelegramBot(config.botToken, { polling: true });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handle replies to notifications
    this.bot.on('message', async (msg) => {
      if (!msg.reply_to_message || !this.pocketping) return;

      const replyToId = msg.reply_to_message.message_id;
      const sessionId = this.findSessionByMessageId(replyToId);

      if (sessionId && msg.text) {
        try {
          await this.pocketping.sendOperatorMessage(sessionId, msg.text);
          this.pocketping.setOperatorOnline(true);

          // Confirm delivery
          await this.bot.sendMessage(msg.chat.id, '✓ Message sent', {
            reply_to_message_id: msg.message_id,
          });
        } catch (err) {
          console.error('[TelegramBridge] Failed to send reply:', err);
          await this.bot.sendMessage(msg.chat.id, '❌ Failed to send message', {
            reply_to_message_id: msg.message_id,
          });
        }
      }
    });

    // Handle callback queries (inline buttons)
    this.bot.on('callback_query', async (query) => {
      if (!query.data || !this.pocketping) return;

      const [action, sessionId] = query.data.split(':');

      switch (action) {
        case 'online':
          this.pocketping.setOperatorOnline(true);
          await this.bot.answerCallbackQuery(query.id, { text: "You're now online!" });
          break;
        case 'close':
          // Mark conversation as closed
          await this.bot.answerCallbackQuery(query.id, { text: 'Conversation closed' });
          break;
      }
    });

    // Commands
    this.bot.onText(/\/online/, async (msg) => {
      this.pocketping?.setOperatorOnline(true);
      await this.bot.sendMessage(msg.chat.id, "✅ You're now online. Users will see you as available.");
    });

    this.bot.onText(/\/offline/, async (msg) => {
      this.pocketping?.setOperatorOnline(false);
      await this.bot.sendMessage(msg.chat.id, "🌙 You're now offline. AI will handle conversations if configured.");
    });

    this.bot.onText(/\/status/, async (msg) => {
      const storage = this.pocketping?.getStorage();
      if (!storage) return;

      // Simple status - you could enhance this
      await this.bot.sendMessage(msg.chat.id,
        `📊 *PocketPing Status*\n\n` +
        `Active sessions: Loading...\n` +
        `Operator: ${this.pocketping ? 'Connected' : 'Disconnected'}`,
        { parse_mode: 'Markdown' }
      );
    });
  }

  async init(pocketping: PocketPing): Promise<void> {
    this.pocketping = pocketping;

    // Notify that bot is connected
    for (const chatId of this.chatIds) {
      await this.bot.sendMessage(chatId,
        '🔔 *PocketPing Connected*\n\n' +
        'Commands:\n' +
        '/online - Mark yourself as available\n' +
        '/offline - Mark yourself as away\n' +
        '/status - View current status\n\n' +
        'Reply to any message to respond to users.',
        { parse_mode: 'Markdown' }
      );
    }
  }

  async onNewSession(session: Session): Promise<void> {
    const text = this.config.templates?.newSession?.(session) ?? this.defaultNewSessionTemplate(session);

    for (const chatId of this.chatIds) {
      const options: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown',
      };

      if (this.config.inlineReply !== false) {
        options.reply_markup = {
          inline_keyboard: [[
            { text: '✅ Go Online', callback_data: `online:${session.id}` },
          ]],
        };
      }

      const sent = await this.bot.sendMessage(chatId, text, options);
      this.sessionChatMap.set(session.id, sent.message_id);
    }
  }

  async onMessage(message: Message, session: Session): Promise<void> {
    if (message.sender !== 'visitor') return;

    const text = this.config.templates?.message?.(message, session) ?? this.defaultMessageTemplate(message, session);

    for (const chatId of this.chatIds) {
      const sent = await this.bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          force_reply: true,
          selective: true,
        },
      });

      // Update session -> message mapping
      this.sessionChatMap.set(session.id, sent.message_id);
    }
  }

  async destroy(): Promise<void> {
    await this.bot.stopPolling();
  }

  // ─────────────────────────────────────────────────────────────────
  // Templates
  // ─────────────────────────────────────────────────────────────────

  private defaultNewSessionTemplate(session: Session): string {
    let text = `🆕 *New Visitor*\n\n`;
    text += `Session: \`${session.id.slice(0, 8)}...\`\n`;

    if (this.config.showUrl !== false && session.metadata?.url) {
      text += `Page: ${session.metadata.url}\n`;
    }

    if (session.metadata?.referrer) {
      text += `From: ${session.metadata.referrer}\n`;
    }

    text += `\n_Reply to any message from this user to respond._`;

    return text;
  }

  private defaultMessageTemplate(message: Message, session: Session): string {
    let text = `💬 *Message*\n\n`;
    text += `${message.content}\n\n`;
    text += `_Session: \`${session.id.slice(0, 8)}...\`_`;

    if (this.config.showUrl !== false && session.metadata?.url) {
      text += `\n_Page: ${session.metadata.url}_`;
    }

    return text;
  }

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────

  private findSessionByMessageId(messageId: number): string | undefined {
    for (const [sessionId, msgId] of this.sessionChatMap) {
      if (msgId === messageId) {
        return sessionId;
      }
    }
    return undefined;
  }
}

export default TelegramBridge;

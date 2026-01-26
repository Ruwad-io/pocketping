import type { Bridge, BridgeMessageResult } from './types';
import type { PocketPing } from '../pocketping';
import type { Session, Message } from '../types';
import { PocketPingSetupError, SETUP_GUIDES } from '../errors';

/**
 * Telegram API response types
 */
interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: {
    message_id?: number;
    [key: string]: unknown;
  };
}

/**
 * Options for TelegramBridge
 */
export interface TelegramBridgeOptions {
  /** Parse mode for message formatting */
  parseMode?: 'HTML' | 'Markdown';
  /** Disable notification sound */
  disableNotification?: boolean;
}

/**
 * Telegram Bridge for PocketPing.
 * Sends visitor messages to a Telegram chat using the Bot API.
 *
 * @example
 * ```ts
 * const telegram = new TelegramBridge(
 *   'BOT_TOKEN',
 *   '-1001234567890',
 *   { parseMode: 'HTML' }
 * );
 * const pocketping = new PocketPing({ bridges: [telegram] });
 * ```
 */
export class TelegramBridge implements Bridge {
  readonly name = 'telegram';

  private pocketping?: PocketPing;
  private readonly botToken: string;
  private readonly chatId: string | number;
  private readonly parseMode: 'HTML' | 'Markdown';
  private readonly disableNotification: boolean;
  private readonly baseUrl: string;

  constructor(
    botToken: string,
    chatId: string | number,
    options: TelegramBridgeOptions = {}
  ) {
    if (!botToken) {
      throw new PocketPingSetupError({
        bridge: 'Telegram',
        missing: 'botToken',
        guide: SETUP_GUIDES.telegram.botToken,
      });
    }

    if (!chatId) {
      throw new PocketPingSetupError({
        bridge: 'Telegram',
        missing: 'chatId',
        guide: SETUP_GUIDES.telegram.chatId,
      });
    }

    this.botToken = botToken;
    this.chatId = chatId;
    this.parseMode = options.parseMode ?? 'HTML';
    this.disableNotification = options.disableNotification ?? false;
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  /**
   * Initialize the bridge (optional setup)
   */
  async init(pocketping: PocketPing): Promise<void> {
    this.pocketping = pocketping;
    // Optionally verify bot token by calling getMe
    try {
      const response = await fetch(`${this.baseUrl}/getMe`);
      const data = (await response.json()) as TelegramResponse;
      if (!data.ok) {
        console.error('[TelegramBridge] Invalid bot token:', data.description);
      }
    } catch (error) {
      console.error('[TelegramBridge] Failed to verify bot token:', error);
    }
  }

  /**
   * Called when a new chat session is created
   */
  async onNewSession(session: Session): Promise<void> {
    const url = session.metadata?.url || 'Unknown page';
    const text = this.formatNewSession(session.visitorId, url);

    try {
      await this.sendMessage(text);
    } catch (error) {
      console.error('[TelegramBridge] Failed to send new session notification:', error);
    }
  }

  /**
   * Called when a visitor sends a message.
   * Returns the Telegram message ID for edit/delete sync.
   */
  async onVisitorMessage(
    message: Message,
    session: Session
  ): Promise<BridgeMessageResult> {
    const text = this.formatVisitorMessage(session.visitorId, message.content);
    let replyToMessageId: number | undefined;

    if (message.replyTo) {
      const storage = this.pocketping?.getStorage();
      if (storage?.getBridgeMessageIds) {
        const ids = await storage.getBridgeMessageIds(message.replyTo);
        if (ids?.telegramMessageId) {
          replyToMessageId = ids.telegramMessageId;
        }
      }
    }

    try {
      const messageId = await this.sendMessage(text, replyToMessageId);
      return { messageId };
    } catch (error) {
      console.error('[TelegramBridge] Failed to send visitor message:', error);
      return {};
    }
  }

  /**
   * Called when an operator sends a message (for cross-bridge sync)
   */
  async onOperatorMessage(
    message: Message,
    _session: Session,
    sourceBridge?: string,
    operatorName?: string
  ): Promise<void> {
    // Don't echo messages that originated from Telegram
    if (sourceBridge === 'telegram') {
      return;
    }

    const name = operatorName || 'Operator';
    const text = this.parseMode === 'HTML'
      ? `<b>${this.escapeHtml(name)}:</b>\n${this.escapeHtml(message.content)}`
      : `*${this.escapeMarkdown(name)}:*\n${this.escapeMarkdown(message.content)}`;

    try {
      await this.sendMessage(text);
    } catch (error) {
      console.error('[TelegramBridge] Failed to send operator message:', error);
    }
  }

  /**
   * Called when visitor starts/stops typing
   */
  async onTyping(sessionId: string, isTyping: boolean): Promise<void> {
    if (!isTyping) return;

    try {
      await this.sendChatAction('typing');
    } catch (error) {
      console.error('[TelegramBridge] Failed to send typing action:', error);
    }
  }

  /**
   * Called when a visitor edits their message.
   * @returns true if edit succeeded, false otherwise
   */
  async onMessageEdit(
    _messageId: string,
    newContent: string,
    bridgeMessageId: string | number
  ): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          message_id: bridgeMessageId,
          text: `${newContent}\n\n<i>(edited)</i>`,
          parse_mode: this.parseMode,
        }),
      });

      const data = (await response.json()) as TelegramResponse;
      if (!data.ok) {
        console.error('[TelegramBridge] Edit failed:', data.description);
        return false;
      }
      return true;
    } catch (error) {
      console.error('[TelegramBridge] Failed to edit message:', error);
      return false;
    }
  }

  /**
   * Called when a visitor deletes their message.
   * @returns true if delete succeeded, false otherwise
   */
  async onMessageDelete(
    _messageId: string,
    bridgeMessageId: string | number
  ): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          message_id: bridgeMessageId,
        }),
      });

      const data = (await response.json()) as TelegramResponse;
      if (!data.ok) {
        // Message might already be deleted or too old
        console.error('[TelegramBridge] Delete failed:', data.description);
        return false;
      }
      return true;
    } catch (error) {
      console.error('[TelegramBridge] Failed to delete message:', error);
      return false;
    }
  }

  /**
   * Called when a custom event is triggered from the widget
   */
  async onCustomEvent(
    event: { name: string; data?: Record<string, unknown> },
    session: Session
  ): Promise<void> {
    const dataStr = event.data ? JSON.stringify(event.data, null, 2) : '';
    const text = this.parseMode === 'HTML'
      ? `<b>Custom Event:</b> ${this.escapeHtml(event.name)}\n<b>Visitor:</b> ${this.escapeHtml(session.visitorId)}${dataStr ? `\n<pre>${this.escapeHtml(dataStr)}</pre>` : ''}`
      : `*Custom Event:* ${this.escapeMarkdown(event.name)}\n*Visitor:* ${this.escapeMarkdown(session.visitorId)}${dataStr ? `\n\`\`\`\n${dataStr}\n\`\`\`` : ''}`;

    try {
      await this.sendMessage(text);
    } catch (error) {
      console.error('[TelegramBridge] Failed to send custom event:', error);
    }
  }

  /**
   * Called when a user identifies themselves via PocketPing.identify()
   */
  async onIdentityUpdate(session: Session): Promise<void> {
    if (!session.identity) return;

    const identity = session.identity;
    let text: string;

    if (this.parseMode === 'HTML') {
      text = `<b>User Identified</b>\n` +
        `<b>ID:</b> ${this.escapeHtml(identity.id)}\n` +
        (identity.name ? `<b>Name:</b> ${this.escapeHtml(identity.name)}\n` : '') +
        (identity.email ? `<b>Email:</b> ${this.escapeHtml(identity.email)}\n` : '') +
        (session.userPhone ? `<b>Phone:</b> ${this.escapeHtml(session.userPhone)}` : '');
    } else {
      text = `*User Identified*\n` +
        `*ID:* ${this.escapeMarkdown(identity.id)}\n` +
        (identity.name ? `*Name:* ${this.escapeMarkdown(identity.name)}\n` : '') +
        (identity.email ? `*Email:* ${this.escapeMarkdown(identity.email)}\n` : '') +
        (session.userPhone ? `*Phone:* ${this.escapeMarkdown(session.userPhone)}` : '');
    }

    try {
      await this.sendMessage(text.trim());
    } catch (error) {
      console.error('[TelegramBridge] Failed to send identity update:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Private helper methods
  // ─────────────────────────────────────────────────────────────────

  /**
   * Send a message to the Telegram chat
   */
  private async sendMessage(
    text: string,
    replyToMessageId?: number
  ): Promise<number | undefined> {
    const response = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: this.parseMode,
        disable_notification: this.disableNotification,
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      }),
    });

    const data = (await response.json()) as TelegramResponse;
    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description}`);
    }
    return data.result?.message_id;
  }

  /**
   * Send a chat action (e.g., "typing")
   */
  private async sendChatAction(action: string): Promise<void> {
    await fetch(`${this.baseUrl}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        action,
      }),
    });
  }

  /**
   * Format new session notification
   */
  private formatNewSession(visitorId: string, url: string): string {
    if (this.parseMode === 'HTML') {
      return `<b>New chat session</b>\n` +
        `<b>Visitor:</b> ${this.escapeHtml(visitorId)}\n` +
        `<b>Page:</b> ${this.escapeHtml(url)}`;
    }
    return `*New chat session*\n` +
      `*Visitor:* ${this.escapeMarkdown(visitorId)}\n` +
      `*Page:* ${this.escapeMarkdown(url)}`;
  }

  /**
   * Format visitor message
   */
  private formatVisitorMessage(visitorId: string, content: string): string {
    if (this.parseMode === 'HTML') {
      return `<b>${this.escapeHtml(visitorId)}:</b>\n${this.escapeHtml(content)}`;
    }
    return `*${this.escapeMarkdown(visitorId)}:*\n${this.escapeMarkdown(content)}`;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Escape Markdown special characters
   */
  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }
}

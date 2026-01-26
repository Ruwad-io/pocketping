import { PocketPingSetupError, SETUP_GUIDES } from '../errors';
import type { PocketPing } from '../pocketping';
import type { Message, Session } from '../types';
import type { Bridge, BridgeMessageResult } from './types';

/**
 * Slack API response types
 */
interface SlackResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  [key: string]: unknown;
}

/**
 * Options for Slack webhook mode
 */
export interface SlackWebhookOptions {
  /** Custom username for webhook messages */
  username?: string;
  /** Custom emoji icon (e.g., ':robot_face:') */
  iconEmoji?: string;
  /** Custom icon URL (overrides iconEmoji) */
  iconUrl?: string;
}

/**
 * Options for Slack bot mode
 */
export interface SlackBotOptions {
  /** Custom username for bot messages */
  username?: string;
  /** Custom emoji icon (e.g., ':robot_face:') */
  iconEmoji?: string;
  /** Custom icon URL (overrides iconEmoji) */
  iconUrl?: string;
}

/**
 * Slack Bridge for PocketPing.
 * Sends visitor messages to a Slack channel using webhooks or bot API.
 *
 * @example Webhook mode
 * ```ts
 * const slack = SlackBridge.webhook(
 *   'https://hooks.slack.com/services/T.../B.../xxx',
 *   { username: 'PocketPing', iconEmoji: ':speech_balloon:' }
 * );
 * ```
 *
 * @example Bot mode
 * ```ts
 * const slack = SlackBridge.bot(
 *   'xoxb-YOUR-BOT-TOKEN',
 *   'C1234567890',
 *   { username: 'PocketPing' }
 * );
 * ```
 */
export class SlackBridge implements Bridge {
  readonly name = 'slack';

  private pocketping?: PocketPing;
  private readonly mode: 'webhook' | 'bot';
  private readonly webhookUrl?: string;
  private readonly botToken?: string;
  private readonly channelId?: string;
  private readonly username?: string;
  private readonly iconEmoji?: string;
  private readonly iconUrl?: string;

  private constructor(config: {
    mode: 'webhook' | 'bot';
    webhookUrl?: string;
    botToken?: string;
    channelId?: string;
    username?: string;
    iconEmoji?: string;
    iconUrl?: string;
  }) {
    this.mode = config.mode;
    this.webhookUrl = config.webhookUrl;
    this.botToken = config.botToken;
    this.channelId = config.channelId;
    this.username = config.username;
    this.iconEmoji = config.iconEmoji;
    this.iconUrl = config.iconUrl;
  }

  /**
   * Create a Slack bridge using a webhook URL
   */
  static webhook(webhookUrl: string, options: SlackWebhookOptions = {}): SlackBridge {
    if (!webhookUrl) {
      throw new PocketPingSetupError({
        bridge: 'Slack',
        missing: 'webhookUrl',
        guide: SETUP_GUIDES.slack.webhookUrl,
      });
    }

    if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
      throw new PocketPingSetupError({
        bridge: 'Slack',
        missing: 'valid webhookUrl',
        guide:
          'Webhook URL must start with https://hooks.slack.com/\n\n' +
          SETUP_GUIDES.slack.webhookUrl,
      });
    }

    return new SlackBridge({
      mode: 'webhook',
      webhookUrl,
      username: options.username,
      iconEmoji: options.iconEmoji,
      iconUrl: options.iconUrl,
    });
  }

  /**
   * Create a Slack bridge using a bot token
   */
  static bot(botToken: string, channelId: string, options: SlackBotOptions = {}): SlackBridge {
    if (!botToken) {
      throw new PocketPingSetupError({
        bridge: 'Slack',
        missing: 'botToken',
        guide: SETUP_GUIDES.slack.botToken,
      });
    }

    if (!botToken.startsWith('xoxb-')) {
      throw new PocketPingSetupError({
        bridge: 'Slack',
        missing: 'valid botToken',
        guide: `Bot token must start with xoxb-\n\n${SETUP_GUIDES.slack.botToken}`,
      });
    }

    if (!channelId) {
      throw new PocketPingSetupError({
        bridge: 'Slack',
        missing: 'channelId',
        guide: SETUP_GUIDES.slack.channelId,
      });
    }

    return new SlackBridge({
      mode: 'bot',
      botToken,
      channelId,
      username: options.username,
      iconEmoji: options.iconEmoji,
      iconUrl: options.iconUrl,
    });
  }

  /**
   * Initialize the bridge (optional setup)
   */
  async init(pocketping: PocketPing): Promise<void> {
    this.pocketping = pocketping;
    // Verify connection for bot mode
    if (this.mode === 'bot' && this.botToken) {
      try {
        const response = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.botToken}`,
          },
        });
        const data = (await response.json()) as SlackResponse;
        if (!data.ok) {
          console.error('[SlackBridge] Invalid bot token:', data.error);
        }
      } catch (error) {
        console.error('[SlackBridge] Failed to verify bot token:', error);
      }
    }
  }

  /**
   * Called when a new chat session is created
   */
  async onNewSession(session: Session): Promise<void> {
    const url = session.metadata?.url || 'Unknown page';

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'New chat session',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Visitor:*\n${session.visitorId}`,
          },
          {
            type: 'mrkdwn',
            text: `*Page:*\n${url}`,
          },
        ],
      },
    ];

    try {
      await this.sendBlocks(blocks);
    } catch (error) {
      console.error('[SlackBridge] Failed to send new session notification:', error);
    }
  }

  /**
   * Called when a visitor sends a message.
   * Returns the Slack message timestamp for edit/delete sync.
   */
  async onVisitorMessage(message: Message, session: Session): Promise<BridgeMessageResult> {
    const blocks: Array<Record<string, unknown>> = [];

    if (message.replyTo && this.pocketping?.getStorage().getMessage) {
      const replyTarget = await this.pocketping.getStorage().getMessage(message.replyTo);
      if (replyTarget) {
        const senderLabel =
          replyTarget.sender === 'visitor'
            ? 'Visitor'
            : replyTarget.sender === 'operator'
              ? 'Support'
              : 'AI';
        const rawPreview = replyTarget.deletedAt
          ? 'Message deleted'
          : replyTarget.content || 'Message';
        const preview = rawPreview.length > 140 ? `${rawPreview.slice(0, 140)}...` : rawPreview;
        const quoted = `> *${this.escapeSlack(senderLabel)}* — ${this.escapeSlack(preview)}`;
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: quoted,
          },
        });
      }
    }

    blocks.push(
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${this.escapeSlack(session.visitorId)}:*\n${this.escapeSlack(message.content)}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `<!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} at {time}|${new Date().toISOString()}>`,
          },
        ],
      }
    );

    try {
      const messageId = await this.sendBlocks(blocks);
      return { messageId };
    } catch (error) {
      console.error('[SlackBridge] Failed to send visitor message:', error);
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
    // Don't echo messages that originated from Slack
    if (sourceBridge === 'slack') {
      return;
    }

    const name = operatorName || 'Operator';
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${this.escapeSlack(name)}:*\n${this.escapeSlack(message.content)}`,
        },
      },
    ];

    try {
      await this.sendBlocks(blocks);
    } catch (error) {
      console.error('[SlackBridge] Failed to send operator message:', error);
    }
  }

  /**
   * Called when visitor starts/stops typing
   */
  async onTyping(_sessionId: string, _isTyping: boolean): Promise<void> {
    // Slack doesn't support typing indicators via API
    // This is a no-op
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
    // Only bot mode supports message editing
    if (this.mode !== 'bot' || !this.channelId) {
      console.warn('[SlackBridge] Message edit only supported in bot mode');
      return false;
    }

    try {
      const response = await fetch('https://slack.com/api/chat.update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.botToken}`,
        },
        body: JSON.stringify({
          channel: this.channelId,
          ts: bridgeMessageId,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${this.escapeSlack(newContent)}\n\n_(edited)_`,
              },
            },
          ],
        }),
      });

      const data = (await response.json()) as SlackResponse;
      if (!data.ok) {
        console.error('[SlackBridge] Edit failed:', data.error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('[SlackBridge] Failed to edit message:', error);
      return false;
    }
  }

  /**
   * Called when a visitor deletes their message.
   * @returns true if delete succeeded, false otherwise
   */
  async onMessageDelete(_messageId: string, bridgeMessageId: string | number): Promise<boolean> {
    // Only bot mode supports message deletion
    if (this.mode !== 'bot' || !this.channelId) {
      console.warn('[SlackBridge] Message delete only supported in bot mode');
      return false;
    }

    try {
      const response = await fetch('https://slack.com/api/chat.delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.botToken}`,
        },
        body: JSON.stringify({
          channel: this.channelId,
          ts: bridgeMessageId,
        }),
      });

      const data = (await response.json()) as SlackResponse;
      if (!data.ok) {
        // message_not_found is acceptable
        if (data.error === 'message_not_found') {
          return true;
        }
        console.error('[SlackBridge] Delete failed:', data.error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('[SlackBridge] Failed to delete message:', error);
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
    const blocks: Array<Record<string, unknown>> = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `Custom Event: ${event.name}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Visitor:*\n${session.visitorId}`,
          },
        ],
      },
    ];

    if (event.data) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Data:*\n\`\`\`${JSON.stringify(event.data, null, 2)}\`\`\``,
        },
      });
    }

    try {
      await this.sendBlocks(blocks);
    } catch (error) {
      console.error('[SlackBridge] Failed to send custom event:', error);
    }
  }

  /**
   * Called when a user identifies themselves via PocketPing.identify()
   */
  async onIdentityUpdate(session: Session): Promise<void> {
    if (!session.identity) return;

    const identity = session.identity;
    const fields = [
      {
        type: 'mrkdwn',
        text: `*User ID:*\n${identity.id}`,
      },
    ];

    if (identity.name) {
      fields.push({
        type: 'mrkdwn',
        text: `*Name:*\n${identity.name}`,
      });
    }
    if (identity.email) {
      fields.push({
        type: 'mrkdwn',
        text: `*Email:*\n${identity.email}`,
      });
    }
    if (session.userPhone) {
      fields.push({
        type: 'mrkdwn',
        text: `*Phone:*\n${session.userPhone}`,
      });
    }

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'User Identified',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields,
      },
    ];

    try {
      await this.sendBlocks(blocks);
    } catch (error) {
      console.error('[SlackBridge] Failed to send identity update:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Private helper methods
  // ─────────────────────────────────────────────────────────────────

  /**
   * Send blocks to Slack
   */
  private async sendBlocks(blocks: Array<Record<string, unknown>>): Promise<string | undefined> {
    const payload: Record<string, unknown> = { blocks };

    if (this.username) {
      payload.username = this.username;
    }
    if (this.iconUrl) {
      payload.icon_url = this.iconUrl;
    } else if (this.iconEmoji) {
      payload.icon_emoji = this.iconEmoji;
    }

    if (this.mode === 'webhook' && this.webhookUrl) {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Slack webhook error: ${error}`);
      }

      // Webhooks don't return message ts
      return undefined;
    } else if (this.mode === 'bot' && this.channelId) {
      payload.channel = this.channelId;

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.botToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as SlackResponse;
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`);
      }

      // Return message timestamp as ID
      return data.ts;
    }

    return undefined;
  }

  /**
   * Escape special characters for Slack mrkdwn
   */
  private escapeSlack(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

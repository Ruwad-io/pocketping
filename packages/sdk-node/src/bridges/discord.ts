import type { Bridge, BridgeMessageResult } from './types';
import type { PocketPing } from '../pocketping';
import type { Session, Message } from '../types';

/**
 * Discord API response types
 */
interface DiscordMessageResponse {
  id: string;
  [key: string]: unknown;
}

/**
 * Options for Discord webhook mode
 */
export interface DiscordWebhookOptions {
  /** Custom username for webhook messages */
  username?: string;
  /** Custom avatar URL for webhook messages */
  avatarUrl?: string;
}

/**
 * Options for Discord bot mode
 */
export interface DiscordBotOptions {
  /** Custom username displayed in embeds */
  username?: string;
  /** Custom avatar URL for embeds */
  avatarUrl?: string;
}

/**
 * Discord Bridge for PocketPing.
 * Sends visitor messages to a Discord channel using webhooks or bot API.
 *
 * @example Webhook mode
 * ```ts
 * const discord = DiscordBridge.webhook(
 *   'https://discord.com/api/webhooks/123/abc',
 *   { username: 'PocketPing' }
 * );
 * ```
 *
 * @example Bot mode
 * ```ts
 * const discord = DiscordBridge.bot(
 *   'BOT_TOKEN',
 *   'CHANNEL_ID',
 *   { username: 'PocketPing' }
 * );
 * ```
 */
export class DiscordBridge implements Bridge {
  readonly name = 'discord';

  private pocketping?: PocketPing;
  private readonly mode: 'webhook' | 'bot';
  private readonly webhookUrl?: string;
  private readonly botToken?: string;
  private readonly channelId?: string;
  private readonly username?: string;
  private readonly avatarUrl?: string;

  private constructor(config: {
    mode: 'webhook' | 'bot';
    webhookUrl?: string;
    botToken?: string;
    channelId?: string;
    username?: string;
    avatarUrl?: string;
  }) {
    this.mode = config.mode;
    this.webhookUrl = config.webhookUrl;
    this.botToken = config.botToken;
    this.channelId = config.channelId;
    this.username = config.username;
    this.avatarUrl = config.avatarUrl;
  }

  /**
   * Create a Discord bridge using a webhook URL
   */
  static webhook(
    webhookUrl: string,
    options: DiscordWebhookOptions = {}
  ): DiscordBridge {
    return new DiscordBridge({
      mode: 'webhook',
      webhookUrl,
      username: options.username,
      avatarUrl: options.avatarUrl,
    });
  }

  /**
   * Create a Discord bridge using a bot token
   */
  static bot(
    botToken: string,
    channelId: string,
    options: DiscordBotOptions = {}
  ): DiscordBridge {
    return new DiscordBridge({
      mode: 'bot',
      botToken,
      channelId,
      username: options.username,
      avatarUrl: options.avatarUrl,
    });
  }

  /**
   * Initialize the bridge (optional setup)
   */
  async init(pocketping: PocketPing): Promise<void> {
    this.pocketping = pocketping;
    // Verify connection based on mode
    if (this.mode === 'bot' && this.botToken) {
      try {
        const response = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${this.botToken}` },
        });
        if (!response.ok) {
          console.error('[DiscordBridge] Invalid bot token');
        }
      } catch (error) {
        console.error('[DiscordBridge] Failed to verify bot token:', error);
      }
    }
  }

  /**
   * Called when a new chat session is created
   */
  async onNewSession(session: Session): Promise<void> {
    const url = session.metadata?.url || 'Unknown page';

    const embed = {
      title: 'New chat session',
      color: 0x5865f2, // Discord blurple
      fields: [
        { name: 'Visitor', value: session.visitorId, inline: true },
        { name: 'Page', value: url, inline: false },
      ],
      timestamp: new Date().toISOString(),
    };

    try {
      await this.sendEmbed(embed);
    } catch (error) {
      console.error('[DiscordBridge] Failed to send new session notification:', error);
    }
  }

  /**
   * Called when a visitor sends a message.
   * Returns the Discord message ID for edit/delete sync.
   */
  async onVisitorMessage(
    message: Message,
    session: Session
  ): Promise<BridgeMessageResult> {
    const embed = {
      author: {
        name: session.visitorId,
        icon_url: this.avatarUrl,
      },
      description: message.content,
      color: 0x57f287, // Green
      timestamp: new Date().toISOString(),
    };
    let replyToMessageId: string | undefined;

    if (message.replyTo && this.pocketping?.getStorage().getBridgeMessageIds) {
      const ids = await this.pocketping
        .getStorage()
        .getBridgeMessageIds(message.replyTo);
      if (ids?.discordMessageId) {
        replyToMessageId = ids.discordMessageId;
      }
    }

    try {
      const messageId = await this.sendEmbed(embed, replyToMessageId);
      return { messageId };
    } catch (error) {
      console.error('[DiscordBridge] Failed to send visitor message:', error);
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
    // Don't echo messages that originated from Discord
    if (sourceBridge === 'discord') {
      return;
    }

    const embed = {
      author: {
        name: operatorName || 'Operator',
        icon_url: this.avatarUrl,
      },
      description: message.content,
      color: 0xfee75c, // Yellow
      timestamp: new Date().toISOString(),
    };

    try {
      await this.sendEmbed(embed);
    } catch (error) {
      console.error('[DiscordBridge] Failed to send operator message:', error);
    }
  }

  /**
   * Called when visitor starts/stops typing
   */
  async onTyping(_sessionId: string, isTyping: boolean): Promise<void> {
    if (!isTyping || this.mode !== 'bot' || !this.channelId) return;

    try {
      await fetch(
        `https://discord.com/api/v10/channels/${this.channelId}/typing`,
        {
          method: 'POST',
          headers: { Authorization: `Bot ${this.botToken}` },
        }
      );
    } catch (error) {
      console.error('[DiscordBridge] Failed to send typing indicator:', error);
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
      if (this.mode === 'webhook' && this.webhookUrl) {
        // Webhooks can edit their own messages
        const response = await fetch(
          `${this.webhookUrl}/messages/${bridgeMessageId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [
                {
                  description: `${newContent}\n\n*(edited)*`,
                  color: 0x57f287,
                },
              ],
            }),
          }
        );
        return response.ok;
      } else if (this.mode === 'bot' && this.channelId) {
        const response = await fetch(
          `https://discord.com/api/v10/channels/${this.channelId}/messages/${bridgeMessageId}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bot ${this.botToken}`,
            },
            body: JSON.stringify({
              embeds: [
                {
                  description: `${newContent}\n\n*(edited)*`,
                  color: 0x57f287,
                },
              ],
            }),
          }
        );
        return response.ok;
      }
      return false;
    } catch (error) {
      console.error('[DiscordBridge] Failed to edit message:', error);
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
      if (this.mode === 'webhook' && this.webhookUrl) {
        const response = await fetch(
          `${this.webhookUrl}/messages/${bridgeMessageId}`,
          { method: 'DELETE' }
        );
        return response.ok || response.status === 404;
      } else if (this.mode === 'bot' && this.channelId) {
        const response = await fetch(
          `https://discord.com/api/v10/channels/${this.channelId}/messages/${bridgeMessageId}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bot ${this.botToken}` },
          }
        );
        return response.ok || response.status === 404;
      }
      return false;
    } catch (error) {
      console.error('[DiscordBridge] Failed to delete message:', error);
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
    const embed = {
      title: `Custom Event: ${event.name}`,
      color: 0xeb459e, // Fuchsia
      fields: [
        { name: 'Visitor', value: session.visitorId, inline: true },
        ...(event.data
          ? [
              {
                name: 'Data',
                value: `\`\`\`json\n${JSON.stringify(event.data, null, 2)}\n\`\`\``,
                inline: false,
              },
            ]
          : []),
      ],
      timestamp: new Date().toISOString(),
    };

    try {
      await this.sendEmbed(embed);
    } catch (error) {
      console.error('[DiscordBridge] Failed to send custom event:', error);
    }
  }

  /**
   * Called when a user identifies themselves via PocketPing.identify()
   */
  async onIdentityUpdate(session: Session): Promise<void> {
    if (!session.identity) return;

    const identity = session.identity;
    const fields = [
      { name: 'User ID', value: identity.id, inline: true },
    ];

    if (identity.name) {
      fields.push({ name: 'Name', value: identity.name, inline: true });
    }
    if (identity.email) {
      fields.push({ name: 'Email', value: identity.email, inline: true });
    }

    const embed = {
      title: 'User Identified',
      color: 0x5865f2,
      fields,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.sendEmbed(embed);
    } catch (error) {
      console.error('[DiscordBridge] Failed to send identity update:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Private helper methods
  // ─────────────────────────────────────────────────────────────────

  /**
   * Send an embed to Discord
   */
  private async sendEmbed(
    embed: Record<string, unknown>,
    replyToMessageId?: string
  ): Promise<string | undefined> {
    const body: Record<string, unknown> = {
      embeds: [embed],
    };

    if (this.username) {
      body.username = this.username;
    }
    if (this.avatarUrl) {
      body.avatar_url = this.avatarUrl;
    }

    if (this.mode === 'webhook' && this.webhookUrl) {
      // Use ?wait=true to get the message back
      if (replyToMessageId) {
        body.message_reference = { message_id: replyToMessageId };
      }
      const response = await fetch(`${this.webhookUrl}?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Discord webhook error: ${error}`);
      }

      const data = (await response.json()) as DiscordMessageResponse;
      return data.id;
    } else if (this.mode === 'bot' && this.channelId) {
      if (replyToMessageId) {
        body.message_reference = { message_id: replyToMessageId };
      }
      const response = await fetch(
        `https://discord.com/api/v10/channels/${this.channelId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${this.botToken}`,
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Discord API error: ${error}`);
      }

      const data = (await response.json()) as DiscordMessageResponse;
      return data.id;
    }

    return undefined;
  }
}

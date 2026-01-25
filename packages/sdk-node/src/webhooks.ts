import type { IncomingMessage, ServerResponse } from 'http';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Attachment from an operator message */
export interface OperatorAttachment {
  filename: string;
  mimeType: string;
  size: number;
  data: Buffer;
  bridgeFileId?: string;
}

/** Callback when operator sends a message from a bridge */
export type OperatorMessageCallback = (
  sessionId: string,
  content: string,
  operatorName: string,
  sourceBridge: 'telegram' | 'discord' | 'slack',
  attachments: OperatorAttachment[],
  replyToBridgeMessageId?: number | null,
  bridgeMessageId?: number | string | null
) => void | Promise<void>;

export type OperatorMessageEditCallback = (
  sessionId: string,
  bridgeMessageId: number | string,
  content: string,
  sourceBridge: 'telegram' | 'discord' | 'slack',
  editedAt?: string
) => void | Promise<void>;

export type OperatorMessageDeleteCallback = (
  sessionId: string,
  bridgeMessageId: number | string,
  sourceBridge: 'telegram' | 'discord' | 'slack',
  deletedAt?: string
) => void | Promise<void>;

/** Webhook handler configuration */
export interface WebhookConfig {
  telegramBotToken?: string;
  slackBotToken?: string;
  discordBotToken?: string;
  allowedBotIds?: string[];
  onOperatorMessage: OperatorMessageCallback;
  onOperatorMessageEdit?: OperatorMessageEditCallback;
  onOperatorMessageDelete?: OperatorMessageDeleteCallback;
}

// ─────────────────────────────────────────────────────────────────
// Telegram Types
// ─────────────────────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  chat: { id: number };
  from?: { id: number; first_name: string; username?: string };
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  audio?: TelegramAudio;
  video?: TelegramVideo;
  voice?: TelegramVoice;
  reply_to_message?: { message_id: number };
  date: number;
  edit_date?: number;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramAudio {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVideo {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVoice {
  file_id: string;
  mime_type?: string;
  file_size?: number;
}

interface ParsedMedia {
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
}

// ─────────────────────────────────────────────────────────────────
// Slack Types
// ─────────────────────────────────────────────────────────────────

interface SlackEventPayload {
  type: string;
  token?: string;
  challenge?: string;
  team_id?: string;
  event?: SlackEvent;
}

interface SlackEvent {
  type: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  files?: SlackFile[];
  message?: {
    text?: string;
    user?: string;
    bot_id?: string;
    ts?: string;
    thread_ts?: string;
    files?: SlackFile[];
  };
  previous_message?: {
    text?: string;
    user?: string;
    bot_id?: string;
    ts?: string;
    thread_ts?: string;
  };
  deleted_ts?: string;
}

interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  url_private: string;
  url_private_download?: string;
}

// ─────────────────────────────────────────────────────────────────
// Discord Types
// ─────────────────────────────────────────────────────────────────

interface DiscordInteraction {
  type: number;
  id: string;
  application_id: string;
  token: string;
  channel_id?: string;
  guild_id?: string;
  member?: { user?: DiscordUser };
  user?: DiscordUser;
  data?: DiscordInteractionData;
}

interface DiscordUser {
  id: string;
  username: string;
}

interface DiscordInteractionData {
  name?: string;
  custom_id?: string;
  options?: Array<{ name: string; value: string }>;
}

const DISCORD_INTERACTION_PING = 1;
const DISCORD_INTERACTION_APPLICATION_COMMAND = 2;
const DISCORD_RESPONSE_PONG = 1;
const DISCORD_RESPONSE_CHANNEL_MESSAGE = 4;

// ─────────────────────────────────────────────────────────────────
// Webhook Handler
// ─────────────────────────────────────────────────────────────────

export class WebhookHandler {
  private config: WebhookConfig;

  constructor(config: WebhookConfig) {
    this.config = config;
  }

  /**
   * Create an Express/Connect middleware for handling Telegram webhooks
   */
  handleTelegramWebhook(): (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => Promise<void> {
    return async (req, res) => {
      if (!this.config.telegramBotToken) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Telegram not configured' }));
        return;
      }

      try {
        const body = await this.parseBody(req);
        const update = body as TelegramUpdate;

        if (update.edited_message) {
          const msg = update.edited_message;

          if (msg.text?.startsWith('/')) {
            this.writeOK(res);
            return;
          }

          const text = msg.text ?? msg.caption ?? '';
          if (!text) {
            this.writeOK(res);
            return;
          }

          const topicId = msg.message_thread_id;
          if (!topicId) {
            this.writeOK(res);
            return;
          }

          if (this.config.onOperatorMessageEdit) {
            const editedAt = msg.edit_date
              ? new Date(msg.edit_date * 1000).toISOString()
              : new Date().toISOString();
            await this.config.onOperatorMessageEdit(
              String(topicId),
              msg.message_id,
              text,
              'telegram',
              editedAt
            );
          }

          this.writeOK(res);
          return;
        }

        if (update.message) {
          const msg = update.message;

          // Skip commands
          if (msg.text?.startsWith('/')) {
            this.writeOK(res);
            return;
          }

          // Get text content
          const text = msg.text ?? msg.caption ?? '';

          // Parse media
          let media: ParsedMedia | null = null;
          if (msg.photo && msg.photo.length > 0) {
            const largest = msg.photo[msg.photo.length - 1];
            media = {
              fileId: largest.file_id,
              filename: `photo_${Date.now()}.jpg`,
              mimeType: 'image/jpeg',
              size: largest.file_size ?? 0,
            };
          } else if (msg.document) {
            media = {
              fileId: msg.document.file_id,
              filename: msg.document.file_name ?? `document_${Date.now()}`,
              mimeType: msg.document.mime_type ?? 'application/octet-stream',
              size: msg.document.file_size ?? 0,
            };
          } else if (msg.audio) {
            media = {
              fileId: msg.audio.file_id,
              filename: msg.audio.file_name ?? `audio_${Date.now()}.mp3`,
              mimeType: msg.audio.mime_type ?? 'audio/mpeg',
              size: msg.audio.file_size ?? 0,
            };
          } else if (msg.video) {
            media = {
              fileId: msg.video.file_id,
              filename: msg.video.file_name ?? `video_${Date.now()}.mp4`,
              mimeType: msg.video.mime_type ?? 'video/mp4',
              size: msg.video.file_size ?? 0,
            };
          } else if (msg.voice) {
            media = {
              fileId: msg.voice.file_id,
              filename: `voice_${Date.now()}.ogg`,
              mimeType: msg.voice.mime_type ?? 'audio/ogg',
              size: msg.voice.file_size ?? 0,
            };
          }

          // Skip if no content
          if (!text && !media) {
            this.writeOK(res);
            return;
          }

          // Get topic ID (session identifier)
          const topicId = msg.message_thread_id;
          if (!topicId) {
            this.writeOK(res);
            return;
          }

          // Get operator name
          const operatorName = msg.from?.first_name ?? 'Operator';

          // Get reply_to_message ID if present (for visual reply linking)
          const replyToBridgeMessageId = msg.reply_to_message?.message_id ?? null;

          // Download media if present
          const attachments: OperatorAttachment[] = [];
          if (media) {
            const data = await this.downloadTelegramFile(media.fileId);
            if (data) {
              attachments.push({
                filename: media.filename,
                mimeType: media.mimeType,
                size: media.size,
                data,
                bridgeFileId: media.fileId,
              });
            }
          }

          // Call callback
          await this.config.onOperatorMessage(
            String(topicId),
            text,
            operatorName,
            'telegram',
            attachments,
            replyToBridgeMessageId,
            msg.message_id
          );
        }

        this.writeOK(res);
      } catch (error) {
        console.error('[WebhookHandler] Telegram error:', error);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    };
  }

  /**
   * Create an Express/Connect middleware for handling Slack webhooks
   */
  handleSlackWebhook(): (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => Promise<void> {
    return async (req, res) => {
      if (!this.config.slackBotToken) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Slack not configured' }));
        return;
      }

      try {
        const body = await this.parseBody(req);
        const payload = body as SlackEventPayload;

        // Handle URL verification challenge
        if (payload.type === 'url_verification' && payload.challenge) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ challenge: payload.challenge }));
          return;
        }

        // Handle event callbacks
        if (payload.type === 'event_callback' && payload.event) {
          const event = payload.event;

          const isAllowedBot = (botId?: string) =>
            !!botId && (this.config.allowedBotIds?.includes(botId) ?? false);

          if (event.subtype === 'message_changed') {
            if (!this.config.onOperatorMessageEdit) {
              this.writeOK(res);
              return;
            }

            const botId = event.message?.bot_id ?? event.previous_message?.bot_id ?? event.bot_id;
            if (botId && !isAllowedBot(botId)) {
              this.writeOK(res);
              return;
            }

            const threadTs = event.message?.thread_ts ?? event.previous_message?.thread_ts;
            const messageTs = event.message?.ts ?? event.previous_message?.ts;
            const text = event.message?.text ?? '';

            if (threadTs && messageTs) {
              await this.config.onOperatorMessageEdit(
                threadTs,
                messageTs,
                text,
                'slack',
                new Date().toISOString()
              );
            }

            this.writeOK(res);
            return;
          }

          if (event.subtype === 'message_deleted') {
            if (!this.config.onOperatorMessageDelete) {
              this.writeOK(res);
              return;
            }

            const botId = event.previous_message?.bot_id ?? event.bot_id;
            if (botId && !isAllowedBot(botId)) {
              this.writeOK(res);
              return;
            }

            const threadTs = event.previous_message?.thread_ts;
            const messageTs = event.deleted_ts ?? event.previous_message?.ts;

            if (threadTs && messageTs) {
              await this.config.onOperatorMessageDelete(
                threadTs,
                messageTs,
                'slack',
                new Date().toISOString()
              );
            }

            this.writeOK(res);
            return;
          }

          const hasContent =
            event.type === 'message' &&
            event.thread_ts &&
            (!event.bot_id || isAllowedBot(event.bot_id)) &&
            !event.subtype;
          const hasFiles = event.files && event.files.length > 0;

          if (hasContent && (event.text || hasFiles)) {
            const threadTs = event.thread_ts;
            const text = event.text ?? '';

            // Download files if present
            const attachments: OperatorAttachment[] = [];
            if (hasFiles && event.files) {
              for (const file of event.files) {
                const data = await this.downloadSlackFile(file);
                if (data) {
                  attachments.push({
                    filename: file.name,
                    mimeType: file.mimetype,
                    size: file.size,
                    data,
                    bridgeFileId: file.id,
                  });
                }
              }
            }

            // Get operator name
            let operatorName = 'Operator';
            if (event.user) {
              const name = await this.getSlackUserName(event.user);
              if (name) operatorName = name;
            }

            // Call callback (Slack reply support TODO)
            await this.config.onOperatorMessage(
              threadTs!,
              text,
              operatorName,
              'slack',
              attachments,
              null,
              event.ts ?? null
            );
          }
        }

        this.writeOK(res);
      } catch (error) {
        console.error('[WebhookHandler] Slack error:', error);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    };
  }

  /**
   * Create an Express/Connect middleware for handling Discord webhooks
   */
  handleDiscordWebhook(): (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => Promise<void> {
    return async (req, res) => {
      try {
        const body = await this.parseBody(req);
        const interaction = body as DiscordInteraction;

        // Handle PING (verification)
        if (interaction.type === DISCORD_INTERACTION_PING) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ type: DISCORD_RESPONSE_PONG }));
          return;
        }

        // Handle Application Commands (slash commands)
        if (
          interaction.type === DISCORD_INTERACTION_APPLICATION_COMMAND &&
          interaction.data
        ) {
          if (interaction.data.name === 'reply') {
            const threadId = interaction.channel_id;
            const content = interaction.data.options?.find(
              (opt) => opt.name === 'message'
            )?.value;

            if (threadId && content) {
              // Get operator name
              const operatorName =
                interaction.member?.user?.username ??
                interaction.user?.username ??
                'Operator';

              // Call callback (Discord reply support TODO)
              await this.config.onOperatorMessage(
                threadId,
                content,
                operatorName,
                'discord',
                [],
                null
              );

              // Respond to interaction
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  type: DISCORD_RESPONSE_CHANNEL_MESSAGE,
                  data: { content: '✅ Message sent to visitor' },
                })
              );
              return;
            }
          }
        }

        // Default response
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ type: DISCORD_RESPONSE_PONG }));
      } catch (error) {
        console.error('[WebhookHandler] Discord error:', error);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Helper Methods
  // ─────────────────────────────────────────────────────────────────

  private async parseBody(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
    if (req.body) return req.body;

    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  private writeOK(res: ServerResponse): void {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  }

  private async downloadTelegramFile(fileId: string): Promise<Buffer | null> {
    try {
      const botToken = this.config.telegramBotToken!;

      // Get file path
      const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
      const getFileResp = await fetch(getFileUrl);
      const getFileResult = (await getFileResp.json()) as {
        ok: boolean;
        result?: { file_path: string };
      };

      if (!getFileResult.ok || !getFileResult.result?.file_path) {
        return null;
      }

      // Download file
      const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${getFileResult.result.file_path}`;
      const downloadResp = await fetch(downloadUrl);
      const arrayBuffer = await downloadResp.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error('[WebhookHandler] Telegram file download error:', error);
      return null;
    }
  }

  private async downloadSlackFile(file: SlackFile): Promise<Buffer | null> {
    try {
      const downloadUrl = file.url_private_download ?? file.url_private;
      const resp = await fetch(downloadUrl, {
        headers: {
          Authorization: `Bearer ${this.config.slackBotToken}`,
        },
      });

      if (!resp.ok) {
        return null;
      }

      const arrayBuffer = await resp.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error('[WebhookHandler] Slack file download error:', error);
      return null;
    }
  }

  private async getSlackUserName(userId: string): Promise<string | null> {
    try {
      const url = `https://slack.com/api/users.info?user=${userId}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.config.slackBotToken}`,
        },
      });

      const result = (await resp.json()) as {
        ok: boolean;
        user?: { real_name?: string; name?: string };
      };

      if (!result.ok) {
        return null;
      }

      return result.user?.real_name ?? result.user?.name ?? null;
    } catch {
      return null;
    }
  }
}

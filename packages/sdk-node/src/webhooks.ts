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
  attachments: OperatorAttachment[]
) => void | Promise<void>;

/** Webhook handler configuration */
export interface WebhookConfig {
  telegramBotToken?: string;
  slackBotToken?: string;
  discordBotToken?: string;
  onOperatorMessage: OperatorMessageCallback;
}

// ─────────────────────────────────────────────────────────────────
// Telegram Types
// ─────────────────────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
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
  date: number;
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
            attachments
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

          const hasContent =
            event.type === 'message' &&
            event.thread_ts &&
            !event.bot_id &&
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

            // Call callback
            await this.config.onOperatorMessage(
              threadTs!,
              text,
              operatorName,
              'slack',
              attachments
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

              // Call callback
              await this.config.onOperatorMessage(
                threadId,
                content,
                operatorName,
                'discord',
                []
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

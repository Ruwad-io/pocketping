import { App, LogLevel } from '@slack/bolt';
import type { Bridge } from '@pocketping/sdk';
import type { PocketPing, Session, Message } from '@pocketping/sdk';

export interface SlackBridgeConfig {
  /** Slack bot token (xoxb-...) */
  botToken: string;

  /** Slack app token for Socket Mode (xapp-...) */
  appToken: string;

  /** Channel ID to send notifications to */
  channelId: string;

  /** Show page URL in notifications */
  showUrl?: boolean;
}

export class SlackBridge implements Bridge {
  name = 'slack';

  private app: App;
  private channelId: string;
  private config: SlackBridgeConfig;
  private pocketping: PocketPing | null = null;
  private sessionThreadMap: Map<string, string> = new Map(); // sessionId -> thread_ts
  private threadSessionMap: Map<string, string> = new Map(); // thread_ts -> sessionId

  constructor(config: SlackBridgeConfig) {
    this.config = config;
    this.channelId = config.channelId;

    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handle mentions for commands
    this.app.event('app_mention', async ({ event, say }) => {
      const text = event.text.toLowerCase();

      if (text.includes('online')) {
        this.pocketping?.setOperatorOnline(true);
        await say("✅ You're now online. Users will see you as available.");
      } else if (text.includes('offline')) {
        this.pocketping?.setOperatorOnline(false);
        await say("🌙 You're now offline. AI will handle conversations if configured.");
      } else if (text.includes('status')) {
        const online = this.pocketping ? true : false;
        await say(`📊 *Status*: ${online ? '🟢 Online' : '🔴 Offline'}`);
      }
    });

    // Handle thread replies
    this.app.event('message', async ({ event, client }) => {
      // @ts-ignore - thread_ts exists on threaded messages
      const threadTs = event.thread_ts;
      // @ts-ignore
      const botId = event.bot_id;

      // Ignore bot messages and non-threaded messages
      if (botId || !threadTs) return;

      const sessionId = this.threadSessionMap.get(threadTs);
      if (!sessionId || !this.pocketping) return;

      // @ts-ignore
      const text = event.text;
      if (!text) return;

      try {
        await this.pocketping.sendOperatorMessage(sessionId, text);
        this.pocketping.setOperatorOnline(true);

        // React to confirm
        await client.reactions.add({
          channel: this.channelId,
          // @ts-ignore
          timestamp: event.ts,
          name: 'white_check_mark',
        });
      } catch (err) {
        await client.chat.postMessage({
          channel: this.channelId,
          thread_ts: threadTs,
          text: `❌ Failed to send: ${err}`,
        });
      }
    });
  }

  async init(pocketping: PocketPing): Promise<void> {
    this.pocketping = pocketping;

    await this.app.start();

    // Send startup message
    await this.app.client.chat.postMessage({
      channel: this.channelId,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              '🔔 *PocketPing Connected*\n\n' +
              '*Commands (mention me):*\n' +
              '• `@PocketPing online` - Mark yourself as available\n' +
              '• `@PocketPing offline` - Mark yourself as away\n' +
              '• `@PocketPing status` - View current status\n\n' +
              '_Reply in thread to respond to users._',
          },
        },
      ],
    });

    console.log('[SlackBridge] Connected');
  }

  async onNewSession(session: Session): Promise<void> {
    const fields: Array<{ type: string; text: string }> = [
      {
        type: 'mrkdwn',
        text: `*Session*\n\`${session.id.slice(0, 8)}...\``,
      },
    ];

    if (this.config.showUrl !== false && session.metadata?.url) {
      fields.push({
        type: 'mrkdwn',
        text: `*Page*\n${session.metadata.url}`,
      });
    }

    if (session.metadata?.referrer) {
      fields.push({
        type: 'mrkdwn',
        text: `*From*\n${session.metadata.referrer}`,
      });
    }

    const result = await this.app.client.chat.postMessage({
      channel: this.channelId,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🆕 New Visitor',
          },
        },
        {
          type: 'section',
          fields,
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '_Reply in this thread to respond to the user_',
            },
          ],
        },
      ],
    });

    const threadTs = result.ts;
    if (threadTs) {
      this.sessionThreadMap.set(session.id, threadTs);
      this.threadSessionMap.set(threadTs, session.id);
    }
  }

  async onMessage(message: Message, session: Session): Promise<void> {
    if (message.sender !== 'visitor') return;

    let threadTs = this.sessionThreadMap.get(session.id);

    if (!threadTs) {
      // Create new thread
      const result = await this.app.client.chat.postMessage({
        channel: this.channelId,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `💬 *Message*\n\n${message.content}`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `_Session: \`${session.id.slice(0, 8)}...\`_`,
              },
            ],
          },
        ],
      });

      threadTs = result.ts;
      if (threadTs) {
        this.sessionThreadMap.set(session.id, threadTs);
        this.threadSessionMap.set(threadTs, session.id);
      }
    } else {
      // Reply in existing thread
      await this.app.client.chat.postMessage({
        channel: this.channelId,
        thread_ts: threadTs,
        text: message.content,
      });
    }
  }

  async destroy(): Promise<void> {
    await this.app.stop();
  }
}

export default SlackBridge;

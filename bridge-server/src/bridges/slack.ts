/**
 * Slack bridge with Thread support (Socket Mode)
 */

import { WebClient } from "@slack/web-api";
import { SocketModeClient } from "@slack/socket-mode";
import { Bridge } from "./base";
import type { Message, Session, SlackConfig } from "../types";

export class SlackBridge extends Bridge {
  private webClient: WebClient;
  private socketClient: SocketModeClient;
  private channelId: string;

  // Thread mode: session_id -> thread_ts
  private sessionThreadMap: Map<string, string> = new Map();
  // Thread mode: thread_ts -> session_id
  private threadSessionMap: Map<string, string> = new Map();

  private operatorOnline = false;

  constructor(config: SlackConfig) {
    super();
    this.channelId = config.channelId;
    this.webClient = new WebClient(config.botToken);
    this.socketClient = new SocketModeClient({
      appToken: config.appToken,
    });

    // Set up event handlers
    this.socketClient.on("message", this.handleSocketEvent.bind(this));
  }

  get name(): string {
    return "slack";
  }

  async init(): Promise<void> {
    // Connect to Socket Mode
    await this.socketClient.start();
    console.log("[Slack] Bridge started");

    // Send startup message
    await this.sendStartupMessage();
  }

  private async sendStartupMessage(): Promise<void> {
    try {
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                "🔔 *PocketPing Bridge Connected*\n\n" +
                "*Commands (mention me):*\n" +
                "• `@PocketPing online` - Marquer comme disponible\n" +
                "• `@PocketPing offline` - Marquer comme absent\n" +
                "• `@PocketPing status` - Voir le statut actuel\n\n" +
                "_Répondez dans un thread pour communiquer avec le visiteur._",
            },
          },
        ],
      });
    } catch (error) {
      console.error("[Slack] Failed to send startup message:", error);
    }
  }

  private async handleSocketEvent(event: any): Promise<void> {
    // Acknowledge the event
    if (event.ack) {
      await event.ack();
    }

    const body = event.body;
    if (!body) return;

    // Handle events_api
    if (body.type === "event_callback") {
      const innerEvent = body.event;

      if (innerEvent.type === "message" && !innerEvent.bot_id) {
        await this.handleMessageEvent(innerEvent);
      } else if (innerEvent.type === "app_mention") {
        await this.handleMention(innerEvent);
      }
    }
  }

  private async handleMessageEvent(event: any): Promise<void> {
    const threadTs = event.thread_ts;
    if (!threadTs) return; // Not a thread reply

    const sessionId = this.threadSessionMap.get(threadTs);
    if (!sessionId) return; // Not a tracked thread

    const text = event.text;
    if (!text) return;

    // Get operator name
    let operatorName: string | undefined;
    if (event.user) {
      try {
        const userInfo = await this.webClient.users.info({ user: event.user });
        if (userInfo.ok && userInfo.user) {
          operatorName = (userInfo.user as any).real_name || (userInfo.user as any).name;
        }
      } catch {
        // Ignore errors
      }
    }

    // Emit operator message event
    await this.emit({
      type: "operator_message",
      sessionId,
      content: text,
      sourceBridge: this.name,
      operatorName,
    });

    // React to confirm
    try {
      await this.webClient.reactions.add({
        channel: this.channelId,
        name: "white_check_mark",
        timestamp: event.ts,
      });
    } catch {
      // Reaction might already exist
    }
  }

  private async handleMention(event: any): Promise<void> {
    const text = (event.text || "").toLowerCase();

    if (text.includes("online")) {
      this.operatorOnline = true;
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        text: "✅ Vous êtes maintenant en ligne.",
      });
    } else if (text.includes("offline")) {
      this.operatorOnline = false;
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        text: "🌙 Vous êtes maintenant hors ligne.",
      });
    } else if (text.includes("status")) {
      const status = this.operatorOnline ? "🟢 En ligne" : "🔴 Hors ligne";
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        text: `📊 *Statut:* ${status}`,
      });
    }
  }

  async onNewSession(session: Session): Promise<void> {
    const fields: any[] = [
      {
        type: "mrkdwn",
        text: `*Session*\n\`${session.id.slice(0, 8)}...\``,
      },
    ];

    if (session.metadata?.url) {
      fields.push({
        type: "mrkdwn",
        text: `*Page*\n${session.metadata.url}`,
      });
    }

    if (session.metadata?.referrer) {
      fields.push({
        type: "mrkdwn",
        text: `*Depuis*\n${session.metadata.referrer}`,
      });
    }

    try {
      const result = await this.webClient.chat.postMessage({
        channel: this.channelId,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "🆕 Nouveau Visiteur",
            },
          },
          {
            type: "section",
            fields,
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "_Répondez dans ce thread pour communiquer avec le visiteur_",
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
    } catch (error) {
      console.error("[Slack] Failed to send new session message:", error);
    }
  }

  async onVisitorMessage(message: Message, session: Session): Promise<void> {
    let threadTs = this.sessionThreadMap.get(session.id);

    if (!threadTs) {
      // Create new thread for this session
      try {
        const result = await this.webClient.chat.postMessage({
          channel: this.channelId,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `💬 *Message*\n\n${message.content}`,
              },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
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
      } catch (error) {
        console.error("[Slack] Failed to create thread:", error);
        return;
      }
    } else {
      // Reply in existing thread
      try {
        await this.webClient.chat.postMessage({
          channel: this.channelId,
          thread_ts: threadTs,
          text: message.content,
        });
      } catch (error) {
        console.error("[Slack] Failed to send thread message:", error);
      }
    }
  }

  async onAITakeover(session: Session, reason: string): Promise<void> {
    const threadTs = this.sessionThreadMap.get(session.id);

    try {
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        thread_ts: threadTs,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🤖 *IA Activée*\nSession: \`${session.id.slice(0, 8)}...\`\nRaison: ${reason}`,
            },
          },
        ],
      });
    } catch (error) {
      console.error("[Slack] Failed to send AI takeover message:", error);
    }
  }

  async onOperatorMessage(
    message: Message,
    session: Session,
    sourceBridge: string,
    operatorName?: string
  ): Promise<void> {
    // Skip if message is from this bridge
    if (sourceBridge === this.name) return;

    const threadTs = this.sessionThreadMap.get(session.id);
    if (!threadTs) return;

    const bridgeEmoji: Record<string, string> = {
      telegram: ":airplane:",
      discord: ":video_game:",
      api: ":electric_plug:",
    };
    const emoji = bridgeEmoji[sourceBridge] || ":incoming_envelope:";
    const name = operatorName || "Operator";

    try {
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        thread_ts: threadTs,
        blocks: [
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `${emoji} *${name}* _via ${sourceBridge}_`,
              },
            ],
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: message.content,
            },
          },
        ],
      });
    } catch (error) {
      console.error("[Slack] Failed to send synced message:", error);
    }
  }

  async onOperatorStatusChange(online: boolean): Promise<void> {
    this.operatorOnline = online;
  }

  async destroy(): Promise<void> {
    await this.socketClient.disconnect();
    console.log("[Slack] Bridge stopped");
  }
}

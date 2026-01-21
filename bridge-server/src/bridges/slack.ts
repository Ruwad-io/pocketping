/**
 * Slack bridge with Thread support (Socket Mode)
 */

import { WebClient } from "@slack/web-api";
import { SocketModeClient } from "@slack/socket-mode";
import { Bridge } from "./base";
import type { Message, Session, MessageStatus, SlackConfig, CustomEvent } from "../types";

export class SlackBridge extends Bridge {
  private webClient: WebClient;
  private socketClient: SocketModeClient;
  private channelId: string;

  // Thread mode: session_id -> thread_ts
  private sessionThreadMap: Map<string, string> = new Map();
  // Thread mode: thread_ts -> session_id
  private threadSessionMap: Map<string, string> = new Map();

  // Track visitor messages for read receipts: message_ts -> { sessionId, messageId }
  private visitorMessageMap: Map<string, { sessionId: string; messageId: string }> = new Map();

  // Track operator messages for read receipts: pocketping_msg_id -> message_ts
  private operatorMessageMap: Map<string, string> = new Map();

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
        text: "PocketPing Bridge Connected - Commands: @PocketPing online/offline/status",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                "🔔 *PocketPing Bridge Connected*\n\n" +
                "*Commands (mention me):*\n" +
                "• `@PocketPing online` - Mark as available\n" +
                "• `@PocketPing offline` - Mark as away\n" +
                "• `@PocketPing status` - View current status\n" +
                "• `@PocketPing read` - Mark all visitor messages as read\n\n" +
                "_Reply in a thread to communicate with the visitor._",
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

    // Debug: log all incoming events
    console.log("[Slack] Event received:", body.type, body.event?.type || "");

    // Handle events_api
    if (body.type === "event_callback") {
      const innerEvent = body.event;

      if (innerEvent.type === "message" && !innerEvent.bot_id) {
        await this.handleMessageEvent(innerEvent);
      } else if (innerEvent.type === "app_mention") {
        await this.handleMention(innerEvent);
      } else if (innerEvent.type === "reaction_added") {
        await this.handleReactionAdded(innerEvent);
      }
    }
  }

  private async handleMessageEvent(event: any): Promise<void> {
    console.log("[Slack] Message event:", { thread_ts: event.thread_ts, text: event.text?.slice(0, 50) });

    const threadTs = event.thread_ts;
    if (!threadTs) {
      console.log("[Slack] Ignoring: not a thread reply");
      return;
    }

    const sessionId = this.threadSessionMap.get(threadTs);
    if (!sessionId) {
      console.log("[Slack] Ignoring: thread not tracked, known threads:", [...this.threadSessionMap.keys()]);
      return;
    }

    const text = event.text;
    if (!text) return;

    // Check if this is a command (message starts with bot mention)
    if (text.trim().startsWith("<@")) {
      console.log("[Slack] Detected mention, treating as command");
      await this.handleMentionCommand(text, threadTs, sessionId);
      return;
    }

    console.log("[Slack] Processing operator message for session:", sessionId);

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

    // Mark all visitor messages in this session as read
    const readMessageIds: string[] = [];
    for (const [messageTs, info] of this.visitorMessageMap.entries()) {
      if (info.sessionId === sessionId) {
        readMessageIds.push(info.messageId);
        this.visitorMessageMap.delete(messageTs);
      }
    }

    if (readMessageIds.length > 0) {
      await this.emit({
        type: "message_read_by_reaction",
        sessionId,
        messageIds: readMessageIds,
        sourceBridge: this.name,
      });
    }

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

  private async handleReactionAdded(event: any): Promise<void> {
    const messageTs = event.item?.ts;
    if (!messageTs) return;

    const info = this.visitorMessageMap.get(messageTs);
    if (!info) return;

    // Operator reacted to a visitor message = read receipt
    await this.emit({
      type: "message_read_by_reaction",
      sessionId: info.sessionId,
      messageIds: [info.messageId],
      sourceBridge: this.name,
    });

    this.visitorMessageMap.delete(messageTs);
  }

  private async handleMentionCommand(text: string, threadTs: string, sessionId: string): Promise<void> {
    const lowerText = text.toLowerCase();

    if (lowerText.includes("read")) {
      // Mark all visitor messages in this session as read
      const messageIds: string[] = [];
      for (const [messageTs, info] of this.visitorMessageMap.entries()) {
        if (info.sessionId === sessionId) {
          messageIds.push(info.messageId);
          this.visitorMessageMap.delete(messageTs);
        }
      }

      if (messageIds.length === 0) {
        await this.webClient.chat.postMessage({
          channel: this.channelId,
          text: "✅ All messages are already marked as read.",
          thread_ts: threadTs,
        });
        return;
      }

      await this.emit({
        type: "message_read_by_reaction",
        sessionId,
        messageIds,
        sourceBridge: this.name,
      });

      await this.webClient.chat.postMessage({
        channel: this.channelId,
        text: `👀 ${messageIds.length} message(s) marked as read.`,
        thread_ts: threadTs,
      });
    } else if (lowerText.includes("status")) {
      const status = this.operatorOnline ? "🟢 Online" : "🔴 Offline";
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        text: `📊 Status: ${status}`,
        thread_ts: threadTs,
      });
    } else if (lowerText.includes("online")) {
      this.operatorOnline = true;
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        text: "✅ You are now online.",
        thread_ts: threadTs,
      });
    } else if (lowerText.includes("offline")) {
      this.operatorOnline = false;
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        text: "🌙 You are now offline.",
        thread_ts: threadTs,
      });
    }
  }

  private async handleMention(event: any): Promise<void> {
    const text = (event.text || "").toLowerCase();
    const threadTs = event.thread_ts;

    if (text.includes("online")) {
      this.operatorOnline = true;
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        text: "✅ You are now online.",
        thread_ts: threadTs,
      });
    } else if (text.includes("offline")) {
      this.operatorOnline = false;
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        text: "🌙 You are now offline.",
        thread_ts: threadTs,
      });
    } else if (text.includes("status")) {
      const status = this.operatorOnline ? "🟢 Online" : "🔴 Offline";
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        text: `📊 Status: ${status}`,
        thread_ts: threadTs,
      });
    } else if (text.includes("read")) {
      // Mark all visitor messages in this thread as read
      const sessionId = threadTs ? this.threadSessionMap.get(threadTs) : undefined;

      if (!sessionId) {
        await this.webClient.chat.postMessage({
          channel: this.channelId,
          text: "❌ Use this command inside a conversation thread.",
          thread_ts: threadTs,
        });
        return;
      }

      const messageIds: string[] = [];
      for (const [messageTs, info] of this.visitorMessageMap.entries()) {
        if (info.sessionId === sessionId) {
          messageIds.push(info.messageId);
          this.visitorMessageMap.delete(messageTs);
        }
      }

      if (messageIds.length === 0) {
        await this.webClient.chat.postMessage({
          channel: this.channelId,
          text: "✅ All messages are already marked as read.",
          thread_ts: threadTs,
        });
        return;
      }

      await this.emit({
        type: "message_read_by_reaction",
        sessionId,
        messageIds,
        sourceBridge: this.name,
      });

      await this.webClient.chat.postMessage({
        channel: this.channelId,
        text: `👀 ${messageIds.length} message(s) marked as read.`,
        thread_ts: threadTs,
      });
    }
  }

  async onNewSession(session: Session): Promise<void> {
    const meta = session.metadata;
    const fields: any[] = [
      {
        type: "mrkdwn",
        text: `*Session*\n\`${session.id.slice(0, 8)}...\``,
      },
    ];

    if (meta?.url) {
      fields.push({
        type: "mrkdwn",
        text: `*Page*\n${meta.url}`,
      });
    }

    if (meta?.referrer) {
      fields.push({
        type: "mrkdwn",
        text: `*From*\n${meta.referrer}`,
      });
    }

    // Build device info
    const deviceParts: string[] = [];
    if (meta?.deviceType) deviceParts.push(meta.deviceType);
    if (meta?.browser) deviceParts.push(meta.browser);
    if (meta?.os) deviceParts.push(meta.os);
    if (deviceParts.length > 0) {
      fields.push({
        type: "mrkdwn",
        text: `*Device*\n${deviceParts.join(" • ")}`,
      });
    }

    // Build location info
    const locationParts: string[] = [];
    if (meta?.city) locationParts.push(meta.city);
    if (meta?.country) locationParts.push(meta.country);
    if (locationParts.length > 0) {
      fields.push({
        type: "mrkdwn",
        text: `*Location*\n${locationParts.join(", ")}`,
      });
    }

    if (meta?.ip) {
      fields.push({
        type: "mrkdwn",
        text: `*IP*\n\`${meta.ip}\``,
      });
    }

    // Plain text fallback
    let plainText = `New visitor - Session: ${session.id.slice(0, 8)}...`;
    if (meta?.url) plainText += ` | Page: ${meta.url}`;

    try {
      const result = await this.webClient.chat.postMessage({
        channel: this.channelId,
        text: plainText,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "🆕 New Conversation",
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
                text: "_Reply in this thread to communicate with the visitor_",
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
          text: `New message: ${message.content}`,
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

          // Track for read receipts
          this.visitorMessageMap.set(threadTs, {
            sessionId: session.id,
            messageId: message.id,
          });
        }

        // Notify backend that message was delivered to Slack
        await this.emit({
          type: "message_delivered",
          sessionId: session.id,
          messageId: message.id,
          sourceBridge: this.name,
        });
      } catch (error) {
        console.error("[Slack] Failed to create thread:", error);
        return;
      }
    } else {
      // Reply in existing thread
      try {
        const result = await this.webClient.chat.postMessage({
          channel: this.channelId,
          thread_ts: threadTs,
          text: message.content,
        });

        // Track for read receipts
        if (result.ts) {
          this.visitorMessageMap.set(result.ts, {
            sessionId: session.id,
            messageId: message.id,
          });
        }

        // Notify backend that message was delivered to Slack
        await this.emit({
          type: "message_delivered",
          sessionId: session.id,
          messageId: message.id,
          sourceBridge: this.name,
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
        text: `AI Activated - Session: ${session.id.slice(0, 8)}... - Reason: ${reason}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🤖 *AI Activated*\nSession: \`${session.id.slice(0, 8)}...\`\nReason: ${reason}`,
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
        text: `${name} via ${sourceBridge}: ${message.content}`,
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

  async onMessageRead(
    sessionId: string,
    messageIds: string[],
    status: MessageStatus
  ): Promise<void> {
    // Map status to Slack emoji names
    const emojiMap: Record<string, string> = {
      delivered: "ballot_box_with_check",
      read: "eyes",
    };

    const emoji = emojiMap[status];
    if (!emoji) return;

    for (const msgId of messageIds) {
      const messageTs = this.operatorMessageMap.get(msgId);
      if (!messageTs) continue;

      try {
        // Remove old "white_check_mark" reaction if exists
        try {
          await this.webClient.reactions.remove({
            channel: this.channelId,
            name: "white_check_mark",
            timestamp: messageTs,
          });
        } catch {
          // Reaction might not exist
        }

        // Add new status reaction
        await this.webClient.reactions.add({
          channel: this.channelId,
          name: emoji,
          timestamp: messageTs,
        });

        // Clean up after "read" status
        if (status === "read") {
          this.operatorMessageMap.delete(msgId);
        }
      } catch (error) {
        console.error("[Slack] Failed to update message reaction:", error);
      }
    }
  }

  async onCustomEvent(event: CustomEvent, session: Session): Promise<void> {
    const threadTs = this.sessionThreadMap.get(session.id);

    // Format event data for display
    const dataStr = event.data ? `\`\`\`${JSON.stringify(event.data, null, 2)}\`\`\`` : '_No data_';

    try {
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        thread_ts: threadTs,
        text: `Custom Event: ${event.name}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `⚡ *Custom Event*\n\n*Event:* \`${event.name}\`\n${dataStr}`,
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
    } catch (error) {
      console.error("[Slack] Failed to send custom event:", error);
    }
  }

  async onIdentityUpdate(session: Session): Promise<void> {
    const identity = session.identity;
    if (!identity) return;

    const threadTs = this.sessionThreadMap.get(session.id);

    // Build identity description
    const identityText = this.formatIdentity(session);

    try {
      await this.webClient.chat.postMessage({
        channel: this.channelId,
        thread_ts: threadTs,
        text: `User Identified: ${identity.name || identity.email || identity.id}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🏷️ *User Identified*\n\n${identityText}`,
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
    } catch (error) {
      console.error("[Slack] Failed to send identity update:", error);
    }
  }

  /**
   * Format user identity for display
   */
  private formatIdentity(session: Session): string {
    const identity = session.identity;
    if (!identity) {
      return `Visitor ${session.visitorId.slice(0, 8)}`;
    }

    const parts: string[] = [];

    // Name or email or ID
    if (identity.name) {
      parts.push(`👤 *${identity.name}*`);
    } else if (identity.email) {
      parts.push(`👤 *${identity.email}*`);
    } else {
      parts.push(`👤 *User ${String(identity.id).slice(0, 8)}*`);
    }

    // Email if different from name
    if (identity.email && identity.name) {
      parts.push(`📧 ${identity.email}`);
    }

    // Custom fields
    const standardFields = ['id', 'email', 'name'];
    const customFields = Object.entries(identity)
      .filter(([key]) => !standardFields.includes(key))
      .map(([key, value]) => `${key}: ${value}`);

    if (customFields.length > 0) {
      parts.push(`📋 ${customFields.join(' • ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Get display name for visitor (uses identity if available)
   */
  private getVisitorDisplayName(session: Session): string {
    if (session.identity?.name) {
      return session.identity.name;
    }
    if (session.identity?.email) {
      return session.identity.email.split('@')[0];
    }
    return 'Visitor';
  }

  async destroy(): Promise<void> {
    await this.socketClient.disconnect();
    console.log("[Slack] Bridge stopped");
  }
}

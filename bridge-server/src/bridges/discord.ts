/**
 * Discord bridge with Thread support
 */

import {
  Client,
  GatewayIntentBits,
  TextChannel,
  ThreadChannel,
  EmbedBuilder,
  Message as DiscordMessage,
  ChannelType,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { Bridge } from "./base";
import type { Message, Session, MessageStatus, DiscordConfig, CustomEvent } from "../types";

export class DiscordBridge extends Bridge {
  private client: Client;
  private channelId: string;
  private useThreads: boolean;
  private autoArchiveDuration: ThreadAutoArchiveDuration;
  private channel: TextChannel | null = null;
  private ready: Promise<void>;
  private resolveReady!: () => void;

  // Thread mode: session_id -> thread_id
  private sessionThreadMap: Map<string, string> = new Map();
  // Thread mode: thread_id -> session_id
  private threadSessionMap: Map<string, string> = new Map();

  // Legacy mode mappings
  private sessionMessageMap: Map<string, string> = new Map();
  private messageSessionMap: Map<string, string> = new Map();

  // Track visitor messages for read receipts: discord_msg_id -> { sessionId, messageId }
  private visitorMessageMap: Map<string, { sessionId: string; messageId: string }> = new Map();

  // Track operator messages for read receipts: pocketping_msg_id -> discord_msg
  private operatorMessageMap: Map<string, DiscordMessage> = new Map();

  private operatorOnline = false;

  constructor(config: DiscordConfig) {
    super();
    this.channelId = config.channelId;
    this.useThreads = config.useThreads ?? true;
    this.autoArchiveDuration = (config.autoArchiveDuration || 1440) as ThreadAutoArchiveDuration;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
    });

    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    // Set up event handlers
    this.client.once("ready", () => this.onReady());
    this.client.on("messageCreate", (msg) => this.onMessage(msg));
    this.client.on("messageReactionAdd", (reaction, user) => this.onReactionAdd(reaction, user));

    // Login
    this.client.login(config.botToken);
  }

  get name(): string {
    return "discord";
  }

  private async onReady(): Promise<void> {
    const channel = await this.client.channels.fetch(this.channelId);
    if (channel?.type === ChannelType.GuildText) {
      this.channel = channel as TextChannel;
    }
    console.log("[Discord] Bridge started");
    this.resolveReady();
    await this.sendStartupMessage();
  }

  async init(): Promise<void> {
    // Wait for the client to be ready
    await this.ready;
  }

  private async sendStartupMessage(): Promise<void> {
    if (!this.channel) return;

    const modeInfo = this.useThreads
      ? "**Mode:** Threads 🧵\nEach conversation has its own thread!"
      : "**Mode:** Legacy (reply-based)";

    const embed = new EmbedBuilder()
      .setTitle("🔔 PocketPing Bridge Connected")
      .setDescription(
        `${modeInfo}\n\n` +
          "**Commands:**\n" +
          "`!online` - Mark as available\n" +
          "`!offline` - Mark as away\n" +
          "`!status` - View current status\n" +
          "`!read` - Mark all visitor messages as read\n" +
          "`!close` - Close the conversation (Threads)"
      )
      .setColor(0x00ff00);

    await this.channel.send({ embeds: [embed] });
  }

  private async onMessage(message: DiscordMessage): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    // Handle commands
    if (message.content.startsWith("!")) {
      await this.handleCommand(message);
      return;
    }

    // Handle operator replies
    if (this.useThreads) {
      await this.handleThreadMessage(message);
    } else {
      await this.handleLegacyReply(message);
    }
  }

  private async onReactionAdd(reaction: any, user: any): Promise<void> {
    // Ignore bot reactions
    if (user.bot) return;

    const messageId = reaction.message.id;
    const info = this.visitorMessageMap.get(messageId);
    if (!info) return;

    // Operator reacted to a visitor message = read receipt
    await this.emit({
      type: "message_read_by_reaction",
      sessionId: info.sessionId,
      messageIds: [info.messageId],
      sourceBridge: this.name,
    });

    this.visitorMessageMap.delete(messageId);
  }

  private async handleCommand(message: DiscordMessage): Promise<void> {
    const command = message.content.slice(1).toLowerCase().split(" ")[0];

    switch (command) {
      case "online":
        this.operatorOnline = true;
        await message.reply("✅ You are now online.");
        break;

      case "offline":
        this.operatorOnline = false;
        await message.reply("🌙 You are now offline.");
        break;

      case "status": {
        const status = this.operatorOnline ? "🟢 Online" : "🔴 Offline";
        const activeSessions = this.sessionThreadMap.size;
        await message.reply(`📊 **Status:** ${status}\n💬 Active sessions: ${activeSessions}`);
        break;
      }

      case "read":
        await this.handleReadCommand(message);
        break;

      case "close":
        await this.handleCloseCommand(message);
        break;

      case "help":
        await message.reply(
          "📖 **PocketPing Bridge**\n\n" +
            "Reply in the thread to communicate with the visitor.\n\n" +
            "**Commands:**\n" +
            "`!online` - Mark as available\n" +
            "`!offline` - Mark as away\n" +
            "`!status` - View current status\n" +
            "`!read` - Mark all visitor messages as read\n" +
            "`!close` - Close the conversation"
        );
        break;
    }
  }

  private async handleReadCommand(message: DiscordMessage): Promise<void> {
    let sessionId: string | undefined;

    if (this.useThreads && message.channel.isThread()) {
      sessionId = this.threadSessionMap.get(message.channel.id);
    }

    if (!sessionId) {
      await message.reply("❌ Use this command inside a conversation thread.");
      return;
    }

    const messageIds: string[] = [];
    for (const [discordMsgId, info] of this.visitorMessageMap.entries()) {
      if (info.sessionId === sessionId) {
        messageIds.push(info.messageId);
        this.visitorMessageMap.delete(discordMsgId);
      }
    }

    if (messageIds.length === 0) {
      await message.reply("✅ All messages are already marked as read.");
      return;
    }

    await this.emit({
      type: "message_read_by_reaction",
      sessionId,
      messageIds,
      sourceBridge: this.name,
    });

    await message.reply(`👀 ${messageIds.length} message(s) marked as read.`);
  }

  private async handleCloseCommand(message: DiscordMessage): Promise<void> {
    if (!this.useThreads) {
      await message.reply("❌ This command only works in Thread mode.");
      return;
    }

    if (!message.channel.isThread()) {
      await message.reply("❌ Use this command inside a conversation thread.");
      return;
    }

    const threadId = message.channel.id;
    const sessionId = this.threadSessionMap.get(threadId);

    if (!sessionId) {
      await message.reply("❌ No active conversation in this thread.");
      return;
    }

    // Emit close event
    await this.emit({
      type: "session_closed",
      sessionId,
      sourceBridge: this.name,
    });

    await message.reply("✅ Conversation closed.");

    // Archive the thread
    try {
      const thread = message.channel as ThreadChannel;
      await thread.setName(`🔴 Closed - ${sessionId.slice(0, 8)}`);
      await thread.setArchived(true);
    } catch (error) {
      console.error("[Discord] Failed to archive thread:", error);
    }

    // Clean up mappings
    this.sessionThreadMap.delete(sessionId);
    this.threadSessionMap.delete(threadId);
  }

  private async handleThreadMessage(message: DiscordMessage): Promise<void> {
    if (!message.channel.isThread()) return;

    const thread = message.channel as ThreadChannel;
    if (thread.parentId !== this.channelId) return;

    const sessionId = this.threadSessionMap.get(thread.id);
    if (!sessionId) return;

    const operatorName = message.member?.displayName || message.author.username;

    await this.emit({
      type: "operator_message",
      sessionId,
      content: message.content,
      sourceBridge: this.name,
      operatorName,
    });

    // Mark all visitor messages in this session as read
    const readMessageIds: string[] = [];
    for (const [discordMsgId, info] of this.visitorMessageMap.entries()) {
      if (info.sessionId === sessionId) {
        readMessageIds.push(info.messageId);
        this.visitorMessageMap.delete(discordMsgId);
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
      await message.react("✅");
    } catch {
      // Reaction might fail
    }
  }

  private async handleLegacyReply(message: DiscordMessage): Promise<void> {
    if (message.channel.id !== this.channelId) return;
    if (!message.reference?.messageId) return;

    const sessionId = this.messageSessionMap.get(message.reference.messageId);
    if (!sessionId) return;

    const operatorName = message.member?.displayName || message.author.username;

    await this.emit({
      type: "operator_message",
      sessionId,
      content: message.content,
      sourceBridge: this.name,
      operatorName,
    });

    try {
      await message.react("✅");
    } catch {
      // Reaction might fail
    }
  }

  async onNewSession(session: Session): Promise<void> {
    if (this.useThreads) {
      await this.createThread(session);
    } else {
      await this.sendLegacyNotification(session);
    }
  }

  private async createThread(session: Session): Promise<void> {
    if (!this.channel) return;

    const meta = session.metadata;

    // Build thread name
    let pageInfo = "";
    if (meta?.url) {
      const parts = meta.url.split("/");
      const lastPart = parts.at(-1) ?? "home";
      const withoutQuery = lastPart.split("?").at(0) ?? lastPart;
      pageInfo = withoutQuery.slice(0, 20);
    }

    const threadName = pageInfo
      ? `🟢 ${session.id.slice(0, 8)} • ${pageInfo}`
      : `🟢 ${session.id.slice(0, 8)}`;

    // Build welcome embed
    let description = `Session: \`${session.id}\``;

    if (meta?.url) {
      description += `\n📍 **Page:** ${meta.url}`;
    }
    if (meta?.pageTitle) {
      description += `\n📄 **Title:** ${meta.pageTitle}`;
    }
    if (meta?.referrer) {
      description += `\n↩️ **From:** ${meta.referrer}`;
    }

    // Device info
    const deviceParts: string[] = [];
    if (meta?.deviceType) {
      const deviceEmoji = meta.deviceType === "mobile" ? "📱" : "💻";
      deviceParts.push(`${deviceEmoji} ${meta.deviceType}`);
    }
    if (meta?.browser) deviceParts.push(meta.browser);
    if (meta?.os) deviceParts.push(meta.os);
    if (deviceParts.length > 0) {
      description += `\n🖥️ **Device:** ${deviceParts.join(" • ")}`;
    }

    // Location
    const locationParts: string[] = [];
    if (meta?.city) locationParts.push(meta.city);
    if (meta?.country) locationParts.push(meta.country);
    if (locationParts.length > 0) {
      description += `\n🌍 **Location:** ${locationParts.join(", ")}`;
    }
    if (meta?.ip) {
      description += `\n🔗 **IP:** \`${meta.ip}\``;
    }

    // Other info
    if (meta?.language) {
      description += `\n🗣️ **Language:** ${meta.language}`;
    }
    if (meta?.timezone) {
      description += `\n🕐 **Timezone:** ${meta.timezone}`;
    }

    description += "\n\n💡 **Reply here to communicate with the visitor!**";

    const embed = new EmbedBuilder()
      .setTitle("🆕 New Conversation")
      .setDescription(description)
      .setColor(0x5865f2);

    try {
      const msg = await this.channel.send({ embeds: [embed] });
      const thread = await msg.startThread({
        name: threadName,
        autoArchiveDuration: this.autoArchiveDuration,
      });

      // Store mappings
      this.sessionThreadMap.set(session.id, thread.id);
      this.threadSessionMap.set(thread.id, session.id);

      await thread.send(
        "👋 Visitor connected! Messages will appear here.\n" +
          "Type directly to reply."
      );
    } catch (error) {
      console.error("[Discord] Failed to create thread:", error);
    }
  }

  private async sendLegacyNotification(session: Session): Promise<void> {
    if (!this.channel) return;

    const meta = session.metadata;
    let description = `Session: \`${session.id.slice(0, 8)}...\``;

    if (meta?.url) {
      description += `\nPage: ${meta.url}`;
    }
    if (meta?.referrer) {
      description += `\nFrom: ${meta.referrer}`;
    }

    const embed = new EmbedBuilder()
      .setTitle("🆕 New Visitor")
      .setDescription(description)
      .setFooter({ text: "Reply to this message to communicate" })
      .setColor(0x5865f2);

    try {
      const msg = await this.channel.send({ embeds: [embed] });
      this.sessionMessageMap.set(session.id, msg.id);
      this.messageSessionMap.set(msg.id, session.id);
    } catch (error) {
      console.error("[Discord] Failed to send notification:", error);
    }
  }

  async onVisitorMessage(message: Message, session: Session): Promise<void> {
    if (this.useThreads) {
      await this.sendThreadMessage(message, session);
    } else {
      await this.sendLegacyMessage(message, session);
    }
  }

  private async sendThreadMessage(message: Message, session: Session): Promise<void> {
    let threadId = this.sessionThreadMap.get(session.id);

    // Create thread if it doesn't exist
    if (!threadId) {
      await this.createThread(session);
      threadId = this.sessionThreadMap.get(session.id);
    }

    if (!threadId) return;

    try {
      const thread = (await this.client.channels.fetch(threadId)) as ThreadChannel;
      if (!thread) return;

      const embed = new EmbedBuilder()
        .setAuthor({ name: "👤 Visitor" })
        .setDescription(message.content)
        .setColor(0x9b59b6);

      const discordMsg = await thread.send({ embeds: [embed] });

      // Track for read receipts
      this.visitorMessageMap.set(discordMsg.id, {
        sessionId: session.id,
        messageId: message.id,
      });

      // Notify backend that message was delivered
      await this.emit({
        type: "message_delivered",
        sessionId: session.id,
        messageId: message.id,
        sourceBridge: this.name,
      });
    } catch (error) {
      console.error("[Discord] Failed to send thread message:", error);
    }
  }

  private async sendLegacyMessage(message: Message, session: Session): Promise<void> {
    if (!this.channel) return;

    const embed = new EmbedBuilder()
      .setTitle("💬 Message")
      .setDescription(`${message.content}\n\n*Session: \`${session.id.slice(0, 8)}...\`*`)
      .setColor(0x9b59b6);

    try {
      const msg = await this.channel.send({ embeds: [embed] });
      this.sessionMessageMap.set(session.id, msg.id);
      this.messageSessionMap.set(msg.id, session.id);

      // Notify backend that message was delivered
      await this.emit({
        type: "message_delivered",
        sessionId: session.id,
        messageId: message.id,
        sourceBridge: this.name,
      });
    } catch (error) {
      console.error("[Discord] Failed to send message:", error);
    }
  }

  async onAITakeover(session: Session, reason: string): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle("🤖 AI Activated")
      .setDescription(`Session: \`${session.id.slice(0, 8)}...\`\nReason: ${reason}`)
      .setColor(0xffa500);

    if (this.useThreads) {
      const threadId = this.sessionThreadMap.get(session.id);
      if (threadId) {
        try {
          const thread = (await this.client.channels.fetch(threadId)) as ThreadChannel;
          if (thread) {
            await thread.send({ embeds: [embed] });
            return;
          }
        } catch (error) {
          console.error("[Discord] Failed to send AI takeover to thread:", error);
        }
      }
    }

    if (this.channel) {
      await this.channel.send({ embeds: [embed] });
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

    const bridgeEmoji: Record<string, string> = {
      telegram: "✈️",
      slack: "💬",
      api: "🔌",
    };
    const emoji = bridgeEmoji[sourceBridge] || "📨";
    const name = operatorName || "Operator";

    const embed = new EmbedBuilder()
      .setAuthor({ name: `${emoji} ${name} via ${sourceBridge}` })
      .setDescription(message.content)
      .setColor(0x95a5a6);

    if (this.useThreads) {
      const threadId = this.sessionThreadMap.get(session.id);
      if (threadId) {
        try {
          const thread = (await this.client.channels.fetch(threadId)) as ThreadChannel;
          if (thread) {
            await thread.send({ embeds: [embed] });
            return;
          }
        } catch (error) {
          console.error("[Discord] Failed to send synced message to thread:", error);
        }
      }
    }

    if (this.channel) {
      await this.channel.send({ embeds: [embed] });
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
    // Map status to emoji reaction
    const emojiMap: Record<string, string> = {
      delivered: "☑️", // Ballot box with check
      read: "👁️", // Eye
    };

    const emoji = emojiMap[status];
    if (!emoji) return;

    for (const msgId of messageIds) {
      const discordMsg = this.operatorMessageMap.get(msgId);
      if (!discordMsg) continue;

      try {
        // Remove old "sent" reaction if exists
        const oldReaction = discordMsg.reactions.cache.get("✅");
        if (oldReaction) {
          await oldReaction.users.remove(this.client.user!.id);
        }

        // Add new status reaction
        await discordMsg.react(emoji);

        // Clean up after "read" status
        if (status === "read") {
          this.operatorMessageMap.delete(msgId);
        }
      } catch (error) {
        console.error("[Discord] Failed to update message reaction:", error);
      }
    }
  }

  async onCustomEvent(event: CustomEvent, session: Session): Promise<void> {
    // Format event data for display
    const dataStr = event.data ? `\`\`\`json\n${JSON.stringify(event.data, null, 2)}\n\`\`\`` : '_No data_';

    const embed = new EmbedBuilder()
      .setTitle("⚡ Custom Event")
      .setDescription(`**Event:** \`${event.name}\`\n\n${dataStr}`)
      .setFooter({ text: `Session: ${session.id.slice(0, 8)}...` })
      .setColor(0xf1c40f);

    if (this.useThreads) {
      const threadId = this.sessionThreadMap.get(session.id);
      if (threadId) {
        try {
          const thread = (await this.client.channels.fetch(threadId)) as ThreadChannel;
          if (thread) {
            await thread.send({ embeds: [embed] });
            return;
          }
        } catch (error) {
          console.error("[Discord] Failed to send custom event to thread:", error);
        }
      }
    }

    if (this.channel) {
      await this.channel.send({ embeds: [embed] });
    }
  }

  async destroy(): Promise<void> {
    this.client.destroy();
    console.log("[Discord] Bridge stopped");
  }
}

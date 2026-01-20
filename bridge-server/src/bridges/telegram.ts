/**
 * Telegram bridge with Forum Topics support
 */

import { Telegraf, Context } from "telegraf";
import type { Message as TelegramMessage } from "telegraf/types";
import { Bridge } from "./base";
import type { Message, Session, MessageStatus, TelegramConfig, CustomEvent } from "../types";

export class TelegramBridge extends Bridge {
  private bot: Telegraf;
  private forumChatId?: number;
  private chatId?: number;
  private useForumTopics: boolean;

  // Forum Topics mode: session_id -> topic_id
  private sessionTopicMap: Map<string, number> = new Map();
  // Forum Topics mode: topic_id -> session_id
  private topicSessionMap: Map<number, string> = new Map();

  // Legacy mode: message_id -> session_id
  private messageSessionMap: Map<number, string> = new Map();
  private sessionMessageMap: Map<string, number> = new Map();

  // Track operator messages for read receipts: pocketping_msg_id -> (chat_id, telegram_msg_id)
  private operatorMessageMap: Map<string, { chatId: number; messageId: number }> = new Map();

  // Track visitor messages for reaction-based read receipts: telegram_msg_id -> {sessionId, messageId}
  private visitorMessageMap: Map<number, { sessionId: string; messageId: string }> = new Map();

  private operatorOnline = false;

  constructor(config: TelegramConfig) {
    super();
    this.bot = new Telegraf(config.botToken);
    this.forumChatId = config.forumChatId;
    this.chatId = config.chatId;
    this.useForumTopics = !!config.forumChatId;
  }

  get name(): string {
    return "telegram";
  }

  async init(): Promise<void> {
    // Register command handlers
    this.bot.command("online", this.handleOnlineCommand.bind(this));
    this.bot.command("offline", this.handleOfflineCommand.bind(this));
    this.bot.command("status", this.handleStatusCommand.bind(this));
    this.bot.command("close", this.handleCloseCommand.bind(this));
    this.bot.command("read", this.handleReadCommand.bind(this));
    this.bot.command("help", this.handleHelpCommand.bind(this));

    // Handle incoming messages
    this.bot.on("message", this.handleMessage.bind(this));

    // Handle reactions (for read receipts)
    this.bot.on("message_reaction", this.handleReaction.bind(this));

    // Start the bot
    console.log("[Telegram] Launching bot...");
    try {
      // Launch with explicit polling options
      this.bot.launch({
        dropPendingUpdates: true,
        allowedUpdates: ["message", "callback_query", "message_reaction"],
      });

      // Don't await launch() - it returns a promise that resolves when bot stops
      // Instead, wait a bit and check if bot is running
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Test by getting bot info
      const botInfo = await this.bot.telegram.getMe();
      console.log(`[Telegram] Bridge started! Bot: @${botInfo.username}`);
    } catch (error) {
      console.error("[Telegram] Failed to launch bot:", error);
      throw error;
    }

    // Send startup message
    await this.sendStartupMessage();
  }

  private async sendStartupMessage(): Promise<void> {
    const targetChatId = this.forumChatId || this.chatId;
    if (!targetChatId) return;

    const modeInfo = this.useForumTopics
      ? "Mode: Forum Topics\nEach conversation gets its own topic!"
      : "Mode: Legacy (reply-based)";

    try {
      await this.bot.telegram.sendMessage(
        targetChatId,
        `🔔 *PocketPing Bridge Connected*\n\n${modeInfo}\n\n*Commands:*\n/online - Mark as available\n/offline - Mark as away\n/status - View current status\n/read - Mark messages as read\n/close - Close conversation (Forum Topics)\n/help - Help`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      console.error("[Telegram] Failed to send startup message:", error);
    }
  }

  private async handleOnlineCommand(ctx: Context): Promise<void> {
    this.operatorOnline = true;
    await ctx.reply("✅ You are now online. Users will see you as available.");
  }

  private async handleOfflineCommand(ctx: Context): Promise<void> {
    this.operatorOnline = false;
    await ctx.reply("🌙 You are now offline. AI will handle conversations if configured.");
  }

  private async handleStatusCommand(ctx: Context): Promise<void> {
    const status = this.operatorOnline ? "🟢 Online" : "🔴 Offline";
    const activeSessions = this.useForumTopics
      ? this.sessionTopicMap.size
      : this.sessionMessageMap.size;
    await ctx.reply(`📊 *Status:* ${status}\n💬 Active sessions: ${activeSessions}`, {
      parse_mode: "Markdown",
    });
  }

  private async handleCloseCommand(ctx: Context): Promise<void> {
    if (!this.useForumTopics) {
      await ctx.reply("❌ This command only works in Forum Topics mode.");
      return;
    }

    const topicId = ctx.message?.message_thread_id;
    if (!topicId) {
      await ctx.reply("❌ Use this command inside a conversation topic.");
      return;
    }

    const sessionId = this.topicSessionMap.get(topicId);
    if (!sessionId) {
      await ctx.reply("❌ No active conversation in this topic.");
      return;
    }

    // Emit close event
    await this.emit({
      type: "session_closed",
      sessionId,
      sourceBridge: this.name,
    });

    // Close the topic
    try {
      await this.bot.telegram.closeForumTopic(this.forumChatId!, topicId);
      await ctx.reply("✅ Conversation closed.");
    } catch (error) {
      console.error("[Telegram] Failed to close topic:", error);
    }

    // Clean up mappings
    this.sessionTopicMap.delete(sessionId);
    this.topicSessionMap.delete(topicId);
  }

  private async handleReadCommand(ctx: Context): Promise<void> {
    let sessionId: string | undefined;

    if (this.useForumTopics) {
      const topicId = ctx.message?.message_thread_id;
      if (!topicId) {
        await ctx.reply("❌ Use this command inside a conversation topic.");
        return;
      }
      sessionId = this.topicSessionMap.get(topicId);
    } else {
      // Legacy mode: get session from reply or last message
      const replyTo = (ctx.message as { reply_to_message?: { message_id: number } })?.reply_to_message;
      if (replyTo) {
        sessionId = this.messageSessionMap.get(replyTo.message_id);
      }
    }

    if (!sessionId) {
      await ctx.reply("❌ No active conversation found.");
      return;
    }

    // Get all tracked visitor messages for this session
    const messageIds: string[] = [];
    for (const [telegramMsgId, info] of this.visitorMessageMap.entries()) {
      if (info.sessionId === sessionId) {
        messageIds.push(info.messageId);
        this.visitorMessageMap.delete(telegramMsgId);
      }
    }

    if (messageIds.length === 0) {
      await ctx.reply("✅ All messages are already marked as read.");
      return;
    }

    // Emit read event
    await this.emit({
      type: "message_read_by_reaction",
      sessionId,
      messageIds,
      sourceBridge: this.name,
    });

    await ctx.reply(`👀 ${messageIds.length} message(s) marked as read.`);
  }

  private async handleHelpCommand(ctx: Context): Promise<void> {
    const modeHelp = this.useForumTopics
      ? "Reply directly in the topic to communicate with the visitor."
      : "Reply to a message to communicate with the corresponding visitor.";

    await ctx.reply(
      `📖 *PocketPing Bridge*\n\n${modeHelp}\n\n*Commands:*\n/online - Mark as available\n/offline - Mark as away\n/status - View current status\n/read - Mark messages as read ✓✓\n/close - Close conversation\n/help - This help`,
      { parse_mode: "Markdown" }
    );
  }

  private async handleMessage(ctx: Context): Promise<void> {
    const message = ctx.message as TelegramMessage.TextMessage;
    if (!message || !("text" in message)) return;

    // Skip commands
    if (message.text.startsWith("/")) return;

    if (this.useForumTopics) {
      await this.handleForumMessage(ctx, message);
    } else {
      await this.handleLegacyReply(ctx, message);
    }
  }

  private async handleReaction(ctx: Context): Promise<void> {
    // Get the reaction update
    const update = ctx.update as { message_reaction?: {
      message_id: number;
      chat: { id: number };
      new_reaction: Array<{ type: string; emoji?: string }>;
      user?: { id: number };
    }};

    const reaction = update.message_reaction;
    if (!reaction) return;

    // Check if the message is a tracked visitor message
    const tracked = this.visitorMessageMap.get(reaction.message_id);
    if (!tracked) return;

    // Only process if there's a new reaction (not removal)
    if (reaction.new_reaction.length === 0) return;

    // Get the emoji
    const emoji = reaction.new_reaction[0]?.emoji;
    console.log(`[Telegram] Reaction "${emoji}" on visitor message ${tracked.messageId.slice(0, 8)}...`);

    // Emit read event for this message
    await this.emit({
      type: "message_read_by_reaction",
      sessionId: tracked.sessionId,
      messageIds: [tracked.messageId],
      sourceBridge: this.name,
    });

    // Also mark all previous unread visitor messages in this session as read
    const sessionMessages: string[] = [];
    for (const [telegramMsgId, info] of this.visitorMessageMap.entries()) {
      if (info.sessionId === tracked.sessionId) {
        sessionMessages.push(info.messageId);
        // Clean up tracked messages
        this.visitorMessageMap.delete(telegramMsgId);
      }
    }

    if (sessionMessages.length > 1) {
      // Emit for all messages in the session
      await this.emit({
        type: "message_read_by_reaction",
        sessionId: tracked.sessionId,
        messageIds: sessionMessages,
        sourceBridge: this.name,
      });
    }
  }

  private async handleForumMessage(ctx: Context, message: TelegramMessage.TextMessage): Promise<void> {
    const topicId = message.message_thread_id;
    if (!topicId) return;

    const sessionId = this.topicSessionMap.get(topicId);
    if (!sessionId) return;

    // Get operator name
    const operatorName = message.from?.first_name || "Operator";

    // Emit operator message event
    await this.emit({
      type: "operator_message",
      sessionId,
      content: message.text,
      sourceBridge: this.name,
      operatorName,
    });

    // React to confirm
    try {
      await ctx.react("👍");
    } catch {
      // Reactions might not be available
    }
  }

  private async handleLegacyReply(ctx: Context, message: TelegramMessage.TextMessage): Promise<void> {
    const replyTo = message.reply_to_message;
    if (!replyTo) return;

    const sessionId = this.messageSessionMap.get(replyTo.message_id);
    if (!sessionId) return;

    const operatorName = message.from?.first_name || "Operator";

    await this.emit({
      type: "operator_message",
      sessionId,
      content: message.text,
      sourceBridge: this.name,
      operatorName,
    });

    try {
      await ctx.react("👍");
    } catch {
      // Reactions might not be available
    }
  }

  async onNewSession(session: Session): Promise<void> {
    if (this.useForumTopics) {
      await this.createForumTopic(session);
    } else {
      await this.sendLegacyNotification(session);
    }
  }

  private async createForumTopic(session: Session): Promise<void> {
    if (!this.forumChatId) return;

    // Build topic name
    let pageInfo = "";
    if (session.metadata?.url) {
      const parts = session.metadata.url.split("/");
      const lastPart = parts.at(-1) ?? "home";
      const withoutQuery = lastPart.split("?").at(0) ?? lastPart;
      pageInfo = withoutQuery.slice(0, 20);
    }

    const topicName = pageInfo
      ? `💬 ${session.id.slice(0, 8)} • ${pageInfo}`
      : `💬 ${session.id.slice(0, 8)}`;

    try {
      const result = await this.bot.telegram.createForumTopic(this.forumChatId, topicName);
      const topicId = result.message_thread_id;

      // Store mappings
      this.sessionTopicMap.set(session.id, topicId);
      this.topicSessionMap.set(topicId, session.id);

      // Build welcome message with all available metadata
      const meta = session.metadata;
      let welcomeText = `🆕 *New conversation*\n\nSession: \`${session.id.slice(0, 8)}...\``;

      // Page info
      if (meta?.url) {
        welcomeText += `\n📍 Page: ${meta.url}`;
      }
      if (meta?.pageTitle) {
        welcomeText += `\n📄 Title: ${meta.pageTitle}`;
      }
      if (meta?.referrer) {
        welcomeText += `\n↩️ From: ${meta.referrer}`;
      }

      // Device info
      const deviceParts: string[] = [];
      if (meta?.deviceType) {
        const deviceEmoji = meta.deviceType === "mobile" ? "📱" : meta.deviceType === "tablet" ? "📱" : "💻";
        deviceParts.push(`${deviceEmoji} ${meta.deviceType}`);
      }
      if (meta?.browser) deviceParts.push(meta.browser);
      if (meta?.os) deviceParts.push(meta.os);
      if (deviceParts.length > 0) {
        welcomeText += `\n🖥️ Device: ${deviceParts.join(" • ")}`;
      }

      // Location info
      const locationParts: string[] = [];
      if (meta?.city) locationParts.push(meta.city);
      if (meta?.country) locationParts.push(meta.country);
      if (locationParts.length > 0) {
        welcomeText += `\n🌍 Location: ${locationParts.join(", ")}`;
      }
      if (meta?.ip) {
        welcomeText += `\n🔗 IP: \`${meta.ip}\``;
      }

      // Other info
      if (meta?.language) {
        welcomeText += `\n🗣️ Language: ${meta.language}`;
      }
      if (meta?.timezone) {
        welcomeText += `\n🕐 Timezone: ${meta.timezone}`;
      }
      if (meta?.screenResolution) {
        welcomeText += `\n📐 Screen: ${meta.screenResolution}`;
      }

      welcomeText += "\n\n_Reply here to communicate with the visitor._";

      await this.bot.telegram.sendMessage(this.forumChatId, welcomeText, {
        message_thread_id: topicId,
        parse_mode: "Markdown",
      });
    } catch (error) {
      console.error("[Telegram] Failed to create forum topic:", error);
    }
  }

  private async sendLegacyNotification(session: Session): Promise<void> {
    if (!this.chatId) return;

    const meta = session.metadata;
    let text = `🆕 *New visitor*\n\nSession: \`${session.id.slice(0, 8)}...\``;

    // Page info
    if (meta?.url) {
      text += `\n📍 Page: ${meta.url}`;
    }
    if (meta?.pageTitle) {
      text += `\n📄 Title: ${meta.pageTitle}`;
    }
    if (meta?.referrer) {
      text += `\n↩️ From: ${meta.referrer}`;
    }

    // Device info
    const deviceParts: string[] = [];
    if (meta?.deviceType) {
      const deviceEmoji = meta.deviceType === "mobile" ? "📱" : meta.deviceType === "tablet" ? "📱" : "💻";
      deviceParts.push(`${deviceEmoji} ${meta.deviceType}`);
    }
    if (meta?.browser) deviceParts.push(meta.browser);
    if (meta?.os) deviceParts.push(meta.os);
    if (deviceParts.length > 0) {
      text += `\n🖥️ Device: ${deviceParts.join(" • ")}`;
    }

    // Location
    const locationParts: string[] = [];
    if (meta?.city) locationParts.push(meta.city);
    if (meta?.country) locationParts.push(meta.country);
    if (locationParts.length > 0) {
      text += `\n🌍 Location: ${locationParts.join(", ")}`;
    }
    if (meta?.ip) {
      text += `\n🔗 IP: \`${meta.ip}\``;
    }

    // Other
    if (meta?.language) {
      text += `\n🗣️ Language: ${meta.language}`;
    }
    if (meta?.timezone) {
      text += `\n🕐 Timezone: ${meta.timezone}`;
    }

    text += "\n\n_Reply to this message to communicate with the visitor._";

    try {
      const result = await this.bot.telegram.sendMessage(this.chatId, text, {
        parse_mode: "Markdown",
      });

      this.messageSessionMap.set(result.message_id, session.id);
      this.sessionMessageMap.set(session.id, result.message_id);
    } catch (error) {
      console.error("[Telegram] Failed to send notification:", error);
    }
  }

  async onVisitorMessage(message: Message, session: Session): Promise<void> {
    if (this.useForumTopics) {
      await this.sendForumMessage(message, session);
    } else {
      await this.sendLegacyMessage(message, session);
    }
  }

  private async sendForumMessage(message: Message, session: Session): Promise<void> {
    if (!this.forumChatId) return;

    let topicId = this.sessionTopicMap.get(session.id);

    // Create topic if it doesn't exist
    if (!topicId) {
      await this.createForumTopic(session);
      topicId = this.sessionTopicMap.get(session.id);
    }

    if (!topicId) return;

    try {
      const result = await this.bot.telegram.sendMessage(
        this.forumChatId,
        `👤 *Visitor:*\n\n${message.content}`,
        {
          message_thread_id: topicId,
          parse_mode: "Markdown",
        }
      );

      // Track visitor message for reaction-based read receipts
      this.visitorMessageMap.set(result.message_id, {
        sessionId: session.id,
        messageId: message.id,
      });

      // Notify backend that message was delivered to Telegram
      await this.emit({
        type: "message_delivered",
        sessionId: session.id,
        messageId: message.id,
        sourceBridge: this.name,
      });
    } catch (error) {
      console.error("[Telegram] Failed to send forum message:", error);
    }
  }

  private async sendLegacyMessage(message: Message, session: Session): Promise<void> {
    if (!this.chatId) return;

    const text = `💬 *Message*\n\n${message.content}\n\n_Session: \`${session.id.slice(0, 8)}...\`_`;

    try {
      const result = await this.bot.telegram.sendMessage(this.chatId, text, {
        parse_mode: "Markdown",
      });

      this.messageSessionMap.set(result.message_id, session.id);
      this.sessionMessageMap.set(session.id, result.message_id);

      // Track visitor message for reaction-based read receipts
      this.visitorMessageMap.set(result.message_id, {
        sessionId: session.id,
        messageId: message.id,
      });

      // Notify backend that message was delivered to Telegram
      await this.emit({
        type: "message_delivered",
        sessionId: session.id,
        messageId: message.id,
        sourceBridge: this.name,
      });
    } catch (error) {
      console.error("[Telegram] Failed to send message:", error);
    }
  }

  async onAITakeover(session: Session, reason: string): Promise<void> {
    const targetChatId = this.forumChatId || this.chatId;
    if (!targetChatId) return;

    const text = `🤖 *AI Activated*\n\nSession: \`${session.id.slice(0, 8)}...\`\nReason: ${reason}`;

    const options: Parameters<typeof this.bot.telegram.sendMessage>[2] = {
      parse_mode: "Markdown" as const,
    };

    if (this.useForumTopics) {
      const topicId = this.sessionTopicMap.get(session.id);
      if (topicId) {
        options.message_thread_id = topicId;
      }
    }

    try {
      await this.bot.telegram.sendMessage(targetChatId, text, options);
    } catch (error) {
      console.error("[Telegram] Failed to send AI takeover message:", error);
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

    const targetChatId = this.forumChatId || this.chatId;
    if (!targetChatId) return;

    const bridgeEmoji: Record<string, string> = {
      discord: "🎮",
      slack: "💬",
      api: "🔌",
    };
    const emoji = bridgeEmoji[sourceBridge] || "📨";
    const name = operatorName || "Operator";

    const text = `${emoji} *${name}* _via ${sourceBridge}_\n\n${message.content}`;

    const options: Parameters<typeof this.bot.telegram.sendMessage>[2] = {
      parse_mode: "Markdown" as const,
    };

    if (this.useForumTopics) {
      const topicId = this.sessionTopicMap.get(session.id);
      if (topicId) {
        options.message_thread_id = topicId;
      }
    }

    try {
      await this.bot.telegram.sendMessage(targetChatId, text, options);
    } catch (error) {
      console.error("[Telegram] Failed to send synced message:", error);
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
    // Map status to emoji reaction (using Telegram-supported emoji)
    const emojiMap: Record<string, string> = {
      delivered: "👌", // OK hand
      read: "👀", // Eyes
    };

    const emoji = emojiMap[status];
    if (!emoji) return;

    for (const msgId of messageIds) {
      const tracked = this.operatorMessageMap.get(msgId);
      if (!tracked) continue;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.bot.telegram.setMessageReaction(tracked.chatId, tracked.messageId, [
          { type: "emoji", emoji: emoji as any },
        ]);

        // Clean up after "read" status
        if (status === "read") {
          this.operatorMessageMap.delete(msgId);
        }
      } catch (error) {
        console.error("[Telegram] Failed to set message reaction:", error);
      }
    }
  }

  async onCustomEvent(event: CustomEvent, session: Session): Promise<void> {
    const targetChatId = this.forumChatId || this.chatId;
    if (!targetChatId) return;

    // Format event data for display
    const dataStr = event.data ? `\n\`\`\`json\n${JSON.stringify(event.data, null, 2)}\n\`\`\`` : '';

    const text = `⚡ *Custom Event*\n\n📌 Event: \`${event.name}\`${dataStr}\n\n_Session: \`${session.id.slice(0, 8)}...\`_`;

    const options: Parameters<typeof this.bot.telegram.sendMessage>[2] = {
      parse_mode: "Markdown" as const,
    };

    if (this.useForumTopics) {
      const topicId = this.sessionTopicMap.get(session.id);
      if (topicId) {
        options.message_thread_id = topicId;
      }
    }

    try {
      await this.bot.telegram.sendMessage(targetChatId, text, options);
    } catch (error) {
      console.error("[Telegram] Failed to send custom event:", error);
    }
  }

  async destroy(): Promise<void> {
    this.bot.stop();
    console.log("[Telegram] Bridge stopped");
  }
}

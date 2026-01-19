/**
 * Telegram bridge with Forum Topics support
 */

import { Telegraf, Context } from "telegraf";
import type { Message as TelegramMessage } from "telegraf/types";
import { Bridge } from "./base";
import type { Message, Session, TelegramConfig } from "../types";

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
    this.bot.command("help", this.handleHelpCommand.bind(this));

    // Handle incoming messages
    this.bot.on("message", this.handleMessage.bind(this));

    // Start the bot
    await this.bot.launch();
    console.log("[Telegram] Bridge started");

    // Send startup message
    await this.sendStartupMessage();
  }

  private async sendStartupMessage(): Promise<void> {
    const targetChatId = this.forumChatId || this.chatId;
    if (!targetChatId) return;

    const modeInfo = this.useForumTopics
      ? "Mode: Forum Topics\nChaque conversation a son propre topic!"
      : "Mode: Legacy (reply-based)";

    try {
      await this.bot.telegram.sendMessage(
        targetChatId,
        `🔔 *PocketPing Bridge Connected*\n\n${modeInfo}\n\n*Commands:*\n/online - Marquer comme disponible\n/offline - Marquer comme absent\n/status - Voir le statut actuel\n/close - Fermer la conversation (Forum Topics)\n/help - Aide`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      console.error("[Telegram] Failed to send startup message:", error);
    }
  }

  private async handleOnlineCommand(ctx: Context): Promise<void> {
    this.operatorOnline = true;
    await ctx.reply("✅ Vous êtes maintenant en ligne. Les utilisateurs verront que vous êtes disponible.");
  }

  private async handleOfflineCommand(ctx: Context): Promise<void> {
    this.operatorOnline = false;
    await ctx.reply("🌙 Vous êtes maintenant hors ligne. L'IA gérera les conversations si configurée.");
  }

  private async handleStatusCommand(ctx: Context): Promise<void> {
    const status = this.operatorOnline ? "🟢 En ligne" : "🔴 Hors ligne";
    const activeSessions = this.useForumTopics
      ? this.sessionTopicMap.size
      : this.sessionMessageMap.size;
    await ctx.reply(`📊 *Statut:* ${status}\n💬 Sessions actives: ${activeSessions}`, {
      parse_mode: "Markdown",
    });
  }

  private async handleCloseCommand(ctx: Context): Promise<void> {
    if (!this.useForumTopics) {
      await ctx.reply("❌ Cette commande ne fonctionne qu'en mode Forum Topics.");
      return;
    }

    const topicId = ctx.message?.message_thread_id;
    if (!topicId) {
      await ctx.reply("❌ Utilisez cette commande dans un topic de conversation.");
      return;
    }

    const sessionId = this.topicSessionMap.get(topicId);
    if (!sessionId) {
      await ctx.reply("❌ Aucune conversation active dans ce topic.");
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
      await ctx.reply("✅ Conversation fermée.");
    } catch (error) {
      console.error("[Telegram] Failed to close topic:", error);
    }

    // Clean up mappings
    this.sessionTopicMap.delete(sessionId);
    this.topicSessionMap.delete(topicId);
  }

  private async handleHelpCommand(ctx: Context): Promise<void> {
    const modeHelp = this.useForumTopics
      ? "Répondez directement dans le topic pour communiquer avec l'utilisateur."
      : "Répondez à un message pour communiquer avec l'utilisateur correspondant.";

    await ctx.reply(
      `📖 *PocketPing Bridge*\n\n${modeHelp}\n\n*Commands:*\n/online - Marquer comme disponible\n/offline - Marquer comme absent\n/status - Voir le statut actuel\n/close - Fermer la conversation\n/help - Cette aide`,
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

      // Build welcome message
      let welcomeText = `🆕 *Nouvelle conversation*\n\nSession: \`${session.id.slice(0, 8)}...\``;

      if (session.metadata?.url) {
        welcomeText += `\n📍 Page: ${session.metadata.url}`;
      }
      if (session.metadata?.referrer) {
        welcomeText += `\n↩️ Depuis: ${session.metadata.referrer}`;
      }
      if (session.metadata?.timezone) {
        welcomeText += `\n🕐 Fuseau: ${session.metadata.timezone}`;
      }

      welcomeText += "\n\n_Répondez ici pour communiquer avec le visiteur._";

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

    let text = `🆕 *Nouveau visiteur*\n\nSession: \`${session.id.slice(0, 8)}...\``;

    if (session.metadata?.url) {
      text += `\nPage: ${session.metadata.url}`;
    }
    if (session.metadata?.referrer) {
      text += `\nDepuis: ${session.metadata.referrer}`;
    }

    text += "\n\n_Répondez à ce message pour communiquer avec le visiteur._";

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
      await this.bot.telegram.sendMessage(
        this.forumChatId,
        `👤 *Visiteur:*\n\n${message.content}`,
        {
          message_thread_id: topicId,
          parse_mode: "Markdown",
        }
      );
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
    } catch (error) {
      console.error("[Telegram] Failed to send message:", error);
    }
  }

  async onAITakeover(session: Session, reason: string): Promise<void> {
    const targetChatId = this.forumChatId || this.chatId;
    if (!targetChatId) return;

    const text = `🤖 *IA Activée*\n\nSession: \`${session.id.slice(0, 8)}...\`\nRaison: ${reason}`;

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

  async destroy(): Promise<void> {
    this.bot.stop();
    console.log("[Telegram] Bridge stopped");
  }
}

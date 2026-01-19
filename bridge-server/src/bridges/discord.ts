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
import type { Message, Session, DiscordConfig } from "../types";

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
      ],
    });

    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    // Set up event handlers
    this.client.once("ready", () => this.onReady());
    this.client.on("messageCreate", (msg) => this.onMessage(msg));

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
      ? "**Mode:** Threads 🧵\nChaque conversation a son propre thread!"
      : "**Mode:** Legacy (reply-based)";

    const embed = new EmbedBuilder()
      .setTitle("🔔 PocketPing Bridge Connected")
      .setDescription(
        `${modeInfo}\n\n` +
          "**Commands:**\n" +
          "`!online` - Marquer comme disponible\n" +
          "`!offline` - Marquer comme absent\n" +
          "`!status` - Voir le statut actuel\n" +
          "`!close` - Fermer la conversation (Threads)"
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

  private async handleCommand(message: DiscordMessage): Promise<void> {
    const command = message.content.slice(1).toLowerCase().split(" ")[0];

    switch (command) {
      case "online":
        this.operatorOnline = true;
        await message.reply("✅ Vous êtes maintenant en ligne.");
        break;

      case "offline":
        this.operatorOnline = false;
        await message.reply("🌙 Vous êtes maintenant hors ligne.");
        break;

      case "status": {
        const status = this.operatorOnline ? "🟢 En ligne" : "🔴 Hors ligne";
        const activeSessions = this.sessionThreadMap.size;
        await message.reply(`📊 **Statut:** ${status}\n💬 Sessions actives: ${activeSessions}`);
        break;
      }

      case "close":
        await this.handleCloseCommand(message);
        break;

      case "help":
        await message.reply(
          "📖 **PocketPing Bridge**\n\n" +
            "Répondez dans le thread pour communiquer avec le visiteur.\n\n" +
            "**Commands:**\n" +
            "`!online` - Marquer comme disponible\n" +
            "`!offline` - Marquer comme absent\n" +
            "`!status` - Voir le statut actuel\n" +
            "`!close` - Fermer la conversation"
        );
        break;
    }
  }

  private async handleCloseCommand(message: DiscordMessage): Promise<void> {
    if (!this.useThreads) {
      await message.reply("❌ Cette commande ne fonctionne qu'en mode Threads.");
      return;
    }

    if (!message.channel.isThread()) {
      await message.reply("❌ Utilisez cette commande dans un thread de conversation.");
      return;
    }

    const threadId = message.channel.id;
    const sessionId = this.threadSessionMap.get(threadId);

    if (!sessionId) {
      await message.reply("❌ Aucune conversation active dans ce thread.");
      return;
    }

    // Emit close event
    await this.emit({
      type: "session_closed",
      sessionId,
      sourceBridge: this.name,
    });

    await message.reply("✅ Conversation fermée.");

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

    // Build thread name
    let pageInfo = "";
    if (session.metadata?.url) {
      const parts = session.metadata.url.split("/");
      const lastPart = parts.at(-1) ?? "home";
      const withoutQuery = lastPart.split("?").at(0) ?? lastPart;
      pageInfo = withoutQuery.slice(0, 20);
    }

    const threadName = pageInfo
      ? `🟢 ${session.id.slice(0, 8)} • ${pageInfo}`
      : `🟢 ${session.id.slice(0, 8)}`;

    // Build welcome embed
    let description = `Session: \`${session.id}\``;

    if (session.metadata?.url) {
      description += `\n📍 **Page:** ${session.metadata.url}`;
    }
    if (session.metadata?.referrer) {
      description += `\n↩️ **Depuis:** ${session.metadata.referrer}`;
    }
    if (session.metadata?.timezone) {
      description += `\n🕐 **Fuseau:** ${session.metadata.timezone}`;
    }
    if (session.metadata?.userAgent) {
      const isMobile = session.metadata.userAgent.includes("Mobile");
      description += `\n**Device:** ${isMobile ? "📱 Mobile" : "💻 Desktop"}`;
    }

    description += "\n\n💡 **Écrivez ici pour répondre!**";

    const embed = new EmbedBuilder()
      .setTitle("🆕 Nouvelle Conversation")
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
        "👋 Visiteur connecté! Les messages apparaîtront ici.\n" +
          "Écrivez directement pour répondre."
      );
    } catch (error) {
      console.error("[Discord] Failed to create thread:", error);
    }
  }

  private async sendLegacyNotification(session: Session): Promise<void> {
    if (!this.channel) return;

    let description = `Session: \`${session.id.slice(0, 8)}...\``;

    if (session.metadata?.url) {
      description += `\nPage: ${session.metadata.url}`;
    }
    if (session.metadata?.referrer) {
      description += `\nDepuis: ${session.metadata.referrer}`;
    }

    const embed = new EmbedBuilder()
      .setTitle("🆕 Nouveau Visiteur")
      .setDescription(description)
      .setFooter({ text: "Répondez à ce message pour communiquer" })
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
        .setAuthor({ name: "👤 Visiteur" })
        .setDescription(message.content)
        .setColor(0x9b59b6);

      await thread.send({ embeds: [embed] });
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
    } catch (error) {
      console.error("[Discord] Failed to send message:", error);
    }
  }

  async onAITakeover(session: Session, reason: string): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle("🤖 IA Activée")
      .setDescription(`Session: \`${session.id.slice(0, 8)}...\`\nRaison: ${reason}`)
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

  async destroy(): Promise<void> {
    this.client.destroy();
    console.log("[Discord] Bridge stopped");
  }
}

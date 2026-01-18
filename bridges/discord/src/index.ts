import {
  Client,
  GatewayIntentBits,
  TextChannel,
  EmbedBuilder,
  Message as DiscordMessage,
} from 'discord.js';
import type { Bridge } from '@pocketping/sdk';
import type { PocketPing, Session, Message } from '@pocketping/sdk';

export interface DiscordBridgeConfig {
  /** Discord bot token */
  botToken: string;

  /** Channel ID to send notifications to */
  channelId: string;

  /** Show page URL in notifications */
  showUrl?: boolean;
}

export class DiscordBridge implements Bridge {
  name = 'discord';

  private client: Client;
  private channelId: string;
  private config: DiscordBridgeConfig;
  private pocketping: PocketPing | null = null;
  private channel: TextChannel | null = null;
  private sessionMessageMap: Map<string, string> = new Map(); // sessionId -> messageId
  private messageSessionMap: Map<string, string> = new Map(); // messageId -> sessionId

  constructor(config: DiscordBridgeConfig) {
    this.config = config;
    this.channelId = config.channelId;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.client.once('ready', async () => {
      console.log(`[DiscordBridge] Logged in as ${this.client.user?.tag}`);

      this.channel = this.client.channels.cache.get(this.channelId) as TextChannel;

      if (this.channel) {
        const embed = new EmbedBuilder()
          .setTitle('🔔 PocketPing Connected')
          .setDescription(
            '**Commands:**\n' +
            '`!online` - Mark yourself as available\n' +
            '`!offline` - Mark yourself as away\n' +
            '`!status` - View current status\n\n' +
            '_Reply to any message to respond to users._'
          )
          .setColor(0x22c55e);

        await this.channel.send({ embeds: [embed] });
      }
    });

    this.client.on('messageCreate', async (message: DiscordMessage) => {
      if (message.author.bot) return;
      if (message.channel.id !== this.channelId) return;

      // Handle commands
      if (message.content === '!online') {
        this.pocketping?.setOperatorOnline(true);
        await message.reply("✅ You're now online. Users will see you as available.");
        return;
      }

      if (message.content === '!offline') {
        this.pocketping?.setOperatorOnline(false);
        await message.reply("🌙 You're now offline. AI will handle conversations if configured.");
        return;
      }

      if (message.content === '!status') {
        const online = this.pocketping ? true : false; // Simplified
        await message.reply(`📊 **Status**: ${online ? '🟢 Online' : '🔴 Offline'}`);
        return;
      }

      // Handle replies
      if (message.reference?.messageId && this.pocketping) {
        const sessionId = this.messageSessionMap.get(message.reference.messageId);

        if (sessionId) {
          try {
            await this.pocketping.sendOperatorMessage(sessionId, message.content);
            this.pocketping.setOperatorOnline(true);
            await message.react('✅');
          } catch (err) {
            await message.reply(`❌ Failed to send: ${err}`);
          }
        }
      }
    });
  }

  async init(pocketping: PocketPing): Promise<void> {
    this.pocketping = pocketping;
    await this.client.login(this.config.botToken);
  }

  async onNewSession(session: Session): Promise<void> {
    if (!this.channel) return;

    let description = `Session: \`${session.id.slice(0, 8)}...\``;

    if (this.config.showUrl !== false && session.metadata?.url) {
      description += `\nPage: ${session.metadata.url}`;
    }

    if (session.metadata?.referrer) {
      description += `\nFrom: ${session.metadata.referrer}`;
    }

    const embed = new EmbedBuilder()
      .setTitle('🆕 New Visitor')
      .setDescription(description)
      .setColor(0x3b82f6)
      .setFooter({ text: 'Reply to any message from this user to respond' });

    const msg = await this.channel.send({ embeds: [embed] });
    this.sessionMessageMap.set(session.id, msg.id);
    this.messageSessionMap.set(msg.id, session.id);
  }

  async onMessage(message: Message, session: Session): Promise<void> {
    if (message.sender !== 'visitor' || !this.channel) return;

    let description = message.content;
    description += `\n\n*Session: \`${session.id.slice(0, 8)}...\`*`;

    if (this.config.showUrl !== false && session.metadata?.url) {
      description += `\n*Page: ${session.metadata.url}*`;
    }

    const embed = new EmbedBuilder()
      .setTitle('💬 Message')
      .setDescription(description)
      .setColor(0xa855f7);

    const msg = await this.channel.send({ embeds: [embed] });
    this.sessionMessageMap.set(session.id, msg.id);
    this.messageSessionMap.set(msg.id, session.id);
  }

  async destroy(): Promise<void> {
    await this.client.destroy();
  }
}

export default DiscordBridge;

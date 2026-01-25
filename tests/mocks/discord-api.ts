/**
 * Mock Discord API Server
 *
 * Simulates the Discord REST and Gateway API for testing without hitting real servers.
 * Supports: messages, channels, threads, reactions, webhooks, and Gateway events
 */

import { Hono } from 'hono';
import { serve } from 'bun';

interface MockDiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  author: {
    id: string;
    username: string;
    discriminator: string;
    bot?: boolean;
  };
  timestamp: string;
  embeds?: any[];
  message_reference?: {
    message_id: string;
    channel_id: string;
    guild_id: string;
  };
}

interface MockDiscordThread {
  id: string;
  guild_id: string;
  parent_id: string;
  name: string;
  type: number; // 11 = public thread, 12 = private thread
}

interface MockGatewayEvent {
  t: string; // Event type
  s: number; // Sequence
  op: number; // Opcode
  d: any; // Data
}

export class MockDiscordServer {
  private app: Hono;
  private server: ReturnType<typeof serve> | null = null;
  private messageIdCounter = 1000000000000000000n;
  private channelIdCounter = 1100000000000000000n;
  private sequenceCounter = 1;

  // Storage for inspection
  public sentMessages: MockDiscordMessage[] = [];
  public createdThreads: MockDiscordThread[] = [];
  public addedReactions: { channel_id: string; message_id: string; emoji: string }[] = [];
  public webhookMessages: { webhook_id: string; content: string; embeds?: any[] }[] = [];
  public gatewayEvents: MockGatewayEvent[] = [];

  // WebSocket connections for Gateway simulation
  private gatewayCallback?: (event: MockGatewayEvent) => void;

  // Guild and channel config
  private guildId = '900000000000000001';
  private forumChannelId = '900000000000000002';

  constructor() {
    this.app = new Hono();
    this.setupRoutes();
  }

  private generateSnowflake(): string {
    const id = this.messageIdCounter++;
    return id.toString();
  }

  private generateChannelId(): string {
    const id = this.channelIdCounter++;
    return id.toString();
  }

  private setupRoutes() {
    // ============ CHANNEL ENDPOINTS ============

    // Get channel info
    this.app.get('/api/v10/channels/:channelId', (c) => {
      const channelId = c.req.param('channelId');

      // Check if it's a thread we created
      const thread = this.createdThreads.find(t => t.id === channelId);
      if (thread) {
        return c.json({
          id: thread.id,
          type: thread.type,
          guild_id: thread.guild_id,
          name: thread.name,
          parent_id: thread.parent_id,
        });
      }

      // Default channel response
      return c.json({
        id: channelId,
        type: 15, // Guild Forum
        guild_id: this.guildId,
        name: 'support-forum',
      });
    });

    // Create message in channel
    this.app.post('/api/v10/channels/:channelId/messages', async (c) => {
      const channelId = c.req.param('channelId');
      const body = await c.req.json();

      const msg: MockDiscordMessage = {
        id: this.generateSnowflake(),
        channel_id: channelId,
        content: body.content || '',
        author: {
          id: '888000000000000001',
          username: 'PocketPing',
          discriminator: '0000',
          bot: true,
        },
        timestamp: new Date().toISOString(),
        embeds: body.embeds,
        message_reference: body.message_reference,
      };

      this.sentMessages.push(msg);
      return c.json(msg);
    });

    // Create thread from message (for forum channels)
    this.app.post('/api/v10/channels/:channelId/messages/:messageId/threads', async (c) => {
      const parentId = c.req.param('channelId');
      const body = await c.req.json();

      const thread: MockDiscordThread = {
        id: this.generateChannelId(),
        guild_id: this.guildId,
        parent_id: parentId,
        name: body.name,
        type: 11, // Public thread
      };

      this.createdThreads.push(thread);

      return c.json({
        id: thread.id,
        type: thread.type,
        guild_id: thread.guild_id,
        name: thread.name,
        parent_id: thread.parent_id,
        owner_id: '888000000000000001',
        message_count: 0,
        member_count: 1,
      });
    });

    // Create thread in forum channel (POST forum)
    this.app.post('/api/v10/channels/:channelId/threads', async (c) => {
      const parentId = c.req.param('channelId');
      const body = await c.req.json();

      const thread: MockDiscordThread = {
        id: this.generateChannelId(),
        guild_id: this.guildId,
        parent_id: parentId,
        name: body.name,
        type: 11, // Public thread
      };

      this.createdThreads.push(thread);

      // Create initial message if provided
      if (body.message?.content || body.message?.embeds) {
        const msg: MockDiscordMessage = {
          id: this.generateSnowflake(),
          channel_id: thread.id,
          content: body.message.content || '',
          author: {
            id: '888000000000000001',
            username: 'PocketPing',
            discriminator: '0000',
            bot: true,
          },
          timestamp: new Date().toISOString(),
          embeds: body.message.embeds,
        };
        this.sentMessages.push(msg);
      }

      return c.json({
        id: thread.id,
        type: thread.type,
        guild_id: thread.guild_id,
        name: thread.name,
        parent_id: thread.parent_id,
        owner_id: '888000000000000001',
        message_count: body.message ? 1 : 0,
        member_count: 1,
        message: body.message ? this.sentMessages[this.sentMessages.length - 1] : undefined,
      });
    });

    // ============ REACTION ENDPOINTS ============

    // Add reaction
    this.app.put('/api/v10/channels/:channelId/messages/:messageId/reactions/:emoji/@me', (c) => {
      const channelId = c.req.param('channelId');
      const messageId = c.req.param('messageId');
      const emoji = decodeURIComponent(c.req.param('emoji'));

      this.addedReactions.push({ channel_id: channelId, message_id: messageId, emoji });
      return c.body(null, 204);
    });

    // ============ WEBHOOK ENDPOINTS ============

    // Execute webhook
    this.app.post('/api/webhooks/:webhookId/:webhookToken', async (c) => {
      const webhookId = c.req.param('webhookId');
      const body = await c.req.json();

      this.webhookMessages.push({
        webhook_id: webhookId,
        content: body.content || '',
        embeds: body.embeds,
      });

      const msg: MockDiscordMessage = {
        id: this.generateSnowflake(),
        channel_id: '900000000000000003',
        content: body.content || '',
        author: {
          id: webhookId,
          username: body.username || 'Webhook',
          discriminator: '0000',
        },
        timestamp: new Date().toISOString(),
        embeds: body.embeds,
      };

      this.sentMessages.push(msg);
      return c.json(msg);
    });

    // ============ GATEWAY ENDPOINTS ============

    // Gateway URL
    this.app.get('/api/v10/gateway', (c) => {
      return c.json({ url: 'wss://gateway.discord.gg' });
    });

    // Gateway bot URL
    this.app.get('/api/v10/gateway/bot', (c) => {
      return c.json({
        url: 'wss://gateway.discord.gg',
        shards: 1,
        session_start_limit: {
          total: 1000,
          remaining: 999,
          reset_after: 14400000,
          max_concurrency: 1,
        },
      });
    });

    // ============ USER ENDPOINTS ============

    // Get current user
    this.app.get('/api/v10/users/@me', (c) => {
      return c.json({
        id: '888000000000000001',
        username: 'PocketPing',
        discriminator: '0000',
        bot: true,
        verified: true,
      });
    });

    // ============ GUILD ENDPOINTS ============

    // Get guild info
    this.app.get('/api/v10/guilds/:guildId', (c) => {
      const guildId = c.req.param('guildId');
      return c.json({
        id: guildId,
        name: 'Test Server',
        owner_id: '777000000000000001',
      });
    });

    // Get guild member
    this.app.get('/api/v10/guilds/:guildId/members/:userId', (c) => {
      const userId = c.req.param('userId');
      return c.json({
        user: {
          id: userId,
          username: 'TestUser',
          discriminator: '1234',
        },
        nick: 'Test',
        roles: [],
        joined_at: new Date().toISOString(),
      });
    });

    // ============ HEALTH CHECK ============

    this.app.get('/health', (c) => c.json({ ok: true }));
  }

  // Start the mock server
  async start(port = 9003): Promise<string> {
    let currentPort = port;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        this.server = serve({
          fetch: this.app.fetch,
          port: currentPort,
        });
        const boundPort = (this.server as any).port ?? currentPort;
        return `http://localhost:${boundPort}`;
      } catch (error) {
        if ((error as { code?: string }).code === 'EADDRINUSE') {
          currentPort += 1;
          continue;
        }
        throw error;
      }
    }
    throw new Error('Failed to find an available port for MockDiscordServer');
  }

  // Stop the server
  stop() {
    this.server?.stop();
  }

  // Reset all state
  reset() {
    this.sentMessages = [];
    this.createdThreads = [];
    this.addedReactions = [];
    this.webhookMessages = [];
    this.gatewayEvents = [];
    this.messageIdCounter = 1000000000000000000n;
    this.channelIdCounter = 1100000000000000000n;
    this.sequenceCounter = 1;
  }

  // ============ SIMULATION METHODS ============

  // Simulate incoming message from operator
  simulateOperatorMessage(
    channelId: string,
    content: string,
    authorName = 'Operator',
    authorId = '999000000000000001'
  ): MockGatewayEvent {
    const event: MockGatewayEvent = {
      t: 'MESSAGE_CREATE',
      s: this.sequenceCounter++,
      op: 0,
      d: {
        id: this.generateSnowflake(),
        channel_id: channelId,
        guild_id: this.guildId,
        content,
        author: {
          id: authorId,
          username: authorName,
          discriminator: '1234',
          bot: false,
        },
        timestamp: new Date().toISOString(),
        type: 0,
      },
    };

    this.gatewayEvents.push(event);
    this.gatewayCallback?.(event);
    return event;
  }

  // Simulate reaction add
  simulateReactionAdd(
    channelId: string,
    messageId: string,
    emoji: string,
    userId = '999000000000000001'
  ): MockGatewayEvent {
    const event: MockGatewayEvent = {
      t: 'MESSAGE_REACTION_ADD',
      s: this.sequenceCounter++,
      op: 0,
      d: {
        user_id: userId,
        channel_id: channelId,
        message_id: messageId,
        guild_id: this.guildId,
        emoji: { name: emoji, id: null },
      },
    };

    this.gatewayEvents.push(event);
    this.gatewayCallback?.(event);
    return event;
  }

  // Simulate thread create
  simulateThreadCreate(name: string, parentId?: string): MockGatewayEvent {
    const thread: MockDiscordThread = {
      id: this.generateChannelId(),
      guild_id: this.guildId,
      parent_id: parentId || this.forumChannelId,
      name,
      type: 11,
    };

    this.createdThreads.push(thread);

    const event: MockGatewayEvent = {
      t: 'THREAD_CREATE',
      s: this.sequenceCounter++,
      op: 0,
      d: thread,
    };

    this.gatewayEvents.push(event);
    this.gatewayCallback?.(event);
    return event;
  }

  // Set callback for Gateway events
  onGatewayEvent(callback: (event: MockGatewayEvent) => void) {
    this.gatewayCallback = callback;
  }

  // ============ HELPER METHODS ============

  // Get last sent message
  getLastMessage(): MockDiscordMessage | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  // Get messages in a thread/channel
  getChannelMessages(channelId: string): MockDiscordMessage[] {
    return this.sentMessages.filter((m) => m.channel_id === channelId);
  }

  // Get threads created
  getThreads(): MockDiscordThread[] {
    return this.createdThreads;
  }

  // Check if reaction was added
  hasReaction(messageId: string, emoji: string): boolean {
    return this.addedReactions.some(
      (r) => r.message_id === messageId && r.emoji === emoji
    );
  }

  // Get guild ID
  getGuildId(): string {
    return this.guildId;
  }

  // Get forum channel ID
  getForumChannelId(): string {
    return this.forumChannelId;
  }
}

// Export a singleton for easy use
export const mockDiscordServer = new MockDiscordServer();

/**
 * Mock Slack API Server
 *
 * Simulates the Slack Web API for testing without hitting real servers.
 * Supports: chat.postMessage, users.info, reactions.add/remove
 */

import { Hono } from 'hono';
import { serve } from 'bun';

interface MockSlackMessage {
  ts: string;
  channel: string;
  text?: string;
  blocks?: any[];
  thread_ts?: string;
  user?: string;
}

interface MockSlackEvent {
  type: string;
  event: any;
  event_id: string;
  event_time: number;
}

export class MockSlackServer {
  private app: Hono;
  private server: ReturnType<typeof serve> | null = null;
  private tsCounter = 1000000000;

  // Storage for inspection
  public postedMessages: MockSlackMessage[] = [];
  public addedReactions: { channel: string; timestamp: string; name: string }[] = [];
  public removedReactions: { channel: string; timestamp: string; name: string }[] = [];

  // Socket Mode event queue (for testing)
  public socketModeEvents: MockSlackEvent[] = [];
  private socketModeCallback?: (event: any) => void;

  constructor() {
    this.app = new Hono();
    this.setupRoutes();
  }

  private generateTs(): string {
    return `${this.tsCounter++}.000000`;
  }

  private setupRoutes() {
    // Auth test
    this.app.post('/api/auth.test', (c) => {
      return c.json({
        ok: true,
        url: 'https://test-workspace.slack.com/',
        team: 'Test Workspace',
        user: 'pocketping',
        team_id: 'T12345678',
        user_id: 'U12345678',
        bot_id: 'B12345678',
      });
    });

    // Post message
    this.app.post('/api/chat.postMessage', async (c) => {
      const body = await c.req.json();
      const ts = this.generateTs();

      const msg: MockSlackMessage = {
        ts,
        channel: body.channel,
        text: body.text,
        blocks: body.blocks,
        thread_ts: body.thread_ts,
      };

      this.postedMessages.push(msg);

      return c.json({
        ok: true,
        channel: body.channel,
        ts,
        message: {
          type: 'message',
          subtype: 'bot_message',
          text: body.text,
          ts,
          username: 'PocketPing',
          bot_id: 'B12345678',
        },
      });
    });

    // Get user info
    this.app.post('/api/users.info', async (c) => {
      const body = await c.req.json();
      return c.json({
        ok: true,
        user: {
          id: body.user,
          name: 'testuser',
          real_name: 'Test User',
          profile: {
            display_name: 'Test User',
            email: 'test@example.com',
          },
        },
      });
    });

    // Add reaction
    this.app.post('/api/reactions.add', async (c) => {
      const body = await c.req.json();
      this.addedReactions.push({
        channel: body.channel,
        timestamp: body.timestamp,
        name: body.name,
      });
      return c.json({ ok: true });
    });

    // Remove reaction
    this.app.post('/api/reactions.remove', async (c) => {
      const body = await c.req.json();
      this.removedReactions.push({
        channel: body.channel,
        timestamp: body.timestamp,
        name: body.name,
      });
      return c.json({ ok: true });
    });

    // Conversations info
    this.app.post('/api/conversations.info', async (c) => {
      const body = await c.req.json();
      return c.json({
        ok: true,
        channel: {
          id: body.channel,
          name: 'test-channel',
          is_private: true,
        },
      });
    });

    // Health check
    this.app.get('/health', (c) => c.json({ ok: true }));
  }

  // Start the mock server
  async start(port = 9002): Promise<string> {
    this.server = serve({
      fetch: this.app.fetch,
      port,
    });
    return `http://localhost:${port}`;
  }

  // Stop the server
  stop() {
    this.server?.stop();
  }

  // Reset all state
  reset() {
    this.postedMessages = [];
    this.addedReactions = [];
    this.removedReactions = [];
    this.socketModeEvents = [];
    this.tsCounter = 1000000000;
  }

  // Simulate a message event from operator in a thread
  simulateOperatorMessage(channel: string, threadTs: string, text: string, userId = 'U999') {
    const event: MockSlackEvent = {
      type: 'event_callback',
      event: {
        type: 'message',
        channel,
        user: userId,
        text,
        ts: this.generateTs(),
        thread_ts: threadTs,
      },
      event_id: `Ev${Date.now()}`,
      event_time: Math.floor(Date.now() / 1000),
    };

    this.socketModeEvents.push(event);
    this.socketModeCallback?.({ body: event, ack: async () => {} });
    return event;
  }

  // Simulate an app mention event
  simulateAppMention(channel: string, text: string, threadTs?: string, userId = 'U999') {
    const event: MockSlackEvent = {
      type: 'event_callback',
      event: {
        type: 'app_mention',
        channel,
        user: userId,
        text,
        ts: this.generateTs(),
        thread_ts: threadTs,
      },
      event_id: `Ev${Date.now()}`,
      event_time: Math.floor(Date.now() / 1000),
    };

    this.socketModeEvents.push(event);
    this.socketModeCallback?.({ body: event, ack: async () => {} });
    return event;
  }

  // Simulate a reaction added event
  simulateReactionAdded(channel: string, messageTs: string, reaction: string, userId = 'U999') {
    const event: MockSlackEvent = {
      type: 'event_callback',
      event: {
        type: 'reaction_added',
        user: userId,
        reaction,
        item: {
          type: 'message',
          channel,
          ts: messageTs,
        },
        event_ts: this.generateTs(),
      },
      event_id: `Ev${Date.now()}`,
      event_time: Math.floor(Date.now() / 1000),
    };

    this.socketModeEvents.push(event);
    this.socketModeCallback?.({ body: event, ack: async () => {} });
    return event;
  }

  // Set callback for Socket Mode events
  onSocketModeEvent(callback: (event: any) => void) {
    this.socketModeCallback = callback;
  }

  // Helper to get last posted message
  getLastMessage(): MockSlackMessage | undefined {
    return this.postedMessages[this.postedMessages.length - 1];
  }

  // Helper to get messages in a thread
  getThreadMessages(threadTs: string): MockSlackMessage[] {
    return this.postedMessages.filter(
      (m) => m.thread_ts === threadTs || m.ts === threadTs
    );
  }

  // Helper to check if reaction was added
  hasReaction(timestamp: string, name: string): boolean {
    return this.addedReactions.some(
      (r) => r.timestamp === timestamp && r.name === name
    );
  }
}

// Export a singleton for easy use
export const mockSlackServer = new MockSlackServer();

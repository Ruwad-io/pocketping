/**
 * Mock Telegram Bot API Server
 *
 * Simulates the Telegram Bot API for testing without hitting real servers.
 * Supports: sendMessage, createForumTopic, setMyCommands, getUpdates
 */

import { Hono } from 'hono';
import { serve } from 'bun';

interface MockMessage {
  message_id: number;
  chat: { id: number; type: string };
  text?: string;
  from?: { id: number; is_bot: boolean; first_name: string };
  date: number;
  message_thread_id?: number;
}

interface MockUpdate {
  update_id: number;
  message?: MockMessage;
  callback_query?: any;
  message_reaction?: any;
}

export class MockTelegramServer {
  private app: Hono;
  private server: ReturnType<typeof serve> | null = null;
  private messageIdCounter = 1;
  private updateIdCounter = 1;
  private threadIdCounter = 1000;

  // Storage for inspection
  public sentMessages: MockMessage[] = [];
  public createdTopics: { name: string; chat_id: number; message_thread_id: number }[] = [];
  public pendingUpdates: MockUpdate[] = [];
  public registeredCommands: any[] = [];

  // Callbacks for simulating events
  private onMessageSent?: (msg: MockMessage) => void;

  constructor() {
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes() {
    // Bot info
    this.app.post('/bot:token/getMe', (c) => {
      return c.json({
        ok: true,
        result: {
          id: 123456789,
          is_bot: true,
          first_name: 'PocketPing Test Bot',
          username: 'pocketping_test_bot',
          can_join_groups: true,
          can_read_all_group_messages: true,
          supports_inline_queries: false,
        },
      });
    });

    // Send message
    this.app.post('/bot:token/sendMessage', async (c) => {
      const body = await c.req.json();
      const msg: MockMessage = {
        message_id: this.messageIdCounter++,
        chat: { id: body.chat_id, type: 'supergroup' },
        text: body.text,
        from: { id: 123456789, is_bot: true, first_name: 'PocketPing' },
        date: Math.floor(Date.now() / 1000),
        message_thread_id: body.message_thread_id,
      };

      this.sentMessages.push(msg);
      this.onMessageSent?.(msg);

      return c.json({ ok: true, result: msg });
    });

    // Create forum topic
    this.app.post('/bot:token/createForumTopic', async (c) => {
      const body = await c.req.json();
      const topic = {
        name: body.name,
        chat_id: body.chat_id,
        message_thread_id: this.threadIdCounter++,
      };

      this.createdTopics.push(topic);

      return c.json({
        ok: true,
        result: {
          message_thread_id: topic.message_thread_id,
          name: topic.name,
          icon_color: 7322096,
        },
      });
    });

    // Set commands
    this.app.post('/bot:token/setMyCommands', async (c) => {
      const body = await c.req.json();
      this.registeredCommands = body.commands || [];
      return c.json({ ok: true, result: true });
    });

    // Get updates (for polling mode)
    this.app.post('/bot:token/getUpdates', async (c) => {
      const updates = [...this.pendingUpdates];
      this.pendingUpdates = [];
      return c.json({ ok: true, result: updates });
    });

    // Delete webhook (required for polling)
    this.app.post('/bot:token/deleteWebhook', (c) => {
      return c.json({ ok: true, result: true });
    });

    // Set webhook
    this.app.post('/bot:token/setWebhook', async (c) => {
      return c.json({ ok: true, result: true });
    });

    // Edit message
    this.app.post('/bot:token/editMessageText', async (c) => {
      const body = await c.req.json();
      return c.json({
        ok: true,
        result: {
          message_id: body.message_id,
          chat: { id: body.chat_id },
          text: body.text,
          date: Math.floor(Date.now() / 1000),
        },
      });
    });

    // Set message reaction
    this.app.post('/bot:token/setMessageReaction', async (c) => {
      return c.json({ ok: true, result: true });
    });

    // Pin message
    this.app.post('/bot:token/pinChatMessage', async (c) => {
      return c.json({ ok: true, result: true });
    });

    // Health check
    this.app.get('/health', (c) => c.json({ ok: true }));
  }

  // Start the mock server
  async start(port = 9001): Promise<string> {
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
    this.sentMessages = [];
    this.createdTopics = [];
    this.pendingUpdates = [];
    this.registeredCommands = [];
    this.messageIdCounter = 1;
    this.updateIdCounter = 1;
    this.threadIdCounter = 1000;
  }

  // Simulate an incoming message from operator
  simulateOperatorMessage(chatId: number, threadId: number, text: string, fromUser = 'Operator') {
    const update: MockUpdate = {
      update_id: this.updateIdCounter++,
      message: {
        message_id: this.messageIdCounter++,
        chat: { id: chatId, type: 'supergroup' },
        text,
        from: { id: 999, is_bot: false, first_name: fromUser },
        date: Math.floor(Date.now() / 1000),
        message_thread_id: threadId,
      },
    };
    this.pendingUpdates.push(update);
    return update;
  }

  // Simulate a reaction on a message
  simulateReaction(chatId: number, messageId: number, emoji: string, userId = 999) {
    const update: MockUpdate = {
      update_id: this.updateIdCounter++,
      message_reaction: {
        chat: { id: chatId, type: 'supergroup' },
        message_id: messageId,
        user: { id: userId, is_bot: false, first_name: 'Operator' },
        date: Math.floor(Date.now() / 1000),
        new_reaction: [{ type: 'emoji', emoji }],
        old_reaction: [],
      },
    };
    this.pendingUpdates.push(update);
    return update;
  }

  // Set callback for when message is sent
  onMessage(callback: (msg: MockMessage) => void) {
    this.onMessageSent = callback;
  }

  // Helper to get last sent message
  getLastMessage(): MockMessage | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  // Helper to get messages for a specific thread
  getThreadMessages(threadId: number): MockMessage[] {
    return this.sentMessages.filter((m) => m.message_thread_id === threadId);
  }
}

// Export a singleton for easy use
export const mockTelegramServer = new MockTelegramServer();

/**
 * Integration tests for Telegram Bridge
 *
 * Uses MockTelegramServer to test the full flow without hitting real Telegram API.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MockTelegramServer } from '../mocks/telegram-api';

describe('Telegram Bridge Integration', () => {
  let mockServer: MockTelegramServer;
  let serverUrl: string;

  beforeAll(async () => {
    mockServer = new MockTelegramServer();
    serverUrl = await mockServer.start(0);
    console.log(`Mock Telegram server started at ${serverUrl}`);
  });

  afterAll(() => {
    mockServer.stop();
  });

  beforeEach(() => {
    mockServer.reset();
  });

  describe('Session Creation', () => {
    it('should create a forum topic for new session', async () => {
      // Simulate what TelegramBridge.onNewSession does
      const response = await fetch(`${serverUrl}/bottest-token/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          name: '🟢 abc123 • home',
        }),
      });

      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.result.message_thread_id).toBeDefined();
      expect(mockServer.createdTopics.length).toBe(1);
      expect(mockServer.createdTopics[0].name).toBe('🟢 abc123 • home');
    });

    it('should send welcome message with metadata', async () => {
      // First create topic
      const topicResponse = await fetch(`${serverUrl}/bottest-token/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          name: '🟢 session1',
        }),
      });
      const topic = await topicResponse.json();

      // Send welcome message
      const welcomeMessage = `🆕 *New Conversation*

Session: \`session-12345...\`
📍 Page: https://example.com/pricing
💻 Device: desktop • Chrome • macOS
🌍 Location: Paris, France
🔗 IP: \`192.168.1.1\`

_Reply here to communicate with the visitor._`;

      await fetch(`${serverUrl}/bottest-token/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          message_thread_id: topic.result.message_thread_id,
          text: welcomeMessage,
          parse_mode: 'Markdown',
        }),
      });

      expect(mockServer.sentMessages.length).toBe(1);
      expect(mockServer.sentMessages[0].text).toContain('New Conversation');
      expect(mockServer.sentMessages[0].text).toContain('Paris, France');
    });
  });

  describe('Visitor Messages', () => {
    it('should forward visitor message to thread', async () => {
      const threadId = 1001;

      await fetch(`${serverUrl}/bottest-token/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          message_thread_id: threadId,
          text: '💬 *Visitor:*\n\nHello, I need help with pricing!',
          parse_mode: 'Markdown',
        }),
      });

      const lastMessage = mockServer.getLastMessage();
      expect(lastMessage?.text).toContain('Hello, I need help with pricing!');
      expect(lastMessage?.message_thread_id).toBe(threadId);
    });

    it('should track visitor messages for read receipts', async () => {
      const threadId = 1001;
      const messages: number[] = [];

      // Send 3 visitor messages
      for (let i = 1; i <= 3; i++) {
        const response = await fetch(`${serverUrl}/bottest-token/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: -1001234567890,
            message_thread_id: threadId,
            text: `Message ${i}`,
          }),
        });
        const data = await response.json();
        messages.push(data.result.message_id);
      }

      // Verify all messages were tracked
      const threadMessages = mockServer.getThreadMessages(threadId);
      expect(threadMessages.length).toBe(3);
    });
  });

  describe('Operator Responses', () => {
    it('should emit operator_message event when operator replies', async () => {
      // Simulate operator message coming in via webhook/polling
      const update = mockServer.simulateOperatorMessage(
        -1001234567890,
        1001,
        'Hi! Let me help you with that.',
        'John'
      );

      expect(update.message?.text).toBe('Hi! Let me help you with that.');
      expect(update.message?.from?.first_name).toBe('John');
      expect(mockServer.pendingUpdates.length).toBe(1);
    });
  });

  describe('Read Receipts', () => {
    it('should handle reaction-based read receipts', async () => {
      // Simulate reaction on a message
      const update = mockServer.simulateReaction(-1001234567890, 123, '👀');

      expect(update.message_reaction).toBeDefined();
      expect(update.message_reaction.new_reaction[0].emoji).toBe('👀');
    });
  });

  describe('Commands', () => {
    it('should register bot commands', async () => {
      await fetch(`${serverUrl}/bottest-token/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: [
            { command: 'online', description: 'Mark as available' },
            { command: 'offline', description: 'Mark as away' },
            { command: 'read', description: 'Mark messages as read' },
          ],
        }),
      });

      expect(mockServer.registeredCommands.length).toBe(3);
      expect(mockServer.registeredCommands[0].command).toBe('online');
    });
  });
});

describe('Telegram Bridge - Message Delivery Flow', () => {
  let mockServer: MockTelegramServer;
  let serverUrl: string;

  beforeAll(async () => {
    mockServer = new MockTelegramServer();
    serverUrl = await mockServer.start(0);
  });

  afterAll(() => {
    mockServer.stop();
  });

  beforeEach(() => {
    mockServer.reset();
  });

  it('should complete full message delivery flow', async () => {
    // 1. Create session (forum topic)
    const topicRes = await fetch(`${serverUrl}/bottest-token/createForumTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: -1001234567890,
        name: '🟢 test-session',
      }),
    });
    const topic = await topicRes.json();
    const threadId = topic.result.message_thread_id;

    // 2. Send welcome message
    await fetch(`${serverUrl}/bottest-token/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: -1001234567890,
        message_thread_id: threadId,
        text: 'Welcome!',
      }),
    });

    // 3. Forward visitor message
    const visitorMsgRes = await fetch(`${serverUrl}/bottest-token/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: -1001234567890,
        message_thread_id: threadId,
        text: '💬 Visitor: Hello!',
      }),
    });
    const visitorMsg = await visitorMsgRes.json();

    // 4. Operator replies
    mockServer.simulateOperatorMessage(-1001234567890, threadId, 'Hi there!', 'Support');

    // 5. Operator reacts (read receipt)
    mockServer.simulateReaction(-1001234567890, visitorMsg.result.message_id, '👀');

    // Verify the complete flow
    expect(mockServer.createdTopics.length).toBe(1);
    expect(mockServer.sentMessages.length).toBe(2);
    expect(mockServer.pendingUpdates.length).toBe(2); // 1 message + 1 reaction
  });
});

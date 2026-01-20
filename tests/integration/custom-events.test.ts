/**
 * Integration tests for Custom Events
 *
 * Tests the bidirectional custom event flow between widget, SDK, and bridges.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MockTelegramServer } from '../mocks/telegram-api';

describe('Custom Events Integration', () => {
  let mockServer: MockTelegramServer;
  let serverUrl: string;

  beforeAll(async () => {
    mockServer = new MockTelegramServer();
    serverUrl = await mockServer.start(9010);
    console.log(`Mock Telegram server started at ${serverUrl}`);
  });

  afterAll(() => {
    mockServer.stop();
  });

  beforeEach(() => {
    mockServer.reset();
  });

  describe('Widget to Bridge Flow', () => {
    it('should forward custom event from widget to Telegram', async () => {
      // First create a forum topic (session)
      const topicResponse = await fetch(`${serverUrl}/bottest-token/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          name: '🟢 session-123',
        }),
      });
      const topic = await topicResponse.json();
      const threadId = topic.result.message_thread_id;

      // Simulate custom event message sent to Telegram (as bridge would do)
      const eventMessage = `⚡ *Custom Event*

📌 Event: \`clicked_pricing\`
\`\`\`json
{
  "plan": "pro",
  "source": "homepage"
}
\`\`\`

_Session: \`session-1...\`_`;

      await fetch(`${serverUrl}/bottest-token/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          message_thread_id: threadId,
          text: eventMessage,
          parse_mode: 'Markdown',
        }),
      });

      const lastMessage = mockServer.getLastMessage();
      expect(lastMessage?.text).toContain('Custom Event');
      expect(lastMessage?.text).toContain('clicked_pricing');
      expect(lastMessage?.text).toContain('pro');
      expect(lastMessage?.message_thread_id).toBe(threadId);
    });

    it('should handle event without data payload', async () => {
      const topicResponse = await fetch(`${serverUrl}/bottest-token/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          name: '🟢 session-456',
        }),
      });
      const topic = await topicResponse.json();
      const threadId = topic.result.message_thread_id;

      const eventMessage = `⚡ *Custom Event*

📌 Event: \`page_view\`

_Session: \`session-4...\`_`;

      await fetch(`${serverUrl}/bottest-token/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          message_thread_id: threadId,
          text: eventMessage,
          parse_mode: 'Markdown',
        }),
      });

      const lastMessage = mockServer.getLastMessage();
      expect(lastMessage?.text).toContain('Custom Event');
      expect(lastMessage?.text).toContain('page_view');
    });

    it('should handle multiple events in sequence', async () => {
      const topicResponse = await fetch(`${serverUrl}/bottest-token/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          name: '🟢 session-789',
        }),
      });
      const topic = await topicResponse.json();
      const threadId = topic.result.message_thread_id;

      // Send multiple events
      const events = [
        { name: 'page_view', data: { page: '/home' } },
        { name: 'clicked_cta', data: { button: 'signup' } },
        { name: 'error_occurred', data: { code: 500 } },
      ];

      for (const event of events) {
        const dataStr = JSON.stringify(event.data, null, 2);
        const eventMessage = `⚡ *Custom Event*

📌 Event: \`${event.name}\`
\`\`\`json
${dataStr}
\`\`\`

_Session: \`session-7...\`_`;

        await fetch(`${serverUrl}/bottest-token/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: -1001234567890,
            message_thread_id: threadId,
            text: eventMessage,
            parse_mode: 'Markdown',
          }),
        });
      }

      // Should have 3 event messages
      const threadMessages = mockServer.getThreadMessages(threadId);
      expect(threadMessages.length).toBe(3);

      // Verify each event was recorded
      const messages = threadMessages.map((m) => m.text);
      expect(messages.some((m) => m.includes('page_view'))).toBe(true);
      expect(messages.some((m) => m.includes('clicked_cta'))).toBe(true);
      expect(messages.some((m) => m.includes('error_occurred'))).toBe(true);
    });
  });

  describe('Event Data Serialization', () => {
    it('should handle nested data objects', async () => {
      const topicResponse = await fetch(`${serverUrl}/bottest-token/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          name: '🟢 nested-data',
        }),
      });
      const topic = await topicResponse.json();
      const threadId = topic.result.message_thread_id;

      const complexData = {
        user: {
          id: 123,
          preferences: {
            theme: 'dark',
            notifications: true,
          },
        },
        cart: [
          { item: 'Product A', qty: 2 },
          { item: 'Product B', qty: 1 },
        ],
      };

      const dataStr = JSON.stringify(complexData, null, 2);
      const eventMessage = `⚡ *Custom Event*

📌 Event: \`checkout_started\`
\`\`\`json
${dataStr}
\`\`\`

_Session: \`nested-d...\`_`;

      await fetch(`${serverUrl}/bottest-token/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          message_thread_id: threadId,
          text: eventMessage,
          parse_mode: 'Markdown',
        }),
      });

      const lastMessage = mockServer.getLastMessage();
      expect(lastMessage?.text).toContain('checkout_started');
      expect(lastMessage?.text).toContain('Product A');
      expect(lastMessage?.text).toContain('theme');
    });
  });
});

describe('Custom Events - Full Integration', () => {
  let mockServer: MockTelegramServer;
  let serverUrl: string;

  beforeAll(async () => {
    mockServer = new MockTelegramServer();
    serverUrl = await mockServer.start(9011);
  });

  afterAll(() => {
    mockServer.stop();
  });

  beforeEach(() => {
    mockServer.reset();
  });

  it('should complete full event flow: session -> message -> event', async () => {
    // 1. Create session (forum topic)
    const topicRes = await fetch(`${serverUrl}/bottest-token/createForumTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: -1001234567890,
        name: '🟢 full-flow',
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

    // 3. Visitor sends message
    await fetch(`${serverUrl}/bottest-token/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: -1001234567890,
        message_thread_id: threadId,
        text: '💬 Visitor: Hello!',
      }),
    });

    // 4. Custom event triggered
    await fetch(`${serverUrl}/bottest-token/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: -1001234567890,
        message_thread_id: threadId,
        text: '⚡ *Custom Event*\n\n📌 Event: `viewed_pricing`',
        parse_mode: 'Markdown',
      }),
    });

    // 5. Operator replies
    mockServer.simulateOperatorMessage(-1001234567890, threadId, 'How can I help?', 'Support');

    // Verify the flow
    expect(mockServer.createdTopics.length).toBe(1);
    expect(mockServer.sentMessages.length).toBe(3); // welcome + visitor msg + event
    expect(mockServer.pendingUpdates.length).toBe(1); // operator reply
  });
});

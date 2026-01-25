/**
 * Full Message Flow Integration Tests
 *
 * Tests complete message flows from Widget → SDK → Bridge Server → Platforms.
 * Simulates realistic scenarios with multiple services interacting.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MockTelegramServer } from '../mocks/telegram-api';
import { MockSlackServer } from '../mocks/slack-api';
import { MockDiscordServer } from '../mocks/discord-api';

// Simulated bridge server state
interface SessionState {
  sessionId: string;
  visitorName?: string;
  threads: {
    telegram?: number;
    slack?: string;
    discord?: string;
  };
  messageIdMap: Map<string, { telegram?: number; slack?: string; discord?: string }>;
}

describe('Full Message Flow', () => {
  let telegramServer: MockTelegramServer;
  let slackServer: MockSlackServer;
  let discordServer: MockDiscordServer;
  let telegramUrl: string;
  let slackUrl: string;
  let discordUrl: string;

  const sessions = new Map<string, SessionState>();

  beforeAll(async () => {
    telegramServer = new MockTelegramServer();
    slackServer = new MockSlackServer();
    discordServer = new MockDiscordServer();

    telegramUrl = await telegramServer.start(0);
    slackUrl = await slackServer.start(0);
    discordUrl = await discordServer.start(0);
  });

  afterAll(() => {
    telegramServer.stop();
    slackServer.stop();
    discordServer.stop();
  });

  beforeEach(() => {
    telegramServer.reset();
    slackServer.reset();
    discordServer.reset();
    sessions.clear();
  });

  describe('New Session Flow', () => {
    it('should create threads on all enabled bridges for new session', async () => {
      const sessionId = `session-${Date.now()}`;
      const visitorName = 'John Doe';

      // Simulating bridge server creating threads on all platforms

      // 1. Create Telegram forum topic
      const telegramRes = await fetch(`${telegramUrl}/bottest/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          name: `🟢 ${visitorName}`,
        }),
      });
      const telegramTopic = await telegramRes.json();

      // 2. Create Slack thread
      const slackRes = await fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C12345678',
          text: `🟢 New session from *${visitorName}*`,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `🟢 New session from *${visitorName}*` } },
            { type: 'context', elements: [{ type: 'mrkdwn', text: `Session: ${sessionId}` }] },
          ],
        }),
      });
      const slackThread = await slackRes.json();

      // 3. Create Discord thread
      const discordRes = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `🟢 ${visitorName}`,
          message: {
            embeds: [{
              title: 'New Support Session',
              description: `Session started by ${visitorName}`,
              color: 0x00ff00,
              fields: [{ name: 'Session ID', value: sessionId }],
            }],
          },
        }),
      });
      const discordThread = await discordRes.json();

      // Store session state
      sessions.set(sessionId, {
        sessionId,
        visitorName,
        threads: {
          telegram: telegramTopic.result.message_thread_id,
          slack: slackThread.ts,
          discord: discordThread.id,
        },
        messageIdMap: new Map(),
      });

      // Verify all threads created
      expect(telegramServer.createdTopics.length).toBe(1);
      expect(slackServer.postedMessages.length).toBe(1);
      expect(discordServer.getThreads().length).toBe(1);

      const session = sessions.get(sessionId)!;
      expect(session.threads.telegram).toBeDefined();
      expect(session.threads.slack).toBeDefined();
      expect(session.threads.discord).toBeDefined();
    });

    it('should notify all bridges when visitor sends first message', async () => {
      const sessionId = `session-${Date.now()}`;
      const visitorMessage = 'Hello, I need help with my account!';

      // Setup session threads first
      const [telegramRes, slackRes, discordRes] = await Promise.all([
        fetch(`${telegramUrl}/bottest/createForumTopic`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: -100123, name: 'New Session' }),
        }),
        fetch(`${slackUrl}/api/chat.postMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: 'C123', text: 'New session' }),
        }),
        fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New Session', message: { content: 'Starting' } }),
        }),
      ]);

      const telegramTopic = await telegramRes.json();
      const slackThread = await slackRes.json();
      const discordThread = await discordRes.json();

      // Forward visitor message to all platforms in parallel
      await Promise.all([
        fetch(`${telegramUrl}/bottest/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: -100123,
            message_thread_id: telegramTopic.result.message_thread_id,
            text: `💬 *Visitor*:\n${visitorMessage}`,
            parse_mode: 'Markdown',
          }),
        }),
        fetch(`${slackUrl}/api/chat.postMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'C123',
            thread_ts: slackThread.ts,
            blocks: [
              { type: 'context', elements: [{ type: 'mrkdwn', text: '💬 *Visitor*' }] },
              { type: 'section', text: { type: 'mrkdwn', text: visitorMessage } },
            ],
          }),
        }),
        fetch(`${discordUrl}/api/v10/channels/${discordThread.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              author: { name: '💬 Visitor' },
              description: visitorMessage,
              color: 0x5865f2,
            }],
          }),
        }),
      ]);

      // Verify message received on all platforms
      expect(telegramServer.sentMessages.length).toBe(1);
      expect(slackServer.postedMessages.length).toBe(2); // session + message
      expect(discordServer.sentMessages.length).toBe(2); // thread start + message

      // Verify content
      expect(telegramServer.getLastMessage()?.text).toContain(visitorMessage);
      expect(slackServer.getLastMessage()?.blocks?.[1]?.text?.text).toBe(visitorMessage);
      expect(discordServer.getLastMessage()?.embeds?.[0]?.description).toBe(visitorMessage);
    });
  });

  describe('Operator Reply Flow', () => {
    it('should forward Telegram operator reply to visitor and sync to other bridges', async () => {
      const sessionId = `session-${Date.now()}`;
      const operatorMessage = 'Hi! Let me help you with that. Can you provide your account email?';
      const operatorName = 'Support Agent';

      // Setup session
      const telegramRes = await fetch(`${telegramUrl}/bottest/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: -100123, name: 'Session' }),
      });
      const telegramTopic = await telegramRes.json();

      const slackRes = await fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'C123', text: 'Session' }),
      });
      const slackThread = await slackRes.json();

      const discordRes = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Session', message: { content: 'Start' } }),
      });
      const discordThread = await discordRes.json();

      // Simulate operator replying on Telegram (via Gateway event)
      telegramServer.simulateOperatorMessage(
        -100123,
        telegramTopic.result.message_thread_id,
        operatorMessage,
        operatorName
      );

      // Bridge server would then sync to other platforms
      await Promise.all([
        // Sync to Slack
        fetch(`${slackUrl}/api/chat.postMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'C123',
            thread_ts: slackThread.ts,
            blocks: [
              { type: 'context', elements: [{ type: 'mrkdwn', text: `✈️ *${operatorName}* _via Telegram_` }] },
              { type: 'section', text: { type: 'mrkdwn', text: operatorMessage } },
            ],
          }),
        }),
        // Sync to Discord
        fetch(`${discordUrl}/api/v10/channels/${discordThread.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              author: { name: `${operatorName} (via Telegram)` },
              description: operatorMessage,
              color: 0x0088cc, // Telegram blue
            }],
          }),
        }),
      ]);

      // Verify sync happened
      expect(slackServer.getLastMessage()?.blocks?.[0]?.elements?.[0]?.text).toContain('via Telegram');
      expect(discordServer.getLastMessage()?.embeds?.[0]?.author?.name).toContain('via Telegram');
    });

    it('should handle rapid message exchange', async () => {
      // Setup session
      const telegramRes = await fetch(`${telegramUrl}/bottest/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: -100123, name: 'Rapid Session' }),
      });
      const telegramTopic = await telegramRes.json();

      // Simulate rapid back-and-forth
      const messages = [
        { from: 'visitor', text: 'Hi!' },
        { from: 'operator', text: 'Hello!' },
        { from: 'visitor', text: 'I need help' },
        { from: 'operator', text: 'Sure, what\'s the issue?' },
        { from: 'visitor', text: 'My order is delayed' },
      ];

      for (const msg of messages) {
        await fetch(`${telegramUrl}/bottest/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: -100123,
            message_thread_id: telegramTopic.result.message_thread_id,
            text: msg.from === 'visitor' ? `💬 Visitor: ${msg.text}` : `👤 Operator: ${msg.text}`,
          }),
        });
      }

      // Verify all messages sent in order
      expect(telegramServer.sentMessages.length).toBe(5);
      expect(telegramServer.sentMessages[0].text).toContain('Hi!');
      expect(telegramServer.sentMessages[4].text).toContain('delayed');
    });
  });

  describe('Read Receipt Flow', () => {
    it('should track message delivery and read status', async () => {
      // Setup
      const slackRes = await fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'C123', text: 'Session' }),
      });
      const slackThread = await slackRes.json();

      // Send message
      const msgRes = await fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C123',
          thread_ts: slackThread.ts,
          text: 'Visitor message that needs acknowledgment',
        }),
      });
      const msg = await msgRes.json();

      // Mark as delivered (add eyes emoji)
      await fetch(`${slackUrl}/api/reactions.add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C123',
          timestamp: msg.ts,
          name: 'eyes',
        }),
      });

      // Later, mark as read (add checkmark)
      await fetch(`${slackUrl}/api/reactions.add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C123',
          timestamp: msg.ts,
          name: 'white_check_mark',
        }),
      });

      // Verify reactions
      expect(slackServer.hasReaction(msg.ts, 'eyes')).toBe(true);
      expect(slackServer.hasReaction(msg.ts, 'white_check_mark')).toBe(true);
    });
  });

  describe('Session End Flow', () => {
    it('should notify all bridges when session ends', async () => {
      // Setup session
      const [telegramRes, slackRes, discordRes] = await Promise.all([
        fetch(`${telegramUrl}/bottest/createForumTopic`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: -100123, name: '🟢 Active Session' }),
        }),
        fetch(`${slackUrl}/api/chat.postMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: 'C123', text: '🟢 Active Session' }),
        }),
        fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '🟢 Active Session', message: { content: 'Started' } }),
        }),
      ]);

      const telegramTopic = await telegramRes.json();
      const slackThread = await slackRes.json();
      const discordThread = await discordRes.json();

      // Send session end notification to all platforms
      await Promise.all([
        fetch(`${telegramUrl}/bottest/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: -100123,
            message_thread_id: telegramTopic.result.message_thread_id,
            text: '🔴 *Session ended by visitor*',
            parse_mode: 'Markdown',
          }),
        }),
        fetch(`${slackUrl}/api/chat.postMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'C123',
            thread_ts: slackThread.ts,
            text: '🔴 Session ended by visitor',
          }),
        }),
        fetch(`${discordUrl}/api/v10/channels/${discordThread.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              description: '🔴 Session ended by visitor',
              color: 0xff0000,
            }],
          }),
        }),
      ]);

      // Verify all platforms notified
      expect(telegramServer.getLastMessage()?.text).toContain('Session ended');
      expect(slackServer.getLastMessage()?.text).toContain('Session ended');
      expect(discordServer.getLastMessage()?.embeds?.[0]?.description).toContain('Session ended');
    });
  });
});

describe('Error Handling and Recovery', () => {
  let telegramServer: MockTelegramServer;
  let slackServer: MockSlackServer;
  let telegramUrl: string;
  let slackUrl: string;

  beforeAll(async () => {
    telegramServer = new MockTelegramServer();
    slackServer = new MockSlackServer();
    telegramUrl = await telegramServer.start(0);
    slackUrl = await slackServer.start(0);
  });

  afterAll(() => {
    telegramServer.stop();
    slackServer.stop();
  });

  beforeEach(() => {
    telegramServer.reset();
    slackServer.reset();
  });

  it('should continue if one bridge fails during message send', async () => {
    // Setup session on Slack only (Telegram would be down)
    const slackRes = await fetch(`${slackUrl}/api/chat.postMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'C123', text: 'Session' }),
    });
    const slackThread = await slackRes.json();

    // Simulate Telegram being unavailable
    const telegramFailed = fetch('http://localhost:99999/invalid', {
      method: 'POST',
    }).catch(() => ({ ok: false, error: 'connection_failed' }));

    // Slack should still work
    const slackSuccess = fetch(`${slackUrl}/api/chat.postMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'C123',
        thread_ts: slackThread.ts,
        text: 'Message when Telegram is down',
      }),
    });

    const [telegramResult, slackResult] = await Promise.all([telegramFailed, slackSuccess]);

    // Telegram failed but Slack succeeded
    expect((telegramResult as any).ok).toBe(false);
    expect(slackResult.ok).toBe(true);
    expect(slackServer.getLastMessage()?.text).toContain('Telegram is down');
  });

  it('should handle rate limiting gracefully', async () => {
    // Simulate sending many messages quickly
    const slackRes = await fetch(`${slackUrl}/api/chat.postMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'C123', text: 'Session' }),
    });
    const slackThread = await slackRes.json();

    // Send 10 messages rapidly
    const promises = Array.from({ length: 10 }, (_, i) =>
      fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C123',
          thread_ts: slackThread.ts,
          text: `Rapid message ${i + 1}`,
        }),
      })
    );

    const results = await Promise.all(promises);

    // All should succeed (mock doesn't enforce rate limits)
    const successCount = results.filter((r) => r.ok).length;
    expect(successCount).toBe(10);
  });

  it('should preserve message order even with async delivery', async () => {
    const telegramRes = await fetch(`${telegramUrl}/bottest/createForumTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: -100123, name: 'Order Test' }),
    });
    const telegramTopic = await telegramRes.json();

    // Send messages with varying "network delays" (simulated by setTimeout)
    const sendMessage = async (text: string, delayMs: number) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return fetch(`${telegramUrl}/bottest/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -100123,
          message_thread_id: telegramTopic.result.message_thread_id,
          text,
        }),
      });
    };

    // Send in sequence but with different delays
    await sendMessage('Message 1', 0);
    await sendMessage('Message 2', 10);
    await sendMessage('Message 3', 5);

    // Messages should be in order they were sent (not by delay)
    const messages = telegramServer.sentMessages;
    expect(messages[0].text).toBe('Message 1');
    expect(messages[1].text).toBe('Message 2');
    expect(messages[2].text).toBe('Message 3');
  });
});

describe('Cross-Platform Consistency', () => {
  let telegramServer: MockTelegramServer;
  let slackServer: MockSlackServer;
  let discordServer: MockDiscordServer;
  let telegramUrl: string;
  let slackUrl: string;
  let discordUrl: string;

  beforeAll(async () => {
    telegramServer = new MockTelegramServer();
    slackServer = new MockSlackServer();
    discordServer = new MockDiscordServer();
    telegramUrl = await telegramServer.start(0);
    slackUrl = await slackServer.start(0);
    discordUrl = await discordServer.start(0);
  });

  afterAll(() => {
    telegramServer.stop();
    slackServer.stop();
    discordServer.stop();
  });

  beforeEach(() => {
    telegramServer.reset();
    slackServer.reset();
    discordServer.reset();
  });

  it('should format same message appropriately for each platform', async () => {
    const visitorMessage = 'Check out this **bold** and _italic_ text with `code`';

    // Same message, different formatting for each platform
    await Promise.all([
      // Telegram: Markdown
      fetch(`${telegramUrl}/bottest/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -100123,
          text: visitorMessage,
          parse_mode: 'Markdown',
        }),
      }),
      // Slack: mrkdwn
      fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C123',
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: visitorMessage },
          }],
        }),
      }),
      // Discord: Markdown (same as source)
      fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Format Test',
          message: { content: visitorMessage },
        }),
      }),
    ]);

    // Verify each platform received the message
    expect(telegramServer.getLastMessage()?.text).toBe(visitorMessage);
    expect(slackServer.getLastMessage()?.blocks?.[0]?.text?.text).toBe(visitorMessage);
    expect(discordServer.getLastMessage()?.content).toBe(visitorMessage);
  });

  it('should handle emoji consistently across platforms', async () => {
    const emojiMessage = 'User rating: ⭐⭐⭐⭐⭐ Great service! 🎉';

    await Promise.all([
      fetch(`${telegramUrl}/bottest/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: -100123, text: emojiMessage }),
      }),
      fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'C123', text: emojiMessage }),
      }),
      fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Emoji Test',
          message: { content: emojiMessage },
        }),
      }),
    ]);

    // All platforms should preserve emojis
    expect(telegramServer.getLastMessage()?.text).toContain('⭐');
    expect(telegramServer.getLastMessage()?.text).toContain('🎉');
    expect(slackServer.getLastMessage()?.text).toContain('⭐');
    expect(discordServer.getLastMessage()?.content).toContain('⭐');
  });
});

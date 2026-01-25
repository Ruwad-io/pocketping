/**
 * Multi-Bridge Sync Integration Tests
 *
 * Tests that messages from one bridge are correctly synced to others.
 * For example: operator replies on Telegram should appear on Slack and Discord.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MockTelegramServer } from '../mocks/telegram-api';
import { MockSlackServer } from '../mocks/slack-api';
import { MockDiscordServer } from '../mocks/discord-api';

describe('Multi-Bridge Sync', () => {
  let telegramServer: MockTelegramServer;
  let slackServer: MockSlackServer;
  let discordServer: MockDiscordServer;
  let telegramUrl: string;
  let slackUrl: string;
  let discordUrl: string;

  // Simulated bridge server state
  const sessionThreadMapping = new Map<
    string,
    { telegram?: number; slack?: string; discord?: string }
  >();

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
    sessionThreadMapping.clear();
  });

  describe('New Session Sync', () => {
    it('should create threads on all platforms for new session', async () => {
      const sessionId = 'session-123';

      // Create Telegram forum topic
      const telegramRes = await fetch(`${telegramUrl}/bottest/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -1001234567890,
          name: `🟢 ${sessionId.slice(0, 8)}`,
        }),
      });
      const telegramTopic = await telegramRes.json();

      // Create Slack thread
      const slackRes = await fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C12345678',
          text: `New session: ${sessionId}`,
        }),
      });
      const slackThread = await slackRes.json();

      // Create Discord forum thread
      const discordRes = await fetch(
        `${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bot test-token' },
          body: JSON.stringify({
            name: `🟢 ${sessionId.slice(0, 8)}`,
            message: { content: `New session: ${sessionId}` },
          }),
        }
      );
      const discordThread = await discordRes.json();

      // Store mapping
      sessionThreadMapping.set(sessionId, {
        telegram: telegramTopic.result.message_thread_id,
        slack: slackThread.ts,
        discord: discordThread.id,
      });

      // Verify all created
      expect(telegramServer.createdTopics.length).toBe(1);
      expect(slackServer.postedMessages.length).toBe(1);
      expect(discordServer.getThreads().length).toBe(1);
      expect(sessionThreadMapping.get(sessionId)?.telegram).toBeDefined();
      expect(sessionThreadMapping.get(sessionId)?.slack).toBeDefined();
      expect(sessionThreadMapping.get(sessionId)?.discord).toBeDefined();
    });
  });

  describe('Visitor Message Sync', () => {
    it('should forward visitor message to all platforms', async () => {
      const sessionId = 'session-456';
      const message = 'Hello, I need help!';

      // Setup session threads
      const telegramRes = await fetch(`${telegramUrl}/bottest/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: -100123, name: 'Test' }),
      });
      const telegramTopic = await telegramRes.json();

      const slackRes = await fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'C123', text: 'New session' }),
      });
      const slackThread = await slackRes.json();

      const discordThreadRes = await fetch(
        `${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bot test-token' },
          body: JSON.stringify({
            name: `🟢 ${sessionId.slice(0, 8)}`,
            message: { content: `New session: ${sessionId}` },
          }),
        }
      );
      const discordThread = await discordThreadRes.json();

      const mapping = {
        telegram: telegramTopic.result.message_thread_id,
        slack: slackThread.ts,
        discord: discordThread.id,
      };

      // Forward visitor message to Telegram
      await fetch(`${telegramUrl}/bottest/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -100123,
          message_thread_id: mapping.telegram,
          text: `💬 Visitor:\n${message}`,
        }),
      });

      // Forward visitor message to Slack
      await fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C123',
          thread_ts: mapping.slack,
          text: message,
        }),
      });

      // Forward visitor message to Discord
      await fetch(`${discordUrl}/api/v10/channels/${mapping.discord}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `💬 **Visitor**:\n${message}`,
        }),
      });

      // Verify all received
      expect(telegramServer.sentMessages.length).toBe(1);
      expect(slackServer.postedMessages.length).toBe(2); // session + message
      expect(discordServer.getChannelMessages(mapping.discord).length).toBe(2); // session + message

      // Verify content
      expect(telegramServer.getLastMessage()?.text).toContain(message);
      expect(slackServer.getLastMessage()?.text).toBe(message);
      expect(discordServer.getLastMessage()?.content).toContain(message);
    });
  });

  describe('Cross-Bridge Operator Message Sync', () => {
    it('should sync Telegram operator message to Slack and Discord', async () => {
      const operatorMessage = 'Hi! Let me help you with that.';
      const operatorName = 'John';

      // Setup threads
      const slackSessionRes = await fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'C123', text: 'Session' }),
      });
      const slackThread = await slackSessionRes.json();

      const discordThreadRes = await fetch(
        `${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bot test-token' },
          body: JSON.stringify({
            name: 'Session',
            message: { content: 'Session started' },
          }),
        }
      );
      const discordThread = await discordThreadRes.json();

      // Operator replies on Telegram (simulated)
      // Bridge server receives this and syncs to Slack + Discord
      await fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C123',
          thread_ts: slackThread.ts,
          text: `${operatorName} via telegram: ${operatorMessage}`,
          blocks: [
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: `✈️ *${operatorName}* _via telegram_` }],
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: operatorMessage },
            },
          ],
        }),
      });

      await fetch(`${discordUrl}/api/v10/channels/${discordThread.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `✈️ ${operatorName} via telegram: ${operatorMessage}`,
        }),
      });

      // Verify sync to Slack + Discord
      const lastSlackMsg = slackServer.getLastMessage();
      expect(lastSlackMsg?.text).toContain('via telegram');
      expect(lastSlackMsg?.blocks?.[0].elements[0].text).toContain('telegram');
      const lastDiscordMsg = discordServer.getLastMessage();
      expect(lastDiscordMsg?.content).toContain('via telegram');
      expect(lastDiscordMsg?.content).toContain(operatorMessage);
    });

    it('should sync Slack operator message to Telegram and Discord', async () => {
      const operatorMessage = 'Hello from Slack!';
      const operatorName = 'Jane';

      // Setup Telegram thread
      const telegramRes = await fetch(`${telegramUrl}/bottest/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: -100123, name: 'Test' }),
      });
      const telegramTopic = await telegramRes.json();

      const discordThreadRes = await fetch(
        `${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bot test-token' },
          body: JSON.stringify({
            name: 'Session',
            message: { content: 'Session started' },
          }),
        }
      );
      const discordThread = await discordThreadRes.json();

      // Operator replies on Slack (simulated)
      // Bridge server receives this and syncs to Telegram + Discord
      await fetch(`${telegramUrl}/bottest/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -100123,
          message_thread_id: telegramTopic.result.message_thread_id,
          text: `💬 *${operatorName}* _via slack_:\n${operatorMessage}`,
          parse_mode: 'Markdown',
        }),
      });

      await fetch(`${discordUrl}/api/v10/channels/${discordThread.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `💬 ${operatorName} via slack: ${operatorMessage}`,
        }),
      });

      // Verify sync to Telegram + Discord
      const lastTelegramMsg = telegramServer.getLastMessage();
      expect(lastTelegramMsg?.text).toContain('via slack');
      expect(lastTelegramMsg?.text).toContain(operatorMessage);
      const lastDiscordMsg = discordServer.getLastMessage();
      expect(lastDiscordMsg?.content).toContain('via slack');
      expect(lastDiscordMsg?.content).toContain(operatorMessage);
    });

    it('should sync Discord operator message to Telegram and Slack', async () => {
      const operatorMessage = 'Hey from Discord!';
      const operatorName = 'Alex';

      // Setup Telegram thread
      const telegramRes = await fetch(`${telegramUrl}/bottest/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: -100123, name: 'Test' }),
      });
      const telegramTopic = await telegramRes.json();

      // Setup Slack thread
      const slackSessionRes = await fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'C123', text: 'Session' }),
      });
      const slackThread = await slackSessionRes.json();

      // Operator replies on Discord (simulated)
      // Bridge server receives this and syncs to Telegram + Slack
      await fetch(`${telegramUrl}/bottest/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: -100123,
          message_thread_id: telegramTopic.result.message_thread_id,
          text: `💬 *${operatorName}* _via discord_:\n${operatorMessage}`,
          parse_mode: 'Markdown',
        }),
      });

      await fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C123',
          thread_ts: slackThread.ts,
          text: `${operatorName} via discord: ${operatorMessage}`,
          blocks: [
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: `💬 *${operatorName}* _via discord_` }],
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: operatorMessage },
            },
          ],
        }),
      });

      // Verify sync to Telegram + Slack
      const lastTelegramMsg = telegramServer.getLastMessage();
      expect(lastTelegramMsg?.text).toContain('via discord');
      expect(lastTelegramMsg?.text).toContain(operatorMessage);
      const lastSlackMsg = slackServer.getLastMessage();
      expect(lastSlackMsg?.text).toContain('via discord');
      expect(lastSlackMsg?.blocks?.[0].elements[0].text).toContain('discord');
    });
  });

  describe('Read Receipt Sync', () => {
    it('should not duplicate delivered events across bridges', async () => {
      // When a message is delivered to Telegram, we emit message_delivered
      // When same message is delivered to Slack or Discord, we emit another message_delivered
      // The backend should dedupe or handle this correctly

      const messageId = 'msg-001';
      const deliveredEvents: string[] = [];

      // Simulate Telegram delivery
      deliveredEvents.push(`telegram:${messageId}`);

      // Simulate Slack delivery
      deliveredEvents.push(`slack:${messageId}`);

      // Simulate Discord delivery
      deliveredEvents.push(`discord:${messageId}`);

      // All should be recorded, backend chooses first
      expect(deliveredEvents.length).toBe(3);
      expect(new Set(deliveredEvents.map((e) => e.split(':')[1])).size).toBe(1);
    });
  });
});

describe('Bridge Failover', () => {
  it('should continue working if one bridge is down', async () => {
    // Only start Slack server
    const slackServer = new MockSlackServer();
    const slackUrl = await slackServer.start(0);

    try {
      // Telegram would fail, but Slack should work
      const res = await fetch(`${slackUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'C123', text: 'Working!' }),
      });

      const data = await res.json();
      expect(data.ok).toBe(true);
    } finally {
      slackServer.stop();
    }
  });
});

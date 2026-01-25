/**
 * Discord Bridge Integration Tests
 *
 * Tests the Discord bridge functionality using mock Discord API.
 * Covers: thread creation, message sending, reactions, embeds, webhooks, and Gateway events.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MockDiscordServer } from '../mocks/discord-api';

describe('Discord Bridge Integration', () => {
  let discordServer: MockDiscordServer;
  let discordUrl: string;

  beforeAll(async () => {
    discordServer = new MockDiscordServer();
    discordUrl = await discordServer.start(0);
  });

  afterAll(() => {
    discordServer.stop();
  });

  beforeEach(() => {
    discordServer.reset();
  });

  describe('Thread Creation (Forum Channel)', () => {
    it('should create a new thread for new session', async () => {
      const sessionId = 'session-discord-001';

      const res = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bot test-token'
        },
        body: JSON.stringify({
          name: `🟢 ${sessionId.slice(0, 8)}`,
          message: {
            content: 'New support session started',
            embeds: [{
              title: 'Session Info',
              color: 0x00ff00,
              fields: [
                { name: 'Session ID', value: sessionId, inline: true },
                { name: 'Platform', value: 'Web', inline: true },
              ],
            }],
          },
        }),
      });

      const data = await res.json();

      expect(res.ok).toBe(true);
      expect(data.id).toBeDefined();
      expect(data.name).toBe(`🟢 ${sessionId.slice(0, 8)}`);
      expect(discordServer.getThreads().length).toBe(1);
    });

    it('should create thread with applied tags', async () => {
      const res = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bot test-token'
        },
        body: JSON.stringify({
          name: 'Support Request',
          message: {
            content: 'New request',
          },
        }),
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.type).toBe(11); // Public thread
    });
  });

  describe('Message Sending', () => {
    it('should send visitor message to thread', async () => {
      // Create thread first
      const threadRes = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Thread',
          message: { content: 'Initial message' },
        }),
      });
      const thread = await threadRes.json();

      // Send visitor message
      const message = 'Hello, I need help with my order';
      const res = await fetch(`${discordUrl}/api/v10/channels/${thread.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `💬 **Visitor**:\n${message}`,
        }),
      });

      const data = await res.json();

      expect(res.ok).toBe(true);
      expect(data.content).toContain(message);
      expect(data.channel_id).toBe(thread.id);
    });

    it('should send message with embeds for rich content', async () => {
      const threadRes = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Rich Content Thread',
          message: { content: 'Starting' },
        }),
      });
      const thread = await threadRes.json();

      const res = await fetch(`${discordUrl}/api/v10/channels/${thread.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '',
          embeds: [{
            title: 'Order Details',
            color: 0x0099ff,
            fields: [
              { name: 'Order ID', value: '#12345', inline: true },
              { name: 'Status', value: 'Pending', inline: true },
              { name: 'Total', value: '$99.99', inline: true },
            ],
            footer: { text: 'PocketPing' },
            timestamp: new Date().toISOString(),
          }],
        }),
      });

      const data = await res.json();

      expect(res.ok).toBe(true);
      expect(data.embeds).toBeDefined();
      expect(data.embeds.length).toBe(1);
      expect(data.embeds[0].title).toBe('Order Details');
    });

    it('should handle message with reply reference', async () => {
      // Create thread and initial message
      const threadRes = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Reply Thread',
          message: { content: 'First message' },
        }),
      });
      const thread = await threadRes.json();

      // Get the initial message ID from sentMessages
      const initialMsgId = discordServer.getLastMessage()?.id;

      // Send reply
      const res = await fetch(`${discordUrl}/api/v10/channels/${thread.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'This is a reply',
          message_reference: {
            message_id: initialMsgId,
            channel_id: thread.id,
            guild_id: discordServer.getGuildId(),
          },
        }),
      });

      const data = await res.json();

      expect(res.ok).toBe(true);
      expect(data.message_reference?.message_id).toBe(initialMsgId);
    });
  });

  describe('Reactions', () => {
    it('should add reaction to mark message as read', async () => {
      // Create thread and message
      const threadRes = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Reaction Thread',
          message: { content: 'Message to react to' },
        }),
      });
      const thread = await threadRes.json();
      const messageId = discordServer.getLastMessage()?.id;

      // Add reaction
      const res = await fetch(
        `${discordUrl}/api/v10/channels/${thread.id}/messages/${messageId}/reactions/%E2%9C%85/@me`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' } }
      );

      expect(res.status).toBe(204);
      expect(discordServer.hasReaction(messageId!, '✅')).toBe(true);
    });

    it('should handle emoji reactions for read receipts', async () => {
      const threadRes = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Read Receipt Thread',
          message: { content: 'Test message' },
        }),
      });
      const thread = await threadRes.json();
      const messageId = discordServer.getLastMessage()?.id;

      // Add 👀 reaction for "seen"
      await fetch(
        `${discordUrl}/api/v10/channels/${thread.id}/messages/${messageId}/reactions/%F0%9F%91%80/@me`,
        { method: 'PUT' }
      );

      expect(discordServer.hasReaction(messageId!, '👀')).toBe(true);
    });
  });

  describe('Webhook Mode', () => {
    it('should send message via webhook', async () => {
      const webhookId = '888000000000000099';
      const webhookToken = 'test-webhook-token';

      const res = await fetch(`${discordUrl}/api/webhooks/${webhookId}/${webhookToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Message from webhook',
          username: 'PocketPing Bot',
          avatar_url: 'https://example.com/avatar.png',
        }),
      });

      const data = await res.json();

      expect(res.ok).toBe(true);
      expect(data.content).toBe('Message from webhook');
      expect(discordServer.webhookMessages.length).toBe(1);
    });

    it('should send webhook with embeds', async () => {
      const webhookId = '888000000000000099';
      const webhookToken = 'test-webhook-token';

      const res = await fetch(`${discordUrl}/api/webhooks/${webhookId}/${webhookToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'Support Bot',
          embeds: [{
            author: { name: 'Visitor - John' },
            description: 'Help needed with login',
            color: 0x5865f2,
          }],
        }),
      });

      const data = await res.json();

      expect(res.ok).toBe(true);
      expect(data.embeds).toBeDefined();
      expect(discordServer.webhookMessages[0].embeds).toBeDefined();
    });
  });

  describe('Gateway Events (Bot Mode)', () => {
    it('should receive operator message event', async () => {
      const receivedEvents: any[] = [];
      discordServer.onGatewayEvent((event) => {
        receivedEvents.push(event);
      });

      // Simulate operator sending a message
      discordServer.simulateOperatorMessage(
        '1100000000000000001',
        'Thanks for reaching out! How can I help?',
        'SupportAgent'
      );

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].t).toBe('MESSAGE_CREATE');
      expect(receivedEvents[0].d.content).toContain('How can I help');
      expect(receivedEvents[0].d.author.username).toBe('SupportAgent');
    });

    it('should receive reaction event for read receipt', async () => {
      const receivedEvents: any[] = [];
      discordServer.onGatewayEvent((event) => {
        receivedEvents.push(event);
      });

      // Simulate reaction
      discordServer.simulateReactionAdd(
        '1100000000000000001',
        '1000000000000000001',
        '✅'
      );

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].t).toBe('MESSAGE_REACTION_ADD');
      expect(receivedEvents[0].d.emoji.name).toBe('✅');
    });

    it('should filter bot messages in Gateway', () => {
      const receivedEvents: any[] = [];
      discordServer.onGatewayEvent((event) => {
        // Simulating bridge logic: filter out bot messages
        if (event.t === 'MESSAGE_CREATE' && !event.d.author.bot) {
          receivedEvents.push(event);
        }
      });

      // Bot message (should be filtered)
      discordServer.sentMessages.push({
        id: '1',
        channel_id: '1100000000000000001',
        content: 'Bot message',
        author: { id: '888000000000000001', username: 'PocketPing', discriminator: '0000', bot: true },
        timestamp: new Date().toISOString(),
      });

      // Operator message (should be received)
      discordServer.simulateOperatorMessage(
        '1100000000000000001',
        'Human operator message',
        'Operator'
      );

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].d.content).toBe('Human operator message');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message with only embeds', async () => {
      const threadRes = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Embeds Only',
          message: { content: '' },
        }),
      });
      const thread = await threadRes.json();

      const res = await fetch(`${discordUrl}/api/v10/channels/${thread.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '',
          embeds: [{ description: 'Embed content only' }],
        }),
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.content).toBe('');
      expect(data.embeds?.[0]?.description).toBe('Embed content only');
    });

    it('should handle special characters in message', async () => {
      const threadRes = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Special Chars',
          message: { content: 'Test' },
        }),
      });
      const thread = await threadRes.json();

      const specialMessage = '**Bold** _italic_ `code` <@123> #channel @everyone 🎉 émojis café';
      const res = await fetch(`${discordUrl}/api/v10/channels/${thread.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: specialMessage }),
      });

      const data = await res.json();
      expect(data.content).toBe(specialMessage);
    });

    it('should handle long messages', async () => {
      const threadRes = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Long Message',
          message: { content: 'Test' },
        }),
      });
      const thread = await threadRes.json();

      // Discord has 2000 char limit, testing handling of long content
      const longMessage = 'A'.repeat(1500);
      const res = await fetch(`${discordUrl}/api/v10/channels/${thread.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: longMessage }),
      });

      const data = await res.json();
      expect(data.content.length).toBe(1500);
    });

    it('should handle concurrent message sends', async () => {
      const threadRes = await fetch(`${discordUrl}/api/v10/channels/${discordServer.getForumChannelId()}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Concurrent',
          message: { content: 'Test' },
        }),
      });
      const thread = await threadRes.json();

      // Send multiple messages concurrently
      const promises = Array.from({ length: 5 }, (_, i) =>
        fetch(`${discordUrl}/api/v10/channels/${thread.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `Message ${i + 1}` }),
        })
      );

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach((res) => expect(res.ok).toBe(true));

      // All messages should be unique
      const channelMessages = discordServer.getChannelMessages(thread.id);
      const messageContents = channelMessages.map((m) => m.content);
      const uniqueContents = new Set(messageContents);
      expect(uniqueContents.size).toBe(6); // 1 initial + 5 concurrent
    });
  });
});

describe('Discord API Compatibility', () => {
  let discordServer: MockDiscordServer;
  let discordUrl: string;

  beforeAll(async () => {
    discordServer = new MockDiscordServer();
    discordUrl = await discordServer.start(0);
  });

  afterAll(() => {
    discordServer.stop();
  });

  it('should return correct gateway URL', async () => {
    const res = await fetch(`${discordUrl}/api/v10/gateway/bot`, {
      headers: { 'Authorization': 'Bot test-token' },
    });

    const data = await res.json();

    expect(data.url).toBe('wss://gateway.discord.gg');
    expect(data.shards).toBe(1);
    expect(data.session_start_limit).toBeDefined();
  });

  it('should return current user info', async () => {
    const res = await fetch(`${discordUrl}/api/v10/users/@me`, {
      headers: { 'Authorization': 'Bot test-token' },
    });

    const data = await res.json();

    expect(data.bot).toBe(true);
    expect(data.username).toBe('PocketPing');
  });

  it('should return guild member info', async () => {
    const guildId = discordServer.getGuildId();
    const res = await fetch(`${discordUrl}/api/v10/guilds/${guildId}/members/999000000000000001`, {
      headers: { 'Authorization': 'Bot test-token' },
    });

    const data = await res.json();

    expect(data.user).toBeDefined();
    expect(data.user.id).toBe('999000000000000001');
  });
});

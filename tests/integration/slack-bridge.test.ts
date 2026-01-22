/**
 * Integration tests for Slack Bridge
 *
 * Uses MockSlackServer to test the full flow without hitting real Slack API.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MockSlackServer } from '../mocks/slack-api';

describe('Slack Bridge Integration', () => {
  let mockServer: MockSlackServer;
  let serverUrl: string;

  beforeAll(async () => {
    mockServer = new MockSlackServer();
    serverUrl = await mockServer.start(0);
    console.log(`Mock Slack server started at ${serverUrl}`);
  });

  afterAll(() => {
    mockServer.stop();
  });

  beforeEach(() => {
    mockServer.reset();
  });

  describe('Session Creation', () => {
    it('should post new session notification', async () => {
      const response = await fetch(`${serverUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C12345678',
          text: 'New visitor - Session: abc12345...',
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: '🆕 New Conversation' },
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: '*Session*\n`abc12345...`' },
                { type: 'mrkdwn', text: '*Page*\nhttps://example.com' },
              ],
            },
          ],
        }),
      });

      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.ts).toBeDefined();
      expect(mockServer.postedMessages.length).toBe(1);
      expect(mockServer.postedMessages[0].text).toContain('New visitor');
    });

    it('should include all metadata in session notification', async () => {
      await fetch(`${serverUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C12345678',
          text: 'New visitor with full metadata',
          blocks: [
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: '*Device*\ndesktop • Chrome • macOS' },
                { type: 'mrkdwn', text: '*Location*\nParis, France' },
                { type: 'mrkdwn', text: '*IP*\n`192.168.1.1`' },
              ],
            },
          ],
        }),
      });

      const lastMsg = mockServer.getLastMessage();
      expect(lastMsg?.blocks).toBeDefined();
      expect(lastMsg?.blocks?.[0].fields.length).toBe(3);
    });
  });

  describe('Thread Messages', () => {
    it('should post visitor message in thread', async () => {
      // First create the thread (session notification)
      const sessionRes = await fetch(`${serverUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C12345678',
          text: 'New session',
        }),
      });
      const session = await sessionRes.json();
      const threadTs = session.ts;

      // Post visitor message in thread
      await fetch(`${serverUrl}/api/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C12345678',
          thread_ts: threadTs,
          text: 'Hello, I need help!',
        }),
      });

      const threadMessages = mockServer.getThreadMessages(threadTs);
      expect(threadMessages.length).toBe(2);
      expect(threadMessages[1].thread_ts).toBe(threadTs);
    });
  });

  describe('Operator Responses', () => {
    it('should handle operator message in thread', async () => {
      const threadTs = '1234567890.000000';
      const events: any[] = [];

      mockServer.onSocketModeEvent((event) => {
        events.push(event);
      });

      // Simulate operator message
      mockServer.simulateOperatorMessage('C12345678', threadTs, 'Hi, how can I help?');

      expect(events.length).toBe(1);
      expect(events[0].body.event.type).toBe('message');
      expect(events[0].body.event.text).toBe('Hi, how can I help?');
      expect(events[0].body.event.thread_ts).toBe(threadTs);
    });
  });

  describe('Commands via Mention', () => {
    it('should handle @PocketPing read command', async () => {
      const events: any[] = [];
      mockServer.onSocketModeEvent((event) => events.push(event));

      mockServer.simulateOperatorMessage(
        'C12345678',
        '1234567890.000000',
        '<@U0AAHFTEH32> read'
      );

      expect(events.length).toBe(1);
      expect(events[0].body.event.text).toContain('read');
    });

    it('should handle @PocketPing status command', async () => {
      const events: any[] = [];
      mockServer.onSocketModeEvent((event) => events.push(event));

      mockServer.simulateAppMention('C12345678', '<@U0AAHFTEH32> status');

      expect(events.length).toBe(1);
      expect(events[0].body.event.type).toBe('app_mention');
    });
  });

  describe('Read Receipts', () => {
    it('should add reaction for delivered status', async () => {
      await fetch(`${serverUrl}/api/reactions.add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'C12345678',
          timestamp: '1234567890.000000',
          name: 'ballot_box_with_check',
        }),
      });

      expect(mockServer.addedReactions.length).toBe(1);
      expect(mockServer.hasReaction('1234567890.000000', 'ballot_box_with_check')).toBe(true);
    });

    it('should handle reaction-based read receipt', async () => {
      const events: any[] = [];
      mockServer.onSocketModeEvent((event) => events.push(event));

      mockServer.simulateReactionAdded('C12345678', '1234567890.000000', 'eyes');

      expect(events.length).toBe(1);
      expect(events[0].body.event.type).toBe('reaction_added');
      expect(events[0].body.event.reaction).toBe('eyes');
    });
  });

  describe('User Info', () => {
    it('should fetch operator name', async () => {
      const response = await fetch(`${serverUrl}/api/users.info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: 'U12345678' }),
      });

      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.user.real_name).toBe('Test User');
    });
  });
});

describe('Slack Bridge - Full Message Flow', () => {
  let mockServer: MockSlackServer;
  let serverUrl: string;

  beforeAll(async () => {
    mockServer = new MockSlackServer();
    serverUrl = await mockServer.start(0);
  });

  afterAll(() => {
    mockServer.stop();
  });

  beforeEach(() => {
    mockServer.reset();
  });

  it('should complete visitor -> operator -> widget flow', async () => {
    const events: any[] = [];
    mockServer.onSocketModeEvent((event) => events.push(event));

    // 1. New session notification
    const sessionRes = await fetch(`${serverUrl}/api/chat.postMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'C12345678',
        text: 'New visitor',
      }),
    });
    const session = await sessionRes.json();
    const threadTs = session.ts;

    // 2. Visitor sends message
    const visitorMsgRes = await fetch(`${serverUrl}/api/chat.postMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'C12345678',
        thread_ts: threadTs,
        text: 'Hello!',
      }),
    });
    const visitorMsg = await visitorMsgRes.json();

    // 3. Operator replies
    mockServer.simulateOperatorMessage('C12345678', threadTs, 'Hi, how can I help?');

    // 4. Operator reacts (read receipt)
    mockServer.simulateReactionAdded('C12345678', visitorMsg.ts, 'eyes');

    // Verify flow
    expect(mockServer.postedMessages.length).toBe(2); // session + visitor message
    expect(events.length).toBe(2); // operator message + reaction

    // Verify operator message event
    expect(events[0].body.event.type).toBe('message');
    expect(events[0].body.event.thread_ts).toBe(threadTs);

    // Verify read receipt event
    expect(events[1].body.event.type).toBe('reaction_added');
  });
});

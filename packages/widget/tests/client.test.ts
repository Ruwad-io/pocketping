import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PocketPingClient } from '../src/client';
import { MockWebSocket, localStorageMock } from './setup';

describe('PocketPingClient', () => {
  let client: PocketPingClient;

  const mockConfig = {
    endpoint: 'http://localhost:8000/pocketping',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.reset();
    localStorageMock.clear();
    client = new PocketPingClient(mockConfig);
  });

  afterEach(() => {
    client.disconnect();
  });

  describe('constructor', () => {
    it('should create client with config', () => {
      expect(client).toBeDefined();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('connect', () => {
    it('should connect and create session', async () => {
      const mockResponse = {
        sessionId: 'session-123',
        visitorId: 'visitor-456',
        operatorOnline: true,
        messages: [],
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const session = await client.connect();

      expect(session.sessionId).toBe('session-123');
      expect(session.visitorId).toBe('visitor-456');
      expect(session.operatorOnline).toBe(true);
      expect(client.isConnected()).toBe(true);
    });

    it('should store session in localStorage', async () => {
      const mockResponse = {
        sessionId: 'session-123',
        visitorId: 'visitor-456',
        operatorOnline: false,
        messages: [],
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await client.connect();

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'pocketping_session_id',
        'session-123'
      );
    });

    it('should reuse existing session ID', async () => {
      // Mock getItem to return visitor ID first, then session ID
      localStorageMock.getItem
        .mockReturnValueOnce('existing-visitor') // for getOrCreateVisitorId
        .mockReturnValueOnce('existing-session'); // for getStoredSessionId

      const mockResponse = {
        sessionId: 'existing-session',
        visitorId: 'visitor-456',
        operatorOnline: false,
        messages: [{ id: 'msg-1', content: 'Previous message' }],
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await client.connect();

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.sessionId).toBe('existing-session');
    });

    it('should connect WebSocket after HTTP connect', async () => {
      const mockResponse = {
        sessionId: 'session-123',
        visitorId: 'visitor-456',
        operatorOnline: false,
        messages: [],
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await client.connect();

      // Wait for WebSocket to be created
      await new Promise((r) => setTimeout(r, 10));

      expect(MockWebSocket.instances.length).toBe(1);
      expect(MockWebSocket.instances[0].url).toContain('session-123');
    });
  });

  describe('sendMessage', () => {
    beforeEach(async () => {
      const mockResponse = {
        sessionId: 'session-123',
        visitorId: 'visitor-456',
        operatorOnline: false,
        messages: [],
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await client.connect();
    });

    it('should send message and update status', async () => {
      const mockMessageResponse = {
        messageId: 'msg-123',
        timestamp: new Date().toISOString(),
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMessageResponse),
      });

      const message = await client.sendMessage('Hello!');

      expect(message.content).toBe('Hello!');
      expect(message.sender).toBe('visitor');
      expect(message.status).toBe('sent');
    });

    it('should emit message event with sending status first', async () => {
      const mockMessageResponse = {
        messageId: 'msg-123',
        timestamp: new Date().toISOString(),
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMessageResponse),
      });

      // Capture snapshots of status at each emit
      const statuses: string[] = [];
      client.on('message', (msg: any) => statuses.push(msg.status));

      await client.sendMessage('Hello!');

      // Two events emitted: first with 'sending', then with 'sent'
      expect(statuses.length).toBe(2);
      expect(statuses[0]).toBe('sending');
      expect(statuses[1]).toBe('sent');
    });

    it('should throw if not connected', async () => {
      const disconnectedClient = new PocketPingClient(mockConfig);
      await expect(disconnectedClient.sendMessage('Hello')).rejects.toThrow(
        'Not connected'
      );
    });

    it('should remove failed message from local state', async () => {
      (globalThis.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const messagesBefore = client.getMessages().length;

      await expect(client.sendMessage('Hello!')).rejects.toThrow();

      const messagesAfter = client.getMessages().length;
      expect(messagesAfter).toBe(messagesBefore);
    });
  });

  describe('WebSocket events', () => {
    beforeEach(async () => {
      const mockResponse = {
        sessionId: 'session-123',
        visitorId: 'visitor-456',
        operatorOnline: false,
        messages: [],
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await client.connect();
      await new Promise((r) => setTimeout(r, 10));
    });

    it('should handle incoming message event', async () => {
      const events: any[] = [];
      client.on('message', (msg) => events.push(msg));

      const ws = MockWebSocket.instances[0];
      ws.simulateMessage({
        type: 'message',
        data: {
          id: 'msg-from-operator',
          content: 'Hello from operator!',
          sender: 'operator',
          timestamp: new Date().toISOString(),
        },
      });

      expect(events.length).toBe(1);
      expect(events[0].content).toBe('Hello from operator!');
      expect(client.getMessages()).toContainEqual(
        expect.objectContaining({ id: 'msg-from-operator' })
      );
    });

    it('should handle typing event', async () => {
      const events: any[] = [];
      client.on('typing', (data) => events.push(data));

      const ws = MockWebSocket.instances[0];
      ws.simulateMessage({
        type: 'typing',
        data: { isTyping: true, sender: 'operator' },
      });

      expect(events.length).toBe(1);
      expect(events[0].isTyping).toBe(true);
    });

    it('should handle presence event', async () => {
      const events: any[] = [];
      client.on('presence', (data) => events.push(data));

      const ws = MockWebSocket.instances[0];
      ws.simulateMessage({
        type: 'presence',
        data: { online: true },
      });

      expect(events.length).toBe(1);
      expect(events[0].online).toBe(true);
      expect(client.getSession()?.operatorOnline).toBe(true);
    });

    it('should handle read event and update message status', async () => {
      // Add a message first
      const mockMessageResponse = {
        messageId: 'msg-123',
        timestamp: new Date().toISOString(),
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMessageResponse),
      });

      await client.sendMessage('Hello!');

      // Simulate read event from WebSocket
      const ws = MockWebSocket.instances[0];
      ws.simulateMessage({
        type: 'read',
        data: {
          messageIds: ['msg-123'],
          status: 'delivered',
        },
      });

      const message = client.getMessages().find((m) => m.id === 'msg-123');
      expect(message?.status).toBe('delivered');
    });
  });

  describe('sendReadStatus', () => {
    beforeEach(async () => {
      const mockResponse = {
        sessionId: 'session-123',
        visitorId: 'visitor-456',
        operatorOnline: false,
        messages: [
          {
            id: 'operator-msg-1',
            content: 'Hello visitor',
            sender: 'operator',
            status: 'sent',
          },
        ],
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await client.connect();
    });

    it('should send read status for operator messages', async () => {
      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await client.sendReadStatus(['operator-msg-1'], 'read');

      const fetchCall = (globalThis.fetch as any).mock.calls[1];
      expect(fetchCall[0]).toContain('/read');
      const body = JSON.parse(fetchCall[1].body);
      expect(body.messageIds).toContain('operator-msg-1');
      expect(body.status).toBe('read');
    });
  });

  describe('event subscription', () => {
    it('should subscribe and unsubscribe to events', () => {
      const callback = vi.fn();
      const unsubscribe = client.on('test', callback);

      // Manually emit (using private method for testing)
      (client as any).emit('test', { data: 'test' });

      expect(callback).toHaveBeenCalledWith({ data: 'test' });

      unsubscribe();

      (client as any).emit('test', { data: 'test2' });

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('widget state', () => {
    it('should track open/close state', () => {
      expect(client.isWidgetOpen()).toBe(false);

      client.setOpen(true);
      expect(client.isWidgetOpen()).toBe(true);

      client.toggleOpen();
      expect(client.isWidgetOpen()).toBe(false);
    });

    it('should emit openChange event', () => {
      const callback = vi.fn();
      client.on('openChange', callback);

      client.setOpen(true);

      expect(callback).toHaveBeenCalledWith(true);
    });
  });
});

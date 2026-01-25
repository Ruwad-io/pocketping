import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PocketPingClient } from '../src/client';

/**
 * =====================================================================================
 * IMPORTANT: DO NOT REMOVE THIS COMMENT OR CHANGE HOW MOCKS ARE ACCESSED!
 * =====================================================================================
 *
 * Why we access mocks from globalThis instead of importing from './setup':
 *
 * There is a known issue with esbuild/vitest where importing a class from a setupFile
 * creates DUPLICATE class instances. This happens because:
 *
 * 1. Vitest runs setup.ts as a setupFile (first execution)
 * 2. When tests import from './setup', the module is processed AGAIN (second execution)
 * 3. esbuild may use different import paths internally, creating two separate class definitions
 * 4. Static properties set on one class copy don't exist on the other
 *
 * Symptoms of this bug:
 * - MockWebSocket.OPEN is undefined even though it's set in setup.ts
 * - globalThis.WebSocket === MockWebSocket is true, but WebSocket.OPEN is undefined
 * - Tests fail with "Cannot trigger event: WebSocket not connected"
 *
 * The fix is to access mocks from globalThis, which is set in the setupFile and
 * remains consistent across the test runtime.
 *
 * References:
 * - https://vcfvct.wordpress.com/2021/12/05/inconsistent-static-field-in-typescript-with-bundler/
 * - https://github.com/evanw/esbuild/issues/2195
 * - https://github.com/vitest-dev/vitest/issues/3328
 *
 * =====================================================================================
 */
const MockWebSocket = globalThis.WebSocket as any;
const MockEventSource = globalThis.EventSource as any;
const localStorageMock = globalThis.localStorage as any;

describe('PocketPingClient', () => {
  let client: PocketPingClient;

  const mockConfig = {
    endpoint: 'http://localhost:8000/pocketping',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.reset();
    MockEventSource.reset();
    localStorageMock.clear();

    // WebSocket constants are defined in setup.ts
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
        headers: new Headers(),
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
        headers: new Headers(),
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
        headers: new Headers(),
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
        headers: new Headers(),
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
        headers: new Headers(),
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
        headers: new Headers(),
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
        headers: new Headers(),
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

  describe('editMessage', () => {
    beforeEach(async () => {
      const mockResponse = {
        sessionId: 'session-123',
        visitorId: 'visitor-456',
        operatorOnline: false,
        messages: [
          { id: 'msg-1', content: 'Original', sender: 'visitor', timestamp: new Date().toISOString() },
        ],
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
        headers: new Headers(),
      });

      await client.connect();
    });

    it('should send PATCH request with sessionId in body', async () => {
      const mockEditResponse = {
        message: {
          id: 'msg-1',
          content: 'Edited content',
          editedAt: new Date().toISOString(),
        },
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEditResponse),
        headers: new Headers(),
      });

      await client.editMessage('msg-1', 'Edited content');

      // Verify PATCH request
      const calls = (globalThis.fetch as any).mock.calls;
      const editCall = calls.find(
        (call: [string, RequestInit]) =>
          call[0].includes('/message/msg-1') && call[1]?.method === 'PATCH'
      );
      expect(editCall).toBeDefined();

      // Verify sessionId is in body (not query params for PATCH)
      const body = JSON.parse(editCall[1].body);
      expect(body.sessionId).toBe('session-123');
      expect(body.content).toBe('Edited content');
    });

    it('should throw if not connected', async () => {
      const disconnectedClient = new PocketPingClient(mockConfig);
      await expect(disconnectedClient.editMessage('msg-1', 'New content')).rejects.toThrow(
        'Not connected'
      );
    });
  });

  describe('deleteMessage', () => {
    beforeEach(async () => {
      const mockResponse = {
        sessionId: 'session-123',
        visitorId: 'visitor-456',
        operatorOnline: false,
        messages: [
          { id: 'msg-1', content: 'To delete', sender: 'visitor', timestamp: new Date().toISOString() },
        ],
      };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
        headers: new Headers(),
      });

      await client.connect();
    });

    it('should send DELETE request with sessionId in query params (not body)', async () => {
      const mockDeleteResponse = { deleted: true };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDeleteResponse),
        headers: new Headers(),
      });

      await client.deleteMessage('msg-1');

      // Verify DELETE request
      const calls = (globalThis.fetch as any).mock.calls;
      const deleteCall = calls.find(
        (call: [string, RequestInit]) =>
          call[0].includes('/message/msg-1') && call[1]?.method === 'DELETE'
      );
      expect(deleteCall).toBeDefined();

      // CRITICAL: sessionId MUST be in query params, NOT in body
      // The API expects: DELETE /message/[id]?sessionId=xxx
      // NOT: DELETE /message/[id] with body: { sessionId: xxx }
      expect(deleteCall[0]).toContain('sessionId=session-123');
    });

    it('should update local message state on successful delete', async () => {
      const mockDeleteResponse = { deleted: true };

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDeleteResponse),
        headers: new Headers(),
      });

      await client.deleteMessage('msg-1');

      // Local message should be marked as deleted
      const messages = client.getMessages();
      const deletedMsg = messages.find((m) => m.id === 'msg-1');
      expect(deletedMsg?.deletedAt).toBeDefined();
      expect(deletedMsg?.content).toBe('');
    });

    it('should throw if not connected', async () => {
      const disconnectedClient = new PocketPingClient(mockConfig);
      await expect(disconnectedClient.deleteMessage('msg-1')).rejects.toThrow(
        'Not connected'
      );
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
        headers: new Headers(),
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
        headers: new Headers(),
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
        headers: new Headers(),
      });

      await client.connect();
    });

    it('should send read status for operator messages', async () => {
      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
        headers: new Headers(),
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

  describe('Custom Events', () => {
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
        headers: new Headers(),
      });

      await client.connect();

      // Wait for WebSocket to be fully connected
      await new Promise<void>((resolve) => {
        const ws = MockWebSocket.instances[0];
        if (ws?.readyState === 1) {
          resolve();
        } else {
          // Wait for onopen to fire
          setTimeout(resolve, 20);
        }
      });
    });

    describe('trigger()', () => {
      it('should send event via WebSocket', () => {
        client.trigger('clicked_pricing', { plan: 'pro' });

        const ws = MockWebSocket.instances[0];

        expect(ws.send).toHaveBeenCalled();

        const sentData = JSON.parse(ws.send.mock.calls[0][0]);
        expect(sentData.type).toBe('event');
        expect(sentData.data.name).toBe('clicked_pricing');
        expect(sentData.data.data).toEqual({ plan: 'pro' });
        expect(sentData.data.timestamp).toBeDefined();
      });

      it('should trigger without data payload', () => {
        client.trigger('page_view');

        const ws = MockWebSocket.instances[0];
        const sentData = JSON.parse(ws.send.mock.calls[0][0]);
        expect(sentData.data.name).toBe('page_view');
        expect(sentData.data.data).toBeUndefined();
      });

      it('should emit local event:name event', () => {
        const callback = vi.fn();
        client.on('event:clicked_cta', callback);

        client.trigger('clicked_cta', { button: 'signup' });

        expect(callback).toHaveBeenCalled();
        expect(callback.mock.calls[0][0].name).toBe('clicked_cta');
      });

      it('should warn when WebSocket is not connected', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const disconnectedClient = new PocketPingClient(mockConfig);

        disconnectedClient.trigger('test_event');

        expect(warnSpy).toHaveBeenCalledWith(
          '[PocketPing] Cannot trigger event: WebSocket not connected'
        );
        warnSpy.mockRestore();
      });
    });

    describe('onEvent()', () => {
      it('should subscribe to custom event', () => {
        const handler = vi.fn();
        client.onEvent('show_offer', handler);

        // Simulate receiving event from WebSocket
        const ws = MockWebSocket.instances[0];
        ws.simulateMessage({
          type: 'event',
          data: {
            name: 'show_offer',
            data: { discount: 20 },
            timestamp: new Date().toISOString(),
          },
        });

        expect(handler).toHaveBeenCalledWith(
          { discount: 20 },
          expect.objectContaining({ name: 'show_offer' })
        );
      });

      it('should return unsubscribe function', () => {
        const handler = vi.fn();
        const unsubscribe = client.onEvent('promo', handler);

        unsubscribe();

        const ws = MockWebSocket.instances[0];
        ws.simulateMessage({
          type: 'event',
          data: {
            name: 'promo',
            data: { code: 'SAVE10' },
            timestamp: new Date().toISOString(),
          },
        });

        expect(handler).not.toHaveBeenCalled();
      });

      it('should handle multiple handlers for same event', () => {
        const handler1 = vi.fn();
        const handler2 = vi.fn();

        client.onEvent('notification', handler1);
        client.onEvent('notification', handler2);

        const ws = MockWebSocket.instances[0];
        ws.simulateMessage({
          type: 'event',
          data: {
            name: 'notification',
            data: { message: 'Hello' },
            timestamp: new Date().toISOString(),
          },
        });

        expect(handler1).toHaveBeenCalled();
        expect(handler2).toHaveBeenCalled();
      });

      it('should only trigger handler for matching event name', () => {
        const handler = vi.fn();
        client.onEvent('event_a', handler);

        const ws = MockWebSocket.instances[0];
        ws.simulateMessage({
          type: 'event',
          data: {
            name: 'event_b',
            data: {},
            timestamp: new Date().toISOString(),
          },
        });

        expect(handler).not.toHaveBeenCalled();
      });
    });

    describe('offEvent()', () => {
      it('should unsubscribe handler from event', () => {
        const handler = vi.fn();
        client.onEvent('alert', handler);

        client.offEvent('alert', handler);

        const ws = MockWebSocket.instances[0];
        ws.simulateMessage({
          type: 'event',
          data: {
            name: 'alert',
            data: {},
            timestamp: new Date().toISOString(),
          },
        });

        expect(handler).not.toHaveBeenCalled();
      });

      it('should only remove specific handler', () => {
        const handler1 = vi.fn();
        const handler2 = vi.fn();

        client.onEvent('update', handler1);
        client.onEvent('update', handler2);
        client.offEvent('update', handler1);

        const ws = MockWebSocket.instances[0];
        ws.simulateMessage({
          type: 'event',
          data: {
            name: 'update',
            data: {},
            timestamp: new Date().toISOString(),
          },
        });

        expect(handler1).not.toHaveBeenCalled();
        expect(handler2).toHaveBeenCalled();
      });
    });

    describe('WebSocket event handling', () => {
      it('should emit generic event on any custom event', () => {
        const genericHandler = vi.fn();
        client.on('event', genericHandler);

        const ws = MockWebSocket.instances[0];
        ws.simulateMessage({
          type: 'event',
          data: {
            name: 'any_event',
            data: { foo: 'bar' },
            timestamp: new Date().toISOString(),
          },
        });

        expect(genericHandler).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'any_event' })
        );
      });

      it('should handle event without data payload', () => {
        const handler = vi.fn();
        client.onEvent('ping', handler);

        const ws = MockWebSocket.instances[0];
        ws.simulateMessage({
          type: 'event',
          data: {
            name: 'ping',
            timestamp: new Date().toISOString(),
          },
        });

        expect(handler).toHaveBeenCalledWith(
          undefined,
          expect.objectContaining({ name: 'ping' })
        );
      });
    });
  });

  describe('Tracked Elements', () => {
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
        headers: new Headers(),
      });

      await client.connect();

      // Wait for WebSocket to be fully connected
      await new Promise<void>((resolve) => {
        const ws = MockWebSocket.instances[0];
        if (ws?.readyState === 1) {
          resolve();
        } else {
          setTimeout(resolve, 20);
        }
      });
    });

    describe('setupTrackedElements()', () => {
      it('should setup event listeners for tracked elements', () => {
        const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

        client.setupTrackedElements([
          { selector: '#cta-btn', name: 'clicked_cta', event: 'click' },
          { selector: '.pricing-card', name: 'viewed_pricing', event: 'mouseenter' },
        ]);

        expect(addEventListenerSpy).toHaveBeenCalledTimes(2);
        expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function), true);
        expect(addEventListenerSpy).toHaveBeenCalledWith('mouseenter', expect.any(Function), true);

        addEventListenerSpy.mockRestore();
      });

      it('should default to click event', () => {
        const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

        client.setupTrackedElements([
          { selector: '#btn', name: 'clicked_btn' },
        ]);

        expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function), true);

        addEventListenerSpy.mockRestore();
      });

      it('should cleanup previous tracked elements before setting new ones', () => {
        const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

        client.setupTrackedElements([
          { selector: '#first', name: 'first_click' },
        ]);

        // Setup new tracked elements (should cleanup old ones first)
        client.setupTrackedElements([
          { selector: '#second', name: 'second_click' },
        ]);

        expect(removeEventListenerSpy).toHaveBeenCalled();

        removeEventListenerSpy.mockRestore();
      });

      it('should include widgetMessage in trigger options', () => {
        // Setup tracked elements with widgetMessage
        client.setupTrackedElements([
          {
            selector: '#help-btn',
            name: 'clicked_help',
            widgetMessage: 'Need assistance?',
          },
        ]);

        // Verify the tracked elements include the widgetMessage
        const elements = client.getTrackedElements();
        expect(elements[0].widgetMessage).toBe('Need assistance?');
      });
    });

    describe('getTrackedElements()', () => {
      it('should return current tracked elements', () => {
        const elements = [
          { selector: '#btn', name: 'clicked_btn' },
          { selector: '.card', name: 'clicked_card' },
        ];

        client.setupTrackedElements(elements);

        const result = client.getTrackedElements();
        expect(result).toEqual(elements);
      });

      it('should return empty array when no tracked elements', () => {
        expect(client.getTrackedElements()).toEqual([]);
      });

      it('should return a copy of tracked elements', () => {
        const elements = [{ selector: '#btn', name: 'clicked_btn' }];
        client.setupTrackedElements(elements);

        const result = client.getTrackedElements();
        result.push({ selector: '#new', name: 'new_click' });

        expect(client.getTrackedElements().length).toBe(1);
      });
    });

    describe('config_update WebSocket event', () => {
      it('should hot-reload tracked elements from WebSocket', () => {
        const setupSpy = vi.spyOn(client, 'setupTrackedElements');

        const ws = MockWebSocket.instances[0];
        ws.simulateMessage({
          type: 'config_update',
          data: {
            trackedElements: [
              { selector: '#new-btn', name: 'new_click' },
            ],
          },
        });

        expect(setupSpy).toHaveBeenCalledWith([
          { selector: '#new-btn', name: 'new_click' },
        ]);

        setupSpy.mockRestore();
      });

      it('should emit configUpdate event', () => {
        const configUpdateSpy = vi.fn();
        client.on('configUpdate', configUpdateSpy);

        const ws = MockWebSocket.instances[0];
        ws.simulateMessage({
          type: 'config_update',
          data: {
            trackedElements: [{ selector: '#btn', name: 'click' }],
          },
        });

        expect(configUpdateSpy).toHaveBeenCalledWith({
          trackedElements: [{ selector: '#btn', name: 'click' }],
        });
      });
    });

    describe('connect() with trackedElements', () => {
      it('should setup tracked elements from connect response', async () => {
        // Create a new client for this test
        const newClient = new PocketPingClient(mockConfig);
        const setupSpy = vi.spyOn(newClient, 'setupTrackedElements');

        const mockResponse = {
          sessionId: 'session-999',
          visitorId: 'visitor-999',
          operatorOnline: false,
          messages: [],
          trackedElements: [
            { selector: '#from-backend', name: 'backend_click' },
          ],
        };

        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockResponse),
          headers: new Headers(),
        });

        await newClient.connect();

        expect(setupSpy).toHaveBeenCalledWith([
          { selector: '#from-backend', name: 'backend_click' },
        ]);

        newClient.disconnect();
        setupSpy.mockRestore();
      });
    });

    describe('disconnect() cleanup', () => {
      it('should cleanup tracked elements on disconnect', () => {
        const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

        client.setupTrackedElements([
          { selector: '#btn', name: 'click' },
        ]);

        client.disconnect();

        expect(removeEventListenerSpy).toHaveBeenCalled();

        removeEventListenerSpy.mockRestore();
      });
    });
  });

  describe('trigger() with options', () => {
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
        headers: new Headers(),
      });

      await client.connect();

      // Wait for WebSocket to be fully connected
      await new Promise<void>((resolve) => {
        const ws = MockWebSocket.instances[0];
        if (ws?.readyState === 1) {
          resolve();
        } else {
          setTimeout(resolve, 20);
        }
      });
    });

    it('should open widget when widgetMessage is provided', () => {
      const openChangeSpy = vi.fn();
      client.on('openChange', openChangeSpy);

      client.trigger('clicked_pricing', { plan: 'pro' }, { widgetMessage: 'Need help?' });

      expect(openChangeSpy).toHaveBeenCalledWith(true);
    });

    it('should emit triggerMessage event with widgetMessage', () => {
      const triggerMessageSpy = vi.fn();
      client.on('triggerMessage', triggerMessageSpy);

      client.trigger('clicked_pricing', { plan: 'pro' }, { widgetMessage: 'Need help choosing a plan?' });

      expect(triggerMessageSpy).toHaveBeenCalledWith({
        message: 'Need help choosing a plan?',
        eventName: 'clicked_pricing',
      });
    });

    it('should not open widget when widgetMessage is not provided', () => {
      const openChangeSpy = vi.fn();
      client.on('openChange', openChangeSpy);

      client.trigger('silent_event', { data: 'test' });

      expect(openChangeSpy).not.toHaveBeenCalled();
    });

    it('should not open widget when options is undefined', () => {
      const openChangeSpy = vi.fn();
      client.on('openChange', openChangeSpy);

      client.trigger('silent_event', { data: 'test' }, undefined);

      expect(openChangeSpy).not.toHaveBeenCalled();
    });
  });

  describe('User Identity', () => {
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
        headers: new Headers(),
      });

      await client.connect();
    });

    describe('identify()', () => {
      it('should send identify request to backend', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
          headers: new Headers(),
        });

        await client.identify({
          id: 'user_123',
          email: 'john@example.com',
          name: 'John Doe',
        });

        const fetchCalls = (globalThis.fetch as any).mock.calls;
        const identifyCall = fetchCalls.find((c: any[]) => c[0].includes('/identify'));
        expect(identifyCall).toBeDefined();

        const body = JSON.parse(identifyCall[1].body);
        expect(body.sessionId).toBe('session-123');
        expect(body.identity.id).toBe('user_123');
      });

      it('should update session identity', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
          headers: new Headers(),
        });

        await client.identify({
          id: 'user_123',
          email: 'john@example.com',
        });

        const session = client.getSession();
        expect(session?.identity).toEqual({
          id: 'user_123',
          email: 'john@example.com',
        });
      });

      it('should throw if id is missing', async () => {
        await expect(
          client.identify({ id: '' } as any)
        ).rejects.toThrow('identity.id is required');
      });
    });

    describe('reset()', () => {
      it('should clear identity from localStorage', async () => {
        await client.reset();

        expect(localStorageMock.removeItem).toHaveBeenCalledWith(
          'pocketping_user_identity'
        );
      });

      it('should emit reset event', async () => {
        const callback = vi.fn();
        client.on('reset', callback);

        await client.reset();

        expect(callback).toHaveBeenCalled();
      });
    });

    describe('getIdentity()', () => {
      it('should return null when no identity', () => {
        const identity = client.getIdentity();
        expect(identity).toBeNull();
      });

      it('should return session identity after identify', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
          headers: new Headers(),
        });

        await client.identify({
          id: 'user_123',
          name: 'John Doe',
        });

        const identity = client.getIdentity();
        expect(identity).toEqual({
          id: 'user_123',
          name: 'John Doe',
        });
      });
    });
  });

  describe('Real-time Connection Fallback (WS → SSE → Polling)', () => {
    const mockConnectResponse = {
      sessionId: 'session-123',
      visitorId: 'visitor-456',
      operatorOnline: false,
      messages: [],
    };

    describe('WebSocket connection', () => {
      it('should try WebSocket first', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockConnectResponse),
          headers: new Headers(),
        });

        await client.connect();
        await new Promise((r) => setTimeout(r, 10));

        expect(MockWebSocket.instances.length).toBe(1);
        expect(MockWebSocket.instances[0].url).toContain('stream?sessionId=session-123');
      });

      it('should emit wsConnected event when WebSocket connects', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockConnectResponse),
          headers: new Headers(),
        });

        const connectedSpy = vi.fn();
        client.on('wsConnected', connectedSpy);

        await client.connect();
        await new Promise((r) => setTimeout(r, 10));

        expect(connectedSpy).toHaveBeenCalled();
      });

      it('should handle incoming messages via WebSocket', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockConnectResponse),
          headers: new Headers(),
        });

        const messageSpy = vi.fn();
        client.on('message', messageSpy);

        await client.connect();
        await new Promise((r) => setTimeout(r, 10));

        const ws = MockWebSocket.instances[0];
        ws.simulateMessage({
          type: 'message',
          data: {
            id: 'msg-1',
            content: 'Hello!',
            sender: 'operator',
            timestamp: new Date().toISOString(),
          },
        });

        expect(messageSpy).toHaveBeenCalled();
        expect(messageSpy.mock.calls[0][0].content).toBe('Hello!');
      });
    });

    describe('SSE fallback', () => {
      it('should fall back to SSE when WebSocket fails quickly', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockConnectResponse),
          headers: new Headers(),
        });

        await client.connect();
        await new Promise((r) => setTimeout(r, 10));

        // Simulate WebSocket closing quickly (within quickFailureThreshold)
        const ws = MockWebSocket.instances[0];
        ws.simulateClose();

        await new Promise((r) => setTimeout(r, 10));

        // SSE should be created
        expect(MockEventSource.instances.length).toBe(1);
        expect(MockEventSource.instances[0].url).toContain('stream?sessionId=session-123');
      });

      it('should emit sseConnected event when SSE connects', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockConnectResponse),
          headers: new Headers(),
        });

        const sseConnectedSpy = vi.fn();
        client.on('sseConnected', sseConnectedSpy);

        await client.connect();
        await new Promise((r) => setTimeout(r, 10));

        // Simulate WebSocket failing
        const ws = MockWebSocket.instances[0];
        ws.simulateClose();

        await new Promise((r) => setTimeout(r, 20));

        expect(sseConnectedSpy).toHaveBeenCalled();
      });

      it('should handle incoming messages via SSE', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockConnectResponse),
          headers: new Headers(),
        });

        const messageSpy = vi.fn();
        client.on('message', messageSpy);

        await client.connect();
        await new Promise((r) => setTimeout(r, 10));

        // Simulate WebSocket failing to trigger SSE
        const ws = MockWebSocket.instances[0];
        ws.simulateClose();
        await new Promise((r) => setTimeout(r, 20));

        // Now simulate SSE message
        const sse = MockEventSource.instances[0];
        sse.simulateMessage({
          type: 'message',
          data: {
            id: 'msg-2',
            content: 'Hello via SSE!',
            sender: 'operator',
            timestamp: new Date().toISOString(),
          },
        });

        expect(messageSpy).toHaveBeenCalled();
        // Find the SSE message (not the one from disconnect/reconnect)
        const sseMessage = messageSpy.mock.calls.find(
          (call: any[]) => call[0].content === 'Hello via SSE!'
        );
        expect(sseMessage).toBeDefined();
      });
    });

    describe('Polling fallback', () => {
      it('should fall back to polling when SSE fails', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockConnectResponse),
          headers: new Headers(),
        });

        // Mock messages endpoint for polling
        (globalThis.fetch as any).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ messages: [] }),
          headers: new Headers(),
        });

        await client.connect();
        await new Promise((r) => setTimeout(r, 10));

        // Simulate WebSocket failing
        const ws = MockWebSocket.instances[0];
        ws.simulateClose();
        await new Promise((r) => setTimeout(r, 20));

        // Simulate SSE failing
        const sse = MockEventSource.instances[0];
        sse.simulateError();

        // Wait for polling to start (500ms initial delay) + first poll
        await new Promise((r) => setTimeout(r, 700));

        // Should now be polling - check for messages fetch calls
        const fetchCalls = (globalThis.fetch as any).mock.calls;
        const pollCalls = fetchCalls.filter((c: any[]) => c[0].includes('/messages'));
        expect(pollCalls.length).toBeGreaterThan(0);
      });
    });

    describe('disconnect', () => {
      it('should close WebSocket on disconnect', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockConnectResponse),
          headers: new Headers(),
        });

        await client.connect();
        await new Promise((r) => setTimeout(r, 10));

        const ws = MockWebSocket.instances[0];
        client.disconnect();

        expect(ws.close).toHaveBeenCalled();
      });

      it('should close SSE on disconnect', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockConnectResponse),
          headers: new Headers(),
        });

        await client.connect();
        await new Promise((r) => setTimeout(r, 10));

        // Trigger SSE fallback
        const ws = MockWebSocket.instances[0];
        ws.simulateClose();
        await new Promise((r) => setTimeout(r, 20));

        const sse = MockEventSource.instances[0];
        client.disconnect();

        expect(sse.close).toHaveBeenCalled();
      });
    });
  });
});

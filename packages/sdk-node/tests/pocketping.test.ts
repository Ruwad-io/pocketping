import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bridge } from '../src/bridges/types';
import { PocketPing } from '../src/pocketping';
import type { CustomEvent } from '../src/types';

describe('PocketPing', () => {
  let pp: PocketPing;

  beforeEach(() => {
    pp = new PocketPing();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      expect(pp).toBeDefined();
    });

    it('should use memory storage by default', () => {
      expect(pp.getStorage()).toBeDefined();
    });

    it('should accept custom welcome message', async () => {
      const ppWithWelcome = new PocketPing({
        welcomeMessage: 'Hello there!',
      });

      const response = await ppWithWelcome.handleConnect({
        visitorId: 'visitor-123',
      });

      expect(response.welcomeMessage).toBe('Hello there!');
    });
  });

  describe('handleConnect', () => {
    it('should create new session for new visitor', async () => {
      const response = await pp.handleConnect({
        visitorId: 'visitor-123',
        metadata: { url: 'https://example.com' },
      });

      expect(response.sessionId).toBeDefined();
      expect(response.visitorId).toBe('visitor-123');
      expect(response.messages).toEqual([]);
    });

    it('should resume existing session by sessionId', async () => {
      // Create initial session
      const first = await pp.handleConnect({ visitorId: 'visitor-123' });

      // Resume with sessionId
      const second = await pp.handleConnect({
        visitorId: 'visitor-123',
        sessionId: first.sessionId,
      });

      expect(second.sessionId).toBe(first.sessionId);
    });

    it('should call onNewSession callback', async () => {
      const onNewSession = vi.fn();
      const ppWithCallback = new PocketPing({ onNewSession });

      await ppWithCallback.handleConnect({ visitorId: 'visitor-123' });

      expect(onNewSession).toHaveBeenCalledWith(
        expect.objectContaining({
          visitorId: 'visitor-123',
        })
      );
    });
  });

  describe('handleMessage', () => {
    let sessionId: string;

    beforeEach(async () => {
      const response = await pp.handleConnect({ visitorId: 'visitor-123' });
      sessionId = response.sessionId;
    });

    it('should save visitor message', async () => {
      const response = await pp.handleMessage({
        sessionId,
        content: 'Hello!',
        sender: 'visitor',
      });

      expect(response.messageId).toBeDefined();
      expect(response.timestamp).toBeDefined();
    });

    it('should call onMessage callback', async () => {
      const onMessage = vi.fn();
      const ppWithCallback = new PocketPing({ onMessage });
      const { sessionId: sid } = await ppWithCallback.handleConnect({
        visitorId: 'visitor-123',
      });

      await ppWithCallback.handleMessage({
        sessionId: sid,
        content: 'Hello!',
        sender: 'visitor',
      });

      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Hello!' }),
        expect.objectContaining({ visitorId: 'visitor-123' })
      );
    });

    it('should throw for unknown session', async () => {
      await expect(
        pp.handleMessage({
          sessionId: 'unknown-session',
          content: 'Hello',
          sender: 'visitor',
        })
      ).rejects.toThrow('Session not found');
    });
  });

  describe('handleGetMessages', () => {
    let sessionId: string;

    beforeEach(async () => {
      const response = await pp.handleConnect({ visitorId: 'visitor-123' });
      sessionId = response.sessionId;

      // Add some messages
      for (let i = 0; i < 5; i++) {
        await pp.handleMessage({
          sessionId,
          content: `Message ${i}`,
          sender: 'visitor',
        });
      }
    });

    it('should return messages for session', async () => {
      const response = await pp.handleGetMessages({ sessionId });

      expect(response.messages.length).toBe(5);
      expect(response.hasMore).toBe(false);
    });

    it('should respect limit parameter', async () => {
      const response = await pp.handleGetMessages({ sessionId, limit: 3 });

      expect(response.messages.length).toBe(3);
      expect(response.hasMore).toBe(true);
    });
  });

  describe('handlePresence', () => {
    it('should return operator offline by default', async () => {
      const response = await pp.handlePresence();

      expect(response.online).toBe(false);
    });

    it('should reflect operator online status', async () => {
      pp.setOperatorOnline(true);
      const response = await pp.handlePresence();

      expect(response.online).toBe(true);
    });
  });

  describe('handleRead', () => {
    let sessionId: string;
    let messageId: string;

    beforeEach(async () => {
      const response = await pp.handleConnect({ visitorId: 'visitor-123' });
      sessionId = response.sessionId;

      const msgResponse = await pp.handleMessage({
        sessionId,
        content: 'Test message',
        sender: 'operator',
      });
      messageId = msgResponse.messageId;
    });

    it('should update message status', async () => {
      const response = await pp.handleRead({
        sessionId,
        messageIds: [messageId],
        status: 'read',
      });

      expect(response.updated).toBe(1);
    });
  });

  describe('Custom Events', () => {
    let _sessionId: string;

    beforeEach(async () => {
      const response = await pp.handleConnect({ visitorId: 'visitor-123' });
      _sessionId = response.sessionId;
    });

    describe('onEvent()', () => {
      it('should register event handler', () => {
        const handler = vi.fn();
        pp.onEvent('test_event', handler);

        // Handler should be registered (we can't easily trigger without WebSocket)
        expect(handler).not.toHaveBeenCalled();
      });

      it('should return unsubscribe function', () => {
        const handler = vi.fn();
        const unsubscribe = pp.onEvent('test_event', handler);

        expect(typeof unsubscribe).toBe('function');
      });
    });

    describe('offEvent()', () => {
      it('should unsubscribe handler', () => {
        const handler = vi.fn();
        pp.onEvent('test_event', handler);
        pp.offEvent('test_event', handler);

        // Handler should be removed
        expect(handler).not.toHaveBeenCalled();
      });
    });

    describe('config.onEvent callback', () => {
      it('should call onEvent callback when configured', async () => {
        const onEvent = vi.fn();
        const ppWithCallback = new PocketPing({ onEvent });
        const { sessionId: sid } = await ppWithCallback.handleConnect({
          visitorId: 'visitor-123',
        });

        // Simulate a custom event via handleCustomEvent (private method)
        // We need to access it via bracket notation
        const customEvent: CustomEvent = {
          name: 'test_event',
          data: { foo: 'bar' },
          timestamp: new Date().toISOString(),
          sessionId: sid,
        };

        // Call the private method directly for testing
        await (ppWithCallback as any).handleCustomEvent(sid, customEvent);

        expect(onEvent).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'test_event' }),
          expect.objectContaining({ visitorId: 'visitor-123' })
        );
      });
    });
  });

  describe('Bridges', () => {
    let _sessionId: string;

    beforeEach(async () => {
      const response = await pp.handleConnect({ visitorId: 'visitor-123' });
      _sessionId = response.sessionId;
    });

    it('should notify bridge on new session', async () => {
      const mockBridge: Bridge = {
        name: 'test-bridge',
        onNewSession: vi.fn(),
      };

      const ppWithBridge = new PocketPing({ bridges: [mockBridge] });
      await ppWithBridge.handleConnect({ visitorId: 'visitor-456' });

      expect(mockBridge.onNewSession).toHaveBeenCalledWith(
        expect.objectContaining({ visitorId: 'visitor-456' })
      );
    });

    it('should notify bridge on visitor message', async () => {
      const mockBridge: Bridge = {
        name: 'test-bridge',
        onVisitorMessage: vi.fn(),
      };

      const ppWithBridge = new PocketPing({ bridges: [mockBridge] });
      const { sessionId: sid } = await ppWithBridge.handleConnect({
        visitorId: 'visitor-456',
      });

      await ppWithBridge.handleMessage({
        sessionId: sid,
        content: 'Hello from visitor!',
        sender: 'visitor',
      });

      expect(mockBridge.onVisitorMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Hello from visitor!' }),
        expect.objectContaining({ visitorId: 'visitor-456' })
      );
    });

    it('should notify bridge on custom event', async () => {
      const mockBridge: Bridge = {
        name: 'test-bridge',
        onCustomEvent: vi.fn(),
      };

      const ppWithBridge = new PocketPing({ bridges: [mockBridge] });
      const { sessionId: sid } = await ppWithBridge.handleConnect({
        visitorId: 'visitor-456',
      });

      // Simulate custom event
      const customEvent: CustomEvent = {
        name: 'clicked_pricing',
        data: { plan: 'pro' },
        timestamp: new Date().toISOString(),
        sessionId: sid,
      };

      await (ppWithBridge as any).handleCustomEvent(sid, customEvent);

      expect(mockBridge.onCustomEvent).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'clicked_pricing' }),
        expect.objectContaining({ visitorId: 'visitor-456' })
      );
    });

    it('should call bridge init when added', () => {
      const mockBridge: Bridge = {
        name: 'test-bridge',
        init: vi.fn(),
      };

      pp.addBridge(mockBridge);

      expect(mockBridge.init).toHaveBeenCalledWith(pp);
    });
  });

  describe('sendOperatorMessage', () => {
    let sessionId: string;

    beforeEach(async () => {
      const response = await pp.handleConnect({ visitorId: 'visitor-123' });
      sessionId = response.sessionId;
    });

    it('should send message as operator', async () => {
      const message = await pp.sendOperatorMessage(sessionId, 'Hello from operator!');

      expect(message.content).toBe('Hello from operator!');
      expect(message.sender).toBe('operator');
    });
  });

  describe('setOperatorOnline', () => {
    it('should update operator status', () => {
      pp.setOperatorOnline(true);
      expect(pp.handlePresence()).resolves.toMatchObject({ online: true });

      pp.setOperatorOnline(false);
      expect(pp.handlePresence()).resolves.toMatchObject({ online: false });
    });
  });

  describe('User Identity', () => {
    let sessionId: string;

    beforeEach(async () => {
      const response = await pp.handleConnect({ visitorId: 'visitor-123' });
      sessionId = response.sessionId;
    });

    describe('handleIdentify', () => {
      it('should update session with identity', async () => {
        const response = await pp.handleIdentify({
          sessionId,
          identity: {
            id: 'user_123',
            email: 'john@example.com',
            name: 'John Doe',
          },
        });

        expect(response.ok).toBe(true);

        // Verify session was updated
        const session = await pp.getStorage().getSession(sessionId);
        expect(session?.identity).toEqual({
          id: 'user_123',
          email: 'john@example.com',
          name: 'John Doe',
        });
      });

      it('should require identity.id', async () => {
        await expect(
          pp.handleIdentify({
            sessionId,
            identity: {
              id: '',
              email: 'test@example.com',
            },
          })
        ).rejects.toThrow('identity.id is required');
      });

      it('should throw for unknown session', async () => {
        await expect(
          pp.handleIdentify({
            sessionId: 'unknown-session',
            identity: { id: 'user_123' },
          })
        ).rejects.toThrow('Session not found');
      });

      it('should call onIdentify callback', async () => {
        const onIdentify = vi.fn();
        const ppWithCallback = new PocketPing({ onIdentify });
        const { sessionId: sid } = await ppWithCallback.handleConnect({
          visitorId: 'visitor-456',
        });

        await ppWithCallback.handleIdentify({
          sessionId: sid,
          identity: {
            id: 'user_123',
            name: 'Test User',
          },
        });

        expect(onIdentify).toHaveBeenCalledWith(
          expect.objectContaining({
            visitorId: 'visitor-456',
            identity: expect.objectContaining({ id: 'user_123' }),
          })
        );
      });

      it('should support custom fields', async () => {
        await pp.handleIdentify({
          sessionId,
          identity: {
            id: 'user_123',
            plan: 'pro',
            company: 'Acme Inc',
            signupDate: '2024-01-15',
          },
        });

        const session = await pp.getStorage().getSession(sessionId);
        expect(session?.identity?.plan).toBe('pro');
        expect(session?.identity?.company).toBe('Acme Inc');
        expect(session?.identity?.signupDate).toBe('2024-01-15');
      });

      it('should notify bridges on identity update', async () => {
        const mockBridge: Bridge = {
          name: 'test-bridge',
          onIdentityUpdate: vi.fn(),
        };

        const ppWithBridge = new PocketPing({ bridges: [mockBridge] });
        const { sessionId: sid } = await ppWithBridge.handleConnect({
          visitorId: 'visitor-456',
        });

        await ppWithBridge.handleIdentify({
          sessionId: sid,
          identity: {
            id: 'user_123',
            name: 'Test User',
          },
        });

        expect(mockBridge.onIdentityUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            identity: expect.objectContaining({ id: 'user_123' }),
          })
        );
      });
    });

    describe('handleConnect with identity', () => {
      it('should accept identity on connect', async () => {
        const response = await pp.handleConnect({
          visitorId: 'visitor-789',
          identity: {
            id: 'user_456',
            email: 'jane@example.com',
            name: 'Jane Doe',
          },
        });

        const session = await pp.getStorage().getSession(response.sessionId);
        expect(session?.identity).toEqual({
          id: 'user_456',
          email: 'jane@example.com',
          name: 'Jane Doe',
        });
      });

      it('should preserve identity when reconnecting', async () => {
        // First connect with identity
        const first = await pp.handleConnect({
          visitorId: 'visitor-789',
          identity: {
            id: 'user_456',
            name: 'Jane',
          },
        });

        // Reconnect without identity
        const second = await pp.handleConnect({
          visitorId: 'visitor-789',
          sessionId: first.sessionId,
        });

        expect(second.sessionId).toBe(first.sessionId);

        const session = await pp.getStorage().getSession(second.sessionId);
        expect(session?.identity?.id).toBe('user_456');
      });
    });
  });
});

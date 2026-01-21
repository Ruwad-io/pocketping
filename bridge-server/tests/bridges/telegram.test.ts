import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { Session, Message } from '../../src/types';

/**
 * ===================================================================================
 * Mock Setup for TelegramBridge Tests
 * ===================================================================================
 *
 * Bun's test runner doesn't support vi.mock hoisting like vitest.
 * Instead, we mock at the instance level after construction.
 *
 * This approach:
 * 1. Creates a real TelegramBridge (which creates a real Telegraf instance)
 * 2. Immediately replaces the internal bot with a mock before init() is called
 * 3. Tests run against the mocked bot
 */

// Create mock functions that persist across tests
const createMockBot = () => ({
  telegram: {
    sendMessage: mock(() => Promise.resolve({ message_id: 123 })),
    createForumTopic: mock(() => Promise.resolve({ message_thread_id: 456 })),
    setMyCommands: mock(() => Promise.resolve(true)),
    getMe: mock(() => Promise.resolve({ username: 'test_bot', id: 12345 })),
  },
  command: mock(() => {}),
  on: mock(() => {}),
  launch: mock(() => Promise.resolve()),
  stop: mock(() => Promise.resolve()),
});

// Dynamic import to allow mocking before use
let TelegramBridge: typeof import('../../src/bridges/telegram').TelegramBridge;

describe('TelegramBridge', () => {
  let bridge: InstanceType<typeof TelegramBridge>;
  let eventCallback: ReturnType<typeof mock>;
  let mockBot: ReturnType<typeof createMockBot>;

  const mockConfig = {
    botToken: 'test-bot-token',
    forumChatId: -1001234567890, // Should be number, not string
  };

  beforeEach(async () => {
    // Import dynamically to allow fresh module state
    const module = await import('../../src/bridges/telegram');
    TelegramBridge = module.TelegramBridge;

    // Create mock bot
    mockBot = createMockBot();

    // Create bridge and immediately replace the bot with mock
    bridge = new TelegramBridge(mockConfig);
    (bridge as any).bot = mockBot;

    eventCallback = mock(() => {});
    bridge.setEventCallback(eventCallback);
  });

  afterEach(() => {
    // Clear all mocks by creating fresh ones
  });

  describe('constructor', () => {
    it('should create bridge with config', () => {
      expect(bridge).toBeDefined();
      expect(bridge.name).toBe('telegram');
    });
  });

  describe('onNewSession', () => {
    const mockSession: Session = {
      id: 'session-123',
      visitorId: 'visitor-456',
      createdAt: new Date(),
      lastActivity: new Date(),
      operatorOnline: false,
      aiActive: false,
      metadata: {
        url: 'https://example.com/test',
        pageTitle: 'Test Page',
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'macOS',
        ip: '192.168.1.1',
        country: 'France',
        city: 'Paris',
      },
    };

    it('should create forum topic for new session', async () => {
      await bridge.init();
      await bridge.onNewSession(mockSession);

      expect(mockBot.telegram.createForumTopic).toHaveBeenCalled();
      const calls = mockBot.telegram.createForumTopic.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toBe(mockConfig.forumChatId);
    });

    it('should send welcome message with metadata', async () => {
      await bridge.init();
      await bridge.onNewSession(mockSession);

      expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
      const calls = mockBot.telegram.sendMessage.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  describe('onVisitorMessage', () => {
    const mockSession: Session = {
      id: 'session-123',
      visitorId: 'visitor-456',
      createdAt: new Date(),
      lastActivity: new Date(),
      operatorOnline: false,
      aiActive: false,
    };

    const mockMessage: Message = {
      id: 'msg-789',
      sessionId: 'session-123',
      content: 'Hello, I need help!',
      sender: 'visitor',
      timestamp: new Date(),
    };

    it('should emit message_delivered after sending', async () => {
      await bridge.init();

      // First create session to set up thread mapping
      await bridge.onNewSession(mockSession);

      // Then send message
      await bridge.onVisitorMessage(mockMessage, mockSession);

      const calls = eventCallback.mock.calls;
      const deliveredCall = calls.find(
        (call: any[]) => call[0]?.type === 'message_delivered'
      );
      expect(deliveredCall).toBeDefined();
      expect(deliveredCall![0].sessionId).toBe('session-123');
      expect(deliveredCall![0].messageId).toBe('msg-789');
    });
  });

  describe('event emission', () => {
    it('should emit operator_message when callback set', async () => {
      await bridge.init();

      // Simulate operator message (internal method)
      await (bridge as any).emit({
        type: 'operator_message',
        sessionId: 'session-123',
        content: 'Hello from operator!',
        sourceBridge: 'telegram',
        operatorName: 'John',
      });

      expect(eventCallback).toHaveBeenCalled();
      const call = eventCallback.mock.calls[0];
      expect(call[0]).toEqual({
        type: 'operator_message',
        sessionId: 'session-123',
        content: 'Hello from operator!',
        sourceBridge: 'telegram',
        operatorName: 'John',
      });
    });
  });
});

describe('TelegramBridge - Session/Thread Mapping', () => {
  it('should map session to thread ID', async () => {
    const module = await import('../../src/bridges/telegram');
    const mockBot = createMockBot();

    const bridge = new module.TelegramBridge({
      botToken: 'test-token',
      forumChatId: -1001234567890,
    });

    // Replace bot with mock before init
    (bridge as any).bot = mockBot;

    await bridge.init();

    const session: Session = {
      id: 'session-abc',
      visitorId: 'visitor-xyz',
      createdAt: new Date(),
      lastActivity: new Date(),
      operatorOnline: false,
      aiActive: false,
    };

    await bridge.onNewSession(session);

    // Verify internal mapping (forum topics use sessionTopicMap)
    const sessionTopicMap = (bridge as any).sessionTopicMap;
    expect(sessionTopicMap.has('session-abc')).toBe(true);
  });
});

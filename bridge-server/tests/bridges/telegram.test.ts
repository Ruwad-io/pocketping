import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';

// Mock telegraf before importing TelegramBridge
vi.mock('telegraf', () => {
  const mockBot = {
    telegram: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
      createForumTopic: vi.fn().mockResolvedValue({ message_thread_id: 456 }),
      setMyCommands: vi.fn().mockResolvedValue(true),
    },
    command: vi.fn(),
    on: vi.fn(),
    launch: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };

  return {
    Telegraf: vi.fn(() => mockBot),
  };
});

import { TelegramBridge } from '../../src/bridges/telegram';
import type { Session, Message } from '../../src/types';

describe('TelegramBridge', () => {
  let bridge: TelegramBridge;
  let eventCallback: ReturnType<typeof vi.fn>;

  const mockConfig = {
    botToken: 'test-bot-token',
    forumChatId: '-1001234567890',
  };

  beforeEach(() => {
    eventCallback = vi.fn();
    bridge = new TelegramBridge(mockConfig);
    bridge.setEventCallback(eventCallback);
  });

  afterEach(() => {
    vi.clearAllMocks();
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

      const bot = (bridge as any).bot;
      expect(bot.telegram.createForumTopic).toHaveBeenCalledWith(
        mockConfig.forumChatId,
        expect.stringContaining('session-12')
      );
    });

    it('should send welcome message with metadata', async () => {
      await bridge.init();
      await bridge.onNewSession(mockSession);

      const bot = (bridge as any).bot;
      expect(bot.telegram.sendMessage).toHaveBeenCalled();

      const sendMessageCall = bot.telegram.sendMessage.mock.calls[0];
      const messageText = sendMessageCall[2]?.text || sendMessageCall[1];

      // Check that metadata is included
      expect(messageText).toContain('New Conversation');
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

      expect(eventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message_delivered',
          sessionId: 'session-123',
          messageId: 'msg-789',
        })
      );
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

      expect(eventCallback).toHaveBeenCalledWith({
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
    const bridge = new TelegramBridge({
      botToken: 'test-token',
      forumChatId: '-1001234567890',
    });

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

    // Verify internal mapping
    const sessionThreadMap = (bridge as any).sessionThreadMap;
    expect(sessionThreadMap.has('session-abc')).toBe(true);
  });
});

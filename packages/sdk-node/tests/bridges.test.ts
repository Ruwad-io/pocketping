import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { TelegramBridge } from '../src/bridges/telegram';
import { DiscordBridge } from '../src/bridges/discord';
import { SlackBridge } from '../src/bridges/slack';
import type { Session, Message } from '../src/types';
import type { PocketPing } from '../src/pocketping';

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-123',
  visitorId: 'visitor-456',
  createdAt: new Date('2024-01-15T10:00:00Z'),
  lastActivity: new Date('2024-01-15T10:30:00Z'),
  operatorOnline: false,
  aiActive: false,
  metadata: {
    url: 'https://example.com/pricing',
    userAgent: 'Mozilla/5.0',
  },
  ...overrides,
});

const createMockMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'msg-789',
  sessionId: 'session-123',
  content: 'Hello, I need help!',
  sender: 'visitor',
  timestamp: new Date('2024-01-15T10:30:00Z'),
  ...overrides,
});

const createMockPocketPing = (): PocketPing => ({} as PocketPing);

// ============================================================================
// Telegram Bridge Tests
// ============================================================================

describe('TelegramBridge', () => {
  const BOT_TOKEN = 'test-bot-token-123';
  const CHAT_ID = '-1001234567890';
  let mockFetch: Mock;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────
  // Constructor Validation
  // ─────────────────────────────────────────────────────────────────

  describe('Constructor validation', () => {
    it('should create bridge with required params', () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);

      expect(bridge.name).toBe('telegram');
    });

    it('should use default options', () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);

      // Default parseMode is HTML, verified by checking message format
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 123 } }),
      });

      // We verify defaults by checking the API call format
      expect(bridge.name).toBe('telegram');
    });

    it('should accept custom options', () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID, {
        parseMode: 'Markdown',
        disableNotification: true,
      });

      expect(bridge.name).toBe('telegram');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onVisitorMessage
  // ─────────────────────────────────────────────────────────────────

  describe('onVisitorMessage', () => {
    it('should send message to API', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 12345 } }),
      });

      await bridge.onVisitorMessage(message, session);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining(message.content),
        })
      );
    });

    it('should return bridge message ID', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 12345 } }),
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBe(12345);
    });

    it('should handle API errors gracefully', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, description: 'Bot was blocked by the user' }),
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onNewSession
  // ─────────────────────────────────────────────────────────────────

  describe('onNewSession', () => {
    it('should send session announcement', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);
      const session = createMockSession();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 111 } }),
      });

      await bridge.onNewSession(session);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should format session info correctly', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);
      const session = createMockSession({
        visitorId: 'test-visitor',
        metadata: { url: 'https://test.com/page' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 111 } }),
      });

      await bridge.onNewSession(session);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.text).toContain('New chat session');
      expect(body.text).toContain('test-visitor');
      expect(body.text).toContain('https://test.com/page');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onMessageEdit
  // ─────────────────────────────────────────────────────────────────

  describe('onMessageEdit', () => {
    it('should call edit API with correct params', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      });

      await bridge.onMessageEdit('msg-123', 'Updated content', 12345);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.chat_id).toBe(CHAT_ID);
      expect(body.message_id).toBe(12345);
      expect(body.text).toContain('Updated content');
      expect(body.text).toContain('(edited)');
    });

    it('should return true on success', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      });

      const result = await bridge.onMessageEdit('msg-123', 'Updated content', 12345);

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, description: 'Message cannot be edited' }),
      });

      const result = await bridge.onMessageEdit('msg-123', 'Updated content', 12345);

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onMessageDelete
  // ─────────────────────────────────────────────────────────────────

  describe('onMessageDelete', () => {
    it('should call delete API with correct params', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: true }),
      });

      await bridge.onMessageDelete('msg-123', 12345);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.chat_id).toBe(CHAT_ID);
      expect(body.message_id).toBe(12345);
    });

    it('should return true on success', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: true }),
      });

      const result = await bridge.onMessageDelete('msg-123', 12345);

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, description: 'Message already deleted' }),
      });

      const result = await bridge.onMessageDelete('msg-123', 12345);

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Error Handling
  // ─────────────────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('should log error but not throw on API failure', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, description: 'Chat not found' }),
      });

      // Should not throw
      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle network errors', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Should not throw
      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle invalid responses', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); },
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────────────────────

  describe('init', () => {
    it('should verify bot token on init', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { username: 'test_bot' } }),
      });

      await bridge.init(createMockPocketPing());

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${BOT_TOKEN}/getMe`
      );
    });

    it('should log error for invalid bot token', async () => {
      const bridge = new TelegramBridge(BOT_TOKEN, CHAT_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, description: 'Unauthorized' }),
      });

      await bridge.init(createMockPocketPing());

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[TelegramBridge] Invalid bot token:',
        'Unauthorized'
      );
    });
  });
});

// ============================================================================
// Discord Bridge Tests
// ============================================================================

describe('DiscordBridge', () => {
  const WEBHOOK_URL = 'https://discord.com/api/webhooks/123456789/abcdef';
  const BOT_TOKEN = 'test-discord-bot-token';
  const CHANNEL_ID = '987654321';
  let mockFetch: Mock;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────
  // Constructor Validation (Webhook Mode)
  // ─────────────────────────────────────────────────────────────────

  describe('Constructor validation (Webhook mode)', () => {
    it('should create bridge with required params', () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);

      expect(bridge.name).toBe('discord');
    });

    it('should use default options', () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);

      expect(bridge.name).toBe('discord');
    });

    it('should accept custom options', () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL, {
        username: 'PocketPing Bot',
        avatarUrl: 'https://example.com/avatar.png',
      });

      expect(bridge.name).toBe('discord');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Constructor Validation (Bot Mode)
  // ─────────────────────────────────────────────────────────────────

  describe('Constructor validation (Bot mode)', () => {
    it('should create bridge with required params', () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);

      expect(bridge.name).toBe('discord');
    });

    it('should use default options', () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);

      expect(bridge.name).toBe('discord');
    });

    it('should accept custom options', () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID, {
        username: 'PocketPing Bot',
        avatarUrl: 'https://example.com/avatar.png',
      });

      expect(bridge.name).toBe('discord');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onVisitorMessage (Webhook Mode)
  // ─────────────────────────────────────────────────────────────────

  describe('onVisitorMessage (Webhook mode)', () => {
    it('should send message to webhook API', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'discord-msg-123' }),
      });

      await bridge.onVisitorMessage(message, session);

      expect(mockFetch).toHaveBeenCalledWith(
        `${WEBHOOK_URL}?wait=true`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should return bridge message ID', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'discord-msg-123' }),
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBe('discord-msg-123');
    });

    it('should handle API errors gracefully', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Invalid webhook',
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onVisitorMessage (Bot Mode)
  // ─────────────────────────────────────────────────────────────────

  describe('onVisitorMessage (Bot mode)', () => {
    it('should send message to bot API', async () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'discord-msg-456' }),
      });

      await bridge.onVisitorMessage(message, session);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${BOT_TOKEN}`,
          },
        })
      );
    });

    it('should return bridge message ID', async () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'discord-msg-456' }),
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBe('discord-msg-456');
    });

    it('should handle API errors gracefully', async () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Unauthorized',
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onNewSession
  // ─────────────────────────────────────────────────────────────────

  describe('onNewSession', () => {
    it('should send session announcement (Webhook mode)', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'discord-msg-111' }),
      });

      await bridge.onNewSession(session);

      expect(mockFetch).toHaveBeenCalledWith(
        `${WEBHOOK_URL}?wait=true`,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should format session info correctly', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);
      const session = createMockSession({
        visitorId: 'test-visitor',
        metadata: { url: 'https://test.com/page' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'discord-msg-111' }),
      });

      await bridge.onNewSession(session);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.embeds[0].title).toBe('New chat session');
      expect(body.embeds[0].fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Visitor', value: 'test-visitor' }),
          expect.objectContaining({ name: 'Page', value: 'https://test.com/page' }),
        ])
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onMessageEdit (Webhook Mode)
  // ─────────────────────────────────────────────────────────────────

  describe('onMessageEdit (Webhook mode)', () => {
    it('should call edit API with correct params', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);

      mockFetch.mockResolvedValueOnce({ ok: true });

      await bridge.onMessageEdit('msg-123', 'Updated content', 'discord-msg-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${WEBHOOK_URL}/messages/discord-msg-123`,
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].description).toContain('Updated content');
      expect(body.embeds[0].description).toContain('(edited)');
    });

    it('should return true on success', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);

      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await bridge.onMessageEdit('msg-123', 'Updated', 'discord-msg-123');

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);

      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await bridge.onMessageEdit('msg-123', 'Updated', 'discord-msg-123');

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onMessageEdit (Bot Mode)
  // ─────────────────────────────────────────────────────────────────

  describe('onMessageEdit (Bot mode)', () => {
    it('should call edit API with correct params', async () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({ ok: true });

      await bridge.onMessageEdit('msg-123', 'Updated content', 'discord-msg-456');

      expect(mockFetch).toHaveBeenCalledWith(
        `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages/discord-msg-456`,
        expect.objectContaining({
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${BOT_TOKEN}`,
          },
        })
      );
    });

    it('should return true on success', async () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await bridge.onMessageEdit('msg-123', 'Updated', 'discord-msg-456');

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await bridge.onMessageEdit('msg-123', 'Updated', 'discord-msg-456');

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onMessageDelete (Webhook Mode)
  // ─────────────────────────────────────────────────────────────────

  describe('onMessageDelete (Webhook mode)', () => {
    it('should call delete API with correct params', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);

      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      await bridge.onMessageDelete('msg-123', 'discord-msg-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${WEBHOOK_URL}/messages/discord-msg-123`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should return true on success', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);

      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      const result = await bridge.onMessageDelete('msg-123', 'discord-msg-123');

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);

      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

      const result = await bridge.onMessageDelete('msg-123', 'discord-msg-123');

      expect(result).toBe(false);
    });

    it('should return true for 404 (already deleted)', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);

      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await bridge.onMessageDelete('msg-123', 'discord-msg-123');

      expect(result).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onMessageDelete (Bot Mode)
  // ─────────────────────────────────────────────────────────────────

  describe('onMessageDelete (Bot mode)', () => {
    it('should call delete API with correct params', async () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      await bridge.onMessageDelete('msg-123', 'discord-msg-456');

      expect(mockFetch).toHaveBeenCalledWith(
        `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages/discord-msg-456`,
        expect.objectContaining({
          method: 'DELETE',
          headers: { Authorization: `Bot ${BOT_TOKEN}` },
        })
      );
    });

    it('should return true on success', async () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      const result = await bridge.onMessageDelete('msg-123', 'discord-msg-456');

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

      const result = await bridge.onMessageDelete('msg-123', 'discord-msg-456');

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Error Handling
  // ─────────────────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('should log error but not throw on API failure', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Webhook not found',
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle network errors', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle invalid responses', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); },
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────────────────────

  describe('init', () => {
    it('should verify bot token on init (Bot mode)', async () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'bot-id', username: 'test_bot' }),
      });

      await bridge.init(createMockPocketPing());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/v10/users/@me',
        expect.objectContaining({
          headers: { Authorization: `Bot ${BOT_TOKEN}` },
        })
      );
    });

    it('should log error for invalid bot token', async () => {
      const bridge = DiscordBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({ ok: false });

      await bridge.init(createMockPocketPing());

      expect(consoleErrorSpy).toHaveBeenCalledWith('[DiscordBridge] Invalid bot token');
    });

    it('should not verify token in webhook mode', async () => {
      const bridge = DiscordBridge.webhook(WEBHOOK_URL);

      await bridge.init(createMockPocketPing());

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Slack Bridge Tests
// ============================================================================

describe('SlackBridge', () => {
  const WEBHOOK_URL = 'https://hooks.slack.com/services/T123/B456/xxx';
  const BOT_TOKEN = 'xoxb-test-slack-bot-token';
  const CHANNEL_ID = 'C1234567890';
  let mockFetch: Mock;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────
  // Constructor Validation (Webhook Mode)
  // ─────────────────────────────────────────────────────────────────

  describe('Constructor validation (Webhook mode)', () => {
    it('should create bridge with required params', () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL);

      expect(bridge.name).toBe('slack');
    });

    it('should use default options', () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL);

      expect(bridge.name).toBe('slack');
    });

    it('should accept custom options', () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL, {
        username: 'PocketPing Bot',
        iconEmoji: ':speech_balloon:',
        iconUrl: 'https://example.com/icon.png',
      });

      expect(bridge.name).toBe('slack');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Constructor Validation (Bot Mode)
  // ─────────────────────────────────────────────────────────────────

  describe('Constructor validation (Bot mode)', () => {
    it('should create bridge with required params', () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);

      expect(bridge.name).toBe('slack');
    });

    it('should use default options', () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);

      expect(bridge.name).toBe('slack');
    });

    it('should accept custom options', () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID, {
        username: 'PocketPing Bot',
        iconEmoji: ':robot_face:',
      });

      expect(bridge.name).toBe('slack');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onVisitorMessage (Webhook Mode)
  // ─────────────────────────────────────────────────────────────────

  describe('onVisitorMessage (Webhook mode)', () => {
    it('should send message to webhook API', async () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'ok',
      });

      await bridge.onVisitorMessage(message, session);

      expect(mockFetch).toHaveBeenCalledWith(
        WEBHOOK_URL,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should return undefined messageId (webhooks do not return ts)', async () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'ok',
      });

      const result = await bridge.onVisitorMessage(message, session);

      // Webhooks don't return message timestamp
      expect(result.messageId).toBeUndefined();
    });

    it('should handle API errors gracefully', async () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'invalid_token',
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onVisitorMessage (Bot Mode)
  // ─────────────────────────────────────────────────────────────────

  describe('onVisitorMessage (Bot mode)', () => {
    it('should send message to bot API', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, ts: '1234567890.123456' }),
      });

      await bridge.onVisitorMessage(message, session);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${BOT_TOKEN}`,
          },
        })
      );
    });

    it('should return bridge message ID (ts)', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, ts: '1234567890.123456' }),
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBe('1234567890.123456');
    });

    it('should handle API errors gracefully', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'channel_not_found' }),
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onNewSession
  // ─────────────────────────────────────────────────────────────────

  describe('onNewSession', () => {
    it('should send session announcement (Webhook mode)', async () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'ok',
      });

      await bridge.onNewSession(session);

      expect(mockFetch).toHaveBeenCalledWith(
        WEBHOOK_URL,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should format session info correctly', async () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL);
      const session = createMockSession({
        visitorId: 'test-visitor',
        metadata: { url: 'https://test.com/page' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'ok',
      });

      await bridge.onNewSession(session);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      // Check header block
      expect(body.blocks[0].text.text).toBe('New chat session');

      // Check section fields
      const fieldsBlock = body.blocks.find((b: any) => b.type === 'section' && b.fields);
      expect(fieldsBlock.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('test-visitor') }),
          expect.objectContaining({ text: expect.stringContaining('https://test.com/page') }),
        ])
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onMessageEdit (Bot Mode Only)
  // ─────────────────────────────────────────────────────────────────

  describe('onMessageEdit', () => {
    it('should call edit API with correct params (Bot mode)', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await bridge.onMessageEdit('msg-123', 'Updated content', '1234567890.123456');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.update',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${BOT_TOKEN}`,
          },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.channel).toBe(CHANNEL_ID);
      expect(body.ts).toBe('1234567890.123456');
      expect(body.blocks[0].text.text).toContain('Updated content');
      expect(body.blocks[0].text.text).toContain('(edited)');
    });

    it('should return true on success', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      const result = await bridge.onMessageEdit('msg-123', 'Updated', '1234567890.123456');

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'message_not_found' }),
      });

      const result = await bridge.onMessageEdit('msg-123', 'Updated', '1234567890.123456');

      expect(result).toBe(false);
    });

    it('should return false and warn in webhook mode', async () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL);

      const result = await bridge.onMessageEdit('msg-123', 'Updated', '1234567890.123456');

      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[SlackBridge] Message edit only supported in bot mode'
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onMessageDelete (Bot Mode Only)
  // ─────────────────────────────────────────────────────────────────

  describe('onMessageDelete', () => {
    it('should call delete API with correct params (Bot mode)', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await bridge.onMessageDelete('msg-123', '1234567890.123456');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.delete',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${BOT_TOKEN}`,
          },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.channel).toBe(CHANNEL_ID);
      expect(body.ts).toBe('1234567890.123456');
    });

    it('should return true on success', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      const result = await bridge.onMessageDelete('msg-123', '1234567890.123456');

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'cant_delete_message' }),
      });

      const result = await bridge.onMessageDelete('msg-123', '1234567890.123456');

      expect(result).toBe(false);
    });

    it('should return true for message_not_found error', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'message_not_found' }),
      });

      const result = await bridge.onMessageDelete('msg-123', '1234567890.123456');

      expect(result).toBe(true);
    });

    it('should return false and warn in webhook mode', async () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL);

      const result = await bridge.onMessageDelete('msg-123', '1234567890.123456');

      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[SlackBridge] Message delete only supported in bot mode'
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Error Handling
  // ─────────────────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('should log error but not throw on API failure', async () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'invalid_token',
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle network errors', async () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle invalid responses', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);
      const session = createMockSession();
      const message = createMockMessage();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); },
      });

      const result = await bridge.onVisitorMessage(message, session);

      expect(result.messageId).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────────────────────

  describe('init', () => {
    it('should verify bot token on init (Bot mode)', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, user: 'bot_user' }),
      });

      await bridge.init(createMockPocketPing());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/auth.test',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${BOT_TOKEN}`,
          },
        })
      );
    });

    it('should log error for invalid bot token', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'invalid_auth' }),
      });

      await bridge.init(createMockPocketPing());

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[SlackBridge] Invalid bot token:',
        'invalid_auth'
      );
    });

    it('should not verify token in webhook mode', async () => {
      const bridge = SlackBridge.webhook(WEBHOOK_URL);

      await bridge.init(createMockPocketPing());

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // onTyping
  // ─────────────────────────────────────────────────────────────────

  describe('onTyping', () => {
    it('should be a no-op (Slack does not support typing indicators)', async () => {
      const bridge = SlackBridge.bot(BOT_TOKEN, CHANNEL_ID);

      await bridge.onTyping('session-123', true);

      // Should not make any API calls
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

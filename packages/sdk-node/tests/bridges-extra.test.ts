import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { DiscordBridge } from '../src/bridges/discord';
import { SlackBridge } from '../src/bridges/slack';
import { TelegramBridge } from '../src/bridges/telegram';
import type { PocketPing } from '../src/pocketping';
import type { Message, Session } from '../src/types';

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's1',
  visitorId: 'visitor-1',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  lastActivity: new Date('2024-01-01T00:00:00Z'),
  operatorOnline: false,
  aiActive: false,
  metadata: { url: 'https://x.com', userAgent: 'Mozilla/5.0 (Windows NT) Chrome/120' },
  ...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 'm1',
  sessionId: 's1',
  content: 'hello',
  sender: 'visitor',
  timestamp: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

describe('Bridge extra branches', () => {
  let mockFetch: Mock;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  // ── Telegram ──
  describe('TelegramBridge', () => {
    const T = () => new TelegramBridge('tok', '-100', { parseMode: 'HTML' });
    const TM = () => new TelegramBridge('tok', '-100', { parseMode: 'Markdown' });

    it('onOperatorMessage echoes for non-telegram source, skips telegram source', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: true, result: { message_id: 1 } }));
      const b = T();
      await b.onOperatorMessage(message({ content: 'reply' }), session(), 'discord', 'Sam');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      mockFetch.mockClear();
      await b.onOperatorMessage(message(), session(), 'telegram', 'Sam');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('onOperatorMessage uses Markdown formatting + default name', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: true, result: { message_id: 1 } }));
      const b = TM();
      await b.onOperatorMessage(message({ content: '*bold*' }), session(), 'discord');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Operator');
    });

    it('onTyping sends chat action only when typing', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: true }));
      const b = T();
      await b.onTyping('s1', false);
      expect(mockFetch).not.toHaveBeenCalled();
      await b.onTyping('s1', true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendChatAction'),
        expect.anything()
      );
    });

    it('onCustomEvent (HTML + Markdown, with and without data)', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: true, result: { message_id: 1 } }));
      await T().onCustomEvent({ name: 'evt', data: { a: 1 } }, session());
      await T().onCustomEvent({ name: 'evt' }, session());
      await TM().onCustomEvent({ name: 'evt', data: { a: 1 } }, session());
      await TM().onCustomEvent({ name: 'evt' }, session());
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('onIdentityUpdate (HTML + Markdown) and no-op without identity', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: true, result: { message_id: 1 } }));
      await T().onIdentityUpdate(
        session({ identity: { id: 'u', name: 'Bob', email: 'b@x.com' }, userPhone: '+1' })
      );
      await TM().onIdentityUpdate(
        session({ identity: { id: 'u', name: 'Bob', email: 'b@x.com' }, userPhone: '+1' })
      );
      mockFetch.mockClear();
      await T().onIdentityUpdate(session()); // no identity -> no fetch
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('onNewSession formats with email/phone/userAgent (HTML + Markdown)', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: true, result: { message_id: 1 } }));
      const s = session({ identity: { id: 'u', email: 'e@x.com' }, userPhone: '+33' });
      await T().onNewSession(s);
      await TM().onNewSession(s);
      // Minimal session with no metadata -> "Unknown page"
      await T().onNewSession(
        session({ metadata: undefined, identity: undefined, userPhone: undefined })
      );
      expect(mockFetch).toHaveBeenCalled();
    });

    it('onVisitorMessage resolves replyTo via storage bridge ids', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: true, result: { message_id: 7 } }));
      const getBridgeMessageIds = vi.fn().mockResolvedValue({ telegramMessageId: 555 });
      const pp = { getStorage: () => ({ getBridgeMessageIds }) } as unknown as PocketPing;
      const b = T();
      await b.init(pp);
      mockFetch.mockClear();
      mockFetch.mockResolvedValue(okJson({ ok: true, result: { message_id: 7 } }));
      await b.onVisitorMessage(message({ replyTo: 'm0' }), session());
      const body = JSON.parse(mockFetch.mock.calls.at(-1)![1].body);
      expect(body.reply_to_message_id).toBe(555);
    });

    it('init logs when getMe reports an invalid token', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: false, description: 'bad token' }));
      await T().init({ getStorage: () => ({}) } as unknown as PocketPing);
      expect(errSpy).toHaveBeenCalledWith('[TelegramBridge] Invalid bot token:', 'bad token');
    });

    it('init logs when getMe throws', async () => {
      mockFetch.mockRejectedValue(new Error('net'));
      await T().init({ getStorage: () => ({}) } as unknown as PocketPing);
      expect(errSpy).toHaveBeenCalledWith('[TelegramBridge] Failed to verify bot token:', expect.any(Error));
    });

    it('parses various user agents through onNewSession (browser/os matrix)', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: true, result: { message_id: 1 } }));
      const uas = [
        'Mozilla Firefox/120 Linux',
        'Mozilla Edg/120 Windows',
        'Mozilla Safari/605 Mac OS',
        'Mozilla OPR/100 Android',
        'Mozilla iPhone',
      ];
      for (const ua of uas) {
        await T().onNewSession(session({ metadata: { userAgent: ua } }));
      }
      expect(mockFetch).toHaveBeenCalledTimes(uas.length);
    });
  });

  // ── Discord ──
  describe('DiscordBridge', () => {
    const W = () => DiscordBridge.webhook('https://discord.com/api/webhooks/1/abc');
    const B = () => DiscordBridge.bot('btok', 'chan');

    it('onOperatorMessage skips discord source, echoes otherwise', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'x' }) });
      const b = W();
      await b.onOperatorMessage(message(), session(), 'telegram', 'Sam');
      expect(mockFetch).toHaveBeenCalled();
      mockFetch.mockClear();
      await b.onOperatorMessage(message(), session(), 'discord');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('onTyping posts only in bot mode while typing', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      await W().onTyping('s', true); // webhook mode -> no-op
      expect(mockFetch).not.toHaveBeenCalled();
      await B().onTyping('s', true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/typing'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('onCustomEvent + onIdentityUpdate send embeds', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'x' }) });
      await W().onCustomEvent({ name: 'evt', data: { a: 1 } }, session());
      await W().onCustomEvent({ name: 'evt' }, session());
      await W().onIdentityUpdate(
        session({ identity: { id: 'u', name: 'n', email: 'e@x' }, userPhone: '+1' })
      );
      mockFetch.mockClear();
      await W().onIdentityUpdate(session()); // no identity
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('onMessageEdit/Delete in bot mode (success + 404)', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      expect(await B().onMessageEdit('m', 'new', 'bid')).toBe(true);
      expect(await B().onMessageDelete('m', 'bid')).toBe(true);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      expect(await B().onMessageDelete('m', 'bid')).toBe(true);
    });

    it('onMessageEdit/Delete return false in an unconfigured mode', async () => {
      // Force a mode mismatch by faking a webhook bridge with cleared url
      const b = W() as unknown as { webhookUrl?: string };
      b.webhookUrl = undefined;
      expect(await (b as unknown as DiscordBridge).onMessageEdit('m', 'n', 'b')).toBe(false);
      expect(await (b as unknown as DiscordBridge).onMessageDelete('m', 'b')).toBe(false);
    });

    it('onVisitorMessage resolves replyTo via storage in webhook mode', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'mid' }) });
      const getBridgeMessageIds = vi.fn().mockResolvedValue({ discordMessageId: 'parent' });
      const pp = { getStorage: () => ({ getBridgeMessageIds }) } as unknown as PocketPing;
      const b = W();
      await b.init(pp);
      const res = await b.onVisitorMessage(message({ replyTo: 'm0' }), session());
      expect(res.messageId).toBe('mid');
      const body = JSON.parse(mockFetch.mock.calls.at(-1)![1].body);
      expect(body.message_reference.message_id).toBe('parent');
    });

    it('init verifies bot token and logs on failure', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });
      await B().init({ getStorage: () => ({}) } as unknown as PocketPing);
      expect(errSpy).toHaveBeenCalledWith('[DiscordBridge] Invalid bot token');
      mockFetch.mockRejectedValue(new Error('net'));
      await B().init({ getStorage: () => ({}) } as unknown as PocketPing);
      expect(errSpy).toHaveBeenCalledWith(
        '[DiscordBridge] Failed to verify bot token:',
        expect.any(Error)
      );
    });
  });

  // ── Slack ──
  describe('SlackBridge', () => {
    const W = () => SlackBridge.webhook('https://hooks.slack.com/services/x');
    const B = () => SlackBridge.bot('xoxb-tok', 'C123');

    it('onOperatorMessage skips slack source, echoes otherwise (default name)', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: true, ts: '1' }));
      await B().onOperatorMessage(message(), session(), 'telegram');
      expect(mockFetch).toHaveBeenCalled();
      mockFetch.mockClear();
      await B().onOperatorMessage(message(), session(), 'slack');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('onTyping is a no-op', async () => {
      await B().onTyping('s', true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('onCustomEvent + onIdentityUpdate send blocks', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: true, ts: '1' }));
      await B().onCustomEvent({ name: 'evt', data: { a: 1 } }, session());
      await B().onCustomEvent({ name: 'evt' }, session());
      await B().onIdentityUpdate(
        session({ identity: { id: 'u', name: 'n', email: 'e@x' }, userPhone: '+1' })
      );
      mockFetch.mockClear();
      await B().onIdentityUpdate(session()); // no identity
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('onMessageEdit/Delete warn + return false in webhook mode', async () => {
      expect(await W().onMessageEdit('m', 'n', 'ts')).toBe(false);
      expect(await W().onMessageDelete('m', 'ts')).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('onMessageDelete treats message_not_found as success', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: false, error: 'message_not_found' }));
      expect(await B().onMessageDelete('m', 'ts')).toBe(true);
    });

    it('onMessageDelete returns false on other errors', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: false, error: 'rate_limited' }));
      expect(await B().onMessageDelete('m', 'ts')).toBe(false);
    });

    it('onVisitorMessage quotes the reply target via storage.getMessage', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: true, ts: '99' }));
      const getMessage = vi.fn().mockResolvedValue({
        id: 'm0',
        sessionId: 's1',
        sender: 'operator',
        content: 'x'.repeat(200),
        timestamp: new Date(),
      });
      const pp = { getStorage: () => ({ getMessage }) } as unknown as PocketPing;
      const b = B();
      await b.init(pp);
      const res = await b.onVisitorMessage(message({ replyTo: 'm0' }), session());
      expect(res.messageId).toBe('99');
      expect(getMessage).toHaveBeenCalledWith('m0');
    });

    it('onVisitorMessage quotes a deleted reply target', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: true, ts: '1' }));
      const getMessage = vi.fn().mockResolvedValue({
        id: 'm0',
        sessionId: 's1',
        sender: 'visitor',
        content: 'gone',
        deletedAt: new Date(),
        timestamp: new Date(),
      });
      const pp = { getStorage: () => ({ getMessage }) } as unknown as PocketPing;
      const b = B();
      await b.init(pp);
      await b.onVisitorMessage(message({ replyTo: 'm0' }), session());
      const body = JSON.parse(mockFetch.mock.calls.at(-1)![1].body);
      expect(JSON.stringify(body)).toContain('Message deleted');
    });

    it('onNewSession (webhook) includes contact fields, and a minimal one without', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
      await W().onNewSession(
        session({ identity: { id: 'u', email: 'e@x' }, userPhone: '+1' })
      );
      await W().onNewSession(session({ metadata: undefined, identity: undefined }));
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('init verifies bot token and logs error on invalid', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: false, error: 'invalid_auth' }));
      await B().init({ getStorage: () => ({}) } as unknown as PocketPing);
      expect(errSpy).toHaveBeenCalledWith('[SlackBridge] Invalid bot token:', 'invalid_auth');
      mockFetch.mockRejectedValue(new Error('net'));
      await B().init({ getStorage: () => ({}) } as unknown as PocketPing);
      expect(errSpy).toHaveBeenCalledWith(
        '[SlackBridge] Failed to verify bot token:',
        expect.any(Error)
      );
    });

    it('bot-mode sendBlocks throws (caught) when API not ok', async () => {
      mockFetch.mockResolvedValue(okJson({ ok: false, error: 'channel_not_found' }));
      const res = await B().onVisitorMessage(message(), session());
      expect(res).toEqual({});
      expect(errSpy).toHaveBeenCalled();
    });
  });
});

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { WebhookHandler } from '../src/webhooks';

function makeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    end(d?: string) {
      if (d !== undefined) this.body = d;
    },
  };
}

const reqWithBody = (body: unknown) => ({ body }) as never;

describe('WebhookHandler incoming', () => {
  let mockFetch: Mock;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  // ── Telegram ──
  describe('Telegram', () => {
    it('returns 404 when telegram is not configured', async () => {
      const h = new WebhookHandler({ onOperatorMessage: vi.fn() });
      const res = makeRes();
      await h.handleTelegramWebhook()(reqWithBody({}), res as never);
      expect(res.statusCode).toBe(404);
    });

    it('forwards a plain text operator message with topic id', async () => {
      const onOperatorMessage = vi.fn();
      const h = new WebhookHandler({ telegramBotToken: 't', onOperatorMessage });
      const res = makeRes();
      await h.handleTelegramWebhook()(
        reqWithBody({
          message: {
            message_id: 10,
            message_thread_id: 77,
            text: 'hi from op',
            from: { id: 1, first_name: 'Sam' },
            chat: { id: -100 },
            date: 1,
            reply_to_message: { message_id: 5 },
          },
        }),
        res as never
      );
      expect(onOperatorMessage).toHaveBeenCalledWith('77', 'hi from op', 'Sam', 'telegram', [], 5, 10);
    });

    it('skips command messages and topic-less messages', async () => {
      const onOperatorMessage = vi.fn();
      const h = new WebhookHandler({ telegramBotToken: 't', onOperatorMessage });
      const res = makeRes();
      // bare command
      await h.handleTelegramWebhook()(
        reqWithBody({ message: { message_id: 1, text: '/start', chat: { id: 1 }, date: 1 } }),
        res as never
      );
      // text but no topic id
      await h.handleTelegramWebhook()(
        reqWithBody({ message: { message_id: 2, text: 'hi', chat: { id: 1 }, date: 1 } }),
        res as never
      );
      // empty content
      await h.handleTelegramWebhook()(
        reqWithBody({ message: { message_id: 3, message_thread_id: 9, chat: { id: 1 }, date: 1 } }),
        res as never
      );
      expect(onOperatorMessage).not.toHaveBeenCalled();
    });

    it('skips edited command messages and edited messages without text/topic', async () => {
      const onOperatorMessageEdit = vi.fn();
      const h = new WebhookHandler({
        telegramBotToken: 't',
        onOperatorMessage: vi.fn(),
        onOperatorMessageEdit,
      });
      const res = makeRes();
      await h.handleTelegramWebhook()(
        reqWithBody({ edited_message: { message_id: 1, text: '/x', chat: { id: 1 }, date: 1 } }),
        res as never
      );
      await h.handleTelegramWebhook()(
        reqWithBody({
          edited_message: { message_id: 2, message_thread_id: 5, chat: { id: 1 }, date: 1 },
        }),
        res as never
      );
      expect(onOperatorMessageEdit).not.toHaveBeenCalled();
    });

    it('uses caption text and falls back to current time when edit_date missing', async () => {
      const onOperatorMessageEdit = vi.fn();
      const h = new WebhookHandler({
        telegramBotToken: 't',
        onOperatorMessage: vi.fn(),
        onOperatorMessageEdit,
      });
      const res = makeRes();
      await h.handleTelegramWebhook()(
        reqWithBody({
          edited_message: {
            message_id: 9,
            message_thread_id: 5,
            caption: 'caption text',
            chat: { id: 1 },
            date: 1,
          },
        }),
        res as never
      );
      expect(onOperatorMessageEdit).toHaveBeenCalledWith('5', 9, 'caption text', 'telegram', expect.any(String));
    });

    it('downloads photo media and attaches it', async () => {
      const onOperatorMessage = vi.fn();
      const h = new WebhookHandler({ telegramBotToken: 'tok', onOperatorMessage });
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: { file_path: 'photos/1.jpg' } }) })
        .mockResolvedValueOnce({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
      const res = makeRes();
      await h.handleTelegramWebhook()(
        reqWithBody({
          message: {
            message_id: 1,
            message_thread_id: 5,
            photo: [{ file_id: 'small', file_size: 1 }, { file_id: 'big', file_size: 9 }],
            from: { id: 1, first_name: 'Op' },
            chat: { id: 1 },
            date: 1,
          },
        }),
        res as never
      );
      const attachments = onOperatorMessage.mock.calls[0][4];
      expect(attachments).toHaveLength(1);
      expect(attachments[0].mimeType).toBe('image/jpeg');
      expect(attachments[0].bridgeFileId).toBe('big');
    });

    it('parses document/audio/video/voice media types', async () => {
      const onOperatorMessage = vi.fn();
      const h = new WebhookHandler({ telegramBotToken: 'tok', onOperatorMessage });
      const cases = [
        { document: { file_id: 'd', file_name: 'a.pdf', mime_type: 'application/pdf', file_size: 2 } },
        { audio: { file_id: 'a', file_size: 2 } },
        { video: { file_id: 'v', file_size: 2 } },
        { voice: { file_id: 'vo', file_size: 2 } },
      ];
      for (const media of cases) {
        mockFetch
          .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: { file_path: 'f' } }) })
          .mockResolvedValueOnce({ arrayBuffer: async () => new Uint8Array([1]).buffer });
        const res = makeRes();
        await h.handleTelegramWebhook()(
          reqWithBody({
            message: { message_id: 1, message_thread_id: 5, ...media, chat: { id: 1 }, date: 1 },
          }),
          res as never
        );
      }
      expect(onOperatorMessage).toHaveBeenCalledTimes(4);
    });

    it('skips attachment when file download fails (getFile not ok)', async () => {
      const onOperatorMessage = vi.fn();
      const h = new WebhookHandler({ telegramBotToken: 'tok', onOperatorMessage });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false }) });
      const res = makeRes();
      await h.handleTelegramWebhook()(
        reqWithBody({
          message: {
            message_id: 1,
            message_thread_id: 5,
            document: { file_id: 'd', file_size: 1 },
            from: { id: 1, first_name: 'Op' },
            chat: { id: 1 },
            date: 1,
          },
        }),
        res as never
      );
      expect(onOperatorMessage.mock.calls[0][4]).toHaveLength(0);
    });

    it('handles download throwing', async () => {
      const onOperatorMessage = vi.fn();
      const h = new WebhookHandler({ telegramBotToken: 'tok', onOperatorMessage });
      mockFetch.mockRejectedValueOnce(new Error('net'));
      const res = makeRes();
      await h.handleTelegramWebhook()(
        reqWithBody({
          message: {
            message_id: 1,
            message_thread_id: 5,
            document: { file_id: 'd', file_size: 1 },
            chat: { id: 1 },
            date: 1,
          },
        }),
        res as never
      );
      expect(onOperatorMessage.mock.calls[0][4]).toHaveLength(0);
      expect(errSpy).toHaveBeenCalled();
    });

    it('ignores reactions that are not 🗑 or lack topic id', async () => {
      const onOperatorMessageDelete = vi.fn();
      const h = new WebhookHandler({
        telegramBotToken: 't',
        onOperatorMessage: vi.fn(),
        onOperatorMessageDelete,
      });
      const res = makeRes();
      await h.handleTelegramWebhook()(
        reqWithBody({
          message_reaction: {
            message_id: 1,
            message_thread_id: 5,
            chat: { id: 1 },
            new_reaction: [{ type: 'emoji', emoji: '👍' }],
          },
        }),
        res as never
      );
      expect(onOperatorMessageDelete).not.toHaveBeenCalled();
    });

    it('returns 500 on body parse error', async () => {
      const h = new WebhookHandler({ telegramBotToken: 't', onOperatorMessage: vi.fn() });
      const req = new EventEmitter() as never as { on: unknown };
      const res = makeRes();
      const p = h.handleTelegramWebhook()(req as never, res as never);
      (req as unknown as EventEmitter).emit('data', '{bad');
      (req as unknown as EventEmitter).emit('end');
      await p;
      expect(res.statusCode).toBe(500);
    });
  });

  // ── Slack ──
  describe('Slack', () => {
    it('returns 404 when slack not configured', async () => {
      const h = new WebhookHandler({ onOperatorMessage: vi.fn() });
      const res = makeRes();
      await h.handleSlackWebhook()(reqWithBody({}), res as never);
      expect(res.statusCode).toBe(404);
    });

    it('responds to url_verification challenge', async () => {
      const h = new WebhookHandler({ slackBotToken: 's', onOperatorMessage: vi.fn() });
      const res = makeRes();
      await h.handleSlackWebhook()(
        reqWithBody({ type: 'url_verification', challenge: 'abc' }),
        res as never
      );
      expect(JSON.parse(res.body).challenge).toBe('abc');
    });

    it('forwards a thread message and resolves operator name via users.info', async () => {
      const onOperatorMessage = vi.fn();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, user: { real_name: 'Real Name' } }),
      });
      const h = new WebhookHandler({ slackBotToken: 's', onOperatorMessage });
      const res = makeRes();
      await h.handleSlackWebhook()(
        reqWithBody({
          type: 'event_callback',
          event: {
            type: 'message',
            thread_ts: '111.0',
            ts: '222.0',
            text: 'reply',
            user: 'U1',
          },
        }),
        res as never
      );
      expect(onOperatorMessage).toHaveBeenCalledWith('111.0', 'reply', 'Real Name', 'slack', [], null, '222.0');
    });

    it('downloads slack files when present', async () => {
      const onOperatorMessage = vi.fn();
      mockFetch
        .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }) // file
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, user: { name: 'op' } }) }); // user
      const h = new WebhookHandler({ slackBotToken: 's', onOperatorMessage });
      const res = makeRes();
      await h.handleSlackWebhook()(
        reqWithBody({
          type: 'event_callback',
          event: {
            type: 'message',
            thread_ts: '1.0',
            ts: '2.0',
            user: 'U1',
            files: [{ id: 'f', name: 'a.png', mimetype: 'image/png', size: 5, url_private: 'http://x/f' }],
          },
        }),
        res as never
      );
      expect(onOperatorMessage.mock.calls[0][4]).toHaveLength(1);
    });

    it('handles message_changed edit events with allowed bot id', async () => {
      const onOperatorMessageEdit = vi.fn();
      const h = new WebhookHandler({
        slackBotToken: 's',
        allowedBotIds: ['B1'],
        onOperatorMessage: vi.fn(),
        onOperatorMessageEdit,
      });
      const res = makeRes();
      await h.handleSlackWebhook()(
        reqWithBody({
          type: 'event_callback',
          event: {
            type: 'message',
            subtype: 'message_changed',
            message: { bot_id: 'B1', thread_ts: '1.0', ts: '2.0', text: 'edited' },
          },
        }),
        res as never
      );
      expect(onOperatorMessageEdit).toHaveBeenCalledWith('1.0', '2.0', 'edited', 'slack', expect.any(String));
    });

    it('ignores message_changed from a disallowed bot, and no edit callback', async () => {
      const onOperatorMessageEdit = vi.fn();
      const h = new WebhookHandler({
        slackBotToken: 's',
        allowedBotIds: ['B1'],
        onOperatorMessage: vi.fn(),
        onOperatorMessageEdit,
      });
      const res = makeRes();
      await h.handleSlackWebhook()(
        reqWithBody({
          type: 'event_callback',
          event: {
            subtype: 'message_changed',
            message: { bot_id: 'B-other', thread_ts: '1.0', ts: '2.0', text: 'e' },
          },
        }),
        res as never
      );
      expect(onOperatorMessageEdit).not.toHaveBeenCalled();

      // no edit callback configured -> early return
      const h2 = new WebhookHandler({ slackBotToken: 's', onOperatorMessage: vi.fn() });
      const res2 = makeRes();
      await h2.handleSlackWebhook()(
        reqWithBody({ type: 'event_callback', event: { subtype: 'message_changed' } }),
        res2 as never
      );
      expect(JSON.parse(res2.body).ok).toBe(true);
    });

    it('handles message_deleted events', async () => {
      const onOperatorMessageDelete = vi.fn();
      const h = new WebhookHandler({
        slackBotToken: 's',
        onOperatorMessage: vi.fn(),
        onOperatorMessageDelete,
      });
      const res = makeRes();
      await h.handleSlackWebhook()(
        reqWithBody({
          type: 'event_callback',
          event: {
            subtype: 'message_deleted',
            deleted_ts: '2.0',
            previous_message: { thread_ts: '1.0', ts: '2.0' },
          },
        }),
        res as never
      );
      expect(onOperatorMessageDelete).toHaveBeenCalledWith('1.0', '2.0', 'slack', expect.any(String));
    });

    it('skips message_deleted without delete callback', async () => {
      const h = new WebhookHandler({ slackBotToken: 's', onOperatorMessage: vi.fn() });
      const res = makeRes();
      await h.handleSlackWebhook()(
        reqWithBody({ type: 'event_callback', event: { subtype: 'message_deleted' } }),
        res as never
      );
      expect(JSON.parse(res.body).ok).toBe(true);
    });

    it('ignores bot messages that are not allow-listed for normal messages', async () => {
      const onOperatorMessage = vi.fn();
      const h = new WebhookHandler({ slackBotToken: 's', onOperatorMessage });
      const res = makeRes();
      await h.handleSlackWebhook()(
        reqWithBody({
          type: 'event_callback',
          event: { type: 'message', thread_ts: '1.0', ts: '2.0', text: 'hi', bot_id: 'B9' },
        }),
        res as never
      );
      expect(onOperatorMessage).not.toHaveBeenCalled();
    });

    it('returns 500 on slack parse error', async () => {
      const h = new WebhookHandler({ slackBotToken: 's', onOperatorMessage: vi.fn() });
      const req = new EventEmitter();
      const res = makeRes();
      const p = h.handleSlackWebhook()(req as never, res as never);
      req.emit('data', '{bad');
      req.emit('end');
      await p;
      expect(res.statusCode).toBe(500);
    });

    it('downloadSlackFile returns null on non-ok and getSlackUserName returns null on not-ok', async () => {
      const onOperatorMessage = vi.fn();
      mockFetch
        .mockResolvedValueOnce({ ok: false }) // file download fails
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false }) }); // user lookup fails
      const h = new WebhookHandler({ slackBotToken: 's', onOperatorMessage });
      const res = makeRes();
      await h.handleSlackWebhook()(
        reqWithBody({
          type: 'event_callback',
          event: {
            type: 'message',
            thread_ts: '1.0',
            ts: '2.0',
            user: 'U1',
            files: [{ id: 'f', name: 'a.png', mimetype: 'image/png', size: 5, url_private: 'http://x/f' }],
          },
        }),
        res as never
      );
      // no attachment downloaded, operator name falls back to 'Operator'
      expect(onOperatorMessage.mock.calls[0][2]).toBe('Operator');
      expect(onOperatorMessage.mock.calls[0][4]).toHaveLength(0);
    });
  });

  // ── Discord ──
  describe('Discord', () => {
    it('responds PONG to a PING interaction', async () => {
      const h = new WebhookHandler({ discordBotToken: 'd', onOperatorMessage: vi.fn() });
      const res = makeRes();
      await h.handleDiscordWebhook()(reqWithBody({ type: 1 }), res as never);
      expect(JSON.parse(res.body)).toEqual({ type: 1 });
    });

    it('handles a /reply slash command', async () => {
      const onOperatorMessage = vi.fn();
      const h = new WebhookHandler({ discordBotToken: 'd', onOperatorMessage });
      const res = makeRes();
      await h.handleDiscordWebhook()(
        reqWithBody({
          type: 2,
          channel_id: 'chan-1',
          member: { user: { id: '1', username: 'OpUser' } },
          data: { name: 'reply', options: [{ name: 'message', value: 'hello there' }] },
        }),
        res as never
      );
      expect(onOperatorMessage).toHaveBeenCalledWith('chan-1', 'hello there', 'OpUser', 'discord', [], null);
      expect(JSON.parse(res.body).type).toBe(4);
    });

    it('falls back to default PONG for unknown commands', async () => {
      const onOperatorMessage = vi.fn();
      const h = new WebhookHandler({ discordBotToken: 'd', onOperatorMessage });
      const res = makeRes();
      await h.handleDiscordWebhook()(
        reqWithBody({ type: 2, channel_id: 'c', data: { name: 'other' } }),
        res as never
      );
      expect(onOperatorMessage).not.toHaveBeenCalled();
      expect(JSON.parse(res.body).type).toBe(1);
    });

    it('returns 500 on discord parse error', async () => {
      const h = new WebhookHandler({ discordBotToken: 'd', onOperatorMessage: vi.fn() });
      const req = new EventEmitter();
      const res = makeRes();
      const p = h.handleDiscordWebhook()(req as never, res as never);
      req.emit('data', '{bad');
      req.emit('end');
      await p;
      expect(res.statusCode).toBe(500);
    });
  });
});

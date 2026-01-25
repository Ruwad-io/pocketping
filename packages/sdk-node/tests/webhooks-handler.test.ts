import { describe, it, expect, vi } from 'vitest';
import { WebhookHandler } from '../src/webhooks';

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(key: string, value: string) {
      this.headers[key.toLowerCase()] = value;
    },
    end(data?: string) {
      if (data !== undefined) {
        this.body = data;
      }
    },
  };
  return res;
}

describe('WebhookHandler (Telegram)', () => {
  it('calls onOperatorMessageEdit for edited_message updates', async () => {
    const onOperatorMessageEdit = vi.fn().mockResolvedValue(undefined);
    const handler = new WebhookHandler({
      telegramBotToken: 'test-token',
      onOperatorMessage: vi.fn(),
      onOperatorMessageEdit,
    });

    const payload = {
      edited_message: {
        message_id: 123,
        message_thread_id: 456,
        text: 'Updated message',
        edit_date: 1700000000,
        chat: { id: 1 },
        date: 1700000000,
      },
    };

    const req = { body: payload } as any;
    const res = createMockRes();

    await handler.handleTelegramWebhook()(req, res);

    expect(onOperatorMessageEdit).toHaveBeenCalledTimes(1);
    expect(onOperatorMessageEdit).toHaveBeenCalledWith(
      '456',
      123,
      'Updated message',
      'telegram',
      new Date(1700000000 * 1000).toISOString()
    );
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('ignores edited_message updates without topic id', async () => {
    const onOperatorMessageEdit = vi.fn();
    const handler = new WebhookHandler({
      telegramBotToken: 'test-token',
      onOperatorMessage: vi.fn(),
      onOperatorMessageEdit,
    });

    const payload = {
      edited_message: {
        message_id: 123,
        text: 'Updated message',
        edit_date: 1700000000,
        chat: { id: 1 },
        date: 1700000000,
      },
    };

    const req = { body: payload } as any;
    const res = createMockRes();

    await handler.handleTelegramWebhook()(req, res);

    expect(onOperatorMessageEdit).not.toHaveBeenCalled();
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('calls onOperatorMessageDelete for /delete command replies', async () => {
    const onOperatorMessageDelete = vi.fn().mockResolvedValue(undefined);
    const handler = new WebhookHandler({
      telegramBotToken: 'test-token',
      onOperatorMessage: vi.fn(),
      onOperatorMessageDelete,
    });

    const payload = {
      message: {
        message_id: 200,
        message_thread_id: 456,
        text: '/delete',
        reply_to_message: { message_id: 999 },
        chat: { id: 1 },
        date: 1700000000,
      },
    };

    const req = { body: payload } as any;
    const res = createMockRes();

    await handler.handleTelegramWebhook()(req, res);

    expect(onOperatorMessageDelete).toHaveBeenCalledTimes(1);
    expect(onOperatorMessageDelete).toHaveBeenCalledWith(
      '456',
      999,
      'telegram',
      expect.any(String)
    );
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('calls onOperatorMessageDelete for 🗑 reactions when topic id is present', async () => {
    const onOperatorMessageDelete = vi.fn().mockResolvedValue(undefined);
    const handler = new WebhookHandler({
      telegramBotToken: 'test-token',
      onOperatorMessage: vi.fn(),
      onOperatorMessageDelete,
    });

    const payload = {
      message_reaction: {
        message_id: 999,
        message_thread_id: 456,
        chat: { id: 1 },
        new_reaction: [{ type: 'emoji', emoji: '🗑️' }],
        date: 1700000000,
      },
    };

    const req = { body: payload } as any;
    const res = createMockRes();

    await handler.handleTelegramWebhook()(req, res);

    expect(onOperatorMessageDelete).toHaveBeenCalledTimes(1);
    expect(onOperatorMessageDelete).toHaveBeenCalledWith(
      '456',
      999,
      'telegram',
      new Date(1700000000 * 1000).toISOString()
    );
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});

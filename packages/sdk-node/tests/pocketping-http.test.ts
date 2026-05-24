import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { PocketPing } from '../src/index';
import type { VersionCheckResult } from '../src/types';

// ── Minimal fake req/res helpers ──
interface FakeReq extends EventEmitter {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  body?: unknown;
}

function makeReq(opts: Partial<FakeReq> & { headers?: Record<string, string> } = {}): FakeReq {
  const req = new EventEmitter() as FakeReq;
  req.url = opts.url ?? '/connect';
  req.method = opts.method ?? 'POST';
  req.headers = { host: 'localhost', ...(opts.headers ?? {}) };
  req.socket = opts.socket ?? { remoteAddress: '9.9.9.9' };
  if ('body' in opts) req.body = opts.body;
  return req;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    ended: false,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return this.headers[k.toLowerCase()];
    },
    end(data?: string) {
      if (data !== undefined) this.body = data;
      this.ended = true;
    },
  };
}

describe('PocketPing.middleware', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('handles CORS preflight (OPTIONS)', async () => {
    const pp = new PocketPing();
    const req = makeReq({ method: 'OPTIONS', url: '/connect' });
    const res = makeRes();
    await pp.middleware()(req as never, res as never);
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('routes /connect with parsed body and enriches metadata', async () => {
    const pp = new PocketPing();
    const req = makeReq({
      url: '/connect',
      headers: { host: 'localhost', 'user-agent': 'Mozilla/5.0 (iPhone)', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      body: { visitorId: 'v1', metadata: { url: 'https://x.com' } },
    });
    const res = makeRes();
    await pp.middleware()(req as never, res as never);
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.visitorId).toBe('v1');
    const session = await pp.getSession(out.sessionId);
    expect(session?.metadata?.ip).toBe('1.2.3.4');
    expect(session?.metadata?.deviceType).toBe('mobile');
  });

  it('routes /connect when metadata is absent (builds metadata server-side)', async () => {
    const pp = new PocketPing();
    const req = makeReq({
      url: '/connect',
      headers: { host: 'localhost', 'user-agent': 'Mozilla/5.0 Windows Chrome', 'x-real-ip': '8.8.8.8' },
      body: { visitorId: 'v2' },
    });
    const res = makeRes();
    await pp.middleware()(req as never, res as never);
    const out = JSON.parse(res.body);
    const session = await pp.getSession(out.sessionId);
    expect(session?.metadata?.ip).toBe('8.8.8.8');
    expect(session?.metadata?.browser).toBe('Chrome');
    expect(session?.metadata?.os).toBe('Windows');
  });

  it('parses a streamed JSON body when req.body is absent', async () => {
    const pp = new PocketPing();
    const req = makeReq({ url: '/connect' });
    const res = makeRes();
    const p = pp.middleware()(req as never, res as never);
    req.emit('data', JSON.stringify({ visitorId: 'streamed' }));
    req.emit('end');
    await p;
    expect(JSON.parse(res.body).visitorId).toBe('streamed');
  });

  it('returns 500 with internal error on invalid JSON body', async () => {
    const pp = new PocketPing();
    const req = makeReq({ url: '/message' });
    const res = makeRes();
    const p = pp.middleware()(req as never, res as never);
    req.emit('data', '{not json');
    req.emit('end');
    await p;
    expect(res.statusCode).toBe(500);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it.each([
    ['/messages', 'GET'],
    ['/typing', 'POST'],
    ['/presence', 'POST'],
    ['/visibility', 'POST'],
  ])('routes %s', async (path) => {
    const pp = new PocketPing();
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    const url = path === '/messages' ? `${path}?sessionId=${sessionId}` : path;
    const body =
      path === '/typing'
        ? { sessionId, sender: 'visitor' }
        : path === '/visibility'
          ? { sessionId, state: 'visible', timestamp: 1 }
          : {};
    const req = makeReq({ url, method: path === '/messages' ? 'GET' : 'POST', body });
    const res = makeRes();
    await pp.middleware()(req as never, res as never);
    expect(res.statusCode).toBe(200);
  });

  it('routes the full set of write endpoints', async () => {
    const pp = new PocketPing();
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    const mid = pp.middleware();

    // message
    let req = makeReq({ url: '/message', body: { sessionId, content: 'hi', sender: 'visitor' } });
    let res = makeRes();
    await mid(req as never, res as never);
    const messageId = JSON.parse(res.body).messageId;

    // read
    req = makeReq({ url: '/read', body: { sessionId, messageIds: [messageId] } });
    res = makeRes();
    await mid(req as never, res as never);
    expect(res.statusCode).toBe(200);

    // identify
    req = makeReq({ url: '/identify', body: { sessionId, identity: { id: 'u1' } } });
    res = makeRes();
    await mid(req as never, res as never);
    expect(JSON.parse(res.body).ok).toBe(true);

    // edit
    req = makeReq({ url: '/edit', body: { sessionId, messageId, content: 'edited' } });
    res = makeRes();
    await mid(req as never, res as never);
    expect(res.statusCode).toBe(200);

    // delete
    req = makeReq({ url: '/delete', body: { sessionId, messageId } });
    res = makeRes();
    await mid(req as never, res as never);
    expect(JSON.parse(res.body).deleted).toBe(true);

    // disconnect
    req = makeReq({ url: '/disconnect', body: { sessionId, duration: 5, reason: 'manual' } });
    res = makeRes();
    await mid(req as never, res as never);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('routes upload endpoints', async () => {
    const pp = new PocketPing();
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    const mid = pp.middleware();

    let req = makeReq({
      url: '/upload-request',
      body: { sessionId, filename: 'a.png', mimeType: 'image/png', size: 5 },
    });
    let res = makeRes();
    await mid(req as never, res as never);
    const attachmentId = JSON.parse(res.body).attachmentId;

    req = makeReq({ url: '/upload-complete', body: { attachmentId } });
    res = makeRes();
    await mid(req as never, res as never);
    expect(JSON.parse(res.body).status).toBe('ready');

    req = makeReq({ url: '/upload-failed', body: { attachmentId } });
    res = makeRes();
    await mid(req as never, res as never);
    expect(JSON.parse(res.body).status).toBe('failed');
  });

  it('calls next() for unknown routes when provided, else 404', async () => {
    const pp = new PocketPing();
    const next = vi.fn();
    let req = makeReq({ url: '/unknown', body: {} });
    let res = makeRes();
    await pp.middleware()(req as never, res as never, next);
    expect(next).toHaveBeenCalled();

    req = makeReq({ url: '/unknown', body: {} });
    res = makeRes();
    await pp.middleware()(req as never, res as never);
    expect(res.statusCode).toBe(404);
  });

  // ── IP filtering ──
  it('blocks requests from blocklisted IPs with default logging', async () => {
    const pp = new PocketPing({
      ipFilter: { enabled: true, mode: 'blocklist', blocklist: ['9.9.9.9'] },
    });
    const req = makeReq({ url: '/connect', body: { visitorId: 'v' } });
    const res = makeRes();
    await pp.middleware()(req as never, res as never);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('Forbidden');
    expect(logSpy).toHaveBeenCalled();
  });

  it('blocks with a custom logger, status code and message', async () => {
    const logger = vi.fn();
    const pp = new PocketPing({
      ipFilter: {
        enabled: true,
        mode: 'allowlist',
        allowlist: ['1.1.1.1'],
        logger,
        blockedStatusCode: 401,
        blockedMessage: 'Nope',
      },
    });
    const req = makeReq({ url: '/connect', headers: { host: 'l', 'x-forwarded-for': '2.2.2.2' }, body: { visitorId: 'v' } });
    const res = makeRes();
    await pp.middleware()(req as never, res as never);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('Nope');
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ type: 'blocked' }));
  });

  it('does not log when logBlocked is false', async () => {
    const pp = new PocketPing({
      ipFilter: { enabled: true, blocklist: ['9.9.9.9'], logBlocked: false },
    });
    const req = makeReq({ url: '/connect', body: { visitorId: 'v' } });
    const res = makeRes();
    await pp.middleware()(req as never, res as never);
    expect(res.statusCode).toBe(403);
    expect(logSpy).not.toHaveBeenCalled();
  });

  // ── UA filtering ──
  it('blocks bot user agents and supports custom logger', async () => {
    const logger = vi.fn();
    const pp = new PocketPing({ uaFilter: { enabled: true, logger } });
    const req = makeReq({ url: '/connect', headers: { host: 'l', 'user-agent': 'curl/8.0' }, body: { visitorId: 'v' } });
    const res = makeRes();
    await pp.middleware()(req as never, res as never);
    expect(res.statusCode).toBe(403);
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ type: 'blocked' }));
  });

  it('logs UA blocks with default logger when no custom logger', async () => {
    const pp = new PocketPing({ uaFilter: { enabled: true } });
    const req = makeReq({ url: '/connect', headers: { host: 'l', 'user-agent': 'Googlebot/2.1' }, body: { visitorId: 'v' } });
    const res = makeRes();
    await pp.middleware()(req as never, res as never);
    expect(res.statusCode).toBe(403);
    expect(logSpy).toHaveBeenCalled();
  });

  // ── Version gating ──
  it('rejects unsupported widget versions with 426', async () => {
    const pp = new PocketPing({ minWidgetVersion: '1.0.0' });
    const req = makeReq({
      url: '/connect',
      headers: { host: 'l', 'x-pocketping-version': '0.1.0' },
      body: { visitorId: 'v' },
    });
    const res = makeRes();
    await pp.middleware()(req as never, res as never);
    expect(res.statusCode).toBe(426);
    expect(res.headers['x-pocketping-version-status']).toBe('unsupported');
  });

  it('sets deprecation headers but continues for outdated versions', async () => {
    vi.useFakeTimers();
    const pp = new PocketPing({ latestWidgetVersion: '2.0.0' });
    const req = makeReq({
      url: '/connect',
      headers: { host: 'l', 'x-pocketping-version': '1.0.0' },
      body: { visitorId: 'v' },
    });
    const res = makeRes();
    await pp.middleware()(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-pocketping-version-status']).toBe('deprecated');
    // exercise the scheduled WebSocket version warning timer
    vi.advanceTimersByTime(600);
    vi.useRealTimers();
  });
});

describe('PocketPing version checks (unit)', () => {
  it('returns ok when no version header', () => {
    const pp = new PocketPing({ minWidgetVersion: '1.0.0' });
    const r = pp.checkWidgetVersion(undefined);
    expect(r.status).toBe('ok');
    expect(r.canContinue).toBe(true);
  });

  it('returns ok when no constraints configured', () => {
    const pp = new PocketPing();
    expect(pp.checkWidgetVersion('1.2.3').status).toBe('ok');
  });

  it('flags outdated (minor behind) vs deprecated (major behind)', () => {
    const pp = new PocketPing({ latestWidgetVersion: '1.5.0' });
    expect(pp.checkWidgetVersion('1.4.0').status).toBe('outdated');
    const pp2 = new PocketPing({ latestWidgetVersion: '3.0.0' });
    expect(pp2.checkWidgetVersion('1.0.0').status).toBe('deprecated');
  });

  it('uses a custom version warning message', () => {
    const pp = new PocketPing({ minWidgetVersion: '2.0.0', versionWarningMessage: 'Upgrade!' });
    expect(pp.checkWidgetVersion('1.0.0').message).toBe('Upgrade!');
  });

  it('sendVersionWarning is a no-op for ok status and runs otherwise', () => {
    const pp = new PocketPing();
    const ok: VersionCheckResult = { status: 'ok', canContinue: true };
    expect(() => pp.sendVersionWarning('s', ok)).not.toThrow();
    const dep: VersionCheckResult = {
      status: 'deprecated',
      message: 'old',
      canContinue: true,
      minVersion: '1.0.0',
      latestVersion: '2.0.0',
    };
    expect(() => pp.sendVersionWarning('s', dep)).not.toThrow();
    const unsup: VersionCheckResult = { status: 'unsupported', canContinue: false };
    expect(() => pp.sendVersionWarning('s', unsup)).not.toThrow();
    const out: VersionCheckResult = { status: 'outdated', canContinue: true };
    expect(() => pp.sendVersionWarning('s', out)).not.toThrow();
  });
});

describe('PocketPing webhook forwarding', () => {
  let mockFetch: Mock;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    global.fetch = mockFetch as unknown as typeof fetch;
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('forwards custom events to the webhook URL with HMAC signature', async () => {
    const pp = new PocketPing({ webhookUrl: 'https://hook.test/in', webhookSecret: 'secret' });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    await pp.triggerEvent(sessionId, 'purchase', { amount: 10 });
    // fire-and-forget: allow microtasks/promise to settle
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hook.test/in',
      expect.objectContaining({ method: 'POST' })
    );
    const init = mockFetch.mock.calls[0][1];
    expect(init.headers['X-PocketPing-Signature']).toMatch(/^sha256=/);
  });

  it('does not forward when no webhookUrl is configured', async () => {
    const pp = new PocketPing();
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    await pp.triggerEvent(sessionId, 'evt', {});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('logs an error when the webhook returns a non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });
    const pp = new PocketPing({ webhookUrl: 'https://hook.test/in' });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    await pp.triggerEvent(sessionId, 'evt', {});
    await new Promise((r) => setTimeout(r, 0));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Webhook returned 500'));
  });

  it('logs an error when the webhook request rejects', async () => {
    mockFetch.mockRejectedValueOnce(Object.assign(new Error('down'), { name: 'TypeError' }));
    const pp = new PocketPing({ webhookUrl: 'https://hook.test/in' });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    await pp.triggerEvent(sessionId, 'evt', {});
    await new Promise((r) => setTimeout(r, 0));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Webhook error:'), 'down');
  });

  it('forwards identity updates to the webhook on identify', async () => {
    const pp = new PocketPing({ webhookUrl: 'https://hook.test/in' });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    await pp.handleIdentify({ sessionId, identity: { id: 'u1', email: 'a@b.com' } });
    await new Promise((r) => setTimeout(r, 0));
    const identifyCall = mockFetch.mock.calls.find((c) =>
      String(c[1].body).includes('"name":"identify"')
    );
    expect(identifyCall).toBeTruthy();
  });
});

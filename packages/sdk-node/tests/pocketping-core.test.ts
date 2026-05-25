import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// NOTE: import via `../src/index` (NOT the aliased `../src/pocketping`) so the real
// TypeScript source is loaded and counted for coverage.
import {
  DEFAULT_ALLOWED_MIME_TYPES,
  MAX_ATTACHMENT_SIZE,
  PocketPing,
  UPLOAD_URL_TTL_SECONDS,
} from '../src/index';
import type { Bridge } from '../src/bridges/types';
import type { CustomEvent, Message, Session } from '../src/types';

// ── A fully-instrumented recording bridge used to assert notify* paths ──
class RecordingBridge implements Bridge {
  name: string;
  calls: Record<string, unknown[][]> = {};
  editResult: boolean;
  deleteResult: boolean;
  msgIdToReturn?: string | number;
  throwOn?: string;

  constructor(name = 'telegram', opts: {
    editResult?: boolean;
    deleteResult?: boolean;
    msgIdToReturn?: string | number;
    throwOn?: string;
  } = {}) {
    this.name = name;
    this.editResult = opts.editResult ?? true;
    this.deleteResult = opts.deleteResult ?? true;
    this.msgIdToReturn = opts.msgIdToReturn;
    this.throwOn = opts.throwOn;
  }

  private record(method: string, args: unknown[]) {
    (this.calls[method] ??= []).push(args);
    if (this.throwOn === method) throw new Error(`${method} boom`);
  }

  async onNewSession(s: Session) {
    this.record('onNewSession', [s]);
  }
  async onVisitorMessage(m: Message, s: Session) {
    this.record('onVisitorMessage', [m, s]);
    return this.msgIdToReturn !== undefined ? { messageId: this.msgIdToReturn } : {};
  }
  async onOperatorMessage(m: Message, s: Session, src?: string, name?: string) {
    this.record('onOperatorMessage', [m, s, src, name]);
  }
  async onMessageRead(sid: string, ids: string[], status: string, s: Session) {
    this.record('onMessageRead', [sid, ids, status, s]);
  }
  async onMessageEdit(id: string, content: string, bridgeId: string | number) {
    this.record('onMessageEdit', [id, content, bridgeId]);
    return this.editResult;
  }
  async onMessageDelete(id: string, bridgeId: string | number) {
    this.record('onMessageDelete', [id, bridgeId]);
    return this.deleteResult;
  }
  async onCustomEvent(e: CustomEvent, s: Session) {
    this.record('onCustomEvent', [e, s]);
  }
  async onIdentityUpdate(s: Session) {
    this.record('onIdentityUpdate', [s]);
  }
}

describe('PocketPing core (real src)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Exported constants ──
  it('exposes attachment constants', () => {
    expect(MAX_ATTACHMENT_SIZE).toBe(10 * 1024 * 1024);
    expect(UPLOAD_URL_TTL_SECONDS).toBe(900);
    expect(DEFAULT_ALLOWED_MIME_TYPES).toContain('image/png');
  });

  // ── Storage init ──
  it('uses provided storage instance when not "memory"', async () => {
    const custom = new (await import('../src/storage/memory')).MemoryStorage();
    const pp = new PocketPing({ storage: custom });
    expect(pp.getStorage()).toBe(custom);
  });

  // ── handleConnect: returning visitor metadata/identity merge ──
  it('merges metadata + identity on returning visitor and preserves server geo fields', async () => {
    const pp = new PocketPing();
    const first = await pp.handleConnect({
      visitorId: 'v1',
      metadata: { url: 'https://a.com', ip: '1.1.1.1', country: 'FR', city: 'Paris' },
    });

    const second = await pp.handleConnect({
      visitorId: 'v1',
      sessionId: first.sessionId,
      metadata: { url: 'https://b.com' },
      identity: { id: 'u1', name: 'Bob' },
    });

    expect(second.sessionId).toBe(first.sessionId);
    const session = await pp.getSession(first.sessionId);
    expect(session?.metadata?.url).toBe('https://b.com');
    // server-side geo fields preserved from the first connect
    expect(session?.metadata?.ip).toBe('1.1.1.1');
    expect(session?.metadata?.country).toBe('FR');
    expect(session?.metadata?.city).toBe('Paris');
    expect(session?.identity?.id).toBe('u1');
  });

  it('finds an existing session by visitorId when no sessionId is given', async () => {
    const pp = new PocketPing();
    const first = await pp.handleConnect({ visitorId: 'v-find' });
    const again = await pp.handleConnect({ visitorId: 'v-find' });
    expect(again.sessionId).toBe(first.sessionId);
  });

  // ── handleMessage: operator activity + AI disable ──
  it('records operator activity and disables AI on operator messages', async () => {
    const pp = new PocketPing();
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    await pp.handleMessage({ sessionId, content: 'hi', sender: 'operator' });
    const session = await pp.getSession(sessionId);
    expect(session?.aiActive).toBe(false);
  });

  it('attaches inline attachments on a message', async () => {
    const pp = new PocketPing();
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    const res = await pp.handleMessage({
      sessionId,
      content: 'see file',
      sender: 'operator',
      attachments: [
        {
          id: 'a1',
          messageId: null,
          filename: 'f.png',
          mimeType: 'image/png',
          size: 10,
          url: 'http://x/a1',
          status: 'ready',
        },
      ],
    });
    const msg = await pp.getStorage().getMessage(res.messageId);
    expect(msg?.attachments?.[0].filename).toBe('f.png');
  });

  // ── handleGetMessages pagination ──
  it('paginates with hasMore + after cursor', async () => {
    const pp = new PocketPing();
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push((await pp.handleMessage({ sessionId, content: `m${i}`, sender: 'visitor' })).messageId);
    }
    const page = await pp.handleGetMessages({ sessionId, limit: 2 });
    expect(page.messages).toHaveLength(2);
    expect(page.hasMore).toBe(true);

    const next = await pp.handleGetMessages({ sessionId, after: page.messages[1].id, limit: 50 });
    expect(next.messages).toHaveLength(2);
    expect(next.hasMore).toBe(false);
  });

  // ── handleTyping ──
  it('handleTyping returns ok', async () => {
    const pp = new PocketPing();
    expect(await pp.handleTyping({ sessionId: 's', sender: 'visitor' })).toEqual({ ok: true });
    expect(await pp.handleTyping({ sessionId: 's', sender: 'operator', isTyping: false })).toEqual({
      ok: true,
    });
  });

  it('isOperatorOnline reflects setOperatorOnline', () => {
    const pp = new PocketPing();
    expect(pp.isOperatorOnline()).toBe(false);
    pp.setOperatorOnline(true);
    expect(pp.isOperatorOnline()).toBe(true);
  });

  // ── handleRead: delivered + read transitions, bridge notify ──
  it('marks messages delivered then read, and notifies bridges', async () => {
    const bridge = new RecordingBridge('telegram');
    const pp = new PocketPing({ bridges: [bridge] });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    const m = await pp.handleMessage({ sessionId, content: 'hi', sender: 'operator' });

    const delivered = await pp.handleRead({
      sessionId,
      messageIds: [m.messageId],
      status: 'delivered',
    });
    expect(delivered.updated).toBe(1);

    const read = await pp.handleRead({ sessionId, messageIds: [m.messageId] }); // default 'read'
    expect(read.updated).toBeGreaterThanOrEqual(1);

    const stored = await pp.getStorage().getMessage(m.messageId);
    expect(stored?.status).toBe('read');
    expect(stored?.deliveredAt).toBeInstanceOf(Date);
    expect(stored?.readAt).toBeInstanceOf(Date);
    expect(bridge.calls.onMessageRead).toHaveLength(2);
  });

  it('handleRead throws for unknown session', async () => {
    const pp = new PocketPing();
    await expect(pp.handleRead({ sessionId: 'nope', messageIds: ['x'] })).rejects.toThrow(
      'Session not found'
    );
  });

  // ── handleDisconnect: duration formatting branches ──
  it.each([
    [30, '30s'],
    [120, '2 min'],
    [3600, '1h'],
    [3660, '1h 1min'],
  ])('handleDisconnect formats duration %i -> %s', async (duration, expected) => {
    const onVisitorDisconnect = vi.fn();
    const pp = new PocketPing({ onVisitorDisconnect });
    const { sessionId } = await pp.handleConnect({
      visitorId: 'v1',
      identity: { id: 'u', name: 'Alice' },
    });
    const res = await pp.handleDisconnect({ sessionId, duration, reason: 'manual' });
    expect(res.ok).toBe(true);
    expect(onVisitorDisconnect).toHaveBeenCalledWith(
      expect.objectContaining({ id: sessionId }),
      duration
    );
    expect(expected.length).toBeGreaterThan(0);
  });

  it('handleDisconnect derives visitor name from email when no name', async () => {
    const pp = new PocketPing();
    const { sessionId } = await pp.handleConnect({
      visitorId: 'v1',
      identity: { id: 'u', email: 'jane.doe@x.com' },
    });
    const res = await pp.handleDisconnect({ sessionId, duration: 5, reason: 'inactivity' });
    expect(res.ok).toBe(true);
  });

  it('handleDisconnect throws for unknown session', async () => {
    const pp = new PocketPing();
    await expect(
      pp.handleDisconnect({ sessionId: 'nope', duration: 1, reason: 'manual' })
    ).rejects.toThrow('Session not found');
  });

  it('notifies bridges that implement notifyDisconnect and swallows their errors', async () => {
    const good = { name: 'good', notifyDisconnect: vi.fn().mockResolvedValue(undefined) };
    const bad = {
      name: 'bad',
      notifyDisconnect: vi.fn().mockRejectedValue(new Error('disc boom')),
    };
    const pp = new PocketPing({ bridges: [good as never, bad as never] });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    await pp.handleDisconnect({ sessionId, duration: 10, reason: 'manual' });
    expect(good.notifyDisconnect).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  // ── handleVisibility ──
  it('handleVisibility updates lastActivity when visible and throws on unknown', async () => {
    const pp = new PocketPing();
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    expect(await pp.handleVisibility({ sessionId, state: 'visible', timestamp: 1 })).toEqual({
      ok: true,
    });
    expect(await pp.handleVisibility({ sessionId, state: 'hidden', timestamp: 2 })).toEqual({
      ok: true,
    });
    await expect(
      pp.handleVisibility({ sessionId: 'nope', state: 'visible', timestamp: 1 })
    ).rejects.toThrow('Session not found');
  });

  // ── Edit/Delete validation branches ──
  describe('handleEditMessage', () => {
    let pp: PocketPing;
    let sessionId: string;
    let messageId: string;

    beforeEach(async () => {
      pp = new PocketPing();
      sessionId = (await pp.handleConnect({ visitorId: 'v1' })).sessionId;
      messageId = (await pp.handleMessage({ sessionId, content: 'orig', sender: 'visitor' }))
        .messageId;
    });

    it('edits a visitor message', async () => {
      const res = await pp.handleEditMessage({ sessionId, messageId, content: '  new text  ' });
      expect(res.message.content).toBe('new text');
      expect(res.message.editedAt).toBeDefined();
    });

    it('throws unknown session', async () => {
      await expect(
        pp.handleEditMessage({ sessionId: 'x', messageId, content: 'a' })
      ).rejects.toThrow('Session not found');
    });

    it('throws message not found', async () => {
      await expect(
        pp.handleEditMessage({ sessionId, messageId: 'x', content: 'a' })
      ).rejects.toThrow('Message not found');
    });

    it('throws when message belongs to a different session', async () => {
      const other = (await pp.handleConnect({ visitorId: 'v2' })).sessionId;
      await expect(
        pp.handleEditMessage({ sessionId: other, messageId, content: 'a' })
      ).rejects.toThrow('does not belong');
    });

    it('throws when editing a deleted message', async () => {
      await pp.handleDeleteMessage({ sessionId, messageId });
      await expect(
        pp.handleEditMessage({ sessionId, messageId, content: 'a' })
      ).rejects.toThrow('Cannot edit deleted message');
    });

    it('throws when editing a non-visitor message', async () => {
      const opMsg = (await pp.handleMessage({ sessionId, content: 'op', sender: 'operator' }))
        .messageId;
      await expect(
        pp.handleEditMessage({ sessionId, messageId: opMsg, content: 'a' })
      ).rejects.toThrow('Cannot edit this message');
    });

    it('throws on empty content', async () => {
      await expect(
        pp.handleEditMessage({ sessionId, messageId, content: '   ' })
      ).rejects.toThrow('Content is required');
    });

    it('throws on content exceeding max length', async () => {
      await expect(
        pp.handleEditMessage({ sessionId, messageId, content: 'x'.repeat(4001) })
      ).rejects.toThrow('exceeds maximum length');
    });
  });

  describe('handleDeleteMessage', () => {
    let pp: PocketPing;
    let sessionId: string;
    let messageId: string;

    beforeEach(async () => {
      pp = new PocketPing();
      sessionId = (await pp.handleConnect({ visitorId: 'v1' })).sessionId;
      messageId = (await pp.handleMessage({ sessionId, content: 'orig', sender: 'visitor' }))
        .messageId;
    });

    it('soft-deletes a visitor message', async () => {
      const res = await pp.handleDeleteMessage({ sessionId, messageId });
      expect(res.deleted).toBe(true);
      const stored = await pp.getStorage().getMessage(messageId);
      expect(stored?.deletedAt).toBeInstanceOf(Date);
    });

    it('throws unknown session / message / wrong session / already deleted / non-visitor', async () => {
      await expect(
        pp.handleDeleteMessage({ sessionId: 'x', messageId })
      ).rejects.toThrow('Session not found');
      await expect(
        pp.handleDeleteMessage({ sessionId, messageId: 'x' })
      ).rejects.toThrow('Message not found');

      const other = (await pp.handleConnect({ visitorId: 'v2' })).sessionId;
      await expect(
        pp.handleDeleteMessage({ sessionId: other, messageId })
      ).rejects.toThrow('does not belong');

      await pp.handleDeleteMessage({ sessionId, messageId });
      await expect(
        pp.handleDeleteMessage({ sessionId, messageId })
      ).rejects.toThrow('already deleted');

      const opMsg = (await pp.handleMessage({ sessionId, content: 'op', sender: 'operator' }))
        .messageId;
      await expect(
        pp.handleDeleteMessage({ sessionId, messageId: opMsg })
      ).rejects.toThrow('Cannot delete this message');
    });
  });

  // ── Attachments ──
  describe('attachments', () => {
    let pp: PocketPing;
    let sessionId: string;

    beforeEach(async () => {
      pp = new PocketPing();
      sessionId = (await pp.handleConnect({ visitorId: 'v1' })).sessionId;
    });

    it('creates a pending attachment + presigned url', async () => {
      const res = await pp.handleUploadRequest({
        sessionId,
        filename: 'pic.png',
        mimeType: 'image/png',
        size: 1000,
      });
      expect(res.attachmentId).toBeTruthy();
      expect(res.uploadUrl).toContain(res.attachmentId);
      expect(res.expiresAt).toBeInstanceOf(Date);
      const att = await pp.getStorage().getAttachment!(res.attachmentId);
      expect(att?.status).toBe('pending');
    });

    it('rejects unknown session, bad mime, and oversized files', async () => {
      await expect(
        pp.handleUploadRequest({ sessionId: 'x', filename: 'f', mimeType: 'image/png', size: 1 })
      ).rejects.toThrow('Session not found');
      await expect(
        pp.handleUploadRequest({ sessionId, filename: 'f', mimeType: 'application/x-evil', size: 1 })
      ).rejects.toThrow('Invalid mime type');
      await expect(
        pp.handleUploadRequest({ sessionId, filename: 'f', mimeType: 'image/png', size: 0 })
      ).rejects.toThrow('File too large');
      await expect(
        pp.handleUploadRequest({
          sessionId,
          filename: 'f',
          mimeType: 'image/png',
          size: MAX_ATTACHMENT_SIZE + 1,
        })
      ).rejects.toThrow('File too large');
    });

    it('completes and fails an attachment', async () => {
      const { attachmentId } = await pp.handleUploadRequest({
        sessionId,
        filename: 'a.png',
        mimeType: 'image/png',
        size: 5,
      });
      const ready = await pp.handleUploadComplete(attachmentId);
      expect(ready.status).toBe('ready');

      const { attachmentId: id2 } = await pp.handleUploadRequest({
        sessionId,
        filename: 'b.png',
        mimeType: 'image/png',
        size: 5,
      });
      const failed = await pp.handleUploadFailed(id2);
      expect(failed.status).toBe('failed');
    });

    it('throws when completing/failing an unknown attachment', async () => {
      await expect(pp.handleUploadComplete('nope')).rejects.toThrow('Attachment not found');
      await expect(pp.handleUploadFailed('nope')).rejects.toThrow('Attachment not found');
    });

    it('links uploaded attachments to a message via attachmentIds', async () => {
      const { attachmentId } = await pp.handleUploadRequest({
        sessionId,
        filename: 'a.png',
        mimeType: 'image/png',
        size: 5,
      });
      await pp.handleUploadComplete(attachmentId);
      const res = await pp.handleMessage({
        sessionId,
        content: 'with file',
        sender: 'visitor',
        attachmentIds: [attachmentId, 'missing-id'],
      });
      const msg = await pp.getStorage().getMessage(res.messageId);
      expect(msg?.attachments?.map((a) => a.id)).toEqual([attachmentId]);
    });

    it('throws when storage lacks attachment support', async () => {
      const minimalStorage = {
        createSession: vi.fn(),
        getSession: vi.fn().mockResolvedValue({ id: 's' }),
        updateSession: vi.fn(),
        deleteSession: vi.fn(),
        saveMessage: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
        getMessage: vi.fn(),
      };
      const pp2 = new PocketPing({ storage: minimalStorage as never });
      await expect(pp2.handleUploadComplete('a')).rejects.toThrow(
        'Storage does not support attachments'
      );
      await expect(pp2.handleUploadFailed('a')).rejects.toThrow(
        'Storage does not support attachments'
      );
    });
  });

  // ── Custom events: handlers, wildcard, unsubscribe, error handling ──
  describe('custom events', () => {
    it('runs specific + wildcard handlers, config callback, bridges and swallows errors', async () => {
      const bridge = new RecordingBridge('discord');
      const onEvent = vi.fn();
      const specific = vi.fn();
      const wildcard = vi.fn();
      const throwing = vi.fn(() => {
        throw new Error('handler boom');
      });
      const pp = new PocketPing({ bridges: [bridge], onEvent });
      const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });

      const off = pp.onEvent('clicked', specific);
      pp.onEvent('clicked', throwing);
      pp.onEvent('*', wildcard);

      await pp.triggerEvent(sessionId, 'clicked', { plan: 'pro' });
      expect(specific).toHaveBeenCalled();
      expect(wildcard).toHaveBeenCalled();
      expect(onEvent).toHaveBeenCalled();
      expect(bridge.calls.onCustomEvent).toHaveLength(1);
      expect(consoleErrorSpy).toHaveBeenCalled();

      // unsubscribe via returned fn + offEvent
      off();
      pp.offEvent('*', wildcard);
      specific.mockClear();
      wildcard.mockClear();
      await pp.triggerEvent(sessionId, 'clicked', {});
      expect(specific).not.toHaveBeenCalled();
      expect(wildcard).not.toHaveBeenCalled();
    });

    it('warns and bails for events on unknown session', async () => {
      const pp = new PocketPing();
      await pp.triggerEvent('ghost', 'evt');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown session')
      );
    });
  });

  // ── Bridge notify error handling ──
  it('swallows bridge errors during new_session / message / read / event / identity', async () => {
    const sessionBridge = new RecordingBridge('telegram', { throwOn: 'onNewSession' });
    const pp = new PocketPing({ bridges: [sessionBridge] });
    await pp.handleConnect({ visitorId: 'v1' });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('persists bridge message ids for telegram/discord/slack visitor messages', async () => {
    for (const [name, key] of [
      ['telegram', 'telegramMessageId'],
      ['discord', 'discordMessageId'],
      ['slack', 'slackMessageTs'],
    ] as const) {
      const bridge = new RecordingBridge(name, { msgIdToReturn: name === 'telegram' ? 42 : 'ts-1' });
      const pp = new PocketPing({ bridges: [bridge] });
      const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
      const res = await pp.handleMessage({ sessionId, content: 'hi', sender: 'visitor' });
      const ids = await pp.getStorage().getBridgeMessageIds!(res.messageId);
      expect(ids?.[key]).toBeDefined();
    }
  });

  // ── Edit/Delete bridge sync ──
  it('syncs edit + delete to bridges using stored bridge message ids', async () => {
    const telegram = new RecordingBridge('telegram', { msgIdToReturn: 99 });
    const discord = new RecordingBridge('discord', { msgIdToReturn: 'd1' });
    const slack = new RecordingBridge('slack', { msgIdToReturn: 's1' });
    const pp = new PocketPing({ bridges: [telegram, discord, slack] });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    const { messageId } = await pp.handleMessage({ sessionId, content: 'hi', sender: 'visitor' });

    await pp.handleEditMessage({ sessionId, messageId, content: 'edited' });
    expect(telegram.calls.onMessageEdit?.[0]).toEqual([messageId, 'edited', 99]);
    expect(discord.calls.onMessageEdit?.[0]).toEqual([messageId, 'edited', 'd1']);
    expect(slack.calls.onMessageEdit?.[0]).toEqual([messageId, 'edited', 's1']);

    await pp.handleDeleteMessage({ sessionId, messageId });
    expect(telegram.calls.onMessageDelete?.[0]).toEqual([messageId, 99]);
    expect(discord.calls.onMessageDelete?.[0]).toEqual([messageId, 'd1']);
    expect(slack.calls.onMessageDelete?.[0]).toEqual([messageId, 's1']);
  });

  it('edit/delete sync is a no-op when no bridge ids are stored', async () => {
    const bridge = new RecordingBridge('telegram'); // returns no messageId
    const pp = new PocketPing({ bridges: [bridge] });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    const { messageId } = await pp.handleMessage({ sessionId, content: 'hi', sender: 'visitor' });
    await pp.handleEditMessage({ sessionId, messageId, content: 'edited' });
    await pp.handleDeleteMessage({ sessionId, messageId });
    expect(bridge.calls.onMessageEdit).toBeUndefined();
    expect(bridge.calls.onMessageDelete).toBeUndefined();
  });

  it('swallows errors thrown by bridge edit/delete handlers', async () => {
    const bridge = new RecordingBridge('telegram', { msgIdToReturn: 5, throwOn: 'onMessageEdit' });
    const pp = new PocketPing({ bridges: [bridge] });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    const { messageId } = await pp.handleMessage({ sessionId, content: 'hi', sender: 'visitor' });
    await pp.handleEditMessage({ sessionId, messageId, content: 'edited' });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  // ── sendOperatorMessage ──
  it('sendOperatorMessage stores and returns an operator message', async () => {
    const pp = new PocketPing();
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    const msg = await pp.sendOperatorMessage(sessionId, 'reply');
    expect(msg.sender).toBe('operator');
    expect(msg.content).toBe('reply');
    expect(msg.timestamp).toBeInstanceOf(Date);
  });

  // ── emitEvent / broadcastEvent are no-ops without sockets but should not crash ──
  it('emitEvent and broadcastEvent run without sockets', () => {
    const pp = new PocketPing();
    expect(() => pp.emitEvent('s', 'evt', { a: 1 })).not.toThrow();
    expect(() => pp.broadcastEvent('evt', { a: 1 })).not.toThrow();
  });

  it('falls back to saveMessage when storage lacks updateMessage (edit + delete)', async () => {
    const messages = new Map<string, Message>();
    const session: Session = {
      id: 's',
      visitorId: 'v',
      createdAt: new Date(),
      lastActivity: new Date(),
      operatorOnline: false,
      aiActive: false,
    };
    const storage = {
      createSession: vi.fn(),
      getSession: vi.fn().mockResolvedValue(session),
      updateSession: vi.fn(),
      deleteSession: vi.fn(),
      saveMessage: vi.fn(async (m: Message) => {
        messages.set(m.id, m);
      }),
      getMessages: vi.fn().mockResolvedValue([]),
      getMessage: vi.fn(async (id: string) => messages.get(id) ?? null),
      // no updateMessage, no getBridgeMessageIds
    };
    const pp = new PocketPing({ storage: storage as never });
    const msg: Message = {
      id: 'm1',
      sessionId: 's',
      content: 'orig',
      sender: 'visitor',
      timestamp: new Date(),
    };
    messages.set('m1', msg);

    await pp.handleEditMessage({ sessionId: 's', messageId: 'm1', content: 'updated' });
    expect(messages.get('m1')?.content).toBe('updated');

    await pp.handleDeleteMessage({ sessionId: 's', messageId: 'm1' });
    expect(messages.get('m1')?.deletedAt).toBeInstanceOf(Date);
  });
});

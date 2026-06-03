import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PocketPing, computeStats } from '../src/index';
import type { Bridge } from '../src/bridges/types';
import type { Message, Session } from '../src/types';

class NotifyBridge implements Bridge {
  name = 'telegram';
  disconnectCalls: Array<{ session: Session; message: string }> = [];
  async onNewSession() {}
  async onVisitorMessage() {
    return {};
  }
  async onOperatorMessage() {}
  async notifyDisconnect(session: Session, message: string) {
    this.disconnectCalls.push({ session, message });
  }
}

describe('CSAT (SDK)', () => {
  let bridge: NotifyBridge;
  let pp: PocketPing;

  beforeEach(() => {
    bridge = new NotifyBridge();
    pp = new PocketPing({ bridges: [bridge] });
  });

  async function newSession(): Promise<string> {
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    return sessionId;
  }

  it('requestCsat sets pending + broadcasts csat_request', async () => {
    const sessionId = await newSession();
    const spy = vi.spyOn(
      pp as unknown as { broadcastToSession: (s: string, e: unknown) => void },
      'broadcastToSession'
    );
    await pp.requestCsat(sessionId);

    const session = await pp.getSession(sessionId);
    expect(session?.csat?.pending).toBe(true);
    expect(session?.csat?.requestedAt).toBeInstanceOf(Date);
    expect(spy).toHaveBeenCalledWith(sessionId, expect.objectContaining({ type: 'csat_request' }));
  });

  it('handleCsat stores the score, clears pending, notifies bridge, runs onCsat', async () => {
    const onCsat = vi.fn();
    pp = new PocketPing({ bridges: [bridge], onCsat });
    const sessionId = await newSession();
    await pp.requestCsat(sessionId);

    const res = await pp.handleCsat({ sessionId, score: 5, comment: '  great  ' });
    expect(res).toEqual({ ok: true });

    const session = await pp.getSession(sessionId);
    expect(session?.csat?.score).toBe(5);
    expect(session?.csat?.comment).toBe('great');
    expect(session?.csat?.pending).toBe(false);
    expect(session?.csat?.respondedAt).toBeInstanceOf(Date);

    expect(bridge.disconnectCalls.at(-1)?.message).toBe('⭐ 😍 5/5 — "great"');
    expect(onCsat).toHaveBeenCalledWith(expect.any(Object), { score: 5, comment: 'great' });
  });

  it('rejects an out-of-range score', async () => {
    const sessionId = await newSession();
    await expect(pp.handleCsat({ sessionId, score: 0 })).rejects.toThrow(/1-5/);
    await expect(pp.handleCsat({ sessionId, score: 6 })).rejects.toThrow(/1-5/);
  });

  it('is idempotent once rated', async () => {
    const sessionId = await newSession();
    await pp.handleCsat({ sessionId, score: 4 });
    const second = await pp.handleCsat({ sessionId, score: 1 });
    expect(second).toEqual({ ok: true, alreadyRated: true });
    const session = await pp.getSession(sessionId);
    expect(session?.csat?.score).toBe(4); // unchanged
  });

  it('throws when the session does not exist', async () => {
    await expect(pp.handleCsat({ sessionId: 'nope', score: 3 })).rejects.toThrow('Session not found');
    await expect(pp.requestCsat('nope')).rejects.toThrow('Session not found');
  });
});

describe('getStats (SDK)', () => {
  it('computes conversations, response rate and CSAT over storage', async () => {
    const pp = new PocketPing();
    const a = await pp.handleConnect({ visitorId: 'va' });
    const b = await pp.handleConnect({ visitorId: 'vb' });

    // Session A: visitor msg + operator reply + 5★ rating
    await pp.handleMessage({ sessionId: a.sessionId, content: 'hi', sender: 'visitor' });
    await pp.sendOperatorMessage(a.sessionId, 'hello!');
    await pp.handleCsat({ sessionId: a.sessionId, score: 5 });

    // Session B: visitor msg only (unanswered)
    await pp.handleMessage({ sessionId: b.sessionId, content: 'anyone?', sender: 'visitor' });

    const stats = await pp.getStats();
    expect(stats.conversations).toBe(2);
    expect(stats.responseRate).toBe(0.5);
    expect(stats.unansweredNow).toBe(1);
    expect(stats.csat).toEqual({ percent: 1, average: 5, responses: 1 });
    expect(stats.conversationsSparkline).toHaveLength(7);
  });

  it('throws a helpful error when storage cannot list sessions', async () => {
    const storage = {
      createSession: async () => {},
      getSession: async () => null,
      updateSession: async () => {},
      deleteSession: async () => {},
      saveMessage: async () => {},
      getMessages: async () => [],
      getMessage: async () => null,
    };
    const pp = new PocketPing({ storage: storage as never });
    await expect(pp.getStats()).rejects.toThrow(/listSessions/);
  });
});

describe('computeStats windowing', () => {
  const from = new Date('2026-06-01T00:00:00Z');
  const to = new Date('2026-06-08T00:00:00Z');
  const inWindow = new Date('2026-06-04T00:00:00Z');
  const beforeWindow = new Date('2026-05-20T00:00:00Z');
  const afterWindow = new Date('2026-06-20T00:00:00Z');

  function session(over: Partial<Session>): Session {
    return {
      id: 's',
      visitorId: 'v',
      createdAt: inWindow,
      lastActivity: inWindow,
      operatorOnline: false,
      aiActive: false,
      ...over,
    } as Session;
  }
  function msg(sender: Message['sender'], timestamp: Date): Message {
    return { id: 'm', sessionId: 's', content: 'x', sender, timestamp } as Message;
  }

  it('counts messages by their own timestamp, not the conversation window', () => {
    const stats = computeStats(
      [
        {
          session: session({}),
          messages: [msg('visitor', inWindow), msg('operator', afterWindow)],
        },
      ],
      { from, to }
    );
    expect(stats.messages).toBe(1); // the afterWindow operator message is excluded
  });

  it('counts a rating only when submitted within the window', () => {
    const counted = computeStats(
      [{ session: session({ csat: { score: 5, respondedAt: inWindow } }), messages: [] }],
      { from, to }
    );
    expect(counted.csat.responses).toBe(1);

    const excluded = computeStats(
      [
        { session: session({ csat: { score: 5, respondedAt: afterWindow } }), messages: [] },
        { session: session({ csat: { score: 1, respondedAt: beforeWindow } }), messages: [] },
      ],
      { from, to }
    );
    expect(excluded.csat.responses).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../src/storage/memory';
import type { Message, Session } from '../src/types';

function createSession(overrides: Partial<Session> = {}): Session {
  const now = new Date();
  return {
    id: `sess_${Math.random().toString(36).slice(2)}`,
    visitorId: `visitor_${Math.random().toString(36).slice(2)}`,
    createdAt: now,
    lastActivity: now,
    operatorOnline: false,
    aiActive: false,
    ...overrides,
  };
}

function createMessage(sessionId: string, overrides: Partial<Message> = {}): Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    sessionId,
    content: 'Hello',
    sender: 'visitor',
    timestamp: new Date(),
    ...overrides,
  };
}

describe('MemoryStorage', () => {
  it('creates and fetches sessions', async () => {
    const storage = new MemoryStorage();
    const session = createSession({ visitorId: 'visitor-1' });

    await storage.createSession(session);

    const fetched = await storage.getSession(session.id);
    expect(fetched).toEqual(session);
  });

  it('updates sessions', async () => {
    const storage = new MemoryStorage();
    const session = createSession({ visitorId: 'visitor-1' });
    await storage.createSession(session);

    const updated = { ...session, visitorId: 'visitor-2' };
    await storage.updateSession(updated);

    const fetched = await storage.getSession(session.id);
    expect(fetched?.visitorId).toBe('visitor-2');
  });

  it('deletes sessions and associated messages', async () => {
    const storage = new MemoryStorage();
    const session = createSession();
    await storage.createSession(session);

    const message = createMessage(session.id);
    await storage.saveMessage(message);

    await storage.deleteSession(session.id);

    const fetchedSession = await storage.getSession(session.id);
    const messages = await storage.getMessages(session.id);
    expect(fetchedSession).toBeNull();
    expect(messages).toEqual([]);
  });

  it('returns latest session by visitorId', async () => {
    const storage = new MemoryStorage();
    const older = createSession({
      visitorId: 'visitor-1',
      lastActivity: new Date('2024-01-01T00:00:00.000Z'),
    });
    const newer = createSession({
      visitorId: 'visitor-1',
      lastActivity: new Date('2024-01-02T00:00:00.000Z'),
    });

    await storage.createSession(older);
    await storage.createSession(newer);

    const latest = await storage.getSessionByVisitorId('visitor-1');
    expect(latest?.id).toBe(newer.id);
  });

  it('saves and retrieves messages with limit and after', async () => {
    const storage = new MemoryStorage();
    const session = createSession();
    await storage.createSession(session);

    const msg1 = createMessage(session.id, { id: 'msg-1' });
    const msg2 = createMessage(session.id, { id: 'msg-2' });
    const msg3 = createMessage(session.id, { id: 'msg-3' });

    await storage.saveMessage(msg1);
    await storage.saveMessage(msg2);
    await storage.saveMessage(msg3);

    const firstTwo = await storage.getMessages(session.id, undefined, 2);
    expect(firstTwo.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);

    const afterMsg2 = await storage.getMessages(session.id, 'msg-2');
    expect(afterMsg2.map((m) => m.id)).toEqual(['msg-3']);
  });

  it('fetches message by id', async () => {
    const storage = new MemoryStorage();
    const session = createSession();
    await storage.createSession(session);

    const message = createMessage(session.id, { id: 'msg-1' });
    await storage.saveMessage(message);

    const fetched = await storage.getMessage('msg-1');
    expect(fetched).toEqual(message);
  });

  it('cleans up sessions older than date', async () => {
    const storage = new MemoryStorage();
    const oldSession = createSession({
      lastActivity: new Date('2023-01-01T00:00:00.000Z'),
    });
    const newSession = createSession({
      lastActivity: new Date('2024-01-01T00:00:00.000Z'),
    });

    await storage.createSession(oldSession);
    await storage.createSession(newSession);

    const removed = await storage.cleanupOldSessions(
      new Date('2023-12-31T00:00:00.000Z')
    );

    expect(removed).toBe(1);
    expect(await storage.getSession(oldSession.id)).toBeNull();
    expect(await storage.getSession(newSession.id)).not.toBeNull();
  });
});

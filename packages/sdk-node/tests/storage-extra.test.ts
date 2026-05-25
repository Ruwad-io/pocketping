import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../src/storage/memory';
import type { Attachment, Message, Session } from '../src/types';

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's1',
  visitorId: 'v1',
  createdAt: new Date(),
  lastActivity: new Date(),
  operatorOnline: false,
  aiActive: false,
  ...overrides,
});

const msg = (overrides: Partial<Message> = {}): Message => ({
  id: 'm1',
  sessionId: 's1',
  content: 'hi',
  sender: 'visitor',
  timestamp: new Date(),
  ...overrides,
});

const att = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'a1',
  messageId: 'm1',
  filename: 'f.png',
  mimeType: 'image/png',
  size: 10,
  url: 'http://x/a1',
  status: 'ready',
  ...overrides,
});

describe('MemoryStorage extra', () => {
  it('returns null for missing session/message and empty visitorId lookups', async () => {
    const s = new MemoryStorage();
    expect(await s.getSession('x')).toBeNull();
    expect(await s.getMessage('x')).toBeNull();
    expect(await s.getSessionByVisitorId('nobody')).toBeNull();
  });

  it('getMessages ignores an unknown "after" id (returns from start)', async () => {
    const s = new MemoryStorage();
    await s.createSession(session());
    await s.saveMessage(msg({ id: 'm1' }));
    await s.saveMessage(msg({ id: 'm2' }));
    const all = await s.getMessages('s1', 'unknown-id');
    expect(all.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('hydrates messages with linked attachments only when message has none', async () => {
    const s = new MemoryStorage();
    await s.createSession(session());
    await s.saveMessage(msg({ id: 'm1' }));
    await s.saveAttachment(att({ id: 'a1', messageId: 'm1' }));

    const hydrated = await s.getMessage('m1');
    expect(hydrated?.attachments?.map((a) => a.id)).toEqual(['a1']);

    // message that already carries attachments is returned untouched
    await s.saveMessage(msg({ id: 'm2', attachments: [att({ id: 'inline' })] }));
    const m2 = await s.getMessage('m2');
    expect(m2?.attachments?.map((a) => a.id)).toEqual(['inline']);

    // message with no attachments at all
    await s.saveMessage(msg({ id: 'm3' }));
    const m3 = await s.getMessage('m3');
    expect(m3?.attachments).toBeUndefined();
  });

  it('updateMessage updates both the index and the session array', async () => {
    const s = new MemoryStorage();
    await s.createSession(session());
    await s.saveMessage(msg({ id: 'm1', content: 'orig' }));
    await s.updateMessage(msg({ id: 'm1', content: 'updated' }));
    expect((await s.getMessage('m1'))?.content).toBe('updated');
    const list = await s.getMessages('s1');
    expect(list[0].content).toBe('updated');

    // updateMessage for a message id not present in session array still updates index
    await s.updateMessage(msg({ id: 'orphan', sessionId: 's1', content: 'x' }));
    expect((await s.getMessage('orphan'))?.content).toBe('x');
  });

  it('merges bridge message ids across calls', async () => {
    const s = new MemoryStorage();
    await s.saveBridgeMessageIds('m1', { telegramMessageId: 1 });
    await s.saveBridgeMessageIds('m1', { discordMessageId: 'd1' });
    const ids = await s.getBridgeMessageIds('m1');
    expect(ids).toEqual({ telegramMessageId: 1, discordMessageId: 'd1' });
    expect(await s.getBridgeMessageIds('none')).toBeNull();
  });

  it('saves, updates and lists attachments by message', async () => {
    const s = new MemoryStorage();
    await s.saveAttachment(att({ id: 'a1', messageId: 'm1' }));
    await s.saveAttachment(att({ id: 'a2', messageId: 'm1' }));
    await s.saveAttachment(att({ id: 'a3', messageId: 'm2' }));
    expect((await s.getMessageAttachments('m1')).map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect(await s.getAttachment('a3')).not.toBeNull();
    expect(await s.getAttachment('missing')).toBeNull();

    await s.updateAttachment(att({ id: 'a1', messageId: 'm1', status: 'failed' }));
    expect((await s.getAttachment('a1'))?.status).toBe('failed');
  });
});

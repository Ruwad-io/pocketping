import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleConnect,
  handleMessage,
  handleMessages,
  handleTelegramWebhook,
  route,
  escapeHtml,
  type Env,
  type KVStore,
  type Deps,
  type TelegramClient,
  type RelayMessage,
} from '../src/index';

// ─────────────────────────────────────────────────────────────────────────
// In-memory KV stub (Map-backed, same async API as KVNamespace)
// ─────────────────────────────────────────────────────────────────────────

class MemoryKV implements KVStore {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Mocked Telegram client (records calls, returns canned ids)
// ─────────────────────────────────────────────────────────────────────────

interface RecordedCall {
  method: string;
  args: unknown[];
}

function makeMockTelegram(opts?: { topicId?: number; messageId?: number }) {
  const calls: RecordedCall[] = [];
  let topicCounter = opts?.topicId ?? 1000;
  let msgCounter = opts?.messageId ?? 500;
  const client: TelegramClient = {
    async createForumTopic(chatId, name) {
      calls.push({ method: 'createForumTopic', args: [chatId, name] });
      return { message_thread_id: topicCounter++ };
    },
    async sendMessage(chatId, text, optsArg) {
      calls.push({ method: 'sendMessage', args: [chatId, text, optsArg] });
      return { message_id: msgCounter++ };
    },
  };
  return { client, calls };
}

function makeEnv(): Env {
  return {
    PP: new MemoryKV(),
    TELEGRAM_BOT_TOKEN: 'test-token-NEVER-LEAKED',
    TELEGRAM_GROUP_ID: '-1001234567890',
  };
}

// Deterministic deps for predictable ids/timestamps.
function makeDeps(telegram: TelegramClient, seedTime = 1_700_000_000_000): Deps {
  let idCounter = 0;
  let t = seedTime;
  return {
    telegram,
    genId: () => `id-${++idCounter}`,
    now: () => new Date((t += 1000)).toISOString(),
  };
}

describe('escapeHtml', () => {
  it('escapes &, < and >', () => {
    expect(escapeHtml('a & b <c> "d"')).toBe('a &amp; b &lt;c&gt; "d"');
  });
});

describe('handleConnect', () => {
  let env: Env;
  beforeEach(() => {
    env = makeEnv();
  });

  it('creates a topic, persists mappings, and returns a sessionId', async () => {
    const { client, calls } = makeMockTelegram({ topicId: 42 });
    const deps = makeDeps(client);

    const res = await handleConnect(
      {
        visitorId: 'visitor-abc',
        metadata: { url: 'https://example.com/pricing', city: 'Paris' },
        identity: { name: 'Jane Doe', email: 'jane@example.com' },
      },
      env,
      deps
    );

    expect(res.sessionId).toBe('id-1');
    expect(res.visitorId).toBe('visitor-abc');
    expect(res.operatorOnline).toBe(false);
    expect(res.messages).toEqual([]);

    // Telegram: createForumTopic then a "new chat" sendMessage.
    expect(calls[0].method).toBe('createForumTopic');
    expect(calls[0].args[1]).toBe('Jane Doe · Paris'); // name from identity + city
    expect(calls[1].method).toBe('sendMessage');
    const sendOpts = calls[1].args[2] as { message_thread_id: number };
    expect(sendOpts.message_thread_id).toBe(42);
    expect(calls[1].args[1]).toContain('New chat');
    expect(calls[1].args[1]).toContain('jane@example.com');
    expect(calls[1].args[1]).toContain('https://example.com/pricing');

    // KV mappings persisted.
    const kv = env.PP as MemoryKV;
    const sess = JSON.parse((await kv.get('sess:id-1'))!);
    expect(sess.visitorId).toBe('visitor-abc');
    expect(sess.topicId).toBe(42);
    expect(await kv.get('topic:42')).toBe('id-1');
    expect(await kv.get('vis:visitor-abc')).toBe('id-1');
  });

  it('resumes an existing session by sessionId (no new topic)', async () => {
    const { client } = makeMockTelegram({ topicId: 7 });
    const deps = makeDeps(client);

    const first = await handleConnect({ visitorId: 'v1' }, env, deps);

    // Queue an operator message so resume returns it.
    const queued: RelayMessage[] = [
      { id: 'm1', sessionId: first.sessionId, content: 'hi', sender: 'operator', timestamp: new Date().toISOString(), status: 'sent' },
    ];
    await env.PP.put(`msgs:${first.sessionId}`, JSON.stringify(queued));

    const { client: client2, calls: calls2 } = makeMockTelegram();
    const deps2 = makeDeps(client2);
    const resumed = await handleConnect(
      { visitorId: 'v1', sessionId: first.sessionId },
      env,
      deps2
    );

    expect(resumed.sessionId).toBe(first.sessionId);
    expect(resumed.messages).toHaveLength(1);
    expect(resumed.messages[0].content).toBe('hi');
    // No telegram calls on resume.
    expect(calls2).toHaveLength(0);
  });

  it('resumes by visitorId when no sessionId is provided', async () => {
    const { client } = makeMockTelegram({ topicId: 9 });
    const first = await handleConnect({ visitorId: 'v-resume' }, env, makeDeps(client));

    const { client: c2, calls } = makeMockTelegram();
    const again = await handleConnect({ visitorId: 'v-resume' }, env, makeDeps(c2));

    expect(again.sessionId).toBe(first.sessionId);
    expect(calls).toHaveLength(0);
  });
});

describe('handleMessage', () => {
  it('sends to the right topic and returns messageId + ISO timestamp', async () => {
    const env = makeEnv();
    const { client, calls } = makeMockTelegram({ topicId: 77 });
    const deps = makeDeps(client);

    const conn = await handleConnect({ visitorId: 'v2' }, env, deps);
    calls.length = 0; // ignore connect calls

    const res = await handleMessage(
      { sessionId: conn.sessionId, content: 'Hello <script>', sender: 'visitor' },
      env,
      deps
    );

    expect(res.messageId).toMatch(/^id-/);
    expect(typeof res.timestamp).toBe('string');
    expect(() => new Date(res.timestamp).toISOString()).not.toThrow();

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('sendMessage');
    const opts = calls[0].args[2] as { message_thread_id: number };
    expect(opts.message_thread_id).toBe(77);
    // Content is HTML-escaped and prefixed with a visitor label.
    expect(calls[0].args[1]).toContain('Visitor');
    expect(calls[0].args[1]).toContain('Hello &lt;script&gt;');
  });

  it('throws 404 for an unknown session', async () => {
    const env = makeEnv();
    const { client } = makeMockTelegram();
    await expect(
      handleMessage({ sessionId: 'nope', content: 'x', sender: 'visitor' }, env, makeDeps(client))
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('handleTelegramWebhook', () => {
  let env: Env;
  let sessionId: string;
  let deps: Deps;

  beforeEach(async () => {
    env = makeEnv();
    const { client } = makeMockTelegram({ topicId: 333 });
    deps = makeDeps(client);
    const conn = await handleConnect({ visitorId: 'v3' }, env, deps);
    sessionId = conn.sessionId;
  });

  it('maps a thread reply to the session queue', async () => {
    const result = await handleTelegramWebhook(
      {
        message: {
          message_id: 9001,
          message_thread_id: 333,
          text: 'Operator reply here',
          from: { is_bot: false, first_name: 'Op' },
        },
      },
      env,
      deps
    );

    expect(result).toMatchObject({ ok: true, appended: true, sessionId });

    const queued = await handleMessages({ sessionId }, env);
    expect(queued.messages).toHaveLength(1);
    expect(queued.messages[0].content).toBe('Operator reply here');
    expect(queued.messages[0].sender).toBe('operator');
    expect(queued.messages[0].status).toBe('sent');
  });

  it('ignores bot messages, missing thread id, and service messages', async () => {
    // Bot's own message.
    await handleTelegramWebhook(
      { message: { message_thread_id: 333, text: 'echo', from: { is_bot: true } } },
      env,
      deps
    );
    // No thread id.
    await handleTelegramWebhook(
      { message: { text: 'group chatter', from: { is_bot: false } } },
      env,
      deps
    );
    // Service message (topic created).
    await handleTelegramWebhook(
      { message: { message_thread_id: 333, forum_topic_created: {}, from: { is_bot: false } } },
      env,
      deps
    );
    // Unknown topic id.
    await handleTelegramWebhook(
      { message: { message_thread_id: 99999, text: 'lost', from: { is_bot: false } } },
      env,
      deps
    );

    const queued = await handleMessages({ sessionId }, env);
    expect(queued.messages).toHaveLength(0);
  });
});

describe('handleMessages', () => {
  it('returns empty when no sessionId is given', async () => {
    const env = makeEnv();
    const res = await handleMessages({}, env);
    expect(res.messages).toEqual([]);
  });

  it('returns empty for an unknown session', async () => {
    const env = makeEnv();
    const res = await handleMessages({ sessionId: 'ghost' }, env);
    expect(res.messages).toEqual([]);
  });

  it('filters operator messages by the `after` timestamp', async () => {
    const env = makeEnv();
    const sessionId = 's-filter';
    const msgs: RelayMessage[] = [
      { id: 'a', sessionId, content: 'first', sender: 'operator', timestamp: '2026-01-01T00:00:00.000Z', status: 'sent' },
      { id: 'b', sessionId, content: 'second', sender: 'operator', timestamp: '2026-01-01T00:01:00.000Z', status: 'sent' },
      { id: 'c', sessionId, content: 'third', sender: 'operator', timestamp: '2026-01-01T00:02:00.000Z', status: 'sent' },
    ];
    await env.PP.put(`msgs:${sessionId}`, JSON.stringify(msgs));

    const all = await handleMessages({ sessionId }, env);
    expect(all.messages).toHaveLength(3);

    const after = await handleMessages(
      { sessionId, after: '2026-01-01T00:01:00.000Z' },
      env
    );
    expect(after.messages.map((m) => m.id)).toEqual(['c']);
  });
});

describe('route / CORS', () => {
  function deps() {
    return makeDeps(makeMockTelegram().client);
  }

  it('answers OPTIONS preflight with 204 and permissive CORS headers', async () => {
    const res = await route(
      new Request('https://relay.workers.dev/connect', { method: 'OPTIONS' }),
      makeEnv(),
      deps()
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-PocketPing-Version');
  });

  it('GET /health returns { status: "ok" } with CORS', async () => {
    const res = await route(
      new Request('https://relay.workers.dev/health'),
      makeEnv(),
      deps()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('POST /typing is an accepted no-op returning { ok: true }', async () => {
    const res = await route(
      new Request('https://relay.workers.dev/typing', {
        method: 'POST',
        body: JSON.stringify({ sessionId: 'x', isTyping: true }),
      }),
      makeEnv(),
      deps()
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET /stream returns 501 so the widget falls back to polling', async () => {
    const res = await route(
      new Request('https://relay.workers.dev/stream?sessionId=x'),
      makeEnv(),
      deps()
    );
    expect(res.status).toBe(501);
  });

  it('end-to-end: connect -> operator webhook -> messages polling via route()', async () => {
    const env = makeEnv();
    const { client } = makeMockTelegram({ topicId: 555 });
    const d = makeDeps(client);

    const connectRes = await route(
      new Request('https://relay.workers.dev/connect', {
        method: 'POST',
        body: JSON.stringify({ visitorId: 'e2e' }),
      }),
      env,
      d
    );
    const connect = (await connectRes.json()) as { sessionId: string };
    expect(connect.sessionId).toBeTruthy();

    await route(
      new Request('https://relay.workers.dev/telegram-webhook', {
        method: 'POST',
        body: JSON.stringify({
          message: { message_thread_id: 555, text: 'pong', from: { is_bot: false } },
        }),
      }),
      env,
      d
    );

    const pollRes = await route(
      new Request(`https://relay.workers.dev/messages?sessionId=${connect.sessionId}`),
      env,
      d
    );
    const poll = (await pollRes.json()) as { messages: RelayMessage[] };
    expect(poll.messages).toHaveLength(1);
    expect(poll.messages[0].content).toBe('pong');
  });

  it('webhook secret mismatch returns 401', async () => {
    const env = { ...makeEnv(), TELEGRAM_WEBHOOK_SECRET: 'sekret' };
    const res = await route(
      new Request('https://relay.workers.dev/telegram-webhook', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
        body: JSON.stringify({ message: {} }),
      }),
      env,
      deps()
    );
    expect(res.status).toBe(401);
  });
});

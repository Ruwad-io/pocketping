/**
 * PocketPing — Serverless Telegram Relay (Cloudflare Worker)
 *
 * A stateless, no-database PocketPing <-> Telegram bridge. State lives in
 * Cloudflare KV (managed) + Telegram Forum Topics (one topic per visitor).
 *
 * The unchanged PocketPing widget points its `endpoint` at this Worker:
 *   PocketPing.init({ endpoint: "https://<your-worker>.workers.dev" })
 *
 * Per-endpoint logic lives in pure, injectable functions (`handleConnect`,
 * `handleMessage`, `handleMessages`, `handleTelegramWebhook`) so they can be
 * unit-tested with an in-memory KV stub and a mocked Telegram client, with no
 * workers runtime or network access.
 */

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/** Minimal KV surface we depend on — satisfied by Cloudflare's KVNamespace. */
export interface KVStore {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
  delete?(key: string): Promise<void>;
}

export interface Env {
  /** KV namespace binding (see wrangler.toml). */
  PP: KVStore;
  /** Telegram bot token (Worker secret). NEVER returned to clients. */
  TELEGRAM_BOT_TOKEN: string;
  /** Supergroup chat id (e.g. -100123...). Topics must be enabled. */
  TELEGRAM_GROUP_ID: string;
  /** Optional: verify Telegram's secret-token header on the webhook. */
  TELEGRAM_WEBHOOK_SECRET?: string;
}

/** Message shape the widget consumes (subset of the widget's Message). */
export interface RelayMessage {
  id: string;
  sessionId: string;
  content: string;
  sender: 'operator';
  timestamp: string;
  status?: 'sent';
}

interface SessionRecord {
  visitorId: string;
  topicId: number;
  createdAt: string;
}

interface ConnectBody {
  visitorId: string;
  sessionId?: string;
  metadata?: {
    url?: string;
    referrer?: string;
    pageTitle?: string;
    userAgent?: string;
    city?: string;
    [k: string]: unknown;
  };
  identity?: { id?: string; name?: string; email?: string; [k: string]: unknown };
}

interface MessageBody {
  sessionId: string;
  content: string;
  sender?: string;
  attachmentIds?: string[];
  replyTo?: string;
}

/** Telegram client surface — default impl uses fetch, tests inject a mock. */
export interface TelegramClient {
  createForumTopic(chatId: string, name: string): Promise<{ message_thread_id: number }>;
  sendMessage(
    chatId: string,
    text: string,
    opts: { message_thread_id: number; parse_mode?: string }
  ): Promise<{ message_id: number }>;
}

export interface Deps {
  telegram: TelegramClient;
  /** Generate a unique id. Overridable in tests for determinism. */
  genId?: () => string;
  /** Current time as ISO string. Overridable in tests. */
  now?: () => string;
}

// ─────────────────────────────────────────────────────────────────────────
// Constants / helpers
// ─────────────────────────────────────────────────────────────────────────

const MSG_TTL_SECONDS = 7 * 24 * 60 * 60; // ~7 days
const MSG_CAP = 100;

const KEY = {
  sess: (sessionId: string) => `sess:${sessionId}`,
  topic: (topicId: number | string) => `topic:${topicId}`,
  vis: (visitorId: string) => `vis:${visitorId}`,
  msgs: (sessionId: string) => `msgs:${sessionId}`,
};

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-PocketPing-Version',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

/** Escape user text for Telegram HTML parse mode. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function defaultGenId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function topicName(body: ConnectBody): string {
  const identity = body.identity ?? {};
  let base = identity.name || identity.email || body.visitorId;
  const city = body.metadata?.city;
  if (city) base = `${base} · ${city}`;
  // Telegram caps forum topic names at 128 chars.
  return String(base).slice(0, 128);
}

async function readMessages(env: Env, sessionId: string): Promise<RelayMessage[]> {
  const raw = await env.PP.get(KEY.msgs(sessionId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RelayMessage[]) : [];
  } catch {
    return [];
  }
}

async function appendMessage(env: Env, sessionId: string, msg: RelayMessage): Promise<void> {
  const existing = await readMessages(env, sessionId);
  existing.push(msg);
  const capped = existing.slice(-MSG_CAP);
  await env.PP.put(KEY.msgs(sessionId), JSON.stringify(capped), {
    expirationTtl: MSG_TTL_SECONDS,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Pure handlers (testable — no workers runtime / no network)
// ─────────────────────────────────────────────────────────────────────────

export interface ConnectResponse {
  sessionId: string;
  visitorId: string;
  operatorOnline: false;
  messages: RelayMessage[];
}

export async function handleConnect(
  body: ConnectBody,
  env: Env,
  deps: Deps
): Promise<ConnectResponse> {
  const genId = deps.genId ?? defaultGenId;
  const now = deps.now ?? defaultNow;

  // 1) Resume by explicit sessionId.
  if (body.sessionId) {
    const rec = await env.PP.get(KEY.sess(body.sessionId));
    if (rec) {
      const messages = await readMessages(env, body.sessionId);
      return {
        sessionId: body.sessionId,
        visitorId: body.visitorId,
        operatorOnline: false,
        messages,
      };
    }
  }

  // 2) Resume by visitorId.
  if (body.visitorId) {
    const existingSessionId = await env.PP.get(KEY.vis(body.visitorId));
    if (existingSessionId) {
      const rec = await env.PP.get(KEY.sess(existingSessionId));
      if (rec) {
        const messages = await readMessages(env, existingSessionId);
        return {
          sessionId: existingSessionId,
          visitorId: body.visitorId,
          operatorOnline: false,
          messages,
        };
      }
    }
  }

  // 3) Create a brand-new session + Telegram forum topic.
  const sessionId = genId();
  const topic = await deps.telegram.createForumTopic(
    env.TELEGRAM_GROUP_ID,
    topicName(body)
  );
  const topicId = topic.message_thread_id;
  const createdAt = now();

  const record: SessionRecord = { visitorId: body.visitorId, topicId, createdAt };
  await env.PP.put(KEY.sess(sessionId), JSON.stringify(record));
  await env.PP.put(KEY.topic(topicId), sessionId);
  if (body.visitorId) await env.PP.put(KEY.vis(body.visitorId), sessionId);

  // Post a "new chat" notice into the topic.
  const lines = ['🆕 <b>New chat</b>'];
  const identity = body.identity ?? {};
  if (identity.name) lines.push(`👤 ${escapeHtml(identity.name)}`);
  if (identity.email) lines.push(`✉️ ${escapeHtml(identity.email)}`);
  if (body.metadata?.url) lines.push(`🔗 ${escapeHtml(body.metadata.url)}`);
  if (body.metadata?.referrer) lines.push(`↩️ ${escapeHtml(body.metadata.referrer)}`);
  await deps.telegram.sendMessage(env.TELEGRAM_GROUP_ID, lines.join('\n'), {
    message_thread_id: topicId,
    parse_mode: 'HTML',
  });

  return { sessionId, visitorId: body.visitorId, operatorOnline: false, messages: [] };
}

export interface SendMessageResponse {
  messageId: string;
  timestamp: string;
}

export async function handleMessage(
  body: MessageBody,
  env: Env,
  deps: Deps
): Promise<SendMessageResponse> {
  const genId = deps.genId ?? defaultGenId;
  const now = deps.now ?? defaultNow;

  const rec = await env.PP.get(KEY.sess(body.sessionId));
  if (!rec) throw new RelayError(404, 'unknown session');
  const session: SessionRecord = JSON.parse(rec);

  const messageId = genId();
  const timestamp = now();

  const visitorLabel = '👤 <b>Visitor</b>';
  const text = `${visitorLabel}\n${escapeHtml(body.content ?? '')}`;

  const sent = await deps.telegram.sendMessage(env.TELEGRAM_GROUP_ID, text, {
    message_thread_id: session.topicId,
    parse_mode: 'HTML',
  });

  // Map the telegram message id -> our messageId (reply context, optional).
  if (sent?.message_id != null) {
    await env.PP.put(`tgmsg:${session.topicId}:${sent.message_id}`, messageId, {
      expirationTtl: MSG_TTL_SECONDS,
    });
  }

  return { messageId, timestamp };
}

export interface MessagesResponse {
  messages: RelayMessage[];
}

export async function handleMessages(
  query: { sessionId?: string | null; after?: string | null },
  env: Env
): Promise<MessagesResponse> {
  if (!query.sessionId) return { messages: [] };
  const messages = await readMessages(env, query.sessionId);
  if (!query.after) return { messages };

  const afterMs = Date.parse(query.after);
  if (Number.isNaN(afterMs)) return { messages };
  const filtered = messages.filter((m) => {
    const t = Date.parse(m.timestamp);
    return !Number.isNaN(t) && t > afterMs;
  });
  return { messages: filtered };
}

/** Minimal subset of a Telegram Update we care about. */
export interface TelegramUpdate {
  message?: {
    message_id?: number;
    message_thread_id?: number;
    text?: string;
    caption?: string;
    is_topic_message?: boolean;
    from?: { is_bot?: boolean; first_name?: string; username?: string };
    forum_topic_created?: unknown;
    forum_topic_edited?: unknown;
    new_chat_members?: unknown;
    left_chat_member?: unknown;
    pinned_message?: unknown;
  };
}

export interface WebhookResult {
  ok: true;
  appended?: boolean;
  sessionId?: string;
}

export async function handleTelegramWebhook(
  update: TelegramUpdate,
  env: Env,
  deps: Deps
): Promise<WebhookResult> {
  const now = deps.now ?? defaultNow;
  const genId = deps.genId ?? defaultGenId;

  const msg = update.message;
  if (!msg) return { ok: true };

  // Must be a reply typed inside a visitor's forum topic.
  const threadId = msg.message_thread_id;
  if (threadId == null) return { ok: true };

  // Ignore the bot's own messages.
  if (msg.from?.is_bot) return { ok: true };

  // Ignore Telegram service messages (topic created/edited, joins, pins...).
  if (
    msg.forum_topic_created ||
    msg.forum_topic_edited ||
    msg.new_chat_members ||
    msg.left_chat_member ||
    msg.pinned_message
  ) {
    return { ok: true };
  }

  const text = msg.text ?? msg.caption;
  if (!text) return { ok: true };

  // Map topic -> session.
  const sessionId = await env.PP.get(KEY.topic(threadId));
  if (!sessionId) return { ok: true };

  const message: RelayMessage = {
    id: genId(),
    sessionId,
    content: text,
    sender: 'operator',
    timestamp: now(),
    status: 'sent',
  };
  await appendMessage(env, sessionId, message);

  return { ok: true, appended: true, sessionId };
}

/** Error carrying an HTTP status. */
export class RelayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Default Telegram client (uses fetch). Not exercised by unit tests.
// ─────────────────────────────────────────────────────────────────────────

export function makeTelegramClient(token: string): TelegramClient {
  const base = `https://api.telegram.org/bot${token}`;

  async function call<T>(method: string, payload: unknown): Promise<T> {
    const res = await fetch(`${base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) {
      throw new RelayError(502, `Telegram ${method} failed: ${data.description ?? 'unknown'}`);
    }
    return data.result as T;
  }

  return {
    createForumTopic(chatId, name) {
      return call('createForumTopic', { chat_id: chatId, name });
    },
    sendMessage(chatId, text, opts) {
      return call('sendMessage', {
        chat_id: chatId,
        text,
        message_thread_id: opts.message_thread_id,
        parse_mode: opts.parse_mode,
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────

const NOOP_POST_PATHS = new Set([
  '/typing',
  '/read',
  '/identify',
  '/presence',
  '/disconnect',
  '/visibility',
  '/prechat',
]);

async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new RelayError(400, 'invalid JSON body');
  }
}

export async function route(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    // Health.
    if (method === 'GET' && path === '/health') {
      return json({ status: 'ok' });
    }

    // Polling path (primary).
    if (method === 'GET' && path === '/messages') {
      const result = await handleMessages(
        { sessionId: url.searchParams.get('sessionId'), after: url.searchParams.get('after') },
        env
      );
      return json(result);
    }

    // SSE/WebSocket not supported — widget auto-falls back to polling.
    if (path === '/stream') {
      return new Response('Not Implemented — use polling (/messages)', {
        status: 501,
        headers: corsHeaders(),
      });
    }

    if (method === 'POST' && path === '/connect') {
      const body = await parseJson<ConnectBody>(request);
      return json(await handleConnect(body, env, deps));
    }

    if (method === 'POST' && path === '/message') {
      const body = await parseJson<MessageBody>(request);
      return json(await handleMessage(body, env, deps));
    }

    if (method === 'POST' && path === '/telegram-webhook') {
      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
        if (got !== env.TELEGRAM_WEBHOOK_SECRET) {
          return json({ ok: false }, 401);
        }
      }
      const update = await parseJson<TelegramUpdate>(request);
      const result = await handleTelegramWebhook(update, env, deps);
      return json(result);
    }

    // Secondary no-op endpoints.
    if (method === 'POST' && NOOP_POST_PATHS.has(path)) {
      if (path === '/presence') return json({ ok: true, operatorOnline: false });
      return json({ ok: true });
    }
    // /presence is also fetched via GET by the widget.
    if (method === 'GET' && path === '/presence') {
      return json({ online: false });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders() });
  } catch (err) {
    if (err instanceof RelayError) {
      return json({ error: err.message }, err.status);
    }
    return json({ error: 'internal error' }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const deps: Deps = { telegram: makeTelegramClient(env.TELEGRAM_BOT_TOKEN) };
    return route(request, env, deps);
  },
};

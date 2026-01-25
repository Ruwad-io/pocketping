#!/usr/bin/env node
/* eslint-disable no-console */

const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = Number(process.env.PP_TIMEOUT_MS || 90000);
const POLL_INTERVAL_MS = Number(process.env.PP_POLL_INTERVAL_MS || 1500);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function optionalEnv(name) {
  return process.env[name] || '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniq(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function isoNow() {
  return new Date().toISOString();
}

const RUN_ID = process.env.PP_RUN_ID || uniq('run');
const RUN_TAG = `pp-e2e:${RUN_ID}`;

function makeContent(label) {
  return `${label} [${RUN_TAG}] ${uniq('msg')}`;
}

function parsePlatforms() {
  const raw = process.env.PP_PLATFORMS || 'slack,discord';
  return raw.split(',').map((p) => p.trim()).filter(Boolean);
}

async function slackApi(method, token, body) {
  const resp = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!json.ok) {
    throw new Error(`Slack API ${method} failed: ${json.error || resp.status}`);
  }
  return json;
}

async function discordApi(method, token, path, body) {
  const resp = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Discord API ${method} ${path} failed: ${resp.status} ${text}`);
  }
  if (resp.status === 204) return null;
  return resp.json();
}

function getSdkEndpoint() {
  const direct = optionalEnv('PP_WIDGET_ENDPOINT');
  if (direct) return direct.replace(/\/$/, '');
  return '';
}

function getSaasEndpoint() {
  const projectId = optionalEnv('PP_SAAS_PROJECT_ID');
  if (projectId) {
    const base = optionalEnv('PP_SAAS_BASE_URL') || 'https://app.pocketping.io';
    return `${base.replace(/\/$/, '')}/api/widget/${projectId}`;
  }

  return '';
}

class WidgetTarget {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.sse = null;
  }

  async connect() {
    const visitorId = uniq('visitor');
    const response = await this.post('/connect', {
      visitorId,
      sessionId: null,
      metadata: {
        url: 'https://e2e.local/test',
        referrer: 'https://e2e.local',
        pageTitle: 'PocketPing E2E',
        userAgent: 'PocketPingE2E',
        timezone: 'UTC',
        language: 'en',
        screenResolution: '1920x1080',
      },
    });

    return { sessionId: response.sessionId, visitorId };
  }

  async sendVisitorMessage(sessionId, content) {
    const response = await this.post('/message', {
      sessionId,
      content,
    });
    return response.messageId;
  }

  async fetchMessages(sessionId, after) {
    const params = new URLSearchParams({ sessionId });
    if (after) params.set('after', after);
    return this.get(`/messages?${params.toString()}`);
  }

  async startSse(sessionId, after) {
    if (this.sse) return;
    const controller = new AbortController();
    const events = [];
    const params = new URLSearchParams({ sessionId });
    if (after) params.set('after', after);

    (async () => {
      const resp = await fetch(`${this.baseUrl}/stream?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`Widget SSE connection failed: ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let currentData = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);

          if (line === '') {
            if (currentData) {
              const data = currentData.endsWith('\n')
                ? currentData.slice(0, -1)
                : currentData;
              try {
                const payload = JSON.parse(data);
                if (payload?.type === 'message' && payload.data) {
                  events.push({ type: 'message', data: payload.data });
                } else if (currentEvent && payload) {
                  events.push({ type: currentEvent, data: payload });
                }
              } catch (err) {
                console.warn('Failed to parse widget SSE payload', err);
              }
            }
            currentEvent = '';
            currentData = '';
            continue;
          }

          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            currentData += `${line.slice(5).trim()}\n`;
          }
        }
      }
    })().catch((err) => {
      if (controller.signal.aborted) return;
      console.error('Widget SSE error', err);
    });

    this.sse = { controller, events };
  }

  async waitForMessage(predicate, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.sse) {
      throw new Error('Widget SSE not started');
    }
    const deadline = Date.now() + timeoutMs;
    let idx = 0;
    while (Date.now() < deadline) {
      while (idx < this.sse.events.length) {
        const event = this.sse.events[idx++];
        if (event.type === 'message' && predicate(event.data)) {
          return event.data;
        }
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error('Timed out waiting for widget message event');
  }

  close() {
    if (this.sse) {
      this.sse.controller.abort();
      this.sse = null;
    }
  }

  async post(path, body) {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Widget POST ${path} failed: ${resp.status} ${text}`);
    }
    return resp.json();
  }

  async get(path) {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Widget GET ${path} failed: ${resp.status} ${text}`);
    }
    return resp.json();
  }
}

class BridgeServerTarget {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.sse = null;
  }

  async connect() {
    const sessionId = uniq('session');
    const session = {
      id: sessionId,
      visitorId: uniq('visitor'),
      createdAt: isoNow(),
      lastActivity: isoNow(),
      operatorOnline: true,
      aiActive: false,
      metadata: {
        url: 'https://e2e.local/test',
        referrer: 'https://e2e.local',
        pageTitle: 'PocketPing E2E',
        userAgent: 'PocketPingE2E',
        timezone: 'UTC',
        language: 'en',
        screenResolution: '1920x1080',
      },
    };

    await this.post('/api/sessions', session);

    return { sessionId, session };
  }

  async sendVisitorMessage(session, content) {
    const message = {
      id: uniq('msg'),
      sessionId: session.id,
      content,
      sender: 'visitor',
      timestamp: isoNow(),
    };

    await this.post('/api/messages', { message, session });
    return message.id;
  }

  async startSse() {
    if (this.sse) return;

    const controller = new AbortController();
    const events = [];
    const headers = this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};

    (async () => {
      const resp = await fetch(`${this.baseUrl}/api/events/stream`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`SSE connection failed: ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let index;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const json = line.slice(5).trim();
              if (!json) continue;
              try {
                const event = JSON.parse(json);
                events.push(event);
              } catch (err) {
                console.warn('Failed to parse SSE event', err);
              }
            }
          }
        }
      }
    })().catch((err) => {
      if (controller.signal.aborted) return;
      console.error('SSE error', err);
    });

    this.sse = { controller, events };
  }

  async waitForEvent(type, predicate, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.sse) {
      throw new Error('SSE not started');
    }
    const deadline = Date.now() + timeoutMs;
    let idx = 0;
    while (Date.now() < deadline) {
      while (idx < this.sse.events.length) {
        const event = this.sse.events[idx++];
        if (event.type === type && (!predicate || predicate(event))) {
          return event;
        }
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Timed out waiting for event ${type}`);
  }

  close() {
    if (this.sse) {
      this.sse.controller.abort();
      this.sse = null;
    }
  }

  async post(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Bridge POST ${path} failed: ${resp.status} ${text}`);
    }

    return resp.json();
  }
}

async function waitForSlackReply(slackToken, channelId, threadTs, replyTs, predicate) {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const replies = await slackApi('conversations.replies', slackToken, {
      channel: channelId,
      ts: threadTs,
      limit: 50,
      inclusive: true,
    });
    const messages = replies.messages || [];
    const match = messages.find((m) => m.ts === replyTs);
    if (match && (!predicate || predicate(match))) {
      return match;
    }
    if (!match && predicate && predicate(null)) {
      return null;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Timed out waiting for Slack reply validation');
}

async function waitForSlackThread(slackToken, channelId, content) {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  const oldest = Math.floor((Date.now() - 5 * 60 * 1000) / 1000).toString();
  while (Date.now() < deadline) {
    const history = await slackApi('conversations.history', slackToken, {
      channel: channelId,
      limit: 50,
      oldest,
    });
    const match = (history.messages || []).find((m) => (m.text || '').includes(content));
    if (match) {
      return match;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Slack thread not found for visitor message');
}

async function discordGetMessageOrNull(discordToken, channelId, messageId) {
  const resp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bot ${discordToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Discord API GET message failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

async function waitForDiscordMessage(discordToken, channelId, messageId, predicate) {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const message = await discordGetMessageOrNull(discordToken, channelId, messageId);
    if (predicate(message)) {
      return message;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Timed out waiting for Discord message validation');
}

async function waitForDiscordThread(discordToken, forumId, content) {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const threads = await discordApi('GET', discordToken, `/channels/${forumId}/threads/active`);
    const list = threads?.threads || [];
    for (const thread of list) {
      const messages = await discordApi('GET', discordToken, `/channels/${thread.id}/messages?limit=10`);
      const match = (messages || []).find((m) => (m.content || '').includes(content));
      if (match) {
        return { thread, message: match };
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Discord thread not found for visitor message');
}

async function runSlackFlow(target, sessionId) {
  const slackToken = requireEnv('SLACK_BOT_TOKEN');
  const slackChannel = requireEnv('SLACK_CHANNEL_ID');

  const visitorContent = makeContent('pp-e2e-slack-visitor');
  await target.sendVisitorMessage(sessionId, visitorContent);

  const threadMessage = await waitForSlackThread(slackToken, slackChannel, visitorContent);
  const threadTs = threadMessage.ts;

  const operatorContent = makeContent('pp-e2e-slack-reply');
  const reply = await slackApi('chat.postMessage', slackToken, {
    channel: slackChannel,
    thread_ts: threadTs,
    text: operatorContent,
  });

  await waitForSlackReply(slackToken, slackChannel, threadTs, reply.ts, (msg) => msg && msg.text === operatorContent);
  const received = await target.waitForMessage((msg) => msg.content === operatorContent);

  const editContent = `${operatorContent}-edited`;
  await slackApi('chat.update', slackToken, {
    channel: slackChannel,
    ts: reply.ts,
    text: editContent,
  });

  await waitForSlackReply(slackToken, slackChannel, threadTs, reply.ts, (msg) => msg && msg.text === editContent);
  const edited = await target.waitForMessage((msg) => msg.id === received.id && msg.content === editContent && msg.editedAt);

  await slackApi('chat.delete', slackToken, {
    channel: slackChannel,
    ts: reply.ts,
  });

  await waitForSlackReply(
    slackToken,
    slackChannel,
    threadTs,
    reply.ts,
    (msg) => msg === null || msg?.subtype === 'message_deleted'
  );
  await target.waitForMessage((msg) => msg.id === received.id && msg.deletedAt);

  return { threadTs, messageId: received.id, editedAt: edited.editedAt };
}

async function runDiscordFlow(target, sessionId) {
  const discordToken = requireEnv('DISCORD_BOT_TOKEN');
  const forumId = requireEnv('DISCORD_FORUM_CHANNEL_ID');

  const visitorContent = makeContent('pp-e2e-discord-visitor');
  await target.sendVisitorMessage(sessionId, visitorContent);

  const { thread } = await waitForDiscordThread(discordToken, forumId, visitorContent);

  const operatorContent = makeContent('pp-e2e-discord-reply');
  const reply = await discordApi('POST', discordToken, `/channels/${thread.id}/messages`, {
    content: operatorContent,
  });

  await waitForDiscordMessage(
    discordToken,
    thread.id,
    reply.id,
    (msg) => !!msg && msg.content === operatorContent
  );
  const received = await target.waitForMessage((msg) => msg.content === operatorContent);

  const editContent = `${operatorContent}-edited`;
  await discordApi('PATCH', discordToken, `/channels/${thread.id}/messages/${reply.id}`, {
    content: editContent,
  });

  await waitForDiscordMessage(
    discordToken,
    thread.id,
    reply.id,
    (msg) => !!msg && msg.content === editContent
  );
  await target.waitForMessage((msg) => msg.id === received.id && msg.content === editContent && msg.editedAt);

  await discordApi('DELETE', discordToken, `/channels/${thread.id}/messages/${reply.id}`);

  await waitForDiscordMessage(discordToken, thread.id, reply.id, (msg) => !msg);
  await target.waitForMessage((msg) => msg.id === received.id && msg.deletedAt);

  return { threadId: thread.id, messageId: received.id };
}

async function runSlackFlowBridge(target, session) {
  const slackToken = requireEnv('SLACK_BOT_TOKEN');
  const slackChannel = requireEnv('SLACK_CHANNEL_ID');

  const visitorContent = makeContent('pp-e2e-slack-visitor');
  await target.sendVisitorMessage(session, visitorContent);

  const threadMessage = await waitForSlackThread(slackToken, slackChannel, visitorContent);
  const threadTs = threadMessage.ts;

  const operatorContent = makeContent('pp-e2e-slack-reply');
  const reply = await slackApi('chat.postMessage', slackToken, {
    channel: slackChannel,
    thread_ts: threadTs,
    text: operatorContent,
  });

  await waitForSlackReply(slackToken, slackChannel, threadTs, reply.ts, (msg) => msg && msg.text === operatorContent);
  const messageEvent = await target.waitForEvent('operator_message', (event) => event.content === operatorContent);

  const editContent = `${operatorContent}-edited`;
  await slackApi('chat.update', slackToken, {
    channel: slackChannel,
    ts: reply.ts,
    text: editContent,
  });

  await waitForSlackReply(slackToken, slackChannel, threadTs, reply.ts, (msg) => msg && msg.text === editContent);
  await target.waitForEvent('operator_message_edited', (event) => event.messageId === messageEvent.messageId && event.content === editContent);

  await slackApi('chat.delete', slackToken, {
    channel: slackChannel,
    ts: reply.ts,
  });

  await waitForSlackReply(
    slackToken,
    slackChannel,
    threadTs,
    reply.ts,
    (msg) => msg === null || msg?.subtype === 'message_deleted'
  );
  await target.waitForEvent('operator_message_deleted', (event) => event.messageId === messageEvent.messageId);

  return { threadTs, messageId: messageEvent.messageId };
}

async function runDiscordFlowBridge(target, session) {
  const discordToken = requireEnv('DISCORD_BOT_TOKEN');
  const forumId = requireEnv('DISCORD_FORUM_CHANNEL_ID');

  const visitorContent = makeContent('pp-e2e-discord-visitor');
  await target.sendVisitorMessage(session, visitorContent);

  const { thread } = await waitForDiscordThread(discordToken, forumId, visitorContent);

  const operatorContent = makeContent('pp-e2e-discord-reply');
  const reply = await discordApi('POST', discordToken, `/channels/${thread.id}/messages`, {
    content: operatorContent,
  });

  await waitForDiscordMessage(
    discordToken,
    thread.id,
    reply.id,
    (msg) => !!msg && msg.content === operatorContent
  );
  const messageEvent = await target.waitForEvent('operator_message', (event) => event.content === operatorContent);

  const editContent = `${operatorContent}-edited`;
  await discordApi('PATCH', discordToken, `/channels/${thread.id}/messages/${reply.id}`, {
    content: editContent,
  });

  await waitForDiscordMessage(
    discordToken,
    thread.id,
    reply.id,
    (msg) => !!msg && msg.content === editContent
  );
  await target.waitForEvent('operator_message_edited', (event) => event.messageId === messageEvent.messageId && event.content === editContent);

  await discordApi('DELETE', discordToken, `/channels/${thread.id}/messages/${reply.id}`);

  await waitForDiscordMessage(discordToken, thread.id, reply.id, (msg) => !msg);
  await target.waitForEvent('operator_message_deleted', (event) => event.messageId === messageEvent.messageId);

  return { threadId: thread.id, messageId: messageEvent.messageId };
}

async function main() {
  const rawMode = (process.env.PP_TARGET_MODE || 'saas').toLowerCase();
  const mode = rawMode === 'widget' ? 'saas' : rawMode;
  const platforms = parsePlatforms();

  if (mode === 'saas' || mode === 'sdk') {
    const endpoint = mode === 'saas' ? getSaasEndpoint() : getSdkEndpoint();
    if (!endpoint) {
      throw new Error(mode === 'saas' ? 'Set PP_SAAS_PROJECT_ID' : 'Set PP_WIDGET_ENDPOINT');
    }
    const target = new WidgetTarget(endpoint);
    const { sessionId } = await target.connect();
    const sseAfter = isoNow();
    await target.startSse(sessionId, sseAfter);

    console.log(`Widget target connected (${mode}): ${endpoint} session=${sessionId} run_id=${RUN_ID}`);

    if (platforms.includes('slack')) {
      const result = await runSlackFlow(target, sessionId);
      console.log('Slack flow OK', result);
    }

    if (platforms.includes('discord')) {
      const result = await runDiscordFlow(target, sessionId);
      console.log('Discord flow OK', result);
    }

    target.close();
    console.log('Widget E2E done');
    return;
  }

  if (mode === 'bridge-server') {
    const baseUrl = requireEnv('PP_BRIDGE_SERVER_URL');
    const apiKey = optionalEnv('PP_BRIDGE_SERVER_API_KEY');
    const target = new BridgeServerTarget(baseUrl, apiKey || null);
    await target.startSse();

    const { session } = await target.connect();
    console.log(`Bridge-server target connected: ${baseUrl} session=${session.id} run_id=${RUN_ID}`);

    if (platforms.includes('slack')) {
      const result = await runSlackFlowBridge(target, session);
      console.log('Slack flow OK', result);
    }

    if (platforms.includes('discord')) {
      const result = await runDiscordFlowBridge(target, session);
      console.log('Discord flow OK', result);
    }

    target.close();
    console.log('Bridge-server E2E done');
    return;
  }

  throw new Error(`Unknown PP_TARGET_MODE: ${mode}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

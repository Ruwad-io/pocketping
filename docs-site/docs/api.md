---
sidebar_position: 10
title: API Reference
description: HTTP API reference for the self-hosted PocketPing bridge server
---

# API Reference

HTTP API reference for the self-hosted PocketPing **bridge server** (the standalone Go binary).

:::info Scope
This page documents the bridge server's HTTP API. If you embed PocketPing into your own backend with an SDK, you call the SDK's handlers directly instead of these routes — see the [SDK docs](/sdk). The hosted SaaS exposes its own endpoints and is not covered here.
:::

## Base URL

The bridge server listens on port **3001** by default. All application endpoints live under `/api`:

- **Local**: `http://localhost:3001`
- **Self-hosted**: your deployed bridge URL (e.g. `https://bridge.yourdomain.com`)

## Authentication

If the server is started with an `API_KEY`, every `/api/*` endpoint (and the SSE stream) requires a matching `Authorization` header. Webhook endpoints and `/health` are not API-key protected.

```bash
Authorization: Bearer your_api_key
```

A missing or incorrect key returns `401 Unauthorized`. If no `API_KEY` is configured, authentication is skipped.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check + configured bridges |
| `POST` | `/api/events` | Yes | Generic event ingestion (typed envelope) |
| `POST` | `/api/sessions` | Yes | Notify bridges of a new session |
| `POST` | `/api/messages` | Yes | Forward a visitor message to the bridges |
| `POST` | `/api/operator/status` | Yes | Update operator online status |
| `POST` | `/api/custom-events` | Yes | Forward a custom event |
| `POST` | `/api/disconnect` | Yes | Notify bridges a visitor left |
| `GET` | `/api/events/stream` | Yes | Server-Sent Events stream (operator replies, edits, deletes) |
| `POST` | `/webhooks/telegram` | No | Telegram webhook (operator replies in) |
| `POST` | `/webhooks/slack` | No | Slack Events API webhook |
| `POST` | `/webhooks/discord` | No | Discord webhook |

Most endpoints return `{"ok": true}` on success.

---

### Health

```http
GET /health
```

Response:

```json
{
  "status": "ok",
  "bridges": ["telegram", "discord"]
}
```

---

### New Session

Notify the configured bridges that a new chat session has started (e.g. so Telegram creates a Forum Topic).

```http
POST /api/sessions
```

The request body is a `Session` object:

```json
{
  "id": "sess_abc123",
  "visitorId": "vis_xyz789",
  "createdAt": "2024-01-15T10:30:00Z",
  "lastActivity": "2024-01-15T10:30:00Z",
  "operatorOnline": false,
  "aiActive": false,
  "metadata": {
    "url": "https://example.com/pricing",
    "country": "France",
    "browser": "Chrome",
    "deviceType": "desktop"
  },
  "identity": {
    "id": "user_123",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

Response:

```json
{ "ok": true }
```

---

### Send Message

Forward a visitor message to the bridges. The body wraps a `message` and the `session` it belongs to.

```http
POST /api/messages
```

Request:

```json
{
  "message": {
    "id": "msg_001",
    "sessionId": "sess_abc123",
    "content": "Hello, I have a question",
    "sender": "visitor",
    "timestamp": "2024-01-15T10:30:00Z",
    "replyTo": "msg_000"
  },
  "session": {
    "id": "sess_abc123",
    "visitorId": "vis_xyz789"
  }
}
```

`message.replyTo` is optional and references the `id` of the message being replied to. Response: `{ "ok": true }`.

---

### Operator Status

```http
POST /api/operator/status
```

Request:

```json
{ "online": true }
```

When the operator is offline, AI fallback (if configured) may take over after the takeover delay.

---

### Custom Events

Forward a custom event from the widget. If `EVENTS_WEBHOOK_URL` is configured, the event is also relayed to that webhook (optionally HMAC-signed with `EVENTS_WEBHOOK_SECRET`).

```http
POST /api/custom-events
```

Request:

```json
{
  "event": {
    "name": "clicked_pricing",
    "data": { "plan": "pro" },
    "timestamp": "2024-01-15T10:30:00Z",
    "sessionId": "sess_abc123"
  },
  "session": {
    "id": "sess_abc123",
    "visitorId": "vis_xyz789"
  }
}
```

---

### Disconnect

Notify the bridges that a visitor left the page (used to post a "visitor left" note in the thread).

```http
POST /api/disconnect
```

Request:

```json
{
  "session": { "id": "sess_abc123", "visitorId": "vis_xyz789" },
  "duration": 320,
  "reason": "page_unload"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session` | object | The session (required) |
| `duration` | number | Seconds the visitor was on the page |
| `reason` | string | `page_unload`, `inactivity`, or `manual` |

---

### Generic Events

`POST /api/events` accepts a single typed envelope and dispatches it like the convenience endpoints above. The body must include a `type` field; the remaining fields depend on the type.

```http
POST /api/events
```

Example (a visitor message):

```json
{
  "type": "visitor_message",
  "message": { "id": "msg_001", "sessionId": "sess_abc123", "content": "Hi", "sender": "visitor" },
  "session": { "id": "sess_abc123", "visitorId": "vis_xyz789" }
}
```

Supported `type` values:

| Type | Purpose |
|------|---------|
| `new_session` | New chat session |
| `visitor_message` | Visitor sent a message |
| `visitor_message_edited` | Visitor edited a message |
| `visitor_message_deleted` | Visitor deleted a message |
| `message_read` | Read/delivery receipt |
| `operator_status` | Operator online/offline |
| `custom_event` | Custom event |
| `identity_update` | Visitor identity changed |
| `ai_takeover` | AI took over the conversation |

An unknown `type` returns `400`.

---

### Event Stream (SSE)

Subscribe to operator-originated events (replies, edits, deletes) coming back from the bridges. This is a **Server-Sent Events** stream — there is no WebSocket endpoint.

```http
GET /api/events/stream
```

```javascript
const es = new EventSource('http://localhost:3001/api/events/stream');
// (EventSource cannot set custom headers; place the stream behind a
// proxy or use a fetch-based SSE client if API_KEY auth is enabled.)

es.onmessage = (e) => {
  const event = JSON.parse(e.data);
  switch (event.type) {
    case 'operator_message':
      console.log('Operator reply:', event.content);
      break;
    case 'operator_message_edited':
      console.log('Edited:', event.messageId, event.content);
      break;
    case 'operator_message_deleted':
      console.log('Deleted:', event.messageId);
      break;
  }
};
```

The server sends a `: heartbeat` comment every 30 seconds to keep the connection alive.

Example `operator_message` payload:

```json
{
  "type": "operator_message",
  "sessionId": "sess_abc123",
  "messageId": "msg_010",
  "content": "Hi! How can I help?",
  "sourceBridge": "telegram",
  "operatorName": "Sarah"
}
```

---

### Bridge Webhooks

These endpoints receive inbound traffic from the messaging platforms. You normally do not call them yourself — you register them with each platform so operator replies flow back into the bridge server (and out via SSE).

```http
POST /webhooks/telegram
POST /webhooks/slack
POST /webhooks/discord
```

See the [Telegram](/bridges/telegram), [Slack](/bridges/slack), and [Discord](/bridges/discord) guides for how to register each webhook URL.

---

## Message Senders

The `sender` field on a message is one of:

| Sender | Description |
|--------|-------------|
| `visitor` | Message from the website visitor |
| `operator` | Message from a human operator (via a bridge) |
| `ai` | Message from AI fallback |

## Error Responses

Errors are returned as JSON with an `error` field and the corresponding HTTP status:

```json
{ "error": "Unauthorized" }
```

| Status | Description |
|--------|-------------|
| 400 | Bad request (invalid JSON / unknown event type / missing field) |
| 401 | Unauthorized (missing or invalid `API_KEY`) |
| 403 | Forbidden (blocked by User-Agent filter) |
| 500 | Internal server error |

## SDKs

Prefer to embed PocketPing in your own backend instead of calling these routes directly? Use a backend SDK:

- [Node.js SDK](/sdk/nodejs)
- [Python SDK](/sdk/python)
- [Go SDK](/sdk/go)
- [PHP SDK](/sdk/php)
- [Ruby SDK](/sdk/ruby)

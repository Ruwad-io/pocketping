---
title: Webhooks
description: Receive PocketPing chat events at your own endpoint, HMAC-signed, for automation and integrations (Zapier, Make, n8n, or your backend).
---

# Webhooks

PocketPing can **POST every chat event to a URL you control** — a new conversation,
a visitor message, an operator reply, and more — so you can pipe them into a CRM,
Slack/email automation, a data warehouse, or tools like **Zapier / Make / n8n**.

The payload is **identical across every deployment mode** (hosted SaaS and the
self-hosted bridge-server), so you can move between them without touching your
receiver.

## Enabling it

**Hosted (pocketping.io):** open your project → **Webhooks** tab → set the
endpoint URL, toggle it on, and copy the signing secret. Use **Send test event**
to verify your receiver.

**Self-hosted (bridge-server):** set two env vars:

```bash
EVENTS_WEBHOOK_URL=https://example.com/webhooks/pocketping
EVENTS_WEBHOOK_SECRET=a-random-secret   # optional but recommended
```

## Request format

Every event is a single `POST` with a JSON envelope:

```http
POST https://example.com/webhooks/pocketping
Content-Type: application/json
X-PocketPing-Event: visitor_message
X-PocketPing-Signature: sha256=<hex>

{
  "type": "visitor_message",
  "data": {
    "sessionId": "…",
    "visitorId": "…",
    "message": { "id": "…", "content": "Hi, I need help" }
  },
  "sentAt": "2026-06-02T12:00:00.000Z"
}
```

Delivery is **fire-and-forget** with a 10s timeout — it never blocks a visitor
or operator. Respond with any `2xx` to acknowledge.

## Events

| `type` | When |
|---|---|
| `new_session` | A visitor starts a new conversation |
| `visitor_message` | A visitor sends a message |
| `operator_message` | An operator replies (from any bridge) |
| `visitor_message_edited` / `visitor_message_deleted` | A visitor edits or deletes a message |
| `message_read` | Messages are marked read |
| `identity_update` | A visitor is identified via `PocketPing.identify()` |
| `visitor_disconnect` | A visitor leaves the page |
| `csat_submitted` | A visitor submits a satisfaction rating — `data: { sessionId, score, comment, respondedAt }` *(hosted SaaS + self-host SDK; not the standalone bridge-server yet)* |
| `custom_event` | A `PocketPing.trigger(name, data)` custom event *(bridge-server only)* |
| `test` | Sent by the dashboard's **Send test event** button |

Most events fire on both the hosted SaaS and the self-hosted bridge-server. The
exceptions: `custom_event` is forwarded only by the bridge-server (the SaaS doesn't
ingest custom events server-side); and `csat_submitted` fires on the hosted SaaS and
from the self-host **SDK**, but the standalone bridge-server doesn't emit it yet
(CSAT support there is a tracked follow-up).

## Verifying the signature

When a secret is configured, the body is signed with **HMAC-SHA256** and sent in
`X-PocketPing-Signature: sha256=<hex>`. Verify it against the **raw** request body
before trusting an event:

```js
import crypto from 'crypto'

function verify(rawBody, header, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))
}
```

```python
import hmac, hashlib

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(header, expected)
```

:::tip
Compute the HMAC over the exact bytes you received — parsing and re-serializing the
JSON first will change whitespace and break the signature.
:::

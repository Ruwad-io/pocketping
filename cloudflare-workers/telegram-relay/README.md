# PocketPing — Serverless Telegram Relay (Cloudflare Worker)

A **free, zero-server, no-database** PocketPing &harr; Telegram bridge that runs as a
single Cloudflare Worker. Point the unchanged PocketPing widget at it and you get
two-way chat: each website visitor gets their own **Telegram Forum Topic**, and
operators reply right inside Telegram.

State lives in **Cloudflare KV** (managed) + **Telegram itself** — there is no
database to run. The bot token never leaves the Worker (it is a Worker secret).

---

## Deploy as a Cloudflare Worker (1 click + a few minutes)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Ruwad-io/pocketping/tree/main/cloudflare-workers/telegram-relay)

The button forks this folder into your GitHub account and deploys it to **your**
Cloudflare account — so you'll need a (free) Cloudflare account. Cloudflare's flow
handles the GitHub connection, provisions the `PP` KV namespace, and lets you set
`TELEGRAM_GROUP_ID` in the UI. Once it's deployed, wire it to Telegram — the
**three short steps** below (a few minutes total).

### 1. Create the Telegram bot + group (skip if you already have one)

- DM [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token (looks like
  `123456:ABC-DEF...`).
- Create a Telegram group → **Group Settings → enable "Topics"** (this makes it a
  forum supergroup). Add your bot and promote it to **admin** with **Manage Topics**.
- Get the supergroup id (looks like `-1001234567890`) — easiest is to message
  [@RawDataBot](https://t.me/RawDataBot) inside the group, then remove it.
- Back in the Cloudflare deploy UI, paste that id into the `TELEGRAM_GROUP_ID` field.

### 2. Set the bot token as a secret

In the Cloudflare dashboard → **Workers & Pages → `pocketping-telegram-relay` →
Settings → Variables and Secrets → Add → Type "Secret"**:

| Name | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | the BotFather token |
| `TELEGRAM_WEBHOOK_SECRET` *(optional, recommended)* | any random string |

Or from your terminal:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # optional
```

### 3. Register the Telegram webhook + point the widget

```bash
# replace <TOKEN>, the worker URL, and (if you set one) <SECRET>
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://pocketping-telegram-relay.<you>.workers.dev/telegram-webhook&secret_token=<SECRET>"
```

Then on your site:

```js
PocketPing.init({ endpoint: 'https://pocketping-telegram-relay.<you>.workers.dev' })
```

Done. Visitors chat in the widget; you reply from the matching topic in Telegram.

---

## Deploy from your terminal (alternative)

Prefer to keep everything local? Same outcome, no GitHub fork:

```bash
# from this folder
npm install
npx wrangler kv namespace create PP            # paste the returned id into wrangler.toml
# edit wrangler.toml: set TELEGRAM_GROUP_ID = "-100..."
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # optional
npx wrangler deploy
```

Then register the webhook and point the widget as in step 3 above.

---

## HTTP endpoints

| Method & path                              | Purpose                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `POST /connect`                            | Resume/create session; on new session creates a Telegram topic.    |
| `POST /message`                            | Visitor message → `sendMessage` into the visitor's topic.          |
| `GET /messages?sessionId=&after=`          | Poll queued operator messages (primary real-time path).            |
| `POST /telegram-webhook`                   | Telegram → Worker; operator topic replies queued for the visitor.  |
| `GET /health`                              | `{ "status": "ok" }`                                               |
| `GET /stream`                              | `501` — widget auto-falls back to polling (no WebSocket/SSE).      |
| `POST /typing` `/read` `/identify` `/presence` `/disconnect` `/visibility` `/prechat` | Accepted no-ops → `{ "ok": true }`. |

All responses carry permissive CORS headers and `OPTIONS` preflight returns `204`.

## What this is / isn't

**Is:** core two-way text chat, one Telegram **forum topic per visitor**, resume by
session/visitor, zero server, no database — the free **"lite"** mode.

**Isn't:** no message edit/delete sync, no file attachments, no read receipts, no AI
fallback, no Discord/Slack. For those, use the [bridge-server](../../bridge-server) (Go,
self-hosted) or the hosted SaaS at pocketping.io.

## Development & tests

```bash
npm install
npm test          # vitest — pure handlers with an in-memory KV + mocked Telegram client
npm run typecheck # tsc --noEmit
npm run dev       # wrangler dev
```

The per-endpoint logic (`handleConnect`, `handleMessage`, `handleMessages`,
`handleTelegramWebhook`) is pure and takes an injectable KV stub and Telegram client,
so the test suite runs with **no workers runtime and no network**.

## KV schema (single namespace, binding `PP`)

| Key                      | Value                                              |
| ------------------------ | -------------------------------------------------- |
| `sess:{sessionId}`       | JSON `{ visitorId, topicId, createdAt }`           |
| `topic:{topicId}`        | `sessionId` (string)                               |
| `vis:{visitorId}`        | `sessionId` (string) — resume-by-visitor           |
| `msgs:{sessionId}`       | JSON `Message[]` (operator queue, last ~100, 7-day TTL) |
| `tgmsg:{topicId}:{tgId}` | our `messageId` for a sent Telegram message (reply context) |

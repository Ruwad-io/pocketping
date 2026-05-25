# PocketPing — Serverless Telegram Relay (Cloudflare Worker)

A **free, zero-server, no-database** PocketPing &harr; Telegram bridge that runs as a
single Cloudflare Worker. Point the unchanged PocketPing widget at it and you get
two-way chat: each website visitor gets their own **Telegram Forum Topic**, and
operators reply right inside Telegram.

State lives in **Cloudflare KV** (managed) + **Telegram itself** — there is no
database to run. The bot token never leaves the Worker (it is a Worker secret).

## Deploy in ~60 seconds

1. **Create a bot** — message [@BotFather](https://t.me/BotFather), `/newbot`, copy the
   token (looks like `123456:ABC-DEF...`).

2. **Create a supergroup, enable Topics, add the bot as admin**
   - Create a group, then in **Group Settings → enable "Topics"** (this makes it a forum).
   - Add your bot to the group and promote it to **admin** with **Manage Topics**.

3. **Get the group id** — add [@RawDataBot](https://t.me/RawDataBot) (or any "get chat id"
   bot) to the group; the supergroup id looks like `-1001234567890`. Remove the helper
   bot afterwards.

4. **Create the KV namespace** and paste its id into `wrangler.toml` (`[[kv_namespaces]] id`):
   ```bash
   npx wrangler kv namespace create PP
   ```

5. **Set the group id var + the bot token secret:**
   ```bash
   # edit wrangler.toml: TELEGRAM_GROUP_ID = "-1001234567890"
   npx wrangler secret put TELEGRAM_BOT_TOKEN        # paste the BotFather token
   # optional, recommended: a random string to verify Telegram webhook calls
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   ```

6. **Deploy:**
   ```bash
   npm install
   npx wrangler deploy
   ```
   Note the URL, e.g. `https://pocketping-telegram-relay.<you>.workers.dev`.

7. **Register the Telegram webhook** so operator replies reach the Worker:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://pocketping-telegram-relay.<you>.workers.dev/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
   (drop `&secret_token=...` if you skipped step 5's optional secret.)

8. **Point the widget at the Worker:**
   ```js
   PocketPing.init({ endpoint: "https://pocketping-telegram-relay.<you>.workers.dev" })
   ```

Done. Visitors chat in the widget; you reply from the matching topic in Telegram.

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

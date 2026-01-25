# Bridge E2E Tests (Real Platforms)

This repo includes a lightweight, API‑level E2E harness that sends **real** messages to Slack/Discord and verifies they propagate back into PocketPing. Each run embeds a **run_id** into message content for traceability.

The harness supports three modes and **listens to real event streams** (SSE / events API) to validate widget ↔ platform propagation:

- **saas**: hits the PocketPing SaaS widget API (`/connect`, `/message`, `/stream`).
- **sdk**: hits **your backend** (SDK mode) using the same widget API shape (`/connect`, `/message`, `/stream`).
- **bridge-server**: hits the bridge-server events API (`/api/sessions`, `/api/messages`, `/api/events/stream`).

> Telegram inbound cannot be fully automated with the Bot API (bots do not receive their own messages). See “Telegram notes” below.

---

## Quick Start

From the `pocketping/` repo:

```bash
pnpm run test:e2e:bridges
```

The harness reads configuration from environment variables.

---

## Environment Variables

### Common

```
PP_PLATFORMS=slack,discord          # default
PP_TIMEOUT_MS=90000                  # optional
PP_POLL_INTERVAL_MS=1500             # optional
PP_RUN_ID=gh-12345                   # optional (auto-generated if omitted)
PP_TARGET_MODE=saas                  # saas | sdk | bridge-server (widget alias supported)
```

### SaaS mode

Pick one:

```
PP_SAAS_PROJECT_ID=proj_xxx
PP_SAAS_BASE_URL=https://app.pocketping.io   # optional (default)
```

### SDK mode

```
PP_WIDGET_ENDPOINT=https://your-backend.example.com/pocketping
```

### Bridge-server mode

```
PP_TARGET_MODE=bridge-server
PP_BRIDGE_SERVER_URL=https://your-bridge-server.example.com
PP_BRIDGE_SERVER_API_KEY=your-api-key        # optional
```

### Slack

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C0123456789
```

### Discord (Forum channel + Gateway)

```
DISCORD_BOT_TOKEN=...
DISCORD_FORUM_CHANNEL_ID=123456789012345678
```

---

## Required Backend Configuration (Test Bots)

The harness posts operator replies **as bots**. For safety, PocketPing ignores bot messages by default. Enable test bot allowlisting in the backend:

```
BRIDGE_TEST_BOT_IDS=SLACK_BOT_ID,DISCORD_BOT_ID
```

- **SaaS**: set on `pocketping-app` runtime.
- **SDK / bridge-server**: set on your backend runtime or `.env`.

You can retrieve bot IDs from platform APIs:

- Slack: `POST https://slack.com/api/auth.test`
- Discord: `GET https://discord.com/api/v10/users/@me`

---

## What Gets Tested

Each step is validated both via **platform APIs** and via **widget/bridge event streams**.

**Slack**
- Visitor → Slack (bot message in channel)
- Slack reply → Widget/Backend
- Slack edit → Widget/Backend (`editedAt`)
- Slack delete → Widget/Backend (`deletedAt`)

**Discord**
- Visitor → Discord (thread message)
- Discord reply → Widget/Backend
- Discord edit → Widget/Backend (`editedAt`)
- Discord delete → Widget/Backend (`deletedAt`)

---

## Telegram Notes

Telegram bots **do not receive their own messages**, so inbound operator tests cannot be fully automated with the Bot API.

Options:

1. **Manual**: reply from a real Telegram user in the forum topic created by the visitor message.
2. **Userbot (optional)**: use MTProto/Telethon with a test user account and session.

We keep Telegram inbound tests **manual by default** to avoid storing user sessions in CI.

---

## Why Not Use Web Apps?

UI automation is fragile and slow (auth flows, captchas, UI changes). The E2E runner uses **official APIs + webhooks/gateway ingestion** to produce hard evidence:
- platform `message_id`
- `reply_to` linkage
- edit/delete events

This gives a stable, API‑level proof without brittle UI tests.

---

## Local Examples

### SaaS

```bash
export PP_SAAS_PROJECT_ID=proj_xxx
export SLACK_BOT_TOKEN=...
export SLACK_CHANNEL_ID=...
export DISCORD_BOT_TOKEN=...
export DISCORD_FORUM_CHANNEL_ID=...
export BRIDGE_TEST_BOT_IDS=SLACK_BOT_ID,DISCORD_BOT_ID

pnpm run test:e2e:bridges
```

### SDK

```bash
export PP_TARGET_MODE=sdk
export PP_WIDGET_ENDPOINT=https://your-backend.example.com/pocketping
export SLACK_BOT_TOKEN=...
export SLACK_CHANNEL_ID=...
export DISCORD_BOT_TOKEN=...
export DISCORD_FORUM_CHANNEL_ID=...
export BRIDGE_TEST_BOT_IDS=SLACK_BOT_ID,DISCORD_BOT_ID

pnpm run test:e2e:bridges
```

### Bridge-server

```bash
export PP_TARGET_MODE=bridge-server
export PP_BRIDGE_SERVER_URL=http://localhost:3001
export PP_BRIDGE_SERVER_API_KEY=optional
export SLACK_BOT_TOKEN=...
export SLACK_CHANNEL_ID=...
export DISCORD_BOT_TOKEN=...
export DISCORD_FORUM_CHANNEL_ID=...
export BRIDGE_TEST_BOT_IDS=SLACK_BOT_ID,DISCORD_BOT_ID

pnpm run test:e2e:bridges
```

---

## CI Guidance

Use **workflow_dispatch** or **nightly** schedules with encrypted secrets:

- `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`
- `DISCORD_BOT_TOKEN`, `DISCORD_FORUM_CHANNEL_ID`
- `BRIDGE_TEST_BOT_IDS`
- `PP_SAAS_PROJECT_ID` and/or `PP_WIDGET_ENDPOINT`
- `PP_BRIDGE_SERVER_URL` (bridge-server runs)

See `.github/workflows/` for suggested pipelines.

---
sidebar_position: 8
title: Community Edition
description: Self-hosted PocketPing with PostgreSQL - full-featured, zero SaaS
---

# Community Edition

**PocketPing Community Edition** is a fully self-hosted solution with PostgreSQL storage, pre-built bridge integrations, and zero dependencies on external services.

Unlike the SDK approach (where you implement your own storage), the Community Edition provides a complete solution out of the box.

## When to Use Community Edition

| Use Case | Solution |
|----------|----------|
| You have a backend and want flexibility | Use [SDKs](/sdk) |
| You want zero code, just configuration | Use [Bridge Server](/bridges/docker) |
| You want full features with PostgreSQL, self-hosted | **Community Edition** ✅ |

## Features

- **PostgreSQL storage** - Sessions, messages, and attachments persisted
- **All bridges included** - Telegram, Discord, Slack with auto-thread management
- **Pre-chat forms** - Collect visitor info before chat starts
- **Message sync** - Edits and deletes sync across all bridges
- **File attachments** - Share images and files bidirectionally
- **Real-time updates** - SSE streaming to widgets
- **Docker ready** - One command deployment

## Quick Start

### 1. Clone and Configure

```bash
git clone https://github.com/pocketping/pocketping.git
cd pocketping/community

# Configure environment
cp .env.example .env
```

### 2. Edit `.env`

```env
# Required
DATABASE_URL="postgresql://pocketping:pocketping@db:5432/pocketping"

# Telegram (optional)
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_WEBHOOK_SECRET=random-secret

# Discord (optional)
DISCORD_BOT_TOKEN=your-bot-token
ENABLE_DISCORD_GATEWAY=true  # Required to receive messages from operators
```

### 3. Start with Docker

```bash
docker-compose up -d
```

### 4. Get Your API Keys

Open http://localhost:3000 to see your API keys:

- **Public Key** - For the widget (client-side)
- **Secret Key** - For admin API (server-side)

### 5. Add Widget to Your Site

```html
<script
  src="https://cdn.pocketping.io/widget.js"
  data-api-key="YOUR_PUBLIC_KEY"
  data-api-url="https://your-pocketping-server.com"
></script>
```

## Bridge Setup

### Telegram

**Step 1: Create a Bot**
1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token

**Step 2: Create a Forum Group**
1. Create a new group in Telegram
2. Settings → Group Type → Convert to Supergroup
3. Settings → Topics → Enable Topics
4. Add your bot to the group
5. Make the bot an admin with "Manage Topics" permission

**Step 3: Get the Chat ID**
1. Add [@userinfobot](https://t.me/userinfobot) to your group temporarily
2. It will post a message with the chat ID (starts with `-100`)
3. Remove the bot after

**Step 4: Set Webhook** (after deployment)
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-domain.com/api/webhooks/telegram&secret_token=<SECRET>"
```

---

### Discord

**Step 1: Create Application**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. New Application → Bot section → Add Bot
3. Copy the bot token

**Step 2: Configure Intents**
In the Bot section, enable:
- ✅ Message Content Intent

**Step 3: Generate Invite URL**
OAuth2 → URL Generator:
- Scopes: `bot`
- Permissions: `Send Messages`, `Create Public Threads`, `Send Messages in Threads`, `Read Message History`

Open the URL to add bot to your server.

**Step 4: Get Channel ID**
1. Enable Developer Mode (User Settings → Advanced → Developer Mode)
2. Right-click channel → Copy Channel ID

**Step 5: Configure via Admin API**
```bash
curl -X PATCH https://your-domain/api/admin/settings \
  -H "Authorization: Bearer YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"discordChannelId": "1234567890123456789"}'
```

---

### Slack

**Step 1: Create Slack App**
1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Create New App → From scratch

**Step 2: Add OAuth Scopes**
OAuth & Permissions → Bot Token Scopes:
- `chat:write`
- `channels:history`
- `channels:read`
- `users:read`
- `files:read`

Install to workspace and copy the Bot Token (`xoxb-...`).

**Step 3: Enable Event Subscriptions**
1. Event Subscriptions → Enable
2. Request URL: `https://your-domain.com/api/webhooks/slack`
3. Subscribe to bot events: `message.channels`

**Step 4: Invite Bot**
In Slack: `/invite @YourBotName` in your support channel.

**Step 5: Get Channel ID**
Right-click channel → View channel details → Copy Channel ID.

**Step 6: Configure via Admin API**
```bash
curl -X PATCH https://your-domain/api/admin/settings \
  -H "Authorization: Bearer YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slackBotToken": "xoxb-your-token",
    "slackChannelId": "C0123456789"
  }'
```

## API Reference

### Widget Endpoints

All require `Authorization: Bearer <PUBLIC_KEY>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/widget/init` | Initialize session |
| `POST` | `/api/widget/messages` | Send message |
| `GET` | `/api/widget/messages?sessionId=X` | Get messages |
| `POST` | `/api/widget/identify` | Update visitor info |
| `GET` | `/api/widget/stream?sessionId=X` | SSE real-time updates |

### Admin Endpoints

All require `Authorization: Bearer <SECRET_KEY>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/settings` | Get project settings |
| `PATCH` | `/api/admin/settings` | Update settings |

### Example: Initialize Session

```javascript
const response = await fetch('https://your-server/api/widget/init', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_PUBLIC_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    visitorId: 'unique-visitor-id',
    url: window.location.href,
    userAgent: navigator.userAgent,
  }),
});

const { sessionId, messages, config } = await response.json();
```

### Example: Send Message

```javascript
const response = await fetch('https://your-server/api/widget/messages', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_PUBLIC_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    sessionId: 'session-id',
    content: 'Hello, I need help!',
  }),
});
```

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────┐
│   Your Website  │────▶│   PocketPing Community       │
│    (Widget)     │◀────│   (Next.js + PostgreSQL)     │
└─────────────────┘     └───────────┬──────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
          ▼                         ▼                         ▼
   ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
   │  Telegram   │          │   Discord   │          │    Slack    │
   │  (Topics)   │          │  (Threads)  │          │  (Threads)  │
   └─────────────┘          └─────────────┘          └─────────────┘
```

## Docker Compose

```yaml title="docker-compose.yml"
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://pocketping:pocketping@db:5432/pocketping
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
      - DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
      - ENABLE_DISCORD_GATEWAY=true
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=pocketping
      - POSTGRES_PASSWORD=pocketping
      - POSTGRES_DB=pocketping
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pocketping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

## vs Other Options

| Feature | SDKs | Bridge Server | **Community Edition** |
|---------|------|---------------|----------------------|
| Self-hosted | ✅ | ✅ | ✅ |
| Storage included | ❌ (implement yourself) | ❌ (stateless) | ✅ PostgreSQL |
| Thread management | ❌ | ❌ | ✅ Auto-recreate |
| Pre-chat forms | ❌ | ❌ | ✅ |
| Message sync | Partial | ✅ | ✅ |
| Docker ready | ❌ | ✅ | ✅ |
| Multi-tenant | ❌ | ❌ | ❌ (use SaaS) |

## Next Steps

- [Widget Customization](/widget/customization) - Customize colors, messages
- [AI Fallback](/ai-fallback) - Set up automatic AI responses
- [API Reference](/api) - Full API documentation

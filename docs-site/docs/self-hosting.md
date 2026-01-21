---
sidebar_position: 7
title: Self-Hosting
description: Deploy PocketPing on your own infrastructure
---

# Self-Hosting Guide

Deploy PocketPing on your own infrastructure for complete control over your data.

## Architecture Overview

A self-hosted PocketPing setup consists of three components:

| Component | Description |
|-----------|-------------|
| **Chat Widget** | Embedded on your website, connects via WebSocket |
| **Bridge Server** | Routes messages between widget and platforms |
| **Messaging Platforms** | Telegram, Discord, or Slack for notifications |

## Option 1: Minimal Setup

The simplest self-hosted setup uses the Python or Node.js SDK with embedded bridge support. No separate bridge server needed.

### Python (FastAPI)

```python
# Install
pip install pocketping

# main.py
from fastapi import FastAPI
from pocketping import PocketPing
from pocketping.bridges import TelegramBridge

app = FastAPI()

pp = PocketPing(
    bridge=TelegramBridge(
        token="YOUR_BOT_TOKEN",
        chat_id="YOUR_CHAT_ID"
    )
)

# Mount routes at /pocketping
pp.mount_fastapi(app, prefix="/pocketping")

# Run: uvicorn main:app --host 0.0.0.0 --port 8000
```

### Node.js (Express)

```javascript
// Install
npm install @pocketping/sdk-node

// server.js
const express = require('express');
const { PocketPing } = require('@pocketping/sdk-node');

const app = express();
const pp = new PocketPing({
  bridgeUrl: 'http://localhost:3001', // Bridge server URL
});

// Mount routes
app.use('/pocketping', pp.middleware());

app.listen(8000);
```

## Option 2: Full Setup with Bridge Server

For production or when you want to use multiple bridges, run the bridge server separately using Docker.

### 1. Deploy Bridge Server

```yaml title="docker-compose.yml"
version: '3.8'

services:
  bridge:
    image: ghcr.io/pocketping/pocketping-bridge:latest
    ports:
      - "3001:3001"
    environment:
      - TELEGRAM_BOT_TOKEN=your_token
      - TELEGRAM_FORUM_CHAT_ID=your_chat_id
      - DISCORD_BOT_TOKEN=your_discord_token
      - DISCORD_CHANNEL_ID=your_channel_id
    restart: unless-stopped

# Run: docker compose up -d
```

### 2. Configure Backend

Point your backend SDK to the bridge server:

```python
# Python
pp = PocketPing(
    bridge_url="http://bridge:3001"  # Docker network or public URL
)
```

```javascript
// Node.js
const pp = new PocketPing({
    bridgeUrl: 'http://bridge:3001'
});
```

### 3. Add Widget to Frontend

```html
<script src="https://cdn.jsdelivr.net/npm/@pocketping/widget@latest/dist/index.global.js"></script>
<script>
  PocketPing.init({
    endpoint: 'https://yourbackend.com/pocketping',
    operatorName: 'Support',
  });
</script>
```

## Database Options

By default, sessions and messages are stored in memory. For production, implement a custom storage backend:

### PostgreSQL Example (Python)

```python
from pocketping.storage import Storage
import asyncpg

class PostgresStorage(Storage):
    def __init__(self, dsn: str):
        self.dsn = dsn

    async def create_session(self, session):
        conn = await asyncpg.connect(self.dsn)
        await conn.execute('''
            INSERT INTO sessions (id, visitor_id, created_at)
            VALUES ($1, $2, $3)
        ''', session.id, session.visitor_id, session.created_at)
        await conn.close()

    # Implement other methods...

pp = PocketPing(
    storage=PostgresStorage("postgresql://user:pass@localhost/db"),
    bridge=TelegramBridge(...)
)
```

## Deployment Checklist

- [ ] Backend deployed with SSL (HTTPS)
- [ ] Bridge server deployed (Docker or embedded)
- [ ] At least one bridge configured (Telegram/Discord/Slack)
- [ ] Widget added to frontend
- [ ] CORS configured (backend allows widget domain)
- [ ] Persistent storage configured (optional but recommended)
- [ ] Health checks and monitoring in place

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Bridge server port (default: 3001) |
| `API_KEY` | No | Secret key for API authentication |
| `TELEGRAM_BOT_TOKEN` | If using Telegram | Bot token from BotFather |
| `TELEGRAM_FORUM_CHAT_ID` | If using Telegram | Telegram supergroup ID |
| `DISCORD_BOT_TOKEN` | If using Discord | Discord bot token |
| `DISCORD_CHANNEL_ID` | If using Discord | Discord channel ID for threads |

## Next Steps

- [Docker Setup](/bridges/docker) - Detailed Docker deployment guide
- [AI Fallback](/ai-fallback) - Configure AI auto-responses
- [API Reference](/api) - Complete REST API documentation

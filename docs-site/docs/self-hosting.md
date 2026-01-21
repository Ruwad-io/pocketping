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
<script src="https://cdn.pocketping.io/widget.js"></script>
<script>
  PocketPing.init({
    endpoint: 'https://yourbackend.com/pocketping',
    operatorName: 'Support',
  });
</script>
```

## Storage Options

By default, sessions and messages are stored **in memory** using `MemoryStorage`. This works for development but data is lost on restart.

### Built-in Storage

| Storage | Included | Description |
|---------|----------|-------------|
| `MemoryStorage` | ✅ Yes | In-memory, data lost on restart. Good for dev/testing. |
| `PostgresStorage` | ❌ No | Implement yourself using the interface below. |
| `RedisStorage` | ❌ No | Implement yourself using the interface below. |

### Custom Storage Interface

To persist data, implement the `Storage` interface:

```python
# Python - Required methods
from pocketping.storage import Storage

class MyStorage(Storage):
    async def create_session(self, session: Session) -> None: ...
    async def get_session(self, session_id: str) -> Session | None: ...
    async def update_session(self, session: Session) -> None: ...
    async def delete_session(self, session_id: str) -> None: ...
    async def save_message(self, message: Message) -> None: ...
    async def get_messages(self, session_id: str, after: str | None = None, limit: int = 50) -> list[Message]: ...
    async def get_message(self, message_id: str) -> Message | None: ...
```

```typescript
// Node.js - Required methods
import { Storage } from '@pocketping/sdk-node';

class MyStorage implements Storage {
  async createSession(session: Session): Promise<void>;
  async getSession(sessionId: string): Promise<Session | null>;
  async updateSession(session: Session): Promise<void>;
  async deleteSession(sessionId: string): Promise<void>;
  async saveMessage(message: Message): Promise<void>;
  async getMessages(sessionId: string, after?: string, limit?: number): Promise<Message[]>;
  async getMessage(messageId: string): Promise<Message | null>;
}
```

### Example: PostgreSQL (Python)

:::note
This is an example. `PostgresStorage` is **not included** in the SDK—you need to implement it.
:::

```python
from pocketping.storage import Storage
from pocketping.models import Session, Message
import asyncpg

class PostgresStorage(Storage):
    def __init__(self, dsn: str):
        self.dsn = dsn
        self.pool = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(self.dsn)

    async def create_session(self, session: Session) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute('''
                INSERT INTO sessions (id, visitor_id, created_at, last_activity)
                VALUES ($1, $2, $3, $4)
            ''', session.id, session.visitor_id, session.created_at, session.last_activity)

    async def get_session(self, session_id: str) -> Session | None:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow('SELECT * FROM sessions WHERE id = $1', session_id)
            if row:
                return Session(id=row['id'], visitor_id=row['visitor_id'], ...)
            return None

    # ... implement remaining methods

# Usage
storage = PostgresStorage("postgresql://user:pass@localhost/pocketping")
await storage.connect()

pp = PocketPing(
    storage=storage,
    bridge=TelegramBridge(...)
)
```

### Example: PostgreSQL (Node.js)

:::note
This is an example. `PostgresStorage` is **not included** in the SDK—you need to implement it.
:::

```typescript
import { Storage, Session, Message } from '@pocketping/sdk-node';
import { Pool } from 'pg';

class PostgresStorage implements Storage {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async createSession(session: Session): Promise<void> {
    await this.pool.query(
      'INSERT INTO sessions (id, visitor_id, created_at, last_activity) VALUES ($1, $2, $3, $4)',
      [session.id, session.visitorId, session.createdAt, session.lastActivity]
    );
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const result = await this.pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [sessionId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      visitorId: row.visitor_id,
      createdAt: row.created_at,
      lastActivity: row.last_activity,
      // ... other fields
    };
  }

  // ... implement remaining methods
}

// Usage
const storage = new PostgresStorage('postgresql://user:pass@localhost/pocketping');

const pp = new PocketPing({
  storage,
  bridgeUrl: 'http://localhost:3001',
});
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

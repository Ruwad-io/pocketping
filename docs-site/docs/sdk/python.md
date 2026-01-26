---
sidebar_position: 2
title: Python SDK
description: Backend integration with the PocketPing Python SDK
---

# Python SDK

Integrate PocketPing into your Python backend.

## Installation

```bash
pip install pocketping
```

## Quick Start

### FastAPI

```python
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

### Flask

```python
from flask import Flask
from pocketping import PocketPing
from pocketping.bridges import TelegramBridge

app = Flask(__name__)

pp = PocketPing(
    bridge=TelegramBridge(
        token="YOUR_BOT_TOKEN",
        chat_id="YOUR_CHAT_ID"
    )
)

# Register blueprint
app.register_blueprint(pp.flask_blueprint, url_prefix="/pocketping")

if __name__ == "__main__":
    app.run(port=8000)
```

### Django

```python
# settings.py
POCKETPING_CONFIG = {
    "bridge_url": "http://localhost:3001",
}

# urls.py
from pocketping.django import pocketping_urls

urlpatterns = [
    path("pocketping/", include(pocketping_urls)),
]
```

## Built-in Bridges

The SDK includes built-in bridges for Telegram, Discord, and Slack with automatic validation and helpful setup guides.

```python
import os
from pocketping import PocketPing
from pocketping.bridges import TelegramBridge, DiscordBridge, SlackBridge
from pocketping.exceptions import SetupError

pp = PocketPing()

# Add Telegram bridge
try:
    pp.add_bridge(TelegramBridge(
        token=os.environ["TELEGRAM_BOT_TOKEN"],
        chat_id=os.environ["TELEGRAM_CHAT_ID"]
    ))
except SetupError as e:
    # Helpful error with setup guide
    print(e.formatted_guide())
    exit(1)

# Add Discord bridge (bot mode)
try:
    pp.add_bridge(DiscordBridge(
        bot_token=os.environ["DISCORD_BOT_TOKEN"],
        channel_id=os.environ["DISCORD_CHANNEL_ID"]
    ))
except SetupError as e:
    print(e.formatted_guide())
    exit(1)

# Add Slack bridge (bot mode)
try:
    pp.add_bridge(SlackBridge(
        bot_token=os.environ["SLACK_BOT_TOKEN"],
        channel_id=os.environ["SLACK_CHANNEL_ID"]
    ))
except SetupError as e:
    print(e.formatted_guide())
    exit(1)
```

### Validation Errors

If configuration is missing or invalid, you'll see a helpful setup guide:

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️  Telegram Setup Required
├─────────────────────────────────────────────────────────────┤
│
│  Missing: bot_token
│
│  To create a Telegram Bot:
│
│  1. Open @BotFather in Telegram
│  2. Send /newbot
│  3. Choose a name and username
│  4. Copy the Bot Token you receive
│
│  📖 Full guide: https://pocketping.io/docs/telegram
│
│  💡 Quick fix: npx @pocketping/cli init telegram
│
└─────────────────────────────────────────────────────────────┘
```

### Bridge Modes

| Bridge | Mode | Constructor | Features |
|--------|------|-------------|----------|
| Telegram | Bot | `TelegramBridge(token=..., chat_id=...)` | Send, edit, delete |
| Discord | Webhook | `DiscordBridge(webhook_url=...)` | Send only |
| Discord | Bot | `DiscordBridge(bot_token=..., channel_id=...)` | Send, edit, delete |
| Slack | Webhook | `SlackBridge(webhook_url=...)` | Send only |
| Slack | Bot | `SlackBridge(bot_token=..., channel_id=...)` | Send, edit, delete |

:::tip Bot vs Webhook
Use **Bot mode** for full bidirectional communication. Webhooks are simpler but only support sending messages.
:::

:::warning Discord Bot requires long-running server
**Discord bot mode** uses the Discord Gateway (WebSocket) to receive operator replies. This only works on **long-running servers** (FastAPI with uvicorn, Flask, Django with gunicorn, etc.).

**Does NOT work with:**
- AWS Lambda
- Google Cloud Functions
- Azure Functions
- Any serverless environment

**For serverless + Discord bidirectional:** Use the [Bridge Server](/bridges/docker) instead, or use `DiscordBridge(webhook_url=...)` (send-only).
:::

:::info Telegram & Slack work with serverless
**Telegram** and **Slack** use HTTP webhooks (not WebSocket), so they work fully with serverless environments like Lambda, Cloud Functions, etc.
:::

---

## Configuration

```python
from pocketping import PocketPing
from pocketping.storage import PostgresStorage
from pocketping.bridges import TelegramBridge, DiscordBridge

pp = PocketPing(
    # Option 1: Use external bridge server (alternative to built-in bridges)
    bridge_url="http://localhost:3001",
    api_key="your_api_key",

    # Option 2: Use built-in bridges directly
    bridges=[
        TelegramBridge(token="...", chat_id="..."),
        DiscordBridge.bot(token="...", channel_id="..."),
    ],

    # Optional: Custom storage
    storage=PostgresStorage("postgresql://..."),

    # Optional: Event handlers
    on_session_start=lambda s: print(f"New session: {s.id}"),
    on_message=lambda s, m: print(f"Message: {m.content}"),
)
```

## API

### Sessions

```python
# Get all active sessions
sessions = await pp.get_sessions()

# Get a specific session
session = await pp.get_session("sess_xxx")

# Get session messages
messages = await pp.get_messages("sess_xxx")

# Close a session
await pp.close_session("sess_xxx")
```

### Messages

```python
# Send a message to a session
await pp.send_message("sess_xxx", {
    "content": "Hello from the server!",
    "type": "operator",
})
```

### Visitor Identification

Enrich sessions with user data so operators can see who they're talking to:

```python
from pocketping.models import IdentifyRequest, UserIdentity

# Identify a visitor
await pp.handle_identify(IdentifyRequest(
    session_id="sess_xxx",
    identity=UserIdentity(
        id="user_123",           # Required
        email="user@example.com",
        name="John Doe",
        plan="pro",              # Custom fields supported
        company="Acme Inc",
    ),
))
```

**Required field:** `identity.id` must be a non-empty string.

## Custom Events

Handle events from the widget and send events back.

### Receiving Events from Widget

Use the `on_event` callback to handle events sent by `PocketPing.trigger()` in the widget:

```python
from pocketping import PocketPing

def handle_event(event, session):
    print(f"Event: {event.name}", event.data)

    # Track in analytics
    analytics.track(event.name, {
        **event.data,
        "session_id": session.id,
        "visitor_id": session.visitor_id,
    })

    # Trigger automation
    if event.name == "clicked_pricing":
        pp.send_message(session.id, {
            "content": "I see you're checking our pricing! Need help?",
            "type": "operator",
        })

pp = PocketPing(
    bridge_url="http://localhost:3001",
    on_event=handle_event,
)
```

### Sending Events to Widget

Use `emit_event()` to send events that the widget can listen to:

```python
# Send a promotional offer to a specific session
pp.emit_event("sess_xxx", "show_offer", {
    "discount": 20,
    "code": "SAVE20",
    "message": "Special offer just for you!"
})

# Open the chat widget remotely
pp.emit_event("sess_xxx", "open_chat")
```

## Custom Storage

Implement the `Storage` class for persistence:

```python
from pocketping.storage import Storage
from typing import Optional, List
import asyncpg

class PostgresStorage(Storage):
    def __init__(self, dsn: str):
        self.dsn = dsn

    async def create_session(self, session: dict) -> None:
        conn = await asyncpg.connect(self.dsn)
        await conn.execute('''
            INSERT INTO sessions (id, visitor_id, created_at)
            VALUES ($1, $2, $3)
        ''', session["id"], session["visitor_id"], session["created_at"])
        await conn.close()

    async def get_session(self, session_id: str) -> Optional[dict]:
        conn = await asyncpg.connect(self.dsn)
        row = await conn.fetchrow(
            "SELECT * FROM sessions WHERE id = $1",
            session_id
        )
        await conn.close()
        return dict(row) if row else None

    async def save_message(self, session_id: str, message: dict) -> None:
        conn = await asyncpg.connect(self.dsn)
        await conn.execute('''
            INSERT INTO messages (id, session_id, content, type, created_at)
            VALUES ($1, $2, $3, $4, $5)
        ''', message["id"], session_id, message["content"],
            message["type"], message["created_at"])
        await conn.close()

    async def get_messages(self, session_id: str) -> List[dict]:
        conn = await asyncpg.connect(self.dsn)
        rows = await conn.fetch(
            "SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at",
            session_id
        )
        await conn.close()
        return [dict(row) for row in rows]

# Usage
pp = PocketPing(
    storage=PostgresStorage("postgresql://user:pass@localhost/db"),
    bridge=TelegramBridge(...)
)
```

## Type Hints

The SDK includes type hints for better IDE support:

```python
from pocketping import PocketPing, Session, Message
from pocketping.storage import Storage
from typing import Callable

def on_new_session(session: Session) -> None:
    print(f"New session: {session.id}")

def on_new_message(session: Session, message: Message) -> None:
    print(f"Message in {session.id}: {message.content}")

pp = PocketPing(
    bridge_url="http://localhost:3001",
    on_session_start=on_new_session,
    on_message=on_new_message,
)
```

## Next Steps

- [Node.js SDK](/sdk/nodejs) - Backend integration for Node.js
- [API Reference](/api) - Full REST API documentation

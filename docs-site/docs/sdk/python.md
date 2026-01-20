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

## Configuration

```python
from pocketping import PocketPing
from pocketping.storage import PostgresStorage
from pocketping.bridges import TelegramBridge, DiscordBridge

pp = PocketPing(
    # Option 1: Use external bridge server
    bridge_url="http://localhost:3001",
    api_key="your_api_key",

    # Option 2: Use embedded bridges
    bridges=[
        TelegramBridge(token="...", chat_id="..."),
        DiscordBridge(token="...", channel_id="..."),
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

```python
# Identify a visitor
await pp.identify("sess_xxx", {
    "email": "user@example.com",
    "name": "John Doe",
    "customer_id": "cust_123",
    "metadata": {
        "plan": "pro",
        "company": "Acme Inc",
    },
})
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

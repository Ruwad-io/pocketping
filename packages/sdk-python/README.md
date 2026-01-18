# PocketPing Python SDK

Python SDK for PocketPing - real-time customer chat with mobile notifications.

## Installation

```bash
pip install pocketping

# With all optional dependencies
pip install pocketping[all]

# Or pick what you need
pip install pocketping[fastapi]      # FastAPI integration
pip install pocketping[telegram]     # Telegram bridge
pip install pocketping[discord]      # Discord bridge
pip install pocketping[slack]        # Slack bridge
pip install pocketping[ai]           # AI providers (OpenAI, Gemini, Claude)
```

## Quick Start with FastAPI

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from pocketping import PocketPing
from pocketping.fastapi import create_router, lifespan_handler, add_cors_middleware
from pocketping.bridges.telegram import TelegramBridge
from pocketping.ai import OpenAIProvider
import os

# Initialize PocketPing
pp = PocketPing(
    welcome_message="Hi! 👋 How can we help you today?",
    ai_provider=OpenAIProvider(api_key=os.getenv("OPENAI_API_KEY")),
    ai_takeover_delay=300,  # 5 minutes before AI takes over
    bridges=[
        TelegramBridge(
            bot_token=os.getenv("TELEGRAM_BOT_TOKEN"),
            chat_ids=os.getenv("TELEGRAM_CHAT_ID"),
        ),
    ],
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with lifespan_handler(pp):
        yield

app = FastAPI(lifespan=lifespan)
add_cors_middleware(app)

# Mount PocketPing routes
app.include_router(create_router(pp), prefix="/pocketping")

@app.get("/")
def home():
    return {"message": "PocketPing is running!"}
```

## Bridges

### Telegram

```python
from pocketping.bridges.telegram import TelegramBridge

bridge = TelegramBridge(
    bot_token="your_bot_token",
    chat_ids=["your_chat_id"],  # Can be string or list
    show_url=True,
)
```

Commands in Telegram:
- `/online` - Mark yourself as available
- `/offline` - Mark yourself as away
- `/status` - View status

Reply to any message to respond to users.

### Discord

```python
from pocketping.bridges.discord import DiscordBridge

bridge = DiscordBridge(
    bot_token="your_bot_token",
    channel_id=123456789,  # Your channel ID (int)
    show_url=True,
)
```

Commands in Discord:
- `!online` - Mark yourself as available
- `!offline` - Mark yourself as away
- `!status` - View status

Reply to any message to respond to users.

### Slack

```python
from pocketping.bridges.slack import SlackBridge

bridge = SlackBridge(
    bot_token="xoxb-your-bot-token",
    app_token="xapp-your-app-token",  # For Socket Mode
    channel_id="C0123456789",
    show_url=True,
)
```

Mention the bot with commands:
- `@PocketPing online` - Mark yourself as available
- `@PocketPing offline` - Mark yourself as away
- `@PocketPing status` - View status

Reply in thread to respond to users.

## AI Providers

### OpenAI

```python
from pocketping.ai import OpenAIProvider

ai = OpenAIProvider(
    api_key="sk-...",
    model="gpt-4o-mini",  # default
)
```

### Google Gemini

```python
from pocketping.ai import GeminiProvider

ai = GeminiProvider(
    api_key="your_api_key",
    model="gemini-1.5-flash",  # default
)
```

### Anthropic Claude

```python
from pocketping.ai import AnthropicProvider

ai = AnthropicProvider(
    api_key="sk-ant-...",
    model="claude-sonnet-4-20250514",  # default
)
```

## Custom System Prompt

```python
pp = PocketPing(
    ai_provider=OpenAIProvider(api_key="..."),
    ai_system_prompt="""
    You are a helpful support assistant for Acme Inc.
    Our products include: Widget Pro, Widget Basic, and Widget Enterprise.
    Be friendly and concise. If you don't know something, offer to connect them with a human.
    """,
    ai_takeover_delay=180,  # 3 minutes
)
```

## Presence Detection

The `ai_takeover_delay` setting controls how long to wait before AI takes over:

1. Visitor sends a message
2. Timer starts
3. If operator responds → Timer resets, AI stays inactive
4. If `ai_takeover_delay` seconds pass with no operator response → AI takes over
5. If operator responds after AI takeover → AI becomes inactive again

```python
pp = PocketPing(
    ai_provider=OpenAIProvider(api_key="..."),
    ai_takeover_delay=300,  # 5 minutes (default)
)
```

## Custom Storage

Implement the `Storage` interface for persistence:

```python
from pocketping import Storage, Session, Message

class PostgresStorage(Storage):
    async def create_session(self, session: Session) -> None:
        # Your implementation
        pass

    async def get_session(self, session_id: str) -> Session | None:
        # Your implementation
        pass

    # ... implement other methods

pp = PocketPing(storage=PostgresStorage())
```

## Events / Callbacks

```python
def on_new_session(session):
    print(f"New session: {session.id}")

def on_message(message, session):
    print(f"Message from {message.sender}: {message.content}")

pp = PocketPing(
    on_new_session=on_new_session,
    on_message=on_message,
)
```

## License

MIT

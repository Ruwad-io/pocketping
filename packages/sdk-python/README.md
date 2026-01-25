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
            forum_chat_id=os.getenv("TELEGRAM_FORUM_CHAT_ID"),  # Supergroup with topics
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

Two modes available:

#### Forum Topics Mode (Recommended for Teams)

Each conversation gets its own topic - perfect for multiple operators:

```python
from pocketping.bridges.telegram import TelegramBridge

bridge = TelegramBridge(
    bot_token="your_bot_token",
    forum_chat_id="-100123456789",  # Supergroup with topics enabled
    show_url=True,
    show_metadata=True,
)
```

**Setup:**
1. Create a Telegram group
2. Convert to Supergroup (Settings > Group Type)
3. Enable Topics (Settings > Topics)
4. Add your bot as admin with "Manage Topics" permission
5. Get the chat_id (starts with -100)

**Benefits:**
- Each visitor = separate topic (no message mixing)
- Just type in the topic to reply (no swipe-reply needed)
- All team members see all conversations
- `/close` command to mark conversations as done

#### Legacy Mode (Single Operator)

All messages in one chat, reply-based:

```python
bridge = TelegramBridge(
    bot_token="your_bot_token",
    chat_ids=["your_chat_id"],  # Can be string or list
    show_url=True,
)
```

**Commands:**
- `/online` - Mark yourself as available
- `/offline` - Mark yourself as away
- `/status` - View status
- `/close` - Close conversation (forum mode only)

### Discord

Two modes available:

#### Thread Mode (Default, Recommended for Teams)

Each conversation gets its own thread:

```python
from pocketping.bridges.discord import DiscordBridge

bridge = DiscordBridge(
    bot_token="your_bot_token",
    channel_id=123456789,  # Your channel ID (int)
    use_threads=True,  # Default
    show_url=True,
    show_metadata=True,
)
```

**Setup:**
1. Create a Discord bot at https://discord.com/developers/applications
2. Enable MESSAGE CONTENT INTENT in Bot settings
3. Add permissions: Send Messages, Create Public Threads, Send Messages in Threads, Add Reactions
4. Invite bot and get channel ID (Developer Mode > Right-click > Copy ID)

**Benefits:**
- Each visitor = separate thread (no message mixing)
- Just type in the thread to reply
- All team members see all conversations
- `!close` command to archive threads

#### Legacy Mode (Single Operator)

All messages in channel, reply-based:

```python
bridge = DiscordBridge(
    bot_token="your_bot_token",
    channel_id=123456789,
    use_threads=False,
)
```

**Commands:**
- `!online` - Mark yourself as available
- `!offline` - Mark yourself as away
- `!status` - View status
- `!close` - Close conversation (thread mode only)

### Slack

```python
from pocketping.bridges.slack import SlackBridge

bridge = SlackBridge(
    bot_token="xoxb-your-bot-token",
    channel_id="C0123456789",
    show_url=True,
)
```

Mention the bot with commands:
- `@PocketPing online` - Mark yourself as available
- `@PocketPing offline` - Mark yourself as away
- `@PocketPing status` - View status

Reply in thread to respond to users.

### Reply Behavior

- **Telegram:** native replies when `reply_to` is set and Telegram message ID is known.
- **Discord:** native replies via `message_reference` when Discord message ID is known.
- **Slack:** quoted block (left bar) inside the thread.

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

## IP Filtering

Block or allow specific IP addresses or CIDR ranges:

```python
from pocketping import PocketPing, IpFilterConfig

pp = PocketPing(
    ip_filter=IpFilterConfig(
        enabled=True,
        mode='blocklist',  # 'allowlist' | 'blocklist' | 'both'
        blocklist=[
            '203.0.113.0/24',   # CIDR range
            '198.51.100.50',    # Single IP
        ],
        allowlist=[
            '10.0.0.0/8',       # Internal network
        ],
        log_blocked=True,      # Log blocked requests (default: True)
        blocked_status_code=403,
        blocked_message='Forbidden',
    ),
)

# Or with a custom filter function
def my_filter(ip: str, request) -> bool | None:
    # Return True to allow, False to block, None to defer to list-based filtering
    if ip.startswith('192.168.'):
        return True  # Always allow local
    return None  # Use blocklist/allowlist

pp = PocketPing(
    ip_filter=IpFilterConfig(
        enabled=True,
        mode='blocklist',
        custom_filter=my_filter,
    ),
)
```

### Modes

| Mode | Behavior |
|------|----------|
| `blocklist` | Block IPs in blocklist, allow all others (default) |
| `allowlist` | Only allow IPs in allowlist, block all others |
| `both` | Allowlist takes precedence, then blocklist is applied |

### CIDR Support

The SDK supports CIDR notation for IP ranges:
- Single IP: `192.168.1.1` (treated as `/32`)
- Class C: `192.168.1.0/24` (256 addresses)
- Class B: `172.16.0.0/16` (65,536 addresses)
- Class A: `10.0.0.0/8` (16M addresses)

### Manual IP Check

```python
# Check IP manually
result = pp.check_ip_filter('192.168.1.50')
# result: IpFilterResult(allowed=bool, reason=str, matched_rule=str|None)

# Get client IP from request headers
client_ip = pp.get_client_ip(request.headers)
# Checks: CF-Connecting-IP, X-Real-IP, X-Forwarded-For
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

## Custom Events

PocketPing supports bidirectional custom events between your website and backend. This enables powerful interactions like triggering alerts, sending offers, or reacting to user behavior.

### Listening for Events (Widget → Backend)

Subscribe to events triggered from the widget:

```python
from pocketping import PocketPing, CustomEvent, Session

pp = PocketPing()

# Using callback in config
def handle_event(event: CustomEvent, session: Session):
    print(f"Event {event.name} from session {session.id}")
    print(f"Data: {event.data}")

pp = PocketPing(on_event=handle_event)

# Or using decorator-style subscription
@pp.on_event('clicked_pricing')
async def on_pricing_click(event: CustomEvent, session: Session):
    print(f"User interested in: {event.data.get('plan')}")
    # Notify sales team, log to analytics, etc.

# Subscribe to all events with wildcard
@pp.on_event('*')
async def log_all_events(event: CustomEvent, session: Session):
    print(f"Event: {event.name} | Data: {event.data}")

# Unsubscribe when needed
pp.off_event('clicked_pricing', on_pricing_click)
```

### Sending Events (Backend → Widget)

Send events to specific sessions or broadcast to all:

```python
# Send to a specific session
await pp.emit_event(
    session_id='session-123',
    event_name='show_offer',
    data={'discount': 20, 'code': 'SAVE20'}
)

# Broadcast to all connected sessions
await pp.broadcast_event(
    event_name='announcement',
    data={'message': 'New feature launched!'}
)
```

### Event Structure

```python
from pocketping import CustomEvent

event = CustomEvent(
    name='clicked_pricing',           # Event name
    data={'plan': 'pro', 'page': '/pricing'},  # Optional payload
    timestamp=datetime.utcnow(),      # Auto-set
    session_id='session-123',         # Set by SDK when from widget
)
```

### Use Cases

| Event | Direction | Use Case |
|-------|-----------|----------|
| `clicked_pricing` | Widget → Backend | Alert sales when visitor shows interest |
| `error_occurred` | Widget → Backend | Get notified of frontend errors |
| `cart_abandoned` | Widget → Backend | Trigger follow-up actions |
| `show_offer` | Backend → Widget | Display personalized discount |
| `request_callback` | Backend → Widget | Show callback scheduling modal |
| `announcement` | Backend → Widget | System-wide notification |

### Bridge Integration

Custom events are automatically forwarded to all configured bridges (Telegram, Discord, Slack). Events appear with full context:

```
⚡ Custom Event

📌 Event: clicked_pricing
{
  "plan": "pro",
  "source": "homepage"
}

Session: abc123...
```

### Webhook Forwarding

Forward all events to your own webhook for integrations with Zapier, Make, n8n, or custom backends:

```python
pp = PocketPing(
    # Forward events to your webhook
    webhook_url='https://your-server.com/pocketping-events',
    webhook_secret='your-hmac-secret',  # Optional: adds X-PocketPing-Signature header
    webhook_timeout=5.0,  # Timeout in seconds (default: 5.0)
)
```

**Webhook payload:**
```json
{
  "event": {
    "name": "clicked_pricing",
    "data": { "plan": "pro" },
    "timestamp": "2026-01-21T00:00:00.000Z",
    "sessionId": "sess_abc123"
  },
  "session": {
    "id": "sess_abc123",
    "visitorId": "visitor_xyz",
    "metadata": { "url": "...", "country": "France" }
  },
  "sentAt": "2026-01-21T00:00:00.000Z"
}
```

**Verifying signatures:**
```python
import hmac
import hashlib

def verify_signature(body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return signature == f"sha256={expected}"
```

## License

MIT

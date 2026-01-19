# PocketPing

> Real-time customer chat widget with mobile-first notifications. Get pinged in your pocket.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## The Problem

You're a founder/developer. A user visits your site and needs help. But you're:
- Walking your dog
- In a meeting
- Making coffee

By the time you check, they're gone. Feedback lost. Opportunity missed.

## The Solution

**PocketPing** = Embeddable chat widget + Instant mobile notifications (Telegram, Discord, Slack) + AI fallback

```
User visits your site → Widget appears → You get a Telegram ping → Reply from your phone
                                              ↓
                              (If you don't respond in X min)
                                              ↓
                                    AI takes over, collects info
                                              ↓
                                    You get a summary later
```

## Architecture

PocketPing is **not a monolithic SaaS**. It's a protocol with pluggable components.

### Option 1: Embedded Mode (Simple)

Bridges run inside your backend. Perfect for getting started.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           YOUR SERVER                                   │
│                                                                         │
│  ┌──────────┐       ┌────────────────────────────────────────────────┐ │
│  │          │       │              YOUR BACKEND                       │ │
│  │  Widget  │ HTTP  │  ┌─────────┐  ┌─────────┐  ┌─────────┐        │ │
│  │   (JS)   │◄─────►│  │Telegram │  │ Discord │  │  Slack  │   AI   │ │
│  │          │  WS   │  │ Bridge  │  │ Bridge  │  │ Bridge  │        │ │
│  └──────────┘       │  └────┬────┘  └────┬────┘  └────┬────┘        │ │
│                     │       │            │            │              │ │
│                     └───────┼────────────┼────────────┼──────────────┘ │
│                             │            │            │                │
└─────────────────────────────┼────────────┼────────────┼────────────────┘
                              ▼            ▼            ▼
                         Telegram      Discord       Slack
                          (Topics)     (Threads)    (Threads)
```

**Pros:** Simple setup, single deployment, cross-bridge sync included
**Cons:** Bridges share resources with backend, redeploy = restart bridges

### Option 2: Bridge Server Mode (Production)

Bridges run in a separate server. Recommended for production & teams.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                                                                                │
│  ┌──────────┐       ┌──────────────┐              ┌──────────────────────────┐│
│  │          │       │              │   HTTP/SSE   │      BRIDGE SERVER       ││
│  │  Widget  │ HTTP  │ YOUR BACKEND │◄────────────►│         (Bun)            ││
│  │   (JS)   │◄─────►│ (any stack)  │              │                          ││
│  │          │  WS   │              │              │  ┌────────┐ ┌────────┐   ││
│  └──────────┘       │   + AI       │              │  │Telegram│ │Discord │   ││
│                     │              │              │  │        │ │        │   ││
│                     └──────────────┘              │  └───┬────┘ └───┬────┘   ││
│                                                   │      │          │        ││
│                                                   │  ┌───┴──────────┴────┐   ││
│                                                   │  │       Slack       │   ││
│                                                   │  └─────────┬─────────┘   ││
│                                                   └────────────┼─────────────┘│
│                                                                │              │
└────────────────────────────────────────────────────────────────┼──────────────┘
                              ▲                 ▲                 ▼
                              │                 │            All Bridges
                         Telegram           Discord

      Cross-bridge sync: Reply on Telegram → Discord & Slack see it too!
```

**Pros:**
- Deploy bridges without touching your backend
- Scale bridges independently
- Cross-bridge sync built-in
- Single Docker container for all bridges
- Works with ANY backend (Python, Node, Go, PHP...)

**Cons:** Extra service to deploy

### Which Mode Should I Use?

| Situation | Recommended Mode |
|-----------|------------------|
| Just getting started | Embedded |
| Solo founder | Embedded |
| Team with multiple operators | Bridge Server |
| Production deployment | Bridge Server |
| Multiple backends/microservices | Bridge Server |

## Quick Start

### 1. Add the Widget (30 seconds)

```html
<script src="https://unpkg.com/@pocketping/widget"></script>
<script>
  PocketPing.init({
    endpoint: 'https://yoursite.com/pocketping',
    theme: 'auto'
  });
</script>
```

### 2. Choose Your Setup

#### Option A: Embedded Mode (Python/FastAPI)

```python
from fastapi import FastAPI
from pocketping import PocketPing
from pocketping.fastapi import create_router, lifespan_handler
from pocketping.bridges.telegram import TelegramBridge
from pocketping.ai import OpenAIProvider

pp = PocketPing(
    welcome_message="Hi! How can we help?",
    ai_provider=OpenAIProvider(api_key="sk-..."),
    ai_takeover_delay=300,  # AI takes over after 5 min
    bridges=[
        # Forum Topics mode: each conversation = 1 topic
        TelegramBridge(
            bot_token="...",
            forum_chat_id="-100123456789",  # Supergroup with Topics enabled
        ),
    ],
)

app = FastAPI(lifespan=lifespan_handler(pp))
app.include_router(create_router(pp), prefix="/pocketping")
```

#### Option B: Bridge Server Mode

**Step 1:** Start the Bridge Server
```bash
cd bridge-server
cp .env.example .env
# Edit .env with your Telegram/Discord/Slack tokens
bun install && bun run start
```

**Step 2:** Connect your backend
```python
# In your .env
BRIDGE_SERVER_URL=http://localhost:3001

# Your backend just handles chat logic, bridges are external
pp = PocketPing(
    welcome_message="Hi! How can we help?",
    ai_provider=OpenAIProvider(api_key="sk-..."),
    # No bridges here - they're in the Bridge Server!
)
```

### 3. Setup Telegram (2 minutes)

**For Forum Topics mode (recommended for teams):**
1. Create a bot with [@BotFather](https://t.me/botfather)
2. Create a Group → Convert to Supergroup → Enable Topics
3. Add bot as admin with "Manage Topics" permission
4. Get chat ID (forward a message to [@userinfobot](https://t.me/userinfobot))

Each conversation gets its own topic - no message mixing!

## Features

### Smart Presence Detection

```
Visitor sends message
        ↓
    Timer starts (default: 5 min)
        ↓
┌───────────────────────────────────────┐
│  Operator responds?                   │
│  ├─ YES → Timer resets, AI inactive   │
│  └─ NO  → AI takes over automatically │
│           ↓                           │
│  Operator can jump in anytime         │
│  → AI becomes inactive for session    │
└───────────────────────────────────────┘
```

### Cross-Bridge Sync

When you have multiple operators on different platforms:

```
Alice replies on Telegram
        ↓
Bob sees Alice's reply on Discord
Carol sees it on Slack
        ↓
Everyone stays in sync!
```

### Thread/Topic Support

Each conversation is isolated:

| Platform | Feature | Benefit |
|----------|---------|---------|
| Telegram | Forum Topics | 1 topic per conversation |
| Discord | Threads | 1 thread per conversation |
| Slack | Threads | Native thread support |

No more message mixing between different visitors!

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [@pocketping/widget](./packages/widget) | Embeddable chat widget | ✅ Ready |
| [pocketping](./packages/sdk-python) | Python SDK (FastAPI) | ✅ Ready |
| [bridge-server](./bridge-server) | Standalone Bridge Server (Bun) | ✅ Ready |

## Protocol Specification

Your backend implements 5 simple endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/connect` | Initialize a chat session |
| `POST` | `/message` | Send a message |
| `GET` | `/messages` | Fetch message history |
| `POST` | `/typing` | Send typing indicator |
| `WS` | `/stream` | Real-time events (optional) |

See [protocol/spec.yaml](./protocol/spec.yaml) for the full OpenAPI specification.

## Examples

- [Python + FastAPI](https://github.com/abonur/pocketping-test-fastapi)

## Roadmap

- [x] Protocol specification
- [x] Python SDK (FastAPI)
- [x] Telegram bridge (Forum Topics)
- [x] Discord bridge (Threads)
- [x] Slack bridge (Threads)
- [x] AI fallback (OpenAI, Gemini, Claude)
- [x] Smart presence detection
- [x] Bridge Server (standalone Bun server)
- [x] Cross-bridge sync
- [ ] Node.js SDK
- [ ] Analytics dashboard
- [ ] Hosted version (optional SaaS)

## Philosophy

1. **Protocol over Platform** - Use any backend, any database
2. **Mobile-First** - Founders are on the go
3. **AI as Backup** - Humans first, AI catches what falls through
4. **Open Source** - Self-host everything, no vendor lock-in

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT - Use it however you want.

---

Built with ❤️ for indie hackers, founders, and developers who care about their users.

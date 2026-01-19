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

## Architecture: Protocol-First

PocketPing is **not a monolithic SaaS**. It's a protocol with pluggable components.

```
┌─────────────────────────────────────────────────────────────────┐
│                     POCKETPING PROTOCOL                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐         ┌──────────────┐         ┌─────────────┐ │
│  │  Widget  │ ←─────→ │ YOUR BACKEND │ ←─────→ │   Bridges   │ │
│  │   (JS)   │  HTTP/  │  (any stack) │         │ (optional)  │ │
│  └──────────┘   WS    └──────────────┘         └─────────────┘ │
│                              │                        │        │
│                              │                 ┌──────┴──────┐ │
│                        Implements              │  │  │  │    │ │
│                       5 endpoints              TG DC SK LLM  │ │
│                                                              │ │
└──────────────────────────────────────────────────────────────┘
```

### Two Bridge Modes

**Option 1: Embedded** - Bridges run in your backend process
```
Your Backend (Python/Node/Go)
     └── Telegram, Discord, Slack bridges
```

**Option 2: Bridge Server** - Bridges run in a separate server (recommended for production)
```
Your Backend ←──HTTP/SSE──→ Bridge Server (Bun) ←→ Telegram, Discord, Slack
```

The Bridge Server ([`bridge-server/`](./bridge-server)) is a standalone Bun server that handles all notification bridges. Benefits:
- Bridges don't crash your backend
- Deploy bridges independently
- Cross-bridge sync built-in (reply on Telegram, see it on Discord)
- Single Docker container for all bridges

### Use Any Backend

Your backend just needs to implement 5 simple endpoints. We provide SDKs to make it even easier:

| Your Stack | Integration |
|------------|-------------|
| Node.js | `npm install @pocketping/sdk` |
| Python | `pip install pocketping` |
| Go | `go get github.com/pocketping/sdk-go` |
| PHP | `composer require pocketping/sdk` |
| Any | Implement the [Protocol Spec](./protocol/spec.yaml) |

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

### 2. Implement the Backend (5 minutes with SDK)

**Node.js Example:**
```javascript
import { PocketPing } from '@pocketping/sdk';
import express from 'express';

const app = express();
const pp = new PocketPing({
  storage: 'memory', // or 'redis', 'postgres', custom adapter
  bridges: {
    telegram: { botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID }
  },
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    fallbackAfter: 300 // seconds before AI takes over
  }
});

app.use('/pocketping', pp.middleware());
app.listen(3000);
```

**Python/FastAPI Example:**
```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from pocketping import PocketPing
from pocketping.fastapi import create_router, lifespan_handler
from pocketping.bridges.telegram import TelegramBridge
from pocketping.ai import OpenAIProvider

pp = PocketPing(
    welcome_message="Hi! How can we help?",
    ai_provider=OpenAIProvider(api_key="sk-..."),
    ai_takeover_delay=300,  # AI takes over after 5 min of no response
    bridges=[
        TelegramBridge(bot_token="...", chat_ids="..."),
    ],
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with lifespan_handler(pp):
        yield

app = FastAPI(lifespan=lifespan)
app.include_router(create_router(pp), prefix="/pocketping")
```

### 3. Connect Your Telegram (2 minutes)

1. Create a bot with [@BotFather](https://t.me/botfather)
2. Get your chat ID
3. Add credentials to your config
4. Done! You'll receive pings when users connect

## Protocol Specification

See [protocol/spec.yaml](./protocol/spec.yaml) for the full OpenAPI specification.

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/connect` | Initialize a chat session |
| `POST` | `/message` | Send a message |
| `GET` | `/messages` | Fetch message history |
| `POST` | `/typing` | Send typing indicator |
| `WS` | `/stream` | Real-time events (optional) |

### Message Format

```typescript
interface Message {
  id: string;
  sessionId: string;
  content: string;
  sender: 'visitor' | 'operator' | 'ai';
  timestamp: string; // ISO 8601
  metadata?: Record<string, any>;
}
```

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [@pocketping/widget](./packages/widget) | Embeddable chat widget | ✅ Ready |
| [@pocketping/sdk](./packages/sdk-node) | Node.js SDK | ✅ Ready |
| [pocketping](./packages/sdk-python) | Python SDK (FastAPI) | ✅ Ready |
| [bridge-server](./bridge-server) | Standalone Bridge Server (Bun) | ✅ Ready |
| [@pocketping/bridge-telegram](./bridges/telegram) | Telegram notifications | ✅ Ready |
| [@pocketping/bridge-discord](./bridges/discord) | Discord notifications | ✅ Ready |
| [@pocketping/bridge-slack](./bridges/slack) | Slack notifications | ✅ Ready |

## Examples

- [Node.js + Express](./examples/node-express)
- [Python + FastAPI](https://github.com/abonur/pocketping-test-fastapi) (separate repo)

## Roadmap

- [x] Protocol specification
- [x] Widget v1
- [x] Node.js SDK
- [x] Python SDK (FastAPI)
- [x] Telegram bridge (with Forum Topics support)
- [x] Discord bridge (with Threads support)
- [x] Slack bridge (with Threads support)
- [x] AI fallback (OpenAI, Gemini, Claude)
- [x] Smart presence detection (auto AI takeover after configurable delay)
- [x] Bridge Server (standalone Bun server for all bridges)
- [x] Cross-bridge sync (reply on one bridge, see it on all others)
- [ ] Analytics dashboard
- [ ] Hosted version (optional SaaS)

## Smart Presence Detection

The AI fallback system is intelligent:

```
Visitor sends message
        ↓
    Timer starts
        ↓
┌───────────────────────────────────────┐
│  Operator responds?                   │
│  ├─ YES → Timer resets, AI inactive   │
│  └─ NO  → After X seconds...          │
│           ↓                           │
│       AI takes over                   │
│           ↓                           │
│  Operator can still reply anytime     │
│  → AI becomes inactive for session    │
└───────────────────────────────────────┘
```

Configure with `ai_takeover_delay` (default: 300 seconds = 5 minutes).

## Admin Dashboard

For building an admin interface, see [docs/ADMIN.md](./docs/ADMIN.md).

Options:
1. **Use bridges** (Telegram/Discord/Slack) - zero UI work needed
2. **Add admin routes** to your existing backend
3. **Build a separate dashboard** (React/Vue/etc.)

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

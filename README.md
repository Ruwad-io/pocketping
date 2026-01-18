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
│                              │                 │  │  │  │    │ │
│                              │                 TG DC SK LLM  │ │
│                              │                               │ │
│                        Implements                            │ │
│                       5 endpoints                            │ │
│                                                              │ │
└──────────────────────────────────────────────────────────────┘
```

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

**Python Example:**
```python
from flask import Flask
from pocketping import PocketPing

app = Flask(__name__)
pp = PocketPing(
    storage='memory',
    telegram_token='...',
    telegram_chat_id='...'
)

app.register_blueprint(pp.blueprint, url_prefix='/pocketping')
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
| [@pocketping/widget](./packages/widget) | Embeddable chat widget | 🚧 WIP |
| [@pocketping/sdk](./packages/sdk-node) | Node.js SDK | 🚧 WIP |
| [pocketping](./packages/sdk-python) | Python SDK | 🚧 WIP |
| [telegram-bridge](./bridges/telegram) | Telegram notification bridge | 🚧 WIP |
| [discord-bridge](./bridges/discord) | Discord notification bridge | 📋 Planned |

## Examples

- [Node.js + Express](./examples/node-express)
- [Python + Flask](./examples/python-flask)
- [Go + Fiber](./examples/go-fiber)

## Roadmap

- [x] Protocol specification
- [ ] Widget v1
- [ ] Node.js SDK
- [ ] Python SDK
- [ ] Telegram bridge
- [ ] Discord bridge
- [ ] AI fallback (OpenAI, Gemini, Claude)
- [ ] Presence detection (operator online/offline)
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

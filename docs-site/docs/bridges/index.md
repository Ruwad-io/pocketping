---
sidebar_position: 1
title: Bridges Overview
description: Connect PocketPing to your favorite messaging platforms
---

# Bridges

Bridges connect your website chat to messaging platforms where you already work.

```mermaid
flowchart LR
    subgraph website["Your Website"]
        widget["Chat Widget"]
    end

    subgraph bridge["Bridge Server"]
        router["Message Router"]
    end

    subgraph platforms["Platforms"]
        tg["Telegram"]
        dc["Discord"]
        sl["Slack"]
    end

    widget <--> router
    router <--> tg
    router <--> dc
    router <--> sl
```

## How Bridges Work

1. **Visitor sends message** → Widget forwards to bridge server
2. **Bridge creates thread** → New topic (Telegram), thread (Discord/Slack)
3. **You reply** → Message appears in widget instantly
4. **Visitor sees response** → Real-time via WebSocket

## Available Bridges

| Platform | Thread Type | Best For |
|----------|-------------|----------|
| [**Telegram**](./telegram) | Forum Topics | Mobile-first teams, personal use |
| [**Discord**](./discord) | Channel Threads | Gaming, communities, dev teams |
| [**Slack**](./slack) | Channel Threads | Enterprise, business teams |

## Features Comparison

| Feature | Telegram | Discord | Slack |
|---------|----------|---------|-------|
| Mobile app | Excellent | Good | Good |
| Notifications | Instant | Good | Good |
| Thread organization | Topics | Threads | Threads |
| Free tier | Unlimited | Unlimited | Limited history |
| Bot commands | `/info`, `/close`, `/ai` | Same | Same |
| Rich messages | ✅ | ✅ | ✅ |
| File sharing | ✅ | ✅ | ✅ |

## Multi-Bridge Setup

You can connect multiple bridges simultaneously. Messages sync across all platforms.

```mermaid
sequenceDiagram
    participant V as Visitor
    participant T as Telegram
    participant D as Discord

    V->>T: "Hello!"
    V->>D: "Hello!" (synced)
    T->>V: "Hi there!"
    D-->>D: (message synced)
```

### Configuration

```bash title=".env"
# Connect both Telegram and Discord
TELEGRAM_BOT_TOKEN=your_telegram_token
TELEGRAM_FORUM_CHAT_ID=-1001234567890

DISCORD_BOT_TOKEN=your_discord_token
DISCORD_CHANNEL_ID=1234567890123456789
```

## Choosing a Bridge

| If you... | Use |
|-----------|-----|
| Want the simplest setup | **Telegram** |
| Already use Discord for your community | **Discord** |
| Work in a business environment | **Slack** |
| Need mobile notifications | **Telegram** (best mobile app) |
| Want unlimited free history | **Telegram** or **Discord** |

## Self-Hosted vs SaaS

### SaaS (app.pocketping.io)
- Configure bridges in dashboard
- No server management
- Automatic updates

### Self-Hosted
- Full control over data
- Configure via environment variables
- Deploy with Docker

See [Self-Hosting Guide](/self-hosting) for deployment instructions.

## SDK Built-in Bridges vs Bridge Server

There are two ways to connect to messaging platforms:

### Option 1: SDK Built-in Bridges (Recommended for most users)

All SDKs include built-in bridges with automatic validation and helpful setup guides:

```javascript
// Node.js example
import { PocketPing, TelegramBridge, DiscordBridge } from '@pocketping/sdk-node';

const pp = new PocketPing();

pp.addBridge(new TelegramBridge({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
}));

pp.addBridge(DiscordBridge.bot(
  process.env.DISCORD_BOT_TOKEN,
  process.env.DISCORD_CHANNEL_ID
));
```

**Pros:**
- Simpler setup - no additional server
- Automatic validation with helpful setup guides
- All SDKs support it (Node.js, Python, Go, PHP, Ruby)

**Cons:**
- Discord receiving requires Gateway (WebSocket) - only works on long-running servers

### Option 2: Bridge Server

Deploy a separate bridge server for advanced use cases:

**When to use:**
- Discord bidirectional (receive operator messages) with serverless backends
- Need dedicated infrastructure for message routing
- Want to separate concerns (backend vs messaging)

See [Docker Deployment](./docker) for bridge server setup.

## Next Steps

- [Telegram Setup](./telegram) - Most popular, easiest setup
- [Discord Setup](./discord) - Great for dev teams
- [Slack Setup](./slack) - Enterprise-ready
- [Docker Deployment](./docker) - Self-host the bridge server

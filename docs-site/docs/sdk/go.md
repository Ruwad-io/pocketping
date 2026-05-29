---
sidebar_position: 4
title: Go SDK
description: Backend integration with the PocketPing Go SDK
---

# Go SDK

Integrate PocketPing into your Go backend.

## Installation

```bash
go get github.com/Ruwad-io/pocketping/sdk-go
```

## Quick Start

### net/http

```go
package main

import (
    "net/http"
    pocketping "github.com/Ruwad-io/pocketping/sdk-go"
)

func main() {
    pp := pocketping.New(pocketping.Config{
        WelcomeMessage: "Hi! How can we help?",
    })

    http.Handle("/pocketping/", pp.Handler("/pocketping"))
    http.ListenAndServe(":3000", nil)
}
```

### Gin

```go
package main

import (
    "github.com/gin-gonic/gin"
    pocketping "github.com/Ruwad-io/pocketping/sdk-go"
)

func main() {
    r := gin.Default()
    pp := pocketping.New(pocketping.Config{
        WelcomeMessage: "Hi! How can we help?",
    })

    r.Any("/pocketping/*path", gin.WrapH(pp.Handler("/pocketping")))
    r.Run(":3000")
}
```

### Echo

```go
package main

import (
    "github.com/labstack/echo/v4"
    pocketping "github.com/Ruwad-io/pocketping/sdk-go"
)

func main() {
    e := echo.New()
    pp := pocketping.New(pocketping.Config{
        WelcomeMessage: "Hi! How can we help?",
    })

    e.Any("/pocketping/*", echo.WrapHandler(pp.Handler("/pocketping")))
    e.Start(":3000")
}
```

## Built-in Bridges

The SDK includes built-in bridges for Telegram, Discord, and Slack with automatic validation and helpful setup guides.

```go
package main

import (
    "log"
    "os"
    pocketping "github.com/Ruwad-io/pocketping/sdk-go"
)

func main() {
    pp := pocketping.New(pocketping.Config{})

    // Add Telegram bridge
    telegram, err := pocketping.NewTelegramBridge(
        os.Getenv("TELEGRAM_BOT_TOKEN"),
        os.Getenv("TELEGRAM_CHAT_ID"),
    )
    if err != nil {
        // Helpful error with setup guide is printed automatically
        log.Fatal(err)
    }
    pp.AddBridge(telegram)

    // Add Discord bridge (bot mode)
    discord, err := pocketping.NewDiscordBotBridge(
        os.Getenv("DISCORD_BOT_TOKEN"),
        os.Getenv("DISCORD_CHANNEL_ID"),
    )
    if err != nil {
        log.Fatal(err)
    }
    pp.AddBridge(discord)

    // Add Slack bridge (bot mode)
    slack, err := pocketping.NewSlackBotBridge(
        os.Getenv("SLACK_BOT_TOKEN"),
        os.Getenv("SLACK_CHANNEL_ID"),
    )
    if err != nil {
        log.Fatal(err)
    }
    pp.AddBridge(slack)
}
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
| Telegram | Bot | `NewTelegramBridge()` | Send, edit, delete |
| Discord | Webhook | `NewDiscordWebhookBridge()` | Send only |
| Discord | Bot | `NewDiscordBotBridge()` | Send, edit, delete |
| Slack | Webhook | `NewSlackWebhookBridge()` | Send only |
| Slack | Bot | `NewSlackBotBridge()` | Send, edit, delete |

:::tip Bot vs Webhook
Use **Bot mode** for full bidirectional communication. Webhooks are simpler but only support sending messages.
:::

:::warning Discord Bot requires long-running server
**Discord bot mode** uses the Discord Gateway (WebSocket) to receive operator replies. This only works on **long-running servers**.

**Does NOT work with:**
- AWS Lambda
- Google Cloud Functions
- Azure Functions
- Any serverless environment

**For serverless + Discord bidirectional:** Use the [Bridge Server](/bridges/docker) instead, or use `NewDiscordWebhookBridge()` (send-only).
:::

:::info Telegram & Slack work with serverless
**Telegram** and **Slack** use HTTP webhooks (not WebSocket), so they work fully with serverless environments like Lambda, Cloud Functions, etc.
:::

---

## Configuration

```go
pp := pocketping.New(pocketping.Config{
    // Welcome message for new visitors
    WelcomeMessage: "Hi! How can we help?",

    // Built-in bridges (or add later with pp.AddBridge(...))
    Bridges: []pocketping.Bridge{},

    // Event handlers
    OnSessionStart: func(s *pocketping.Session) {
        log.Printf("New session: %s", s.ID)
    },
    OnMessage: func(s *pocketping.Session, m *pocketping.Message) {
        log.Printf("Message: %s", m.Content)
    },
    OnEvent: func(s *pocketping.Session, e *pocketping.Event) {
        log.Printf("Event: %s", e.Name)
    },

    // Custom storage (optional)
    Storage: &PostgresStorage{},
})
```

## API

### Sessions

```go
// Get a specific session
session, err := pp.GetSession(ctx, "sess_xxx")

// Get session messages
messages, err := pp.GetMessages(ctx, "sess_xxx")
```

:::note Sessions live in your storage
The SDK does not keep an in-memory list of "all sessions". To enumerate
conversations, query your `Storage` implementation directly, or track sessions
in the `OnSessionStart` handler.
:::

### Messages

```go
// Send an operator reply to a session
err := pp.SendOperatorMessage(ctx, "sess_xxx", "Hello from the server!")
```

### Custom Events

```go
// Receive events from widget
pp := pocketping.New(pocketping.Config{
    OnEvent: func(s *pocketping.Session, e *pocketping.Event) {
        if e.Name == "clicked_pricing" {
            // Track analytics, trigger automation, etc.
        }
    },
})

// Send events to widget
err := pp.EmitEvent(ctx, "sess_xxx", "show_offer", map[string]any{
    "discount": 20,
    "code":     "SAVE20",
})
```

## Custom Storage

Implement the `Storage` interface for persistence:

```go
type Storage interface {
    CreateSession(ctx context.Context, session *Session) error
    GetSession(ctx context.Context, id string) (*Session, error)
    SaveMessage(ctx context.Context, sessionID string, msg *Message) error
    GetMessages(ctx context.Context, sessionID string) ([]*Message, error)
}

type PostgresStorage struct {
    db *sql.DB
}

func (s *PostgresStorage) CreateSession(ctx context.Context, session *pocketping.Session) error {
    _, err := s.db.ExecContext(ctx,
        "INSERT INTO sessions (id, visitor_id, created_at) VALUES ($1, $2, $3)",
        session.ID, session.VisitorID, session.CreatedAt)
    return err
}

// Implement other methods...
```

## User-Agent Filtering

Block bots and automated requests from creating chat sessions.

### Quick Setup

```go
pp := pocketping.New(pocketping.Config{
    UaFilter: &pocketping.UaFilterConfig{
        Enabled:        true,
        UseDefaultBots: true, // Block ~50 known bot patterns
    },
})
```

### Configuration Options

```go
pp := pocketping.New(pocketping.Config{
    UaFilter: &pocketping.UaFilterConfig{
        Enabled:        true,
        Mode:           pocketping.UaFilterModeBlocklist, // Blocklist | Allowlist | Both
        UseDefaultBots: true,
        Blocklist: []string{
            "my-custom-scraper",
            "bad-bot",
            `/spam-\d+/`, // Regex pattern
        },
        Allowlist: []string{
            "my-monitoring-bot",
            `/internal-.*/`, // Regex: allow internal tools
        },
        LogBlocked:        true,
        BlockedStatusCode: 403,
        BlockedMessage:    "Forbidden",
    },
})
```

### Manual Filtering

```go
import pocketping "github.com/Ruwad-io/pocketping/sdk-go"

// Quick bot check
if pocketping.IsBot(r.UserAgent()) {
    http.Error(w, `{"error":"Bots not allowed"}`, http.StatusForbidden)
    return
}

// Full filter check
result := pocketping.CheckUAFilter(ctx, r.UserAgent(), &pocketping.UaFilterConfig{
    Enabled:        true,
    UseDefaultBots: true,
}, map[string]interface{}{
    "path": r.URL.Path,
})

if !result.Allowed {
    log.Printf("Blocked: %s, pattern: %s", result.Reason, result.MatchedPattern)
}
```

---

## Next Steps

- [Python SDK](/sdk/python) - Backend integration for Python
- [Node.js SDK](/sdk/nodejs) - Backend integration for Node.js
- [API Reference](/api) - Full REST API documentation

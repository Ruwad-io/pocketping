---
sidebar_position: 4
title: Go SDK
description: Backend integration with the PocketPing Go SDK
---

# Go SDK

Integrate PocketPing into your Go backend.

## Installation

```bash
go get github.com/pocketping/pocketping-go
```

## Quick Start

### net/http

```go
package main

import (
    "net/http"
    pocketping "github.com/pocketping/pocketping-go"
)

func main() {
    pp := pocketping.New(pocketping.Config{
        BridgeURL:      "http://localhost:3001",
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
    pocketping "github.com/pocketping/pocketping-go"
)

func main() {
    r := gin.Default()
    pp := pocketping.New(pocketping.Config{
        BridgeURL: "http://localhost:3001",
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
    pocketping "github.com/pocketping/pocketping-go"
)

func main() {
    e := echo.New()
    pp := pocketping.New(pocketping.Config{
        BridgeURL: "http://localhost:3001",
    })

    e.Any("/pocketping/*", echo.WrapHandler(pp.Handler("/pocketping")))
    e.Start(":3000")
}
```

## Configuration

```go
pp := pocketping.New(pocketping.Config{
    // Bridge server URL
    BridgeURL: "http://localhost:3001",

    // Welcome message for new visitors
    WelcomeMessage: "Hi! How can we help?",

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
// Get all active sessions
sessions, err := pp.GetSessions(ctx)

// Get a specific session
session, err := pp.GetSession(ctx, "sess_xxx")

// Get session messages
messages, err := pp.GetMessages(ctx, "sess_xxx")

// Close a session
err := pp.CloseSession(ctx, "sess_xxx")
```

### Messages

```go
// Send a message to a session
err := pp.SendMessage(ctx, "sess_xxx", pocketping.Message{
    Content: "Hello from the server!",
    Type:    pocketping.MessageTypeOperator,
})
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

## Next Steps

- [Python SDK](/sdk/python) - Backend integration for Python
- [Node.js SDK](/sdk/nodejs) - Backend integration for Node.js
- [API Reference](/api) - Full REST API documentation

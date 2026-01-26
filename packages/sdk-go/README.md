# PocketPing Go SDK

Official Go SDK for PocketPing - the lightweight, privacy-first chat widget for your website.

> **Tip:** Use the CLI for guided bridge setup: `npx @pocketping/cli init`

## Installation

```bash
go get github.com/Ruwad-io/pocketping/sdk-go
```

## Quick Start

```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"

    pocketping "github.com/Ruwad-io/pocketping/sdk-go"
)

func main() {
    // Create PocketPing instance
    pp := pocketping.New(pocketping.Config{
        WelcomeMessage: "Hello! How can I help you today?",
        OnNewSession: func(session *pocketping.Session) {
            log.Printf("New session: %s", session.ID)
        },
        OnMessage: func(msg *pocketping.Message, session *pocketping.Session) {
            log.Printf("Message from %s: %s", msg.Sender, msg.Content)
        },
    })

    // Start PocketPing (initializes bridges)
    ctx := context.Background()
    if err := pp.Start(ctx); err != nil {
        log.Fatal(err)
    }
    defer pp.Stop(ctx)

    // Use with your HTTP server (example with standard library)
    http.HandleFunc("/pocketping/connect", func(w http.ResponseWriter, r *http.Request) {
        // Parse request and call pp.HandleConnect()
    })

    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

## Configuration

```go
pp := pocketping.New(pocketping.Config{
    // Storage adapter (default: MemoryStorage)
    Storage: pocketping.NewMemoryStorage(),

    // Notification bridges
    Bridges: []pocketping.Bridge{myBridge},

    // Welcome message for new visitors
    WelcomeMessage: "Hello! How can I help?",

    // Callbacks
    OnNewSession: func(session *pocketping.Session) {},
    OnMessage:    func(msg *pocketping.Message, session *pocketping.Session) {},
    OnEvent:      func(event pocketping.CustomEvent, session *pocketping.Session) {},
    OnIdentify:   func(session *pocketping.Session) {},

    // Webhook for external integrations (Zapier, Make, n8n)
    WebhookURL:     "https://your-webhook.example.com/events",
    WebhookSecret:  "your-hmac-secret",
    WebhookTimeout: 5 * time.Second,

    // Version management
    MinWidgetVersion:      "0.2.0",
    LatestWidgetVersion:   "0.3.0",
    VersionWarningMessage: "Please update your widget",
    VersionUpgradeURL:     "https://docs.pocketping.io/widget",

    // Auto-tracking elements
    TrackedElements: []pocketping.TrackedElement{
        {Selector: ".pricing-btn", Name: "clicked_pricing"},
    },

    // IP filtering (see IP Filtering section below)
    IpFilter: &pocketping.IpFilterConfig{
        Enabled:   true,
        Mode:      pocketping.IpFilterModeBlocklist,
        Blocklist: []string{"203.0.113.0/24"},
    },
})
```

## IP Filtering

Block or allow specific IP addresses or CIDR ranges:

```go
pp := pocketping.New(pocketping.Config{
    IpFilter: &pocketping.IpFilterConfig{
        Enabled: true,
        Mode:    pocketping.IpFilterModeBlocklist, // Blocklist | Allowlist | Both
        Blocklist: []string{
            "203.0.113.0/24",  // CIDR range
            "198.51.100.50",   // Single IP
        },
        Allowlist: []string{
            "10.0.0.0/8",      // Internal network
        },
        LogBlocked:       true, // Log blocked requests (default: true)
        BlockedStatusCode: 403,
        BlockedMessage:   "Forbidden",
    },
})

// Or with a custom filter function
pp := pocketping.New(pocketping.Config{
    IpFilter: &pocketping.IpFilterConfig{
        Enabled: true,
        Mode:    pocketping.IpFilterModeBlocklist,
        CustomFilter: func(ip string, r *http.Request) *bool {
            // Return &true to allow, &false to block, nil to defer
            if strings.HasPrefix(ip, "192.168.") {
                allow := true
                return &allow // Always allow local
            }
            return nil // Use blocklist/allowlist
        },
    },
})
```

### Modes

| Mode | Behavior |
|------|----------|
| `IpFilterModeBlocklist` | Block IPs in blocklist, allow all others (default) |
| `IpFilterModeAllowlist` | Only allow IPs in allowlist, block all others |
| `IpFilterModeBoth` | Allowlist takes precedence, then blocklist is applied |

### CIDR Support

The SDK uses Go's native `net.ParseCIDR()` for IP range matching:
- Single IP: `192.168.1.1` (treated as `/32`)
- Class C: `192.168.1.0/24` (256 addresses)
- Class B: `172.16.0.0/16` (65,536 addresses)
- Class A: `10.0.0.0/8` (16M addresses)

### Manual IP Check

```go
// Check IP manually
result := pp.CheckIpFilter("192.168.1.50")
// result: IpFilterResult{Allowed: bool, Reason: string, MatchedRule: string}

// Get client IP from request (simple)
clientIP := pocketping.GetClientIP(request, nil)
// Checks: CF-Connecting-IP, X-Forwarded-For, X-Real-IP

// Or with custom config (use custom proxy headers)
clientIP := pocketping.GetClientIP(request, &pocketping.IpFilterConfig{
    ProxyHeaders: []string{"X-Custom-IP"},
})
```

## API Reference

### Session Management

```go
// Handle connection request
response, err := pp.HandleConnect(ctx, pocketping.ConnectRequest{
    VisitorID: "visitor-123",
    SessionID: "optional-existing-session",
    Metadata: &pocketping.SessionMetadata{
        URL:      "https://example.com/page",
        Referrer: "https://google.com",
    },
})

// Get session
session, err := pp.GetSession(ctx, "session-id")
```

### Message Handling

```go
// Handle visitor/operator message
response, err := pp.HandleMessage(ctx, pocketping.SendMessageRequest{
    SessionID: "session-123",
    Content:   "Hello!",
    Sender:    pocketping.SenderVisitor, // or SenderOperator
})

// Send operator message
msg, err := pp.SendOperatorMessage(ctx, sessionID, "How can I help?", "api", "")

// Get messages
response, err := pp.HandleGetMessages(ctx, pocketping.GetMessagesRequest{
    SessionID: "session-123",
    After:     "last-message-id",
    Limit:     50,
})
```

### Read Receipts

```go
response, err := pp.HandleRead(ctx, pocketping.ReadRequest{
    SessionID:  "session-123",
    MessageIDs: []string{"msg-1", "msg-2"},
    Status:     pocketping.MessageStatusRead, // or MessageStatusDelivered
})
```

### User Identity

```go
response, err := pp.HandleIdentify(ctx, pocketping.IdentifyRequest{
    SessionID: "session-123",
    Identity: &pocketping.UserIdentity{
        ID:    "user-456",
        Email: "user@example.com",
        Name:  "John Doe",
        Extra: map[string]interface{}{
            "plan":    "premium",
            "company": "Acme Inc",
        },
    },
})
```

### Custom Events

```go
// Subscribe to events
unsubscribe := pp.OnEvent("clicked_pricing", func(event pocketping.CustomEvent, session *pocketping.Session) {
    log.Printf("User %s clicked pricing: %v", session.VisitorID, event.Data)
})

// Wildcard subscription (all events)
pp.OnEvent("*", func(event pocketping.CustomEvent, session *pocketping.Session) {
    log.Printf("Event: %s", event.Name)
})

// Unsubscribe
unsubscribe()

// Emit event to session
pp.EmitEvent("session-123", "show_offer", map[string]interface{}{
    "discount": 20,
    "code":     "SAVE20",
})

// Broadcast event to all sessions
pp.BroadcastEvent("maintenance_warning", map[string]interface{}{
    "message": "Maintenance in 5 minutes",
})

// Trigger event server-side (runs handlers, bridges, webhooks)
err := pp.TriggerEvent(ctx, "session-123", "purchase_completed", map[string]interface{}{
    "orderId": "order-456",
})
```

### Operator Functions

```go
// Set operator online/offline
pp.SetOperatorOnline(true)

// Check operator status
online := pp.IsOperatorOnline()
```

### WebSocket Management

```go
// Register WebSocket connection
pp.RegisterWebSocket(sessionID, wsConn)

// Unregister WebSocket connection
pp.UnregisterWebSocket(sessionID, wsConn)

// Broadcast to session
pp.BroadcastToSession(sessionID, pocketping.WebSocketEvent{
    Type: "custom_event",
    Data: myData,
})
```

### Version Management

```go
// Check widget version
result := pp.CheckWidgetVersion("0.2.0")
// result.Status: "ok", "outdated", "deprecated", "unsupported"
// result.CanContinue: true/false

// Get version headers for HTTP response
headers := pocketping.GetVersionHeaders(result)

// Send version warning via WebSocket
pp.SendVersionWarning(sessionID, result, "0.2.0")
```

## Storage Adapters

### MemoryStorage (Default)

```go
storage := pocketping.NewMemoryStorage()
```

### Custom Storage

Implement the `Storage` interface:

```go
type Storage interface {
    CreateSession(ctx context.Context, session *Session) error
    GetSession(ctx context.Context, sessionID string) (*Session, error)
    GetSessionByVisitorID(ctx context.Context, visitorID string) (*Session, error)
    UpdateSession(ctx context.Context, session *Session) error
    DeleteSession(ctx context.Context, sessionID string) error

    SaveMessage(ctx context.Context, message *Message) error
    GetMessages(ctx context.Context, sessionID string, after string, limit int) ([]Message, error)
    GetMessage(ctx context.Context, messageID string) (*Message, error)

    CleanupOldSessions(ctx context.Context, olderThan time.Time) (int, error)
}
```

Example Redis implementation:

```go
type RedisStorage struct {
    client *redis.Client
}

func (r *RedisStorage) CreateSession(ctx context.Context, session *pocketping.Session) error {
    data, _ := json.Marshal(session)
    return r.client.Set(ctx, "session:"+session.ID, data, 24*time.Hour).Err()
}

// ... implement other methods
```

## Bridge Integration

Create custom bridges by implementing the `Bridge` interface:

```go
type Bridge interface {
    Name() string
    Init(ctx context.Context, pp *PocketPing) error
    OnNewSession(ctx context.Context, session *Session) error
    OnVisitorMessage(ctx context.Context, message *Message, session *Session) error
    OnOperatorMessage(ctx context.Context, message *Message, session *Session, sourceBridge string, operatorName string) error
    OnTyping(ctx context.Context, sessionID string, isTyping bool) error
    OnMessageRead(ctx context.Context, sessionID string, messageIDs []string, status MessageStatus) error
    OnCustomEvent(ctx context.Context, event CustomEvent, session *Session) error
    OnIdentityUpdate(ctx context.Context, session *Session) error
    Destroy(ctx context.Context) error
}
```

Use `BaseBridge` for convenience:

```go
type SlackBridge struct {
    pocketping.BaseBridge
    webhookURL string
}

func NewSlackBridge(webhookURL string) *SlackBridge {
    return &SlackBridge{
        BaseBridge: pocketping.BaseBridge{BridgeName: "slack"},
        webhookURL: webhookURL,
    }
}

func (s *SlackBridge) OnNewSession(ctx context.Context, session *pocketping.Session) error {
    // Send notification to Slack
    return nil
}

func (s *SlackBridge) OnVisitorMessage(ctx context.Context, message *pocketping.Message, session *pocketping.Session) error {
    // Forward message to Slack
    return nil
}
```

### Reply Behavior

- **Telegram:** native replies when `ReplyTo` is set and Telegram message ID is known.
- **Discord:** native replies via `message_reference` when Discord message ID is known.
- **Slack:** quoted block (left bar) inside the thread.

## HTTP Integration Examples

### Standard Library

```go
func main() {
    pp := pocketping.New(pocketping.Config{})

    http.HandleFunc("/pocketping/connect", func(w http.ResponseWriter, r *http.Request) {
        var req pocketping.ConnectRequest
        json.NewDecoder(r.Body).Decode(&req)

        resp, err := pp.HandleConnect(r.Context(), req)
        if err != nil {
            http.Error(w, err.Error(), 500)
            return
        }

        json.NewEncoder(w).Encode(resp)
    })
}
```

### Gin

```go
func main() {
    pp := pocketping.New(pocketping.Config{})
    r := gin.Default()

    r.POST("/pocketping/connect", func(c *gin.Context) {
        var req pocketping.ConnectRequest
        if err := c.ShouldBindJSON(&req); err != nil {
            c.JSON(400, gin.H{"error": err.Error()})
            return
        }

        resp, err := pp.HandleConnect(c.Request.Context(), req)
        if err != nil {
            c.JSON(500, gin.H{"error": err.Error()})
            return
        }

        c.JSON(200, resp)
    })
}
```

### Echo

```go
func main() {
    pp := pocketping.New(pocketping.Config{})
    e := echo.New()

    e.POST("/pocketping/connect", func(c echo.Context) error {
        var req pocketping.ConnectRequest
        if err := c.Bind(&req); err != nil {
            return err
        }

        resp, err := pp.HandleConnect(c.Request().Context(), req)
        if err != nil {
            return err
        }

        return c.JSON(200, resp)
    })
}
```

## Testing

```bash
go test ./...
```

Run with verbose output:

```bash
go test -v ./...
```

## Version Compatibility

| SDK Version | Min Go Version | Widget Version |
|-------------|----------------|----------------|
| 0.1.x       | 1.21+          | 0.2.0+         |

## License

MIT License - see LICENSE file for details.

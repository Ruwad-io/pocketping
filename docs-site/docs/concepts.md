---
sidebar_position: 3
title: Core Concepts
description: Understand the architecture and key concepts behind PocketPing
---

# Core Concepts

This page explains how PocketPing works under the hood. Understanding these concepts will help you get the most out of the platform.

---

## Architecture Overview

PocketPing has a modular architecture with three main components:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              YOUR WEBSITE                                    │
│                                                                             │
│   ┌─────────────────┐                                                       │
│   │  Widget (~14KB) │ ◄──── Embedded in your pages                         │
│   │   - Chat UI     │                                                       │
│   │   - Events      │                                                       │
│   └────────┬────────┘                                                       │
└────────────┼────────────────────────────────────────────────────────────────┘
             │
             │ WebSocket
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BRIDGE SERVER                                     │
│                                                                             │
│   - Routes messages between widget and platforms                            │
│   - Manages sessions and message history                                    │
│   - Handles custom events                                                   │
│   - AI fallback (optional)                                                  │
│                                                                             │
└────────────┬─────────────────────┬─────────────────────┬────────────────────┘
             │                     │                     │
             ▼                     ▼                     ▼
      ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
      │   Telegram   │     │   Discord    │     │    Slack     │
      │   Bridge     │     │   Bridge     │     │   Bridge     │
      └──────────────┘     └──────────────┘     └──────────────┘
             │                     │                     │
             ▼                     ▼                     ▼
      ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
      │  Your Phone  │     │ Your Server  │     │ Your Team    │
      │  (Topics)    │     │ (Threads)    │     │ (Channels)   │
      └──────────────┘     └──────────────┘     └──────────────┘
```

### Component Details

| Component | Size | Role | You Need To... |
|-----------|------|------|----------------|
| **Widget** | ~14KB | Chat UI + event handling | Add 2 lines of code |
| **Bridge Server** | - | Message routing + storage | Use SaaS or self-host |
| **Bridges** | - | Platform integrations | Configure credentials |
| **Backend SDK** | Optional | Custom logic + webhooks | `npm install` / `pip install` |

---

## Sessions

A **session** represents a conversation between a visitor and your team.

### Session Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                        SESSION LIFECYCLE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. CREATED                    2. ACTIVE                        │
│  ┌─────────────────────┐      ┌─────────────────────┐          │
│  │ Visitor opens chat  │ ───► │ Messages exchanged  │          │
│  │ New topic/thread    │      │ Events triggered    │          │
│  └─────────────────────┘      └──────────┬──────────┘          │
│                                          │                      │
│                                          ▼                      │
│                               3. CLOSED (optional)              │
│                               ┌─────────────────────┐          │
│                               │ Marked resolved     │          │
│                               │ Thread archived     │          │
│                               └─────────────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Session Properties

Sessions persist across page refreshes using a browser fingerprint:

```typescript
// Session object structure
{
  id: "sess_abc123",           // Unique session ID
  visitorId: "vis_xyz789",     // Browser fingerprint
  projectId: "proj_def456",    // Your project
  messages: [...],             // Conversation history
  metadata: {
    url: "https://yoursite.com/pricing",
    country: "France",
    browser: "Chrome",
    device: "desktop"
  },
  status: "active",            // "active" | "closed"
  createdAt: "2024-01-15T10:30:00Z",
  lastActivity: "2024-01-15T10:35:00Z"
}
```

### Same Visitor, Same Session

```
┌─────────────────────────────────────────────────────────────────┐
│                         SAME VISITOR                             │
│                                                                 │
│   Day 1: Opens chat           Day 2: Returns                    │
│   ┌─────────────────┐        ┌─────────────────┐               │
│   │ "Hi, I need     │        │ Session restored │               │
│   │  help with..."  │        │ ► Previous msgs  │               │
│   └────────┬────────┘        │ ► Same thread    │               │
│            │                 └────────┬────────┘               │
│            │                          │                         │
│            └─────────┬────────────────┘                         │
│                      ▼                                          │
│            Same Telegram/Discord thread                         │
│            (Continuous conversation)                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Bridges

Bridges connect PocketPing to messaging platforms. They handle bidirectional sync.

### Supported Bridges

| Platform | Thread Type | Best For |
|----------|-------------|----------|
| **Telegram** | Topics in supergroup | Mobile-first, personal |
| **Discord** | Threads in channel | Team support, gaming |
| **Slack** | Threads in channel | Enterprise, team collaboration |

### How Bridges Work

```
┌─────────────────────────────────────────────────────────────────┐
│                      BRIDGE ARCHITECTURE                         │
│                                                                 │
│   Bridge Server                       Your Telegram Group       │
│   ┌──────────────┐                   ┌──────────────────────┐  │
│   │              │    WebSocket      │  📁 General          │  │
│   │  Sessions    │ ◄────────────────►│  📁 John (visitor 1) │  │
│   │  Messages    │    Bidirectional  │  📁 Sarah (visitor 2)│  │
│   │  Events      │                   │  📁 Mike (visitor 3) │  │
│   │              │                   └──────────────────────┘  │
│   └──────────────┘                                              │
│                                                                 │
│   Each visitor = 1 topic/thread                                │
│   All messages sync in real-time                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Multi-Bridge Sync

You can connect multiple bridges simultaneously. Messages sync across all platforms:

```
                      ┌──────────────────────┐
                      │    Bridge Server     │
                      └──────────┬───────────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           │                     │                     │
           ▼                     ▼                     ▼
    ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
    │  Telegram   │      │   Discord   │      │    Slack    │
    │             │      │             │      │             │
    │ You reply   │      │ Teammate    │      │ Manager     │
    │ here...     │      │ sees it     │      │ sees it     │
    │             │      │ here too    │      │ here too    │
    └─────────────┘      └─────────────┘      └─────────────┘

    Reply from ANY platform → Delivered to visitor instantly
```

:::tip Team Flexibility
Your team can use their preferred platform. Mobile users might prefer Telegram, while office-based team members use Slack.
:::

---

## Message Flow

Here's exactly what happens when a message is sent:

### Visitor → You

```
1. Visitor types message in widget
         │
         ▼
2. Widget sends via WebSocket
         │
         ▼
3. Bridge Server receives & stores
         │
         ▼
4. Server broadcasts to all bridges
         │
         ├──────────────┬──────────────┐
         ▼              ▼              ▼
5. Telegram        Discord        Slack
   creates/updates creates/updates creates/updates
   topic           thread         thread
         │              │              │
         ▼              ▼              ▼
6. You see the message on all your platforms
```

### You → Visitor

```
1. You reply in Telegram/Discord/Slack
         │
         ▼
2. Bridge picks up the message
         │
         ▼
3. Sends to Bridge Server
         │
         ▼
4. Server broadcasts to:
         │
         ├──► Widget (visitor sees it instantly)
         │
         └──► Other bridges (team sees it on all platforms)
```

---

## Custom Events

Beyond chat messages, you can send **custom events** between the widget and your backend.

### Event Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      CUSTOM EVENTS                               │
│                                                                 │
│   Widget                    Backend                    Bridges  │
│   ┌───────┐                 ┌───────┐                 ┌───────┐│
│   │       │  trigger()      │       │  notification   │       ││
│   │ ─────────────────────► │       │ ─────────────► │       ││
│   │       │                 │       │                 │       ││
│   │       │  onEvent()      │       │  emitEvent()    │       ││
│   │ ◄───────────────────── │       │                 │       ││
│   │       │                 │       │                 │       ││
│   └───────┘                 └───────┘                 └───────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Use Cases

| Event | Direction | Example |
|-------|-----------|---------|
| `clicked_pricing` | Widget → Backend | Track when visitors view pricing |
| `form_submitted` | Widget → Backend | Log form submissions |
| `show_discount` | Backend → Widget | Display personalized offer |
| `highlight_feature` | Backend → Widget | Guide visitor to a feature |

### Example: Pricing Tracker

**Widget (frontend):**
```javascript
// When visitor clicks pricing
PocketPing.trigger('clicked_pricing', {
  plan: 'pro',
  source: 'homepage'
});
```

**Backend (Node.js):**
```javascript
const pp = new PocketPing({
  onEvent: (event, session) => {
    if (event.name === 'clicked_pricing') {
      // Log to analytics
      analytics.track('pricing_view', event.data);

      // Notify team
      console.log(`${session.metadata.country} visitor interested in ${event.data.plan}`);
    }
  }
});
```

---

## Projects

A **project** represents one website or application in PocketPing.

### Project Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                          PROJECT                                 │
│                                                                 │
│   Name: "My SaaS App"                                           │
│   ID: proj_def456                                               │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ Keys                                                     │   │
│   ├─────────────────────────────────────────────────────────┤   │
│   │ Public:  pk_live_xxxxxxxxx  (used in widget)            │   │
│   │ Secret:  sk_live_xxxxxxxxx  (used in backend SDK)       │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ Widget Settings                                          │   │
│   ├─────────────────────────────────────────────────────────┤   │
│   │ Primary Color:   #6366f1                                 │   │
│   │ Operator Name:   Sarah from Support                      │   │
│   │ Welcome Message: Hi! How can I help?                     │   │
│   │ Position:        bottom-right                            │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ Connected Bridges                                        │   │
│   ├─────────────────────────────────────────────────────────┤   │
│   │ ✓ Telegram  @mysaas_support_bot  →  -1001234567890      │   │
│   │ ✓ Discord   MySaaS Support Bot   →  #support-chat       │   │
│   │ ○ Slack     (not configured)                             │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Multiple Projects

You can have multiple projects for different sites or environments:

```
Your Account
├── Production (proj_abc123)
│   ├── Widget on yoursite.com
│   └── Bridges → Production Telegram group
│
├── Staging (proj_def456)
│   ├── Widget on staging.yoursite.com
│   └── Bridges → Test Telegram group
│
└── Another Site (proj_ghi789)
    ├── Widget on otherbrand.com
    └── Bridges → Different Telegram group
```

---

## AI Fallback

When you're away, AI can respond to visitors using your custom instructions.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                       AI FALLBACK FLOW                           │
│                                                                 │
│   1. Visitor sends message                                      │
│      │                                                          │
│      ▼                                                          │
│   2. Message delivered to all bridges                           │
│      │                                                          │
│      ▼                                                          │
│   3. Timer starts (configurable, default 2 min)                 │
│      │                                                          │
│      ├──► You reply within time? ──► Normal flow (AI disabled) │
│      │                                                          │
│      └──► No reply? ──────────────────────┐                     │
│                                           │                     │
│                                           ▼                     │
│   4. AI takes over                                              │
│      ├── Uses your custom system prompt                         │
│      ├── References your knowledge base                         │
│      └── Responds as your brand                                 │
│                                                                 │
│   5. You can jump back in anytime                               │
│      (AI stops when you send a message)                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Configuration

```typescript
// AI Fallback settings
{
  enabled: true,
  delayMinutes: 2,           // Wait before AI responds
  systemPrompt: `
    You are a helpful support agent for Acme Inc.
    - Be friendly and professional
    - If you don't know, say so and offer to connect with a human
    - Our business hours are 9am-6pm EST
  `,
  knowledgeBase: [
    { type: 'url', value: 'https://docs.acme.com' },
    { type: 'file', value: 'faq.md' }
  ]
}
```

---

## Security

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         DATA FLOW                                │
│                                                                 │
│   Visitor                Bridge Server              Your Platforms
│   ┌───────┐              ┌───────────┐              ┌───────┐  │
│   │       │   HTTPS/WSS  │           │   HTTPS     │       │  │
│   │       │ ───────────► │  Encrypted│ ───────────►│       │  │
│   │       │ ◄─────────── │  at rest  │ ◄───────────│       │  │
│   └───────┘              └───────────┘              └───────┘  │
│                                                                 │
│   All connections encrypted (TLS 1.3)                          │
│   Messages encrypted at rest (AES-256)                          │
│   No visitor PII stored without consent                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Self-Hosting Option

For complete data control, you can self-host:

| Component | Self-Host? | Notes |
|-----------|------------|-------|
| Widget | Always self-served | Loaded from your domain or CDN |
| Bridge Server | Optional | Docker image available |
| Bridges | Run anywhere | Your credentials, your infra |
| Database | Optional | Postgres, MySQL, SQLite supported |

→ See [Self-Hosting Guide](/self-hosting) for details.

---

## Next Steps

Now that you understand the concepts:

- **[Quick Start](/quickstart)** - Get running in 5 minutes
- **[Widget Configuration](/widget/configuration)** - Customize appearance and behavior
- **[Telegram Bridge](/bridges/telegram)** - Set up Telegram integration
- **[Custom Events](/widget/configuration#custom-events)** - Track user actions
- **[AI Fallback](/ai-fallback)** - Configure automatic responses

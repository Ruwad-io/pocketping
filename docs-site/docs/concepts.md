---
sidebar_position: 3
title: Core Concepts
description: Understand the architecture and key concepts behind PocketPing
---

# Core Concepts

Understand the architecture and key concepts behind PocketPing.

## Architecture Overview

PocketPing consists of three main components that work together:

| Component | Role | Description |
|-----------|------|-------------|
| **Widget** | Frontend | Lightweight chat widget (7KB) that embeds in your website |
| **Bridge Server** | Backend | Routes messages between the widget and messaging platforms |
| **Backend SDK** | Integration | Optional SDK for custom integrations and analytics |

## Sessions

A **session** represents a conversation between a visitor and your team. Each session:

- Has a unique visitor ID (browser fingerprint)
- Contains all messages exchanged
- Persists across page refreshes
- Creates a dedicated thread in your messaging platform

```typescript
// Session object structure
{
  id: "sess_abc123",
  visitorId: "vis_xyz789",
  projectId: "proj_def456",
  messages: [...],
  status: "active" | "closed",
  createdAt: "2024-01-15T10:30:00Z",
  lastActivity: "2024-01-15T10:35:00Z"
}
```

## Bridges

Bridges connect PocketPing to your messaging platforms. Each bridge:

- Runs as a separate process
- Maintains a WebSocket connection to the bridge server
- Creates threads/topics for each new session
- Syncs messages bidirectionally in real-time

:::info Multi-bridge sync
Messages sent on one bridge are automatically synced to all connected bridges, so your team can use their preferred platform.
:::

## Projects

A **project** represents one website or application. Each project has:

- **Public Key:** Used in the widget to identify your project
- **Secret Key:** Used for API calls and backend SDKs
- **Widget Settings:** Colors, operator name, welcome message
- **Bridge Configuration:** Connected platforms and their credentials

## Message Flow

When a visitor sends a message:

1. Widget sends message to Bridge Server via WebSocket
2. Bridge Server stores message and broadcasts to all connected bridges
3. Each bridge posts the message to its platform (Telegram, Discord, etc.)
4. When you reply, the bridge sends it back to the Bridge Server
5. Bridge Server broadcasts to all bridges and the widget
6. Widget displays the response in real-time

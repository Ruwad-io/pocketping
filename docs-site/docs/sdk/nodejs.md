---
sidebar_position: 1
title: Node.js SDK
description: Backend integration with the PocketPing Node.js SDK
---

# Node.js SDK

Integrate PocketPing into your Node.js backend.

## Installation

```bash
npm install @pocketping/sdk-node
```

## Quick Start

### Express

```javascript
const express = require('express');
const { PocketPing } = require('@pocketping/sdk-node');

const app = express();

const pp = new PocketPing({
  bridgeUrl: process.env.BRIDGE_URL || 'http://localhost:3001',
  apiKey: process.env.POCKETPING_API_KEY,
});

// Mount middleware
app.use('/pocketping', pp.middleware());

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

### Fastify

```javascript
const fastify = require('fastify')();
const { PocketPing } = require('@pocketping/sdk-node');

const pp = new PocketPing({
  bridgeUrl: process.env.BRIDGE_URL,
});

// Register plugin
fastify.register(pp.fastifyPlugin, { prefix: '/pocketping' });

fastify.listen({ port: 3000 });
```

### Next.js API Routes

```typescript title="app/api/pocketping/[...path]/route.ts"
import { PocketPing } from '@pocketping/sdk-node';

const pp = new PocketPing({
  bridgeUrl: process.env.BRIDGE_URL!,
});

export const GET = pp.nextHandler();
export const POST = pp.nextHandler();
```

## Configuration

```javascript
const pp = new PocketPing({
  // Required: URL of the bridge server
  bridgeUrl: 'http://localhost:3001',

  // Optional: API key for authentication
  apiKey: 'your_api_key',

  // Optional: Custom session storage
  storage: new RedisStorage(),

  // Optional: Event handlers
  onSessionStart: (session) => {
    console.log('New session:', session.id);
  },
  onMessage: (session, message) => {
    console.log('New message:', message.content);
  },
});
```

## API

### Sessions

```javascript
// Get all active sessions
const sessions = await pp.getSessions();

// Get a specific session
const session = await pp.getSession('sess_xxx');

// Get session messages
const messages = await pp.getMessages('sess_xxx');

// Close a session
await pp.closeSession('sess_xxx');
```

### Messages

```javascript
// Send a message to a session
await pp.sendMessage('sess_xxx', {
  content: 'Hello from the server!',
  type: 'operator',
});
```

### Visitor Identification

```javascript
// Identify a visitor (for CRM integration)
await pp.identify('sess_xxx', {
  email: 'user@example.com',
  name: 'John Doe',
  customerId: 'cust_123',
  metadata: {
    plan: 'pro',
    company: 'Acme Inc',
  },
});
```

## Custom Events

Handle events from the widget and send events back.

### Receiving Events from Widget

Use the `onEvent` config option to handle events sent by `PocketPing.trigger()` in the widget:

```javascript
const pp = new PocketPing({
  bridgeUrl: process.env.BRIDGE_URL,

  // Handle custom events from widget
  onEvent: (event, session) => {
    console.log(`Event: ${event.name}`, event.data);

    // Track in analytics
    analytics.track(event.name, {
      ...event.data,
      sessionId: session.id,
      visitorId: session.visitorId,
    });

    // Trigger automation
    if (event.name === 'clicked_pricing') {
      // Send a follow-up message
      pp.sendMessage(session.id, {
        content: 'I see you\'re checking our pricing! Would you like help choosing a plan?',
        type: 'operator',
      });
    }
  },
});
```

### Sending Events to Widget

Use `emitEvent()` to send events that the widget can listen to with `PocketPing.onEvent()`:

```javascript
// Send a promotional offer to a specific session
pp.emitEvent('sess_xxx', 'show_offer', {
  discount: 20,
  code: 'SAVE20',
  message: 'Special offer just for you!'
});

// Open the chat widget remotely
pp.emitEvent('sess_xxx', 'open_chat');

// Show a notification
pp.emitEvent('sess_xxx', 'notification', {
  title: 'New feature!',
  message: 'Check out our new dashboard.'
});
```

### Event Flow

```
Widget                              Backend SDK
───────                             ───────────
PocketPing.trigger('event', data)
         ─────────────────────────►  onEvent(event, session)

PocketPing.onEvent('event', handler)
         ◄─────────────────────────  pp.emitEvent(sessionId, 'event', data)
```

## Custom Storage

Implement the `Storage` interface for persistence:

```typescript
import { Storage, Session, Message } from '@pocketping/sdk-node';

class RedisStorage implements Storage {
  constructor(private redis: Redis) {}

  async createSession(session: Session): Promise<void> {
    await this.redis.hset(`session:${session.id}`, session);
  }

  async getSession(id: string): Promise<Session | null> {
    return this.redis.hgetall(`session:${id}`);
  }

  async saveMessage(sessionId: string, message: Message): Promise<void> {
    await this.redis.rpush(`messages:${sessionId}`, JSON.stringify(message));
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const messages = await this.redis.lrange(`messages:${sessionId}`, 0, -1);
    return messages.map(m => JSON.parse(m));
  }

  // ... implement other methods
}

const pp = new PocketPing({
  bridgeUrl: process.env.BRIDGE_URL,
  storage: new RedisStorage(redis),
});
```

## TypeScript

The SDK is written in TypeScript and includes type definitions:

```typescript
import {
  PocketPing,
  Session,
  Message,
  Storage,
  PocketPingConfig,
} from '@pocketping/sdk-node';

const config: PocketPingConfig = {
  bridgeUrl: process.env.BRIDGE_URL!,
};

const pp = new PocketPing(config);

pp.onSessionStart((session: Session) => {
  console.log(`New session: ${session.id}`);
});
```

## Next Steps

- [Python SDK](/sdk/python) - Backend integration for Python
- [API Reference](/api) - Full REST API documentation

# PocketPing Node.js SDK

Node.js SDK for PocketPing - real-time customer chat with mobile notifications.

## Installation

```bash
npm install @pocketping/sdk-node

# Or with pnpm
pnpm add @pocketping/sdk-node

# Or with yarn
yarn add @pocketping/sdk-node
```

## Quick Start with Express

```typescript
import express from 'express';
import { createServer } from 'http';
import { PocketPing } from '@pocketping/sdk-node';

const app = express();
const server = createServer(app);

app.use(express.json());

// Initialize PocketPing
const pp = new PocketPing({
  welcomeMessage: 'Hi! How can we help you today?',
  onNewSession: (session) => {
    console.log(`New session: ${session.id}`);
  },
  onMessage: (message, session) => {
    console.log(`Message from ${message.sender}: ${message.content}`);
  },
});

// Mount PocketPing routes
app.use('/pocketping', pp.middleware());

// Attach WebSocket for real-time communication
pp.attachWebSocket(server);

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

## Configuration Options

```typescript
const pp = new PocketPing({
  // Welcome message shown to new visitors
  welcomeMessage: 'Hi! How can we help you?',

  // Callbacks
  onNewSession: (session) => { /* ... */ },
  onMessage: (message, session) => { /* ... */ },
  onEvent: (event, session) => { /* ... */ },

  // Custom storage (default: in-memory)
  storage: new MemoryStorage(),

  // Bridge server for notifications (Telegram, Discord, Slack)
  bridgeServerUrl: 'http://localhost:3001',

  // Protocol version settings
  protocolVersion: '1.0',
  minSupportedVersion: '0.1',

  // IP filtering (see IP Filtering section below)
  ipFilter: {
    enabled: true,
    mode: 'blocklist',
    blocklist: ['203.0.113.0/24'],
  },
});
```

## IP Filtering

Block or allow specific IP addresses or CIDR ranges:

```typescript
const pp = new PocketPing({
  ipFilter: {
    enabled: true,
    mode: 'blocklist',  // 'allowlist' | 'blocklist' | 'both'
    blocklist: [
      '203.0.113.0/24',   // CIDR range
      '198.51.100.50',    // Single IP
    ],
    allowlist: [
      '10.0.0.0/8',       // Internal network
    ],
    logBlocked: true,     // Log blocked requests (default: true)
    blockedStatusCode: 403,
    blockedMessage: 'Forbidden',
  },
});

// Or with a custom filter function
const pp = new PocketPing({
  ipFilter: {
    enabled: true,
    mode: 'blocklist',
    customFilter: (ip, request) => {
      // Return true to allow, false to block, null to defer to list-based filtering
      if (ip.startsWith('192.168.')) return true;  // Always allow local
      return null;  // Use blocklist/allowlist
    },
  },
});
```

### Modes

| Mode | Behavior |
|------|----------|
| `blocklist` | Block IPs in blocklist, allow all others (default) |
| `allowlist` | Only allow IPs in allowlist, block all others |
| `both` | Allowlist takes precedence, then blocklist is applied |

### CIDR Support

The SDK supports CIDR notation for IP ranges:
- Single IP: `192.168.1.1` (treated as `/32`)
- Class C: `192.168.1.0/24` (256 addresses)
- Class B: `172.16.0.0/16` (65,536 addresses)
- Class A: `10.0.0.0/8` (16M addresses)

### Manual IP Check

```typescript
// Check IP manually
const result = pp.checkIpFilter('192.168.1.50');
// result: { allowed: boolean, reason: string, matchedRule?: string }

// Get client IP from request headers
const clientIp = pp.getClientIp(request.headers);
// Checks: CF-Connecting-IP, X-Real-IP, X-Forwarded-For
```

## Architecture Options

### 1. Embedded Mode (Simple)

SDK handles everything directly - best for single server deployments:

```typescript
import { PocketPing } from '@pocketping/sdk-node';

const pp = new PocketPing({
  welcomeMessage: 'Hello!',
});

app.use('/pocketping', pp.middleware());
pp.attachWebSocket(server);
```

### 2. Bridge Server Mode (Recommended)

SDK connects to a dedicated bridge server for notifications:

```typescript
const pp = new PocketPing({
  welcomeMessage: 'Hello!',
  bridgeServerUrl: process.env.BRIDGE_SERVER_URL,
});
```

The bridge server handles Telegram, Discord, and Slack integrations, keeping your main server lightweight.

## Custom Storage

Implement the `Storage` interface for persistence:

```typescript
import { Storage, Session, Message } from '@pocketping/sdk-node';

class PostgresStorage implements Storage {
  async createSession(session: Session): Promise<void> {
    // Your implementation
  }

  async getSession(sessionId: string): Promise<Session | null> {
    // Your implementation
  }

  async saveMessage(message: Message): Promise<void> {
    // Your implementation
  }

  async getMessages(sessionId: string, options?: { after?: string; limit?: number }): Promise<Message[]> {
    // Your implementation
  }

  // ... implement other methods
}

const pp = new PocketPing({
  storage: new PostgresStorage(),
});
```

## Events / Callbacks

```typescript
const pp = new PocketPing({
  onNewSession: (session) => {
    console.log(`New session: ${session.id}`);
    // Notify your team, log to analytics, etc.
  },
  onMessage: (message, session) => {
    console.log(`Message from ${message.sender}: ${message.content}`);
  },
  onEvent: (event, session) => {
    console.log(`Custom event: ${event.name}`, event.data);
  },
});
```

## Custom Events

PocketPing supports bidirectional custom events between your website and backend.

### Listening for Events (Widget -> Backend)

```typescript
// Using callback in config
const pp = new PocketPing({
  onEvent: (event, session) => {
    console.log(`Event ${event.name} from session ${session.id}`);
    console.log(`Data:`, event.data);
  },
});

// Or using subscription
pp.onEvent('clicked_pricing', (event, session) => {
  console.log(`User interested in: ${event.data?.plan}`);
});

// Subscribe to all events
pp.onEvent('*', (event, session) => {
  console.log(`Event: ${event.name}`, event.data);
});
```

### Sending Events (Backend -> Widget)

```typescript
// Send to a specific session
await pp.emitEvent('session-123', 'show_offer', {
  discount: 20,
  code: 'SAVE20',
});

// Broadcast to all connected sessions
await pp.broadcastEvent('announcement', {
  message: 'New feature launched!',
});
```

## User Identification

Track and identify users across sessions:

```typescript
// On the frontend (widget)
PocketPing.identify({
  userId: 'user_123',
  email: 'john@example.com',
  name: 'John Doe',
  plan: 'pro',
});

// Get current identity
const identity = PocketPing.getIdentity();

// Reset identity (e.g., on logout)
PocketPing.reset();
```

User identity is automatically included in session metadata and forwarded to bridges.

## Operator Presence

Control operator online status:

```typescript
// Set operator as online
pp.setOperatorOnline(true);

// Set operator as offline
pp.setOperatorOnline(false);
```

When using the bridge server, presence is managed automatically via Telegram/Discord/Slack commands.

## API Reference

### PocketPing Class

| Method | Description |
|--------|-------------|
| `middleware()` | Returns Express middleware for HTTP routes |
| `attachWebSocket(server)` | Attaches WebSocket handler for real-time communication |
| `setOperatorOnline(online)` | Sets operator online/offline status |
| `onEvent(name, callback)` | Subscribe to custom events |
| `offEvent(name, callback)` | Unsubscribe from custom events |
| `emitEvent(sessionId, name, data)` | Send event to specific session |
| `broadcastEvent(name, data)` | Broadcast event to all sessions |
| `getSession(sessionId)` | Get session by ID |
| `getMessages(sessionId, options)` | Get messages for a session |

### Types

```typescript
interface Session {
  id: string;
  visitorId: string;
  metadata: SessionMetadata;
  createdAt: Date;
  lastActivity: Date;
  status: 'active' | 'closed';
}

interface Message {
  id: string;
  sessionId: string;
  sender: 'visitor' | 'operator' | 'system' | 'ai';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

interface CustomEvent {
  name: string;
  data?: Record<string, unknown>;
  timestamp: Date;
  sessionId?: string;
}
```

## Widget Integration

Add the widget to your website:

```html
<script src="https://unpkg.com/@pocketping/widget"></script>
<script>
  PocketPing.init({
    endpoint: '/pocketping',
    theme: 'light', // or 'dark'
    primaryColor: '#667eea',
  });
</script>
```

Or via npm:

```typescript
import { init } from '@pocketping/widget';

init({
  endpoint: '/pocketping',
  theme: 'dark',
  primaryColor: '#667eea',
});
```

## License

MIT

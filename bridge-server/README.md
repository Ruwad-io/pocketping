# PocketPing Bridge Server

A standalone server that handles all notification bridges (Telegram, Discord, Slack) for PocketPing. This server can run independently and communicate with any backend via HTTP/SSE.

## Features

- **Telegram Bridge** with Forum Topics support (1 topic per conversation)
- **Discord Bridge** with Threads support (1 thread per conversation)
- **Slack Bridge** with native thread support
- **Cross-bridge synchronization** - replies from one bridge appear in all others
- **HTTP API** for receiving events from backends
- **SSE stream** for sending operator events back to backends
- **Docker support** for easy deployment

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your bot tokens and channel IDs
```

### 3. Run the server

```bash
# Development (with hot reload)
bun run dev

# Production
bun run start
```

## API Endpoints

### Health Check
```
GET /health
```

### Receive Events from Backend
```
POST /api/events
Content-Type: application/json

{
  "type": "new_session" | "visitor_message" | "ai_takeover" | "operator_status",
  ...
}
```

### Convenience Endpoints
```
POST /api/sessions     - New session notification
POST /api/messages     - Visitor message notification
POST /api/operator/status - Update operator status
```

### SSE Stream (Operator Events)
```
GET /api/events/stream

# Receives events like:
# data: {"type":"operator_message","sessionId":"...","content":"...","sourceBridge":"telegram"}
```

## Docker Deployment

### Quick Start (recommended)

Pull and run the pre-built image from GitHub Container Registry:

```bash
docker run -d \
  --name pocketping-bridge \
  -p 3001:3001 \
  -e TELEGRAM_BOT_TOKEN=your_token \
  -e TELEGRAM_FORUM_CHAT_ID=your_chat_id \
  ghcr.io/pocketping/pocketping-bridge:latest
```

### Docker Compose

```bash
# Create .env file with your credentials
cp .env.example .env

# Pull and run
docker compose up -d
```

### Build from source

If you want to build locally instead:

```bash
# Using docker compose
docker compose -f docker-compose.build.yml up -d

# Or manually
docker build -t pocketping-bridge .
docker run -d --name pocketping-bridge -p 3001:3001 --env-file .env pocketping-bridge
```

### Available tags

- `latest` - Latest stable release
- `main` - Latest from main branch
- `v1.0.0`, `v1.0`, `v1` - Specific versions

## Integration with Backend

### Sending events to Bridge Server

Your backend should send events to the Bridge Server when:

1. **New session** - A visitor starts a conversation
```javascript
await fetch('http://bridge-server:3001/api/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: 'session-123',
    visitorId: 'visitor-456',
    createdAt: new Date(),
    lastActivity: new Date(),
    operatorOnline: false,
    aiActive: false,
    metadata: {
      url: 'https://example.com/pricing',
      referrer: 'https://google.com',
    }
  })
});
```

2. **Visitor message** - A visitor sends a message
```javascript
await fetch('http://bridge-server:3001/api/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: {
      id: 'msg-123',
      sessionId: 'session-123',
      content: 'Hello, I have a question!',
      sender: 'visitor',
      timestamp: new Date()
    },
    session: { /* session object */ }
  })
});
```

### Receiving events from Bridge Server

**Option 1: SSE Stream** (recommended for real-time)
```javascript
const evtSource = new EventSource('http://bridge-server:3001/api/events/stream');

evtSource.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'operator_message') {
    // Handle operator reply
    console.log(`Operator replied: ${data.content}`);
  }
};
```

**Option 2: Webhook**
Set `BACKEND_WEBHOOK_URL` in the Bridge Server's `.env`:
```
BACKEND_WEBHOOK_URL=http://your-backend:8000/api/bridge/webhook
```

The Bridge Server will POST events to this URL.

## Bridge Setup

### Telegram (Forum Topics)

1. Create a bot with [@BotFather](https://t.me/botfather)
2. Create a supergroup and enable Topics in settings
3. Add the bot as admin with "Manage Topics" permission
4. Get the chat ID (forward a message to [@userinfobot](https://t.me/userinfobot))

### Discord (Threads)

1. Create a bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. Enable **MESSAGE CONTENT INTENT** in Bot settings
3. Generate invite URL with permissions: Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Add Reactions
4. Get channel ID (Enable Developer Mode, right-click channel)

### Slack

1. Create an app at [Slack API](https://api.slack.com/apps)
2. Enable Socket Mode and get App-Level Token (xapp-...)
3. Add bot scopes: `chat:write`, `channels:history`, `channels:read`, `reactions:write`, `users:read`
4. Install to workspace and get Bot Token (xoxb-...)
5. Invite bot to the channel

## Architecture

```
┌─────────────────┐     HTTP/SSE      ┌──────────────────┐
│   Your Backend  │◄────────────────►│  Bridge Server   │
│   (any lang)    │                   │     (Bun)        │
└─────────────────┘                   └────────┬─────────┘
                                               │
                     ┌─────────────────────────┼─────────────────────────┐
                     │                         │                         │
                     ▼                         ▼                         ▼
              ┌──────────┐              ┌──────────┐              ┌──────────┐
              │ Telegram │              │ Discord  │              │  Slack   │
              │ (Topics) │              │(Threads) │              │(Threads) │
              └──────────┘              └──────────┘              └──────────┘
```

## License

MIT

# PocketPing Bridge Server (Go)

A **standalone server** for PocketPing that handles bidirectional messaging with Telegram, Discord, and Slack.
Deploy with Docker, configure your tokens, and you're done - no code to write.

> **Quick setup:** Use the CLI wizard for guided setup: `npx @pocketping/cli init`

## Architecture

The bridge-server is one of three ways to run PocketPing:

```
┌─────────┐         ┌──────────────┐         ┌──────────────────────┐
│  Widget │ ◀─SSE─▶ │ bridge-server│ ◀─HTTP─▶│ Telegram/Discord/Slack│
└─────────┘         └──────────────┘         └──────────────────────┘
                           │
                           │ Webhook (optional)
                           ▼
                    ┌────────────┐
                    │ Your Backend│
                    └────────────┘
```

**Uses sdk-go internally** for the core logic (WebhookHandler, message handling, etc.).

### When to use bridge-server vs SDKs

| Use Case | Solution |
|----------|----------|
| **You have a backend** (Node, Python, Go, PHP, Ruby) | Use the SDK for your language |
| **No backend / Static site / Serverless** | Use bridge-server |
| **Want maximum control** | Use SDK |
| **Want zero code** | Use bridge-server |

## Features

- **Bidirectional messaging**: Visitors send messages, operators reply from Telegram/Discord/Slack
- **File attachments**: Share images and files in both directions
- **Message edit/delete sync**: Syncs modifications across all platforms
- **Reply linking**: Telegram/Discord show native replies; Slack shows quoted block in threads
- **SSE streaming**: Real-time updates to widgets
- **Multi-bridge**: Supports Telegram, Discord, and Slack simultaneously
- **Zero code**: Just configuration, no backend code needed
- **Single binary**: Easy deployment with Go or Docker

## Quick Start

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your credentials

# Run
make run
```

## Configuration

All configuration is done via environment variables. See `.env.example` for all options.

### Required (at least one bridge)

**Telegram:**
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
TELEGRAM_CHAT_ID=-1001234567890
```

**Discord (Bot mode):**
```env
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_CHANNEL_ID=1234567890123456789
```

**Slack (Bot mode):**
```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_CHANNEL_ID=C0123456789
```

### Optional

```env
PORT=3001
API_KEY=your-secret-key
BACKEND_WEBHOOK_URL=https://your-backend.com/api/bridge-events
BRIDGE_TEST_BOT_IDS=SLACK_BOT_ID,DISCORD_BOT_ID
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/events` | Main event handler |
| POST | `/api/sessions` | New session notification |
| POST | `/api/messages` | Visitor message notification |
| POST | `/api/operator/status` | Operator status update |
| POST | `/api/custom-events` | Custom event notification |
| GET | `/api/events/stream` | SSE stream for operator events |

## Event Types

### Incoming (Backend → Bridge Server)

- `new_session` - New chat session started
- `visitor_message` - Visitor sent a message
- `ai_takeover` - AI took over conversation
- `operator_status` - Operator online/offline
- `message_read` - Messages marked as read
- `custom_event` - Custom event from widget
- `identity_update` - User identity updated
- `visitor_message_edited` - Visitor edited a message
- `visitor_message_deleted` - Visitor deleted a message

### Outgoing (Bridge Server → Backend)

- `operator_message` - Operator replied from a bridge
- `operator_message_edited` - Operator edited a bridge message
- `operator_message_deleted` - Operator deleted a bridge message
- `operator_typing` - Operator is typing
- `session_closed` - Session closed from bridge

## Reply Behavior

Each bridge handles replies differently:

| Bridge | Reply Style |
|--------|-------------|
| **Telegram** | Native reply (with preview of original message) |
| **Discord** | Native reply in channel |
| **Slack** | Quoted block with left border (Slack doesn't support message-level replies) |

## Receiving Operator Replies

To receive replies from operators, configure `BACKEND_WEBHOOK_URL`:

```env
BACKEND_WEBHOOK_URL=https://your-backend.com/api/bridge-events
```

The bridge-server will POST events like:

```json
{
  "type": "operator_message",
  "session_id": "sess_123",
  "content": "Hello! How can I help?",
  "operator_name": "John",
  "source_bridge": "telegram",
  "bridge_message_ids": {
    "telegram_message_id": 12345
  }
}
```

### Webhook Event Types

| Event | Description |
|-------|-------------|
| `operator_message` | Operator sent a reply |
| `operator_message_edited` | Operator edited their message |
| `operator_message_deleted` | Operator deleted their message |
| `operator_typing` | Operator is typing |
| `session_closed` | Session closed from bridge |

## Docker

```bash
# Build
make docker

# Run
make docker-run
```

### Docker Compose Example

```yaml
version: '3.8'
services:
  bridge-server:
    image: pocketping/bridge-server:latest
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
      - DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
      - DISCORD_CHANNEL_ID=${DISCORD_CHANNEL_ID}
      - SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}
      - SLACK_CHANNEL_ID=${SLACK_CHANNEL_ID}
      - BACKEND_WEBHOOK_URL=${BACKEND_WEBHOOK_URL}
    restart: unless-stopped
```

## Development

```bash
# Install dependencies
make deps

# Run linter
make lint

# Format code
make fmt

# Run tests
make test
```

## License

MIT

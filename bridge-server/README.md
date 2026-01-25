# PocketPing Bridge Server (Go)

A standalone HTTP server that forwards chat notifications to Telegram, Discord, and Slack using pure HTTP APIs (no external messaging libraries).

## Features

- **HTTP-only**: Uses native HTTP calls to platform APIs
- **Multi-bridge**: Supports Telegram, Discord, and Slack simultaneously
- **Edit/Delete sync**: Syncs message edits and deletes across platforms
- **SSE streaming**: Real-time event stream for backends
- **Webhook support**: Forward events to external systems (Zapier, Make, n8n)
- **Single binary**: Easy deployment with Go

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
- `operator_typing` - Operator is typing
- `session_closed` - Session closed from bridge

## Docker

```bash
# Build
make docker

# Run
make docker-run
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

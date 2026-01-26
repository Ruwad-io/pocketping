# PocketPing Community Edition

A **self-hosted** live chat solution with Telegram, Discord, and Slack integration. No SaaS, no subscriptions - just deploy and chat.

## Features

- **Real-time chat widget** - Embed on any website
- **Multi-bridge support** - Reply from Telegram, Discord, or Slack
- **Thread management** - Each conversation gets its own thread/topic
- **File attachments** - Share images and files
- **Message sync** - Edits and deletes sync across all bridges
- **Pre-chat forms** - Collect visitor info before chat
- **Self-hosted** - Your data, your server

## Quick Start

### Docker (Recommended)

```bash
# Clone the repo
git clone https://github.com/pocketping/pocketping.git
cd pocketping/community

# Configure environment
cp .env.example .env
# Edit .env with your bridge tokens

# Start with Docker Compose
docker-compose up -d

# Run migrations
docker-compose run --rm migrate

# Open http://localhost:3000 for API keys
```

### Manual Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with DATABASE_URL and bridge tokens

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate deploy

# Start development server
npm run dev

# Or build for production
npm run build
npm start
```

## Bridge Setup

You can configure bridges via environment variables or via the Admin API.

### Telegram

**Step 1: Create a Bot**
1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHI...`)

**Step 2: Create a Forum Group**
1. Create a new group in Telegram
2. Go to Group Settings → Group Type → Convert to Supergroup
3. Go to Group Settings → Topics → Enable Topics
4. Add your bot to the group
5. Make the bot an admin (Settings → Administrators → Add Admin)
   - Enable "Manage Topics" permission

**Step 3: Get the Chat ID**
1. Add [@userinfobot](https://t.me/userinfobot) to your group temporarily
2. It will post a message with the chat ID (starts with `-100`)
3. Remove the bot after getting the ID

**Step 4: Configure**
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_WEBHOOK_SECRET=random-secret-string
```

**Step 5: Set Webhook** (after deploying)
```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://your-domain.com/api/webhooks/telegram&secret_token=<YOUR_SECRET>"
```

---

### Discord

**Step 1: Create a Discord Application**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to "Bot" section → "Add Bot"
4. Copy the bot token (click "Reset Token" if needed)

**Step 2: Configure Bot Settings**
1. In Bot section, enable these Privileged Gateway Intents:
   - ✅ Message Content Intent
2. In OAuth2 → URL Generator:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Create Public Threads`, `Send Messages in Threads`, `Read Message History`, `Add Reactions`
3. Copy the generated URL and open it to add bot to your server

**Step 3: Get Channel ID**
1. In Discord, enable Developer Mode (User Settings → App Settings → Advanced → Developer Mode)
2. Right-click the channel where you want messages → "Copy Channel ID"

**Step 4: Configure**
```env
DISCORD_BOT_TOKEN=your-bot-token
# Enable Discord Gateway for receiving messages (required for persistent hosting)
ENABLE_DISCORD_GATEWAY=true
```

Then set channel ID via Admin API:
```bash
curl -X PATCH http://localhost:3000/api/admin/settings \
  -H "Authorization: Bearer YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"discordChannelId": "1234567890123456789"}'
```

---

### Slack

**Step 1: Create a Slack App**
1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name it and select your workspace

**Step 2: Configure OAuth Scopes**
1. Go to "OAuth & Permissions"
2. Add these Bot Token Scopes:
   - `chat:write` - Send messages
   - `channels:history` - Read channel messages
   - `channels:read` - View channel info
   - `users:read` - Get user info
   - `files:read` - Access files
3. Click "Install to Workspace" and authorize
4. Copy the "Bot User OAuth Token" (starts with `xoxb-`)

**Step 3: Enable Event Subscriptions**
1. Go to "Event Subscriptions" and enable it
2. Set Request URL: `https://your-domain.com/api/webhooks/slack`
3. Wait for verification (your server must be running)
4. Under "Subscribe to bot events", add:
   - `message.channels`

**Step 4: Invite Bot to Channel**
1. In Slack, go to your support channel
2. Type `/invite @YourBotName`

**Step 5: Get Channel ID**
1. Right-click the channel → "View channel details"
2. Scroll down to find the Channel ID (starts with `C`)

**Step 6: Configure via Admin API**
```bash
curl -X PATCH http://localhost:3000/api/admin/settings \
  -H "Authorization: Bearer YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slackBotToken": "xoxb-your-token",
    "slackChannelId": "C0123456789"
  }'
```

## Widget Integration

Add to your website:

```html
<script
  src="https://cdn.pocketping.io/widget.js"
  data-api-key="YOUR_PUBLIC_KEY"
  data-api-url="https://your-pocketping-server.com"
></script>
```

Or use the widget SDK:

```javascript
import { PocketPing } from '@pocketping/widget'

const chat = new PocketPing({
  apiKey: 'YOUR_PUBLIC_KEY',
  apiUrl: 'https://your-pocketping-server.com',
})

chat.init()
```

## API Endpoints

All widget endpoints require `Authorization: Bearer <PUBLIC_KEY>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/widget/init` | Initialize session |
| POST | `/api/widget/messages` | Send message |
| GET | `/api/widget/messages` | Get messages |
| POST | `/api/widget/identify` | Update visitor info |
| GET | `/api/widget/stream` | SSE real-time updates |

### Webhook Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/webhooks/telegram` | Telegram updates |
| POST | `/api/webhooks/slack` | Slack events |

## Database Schema

The community edition uses a simplified schema:

- **Project** - Single project with all settings
- **Session** - Chat sessions with visitor info
- **Message** - Messages with bridge IDs for sync
- **Attachment** - File attachments

## Environment Variables

```env
# Required
DATABASE_URL="postgresql://user:pass@localhost:5432/pocketping"

# Telegram (optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=

# Discord (optional)
DISCORD_BOT_TOKEN=
ENABLE_DISCORD_GATEWAY=true  # Enable to receive messages from operators

# Widget (optional)
NEXT_PUBLIC_WIDGET_URL=https://cdn.pocketping.io/widget.js
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Your Website  │────▶│  PocketPing CE  │
│    (Widget)     │◀────│   (Next.js)     │
└─────────────────┘     └────────┬────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
          ▼                      ▼                      ▼
   ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
   │  Telegram   │       │   Discord   │       │    Slack    │
   │  (Topics)   │       │  (Threads)  │       │  (Threads)  │
   └─────────────┘       └─────────────┘       └─────────────┘
```

## vs SaaS Edition

| Feature | Community | SaaS |
|---------|-----------|------|
| Self-hosted | ✅ | ❌ |
| Multi-project | ❌ | ✅ |
| Team management | ❌ | ✅ |
| Analytics dashboard | ❌ | ✅ |
| Clerk auth | ❌ | ✅ |
| Stripe billing | ❌ | ✅ |
| Vercel deployment | ❌ | ✅ |

## Contributing

Contributions welcome! Please read our contributing guidelines.

## License

MIT

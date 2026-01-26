<p align="center">
  <img src="assets/logo.svg" alt="PocketPing" width="200" />
</p>

<h1 align="center">PocketPing</h1>

<p align="center">
  <strong>Chat widget + instant notifications on your phone</strong><br>
  Get pinged in Telegram, Discord, or Slack when visitors need help.
</p>

<p align="center">
  <a href="https://pocketping.io">Website</a> &bull;
  <a href="https://pocketping.io/docs">Documentation</a> &bull;
  <a href="#-60-second-quick-start">Quick Start</a> &bull;
  <a href="#-features">Features</a> &bull;
  <a href="https://github.com/Ruwad-io/pocketping/issues">Get Help</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
</p>

---

## Why PocketPing?

You're a founder. A user visits your site and needs help. But you're walking your dog, in a meeting, or making coffee.

**By the time you check, they're gone.**

PocketPing fixes this:

```
Visitor opens chat -> You get a Telegram ping -> Reply from your phone
                            |
            (No response in 5 min? AI takes over)
```

**No desktop app needed. No browser tab. Just your phone.**

---

## Comparison with Alternatives

| Feature | PocketPing | Intercom | Crisp | Chatwoot | Tawk.to |
|---------|------------|----------|-------|----------|---------|
| **Pricing** | Free | $74+/mo | $25+/mo | Free | Free |
| **Self-hosted** | Yes | No | No | Yes | No |
| **Telegram** | Yes | No | No | No | No |
| **Discord** | Yes | No | No | No | No |
| **Slack** | Yes | Add-on | Add-on | Yes | No |
| **Multi-channel sync** | Yes | No | No | No | No |
| **Custom Events** | Yes | Paid | Limited | No | No |
| **Open source** | MIT | No | No | AGPL | No |

**[See full comparison](docs/COMPARISON.md)** - Detailed analysis vs Intercom, Crisp, Chatwoot, Tawk.to, Drift, Zendesk

---

## 60-Second Quick Start

### Step 1: Add the widget to your site

```html
<script src="https://cdn.pocketping.io/widget.js"></script>
<script>
  PocketPing.init({
    endpoint: 'https://yoursite.com/pocketping'
  });
</script>
```

### Step 2: Set up your backend

**Option A: Python (FastAPI)** - Recommended for beginners

```bash
# Clone the example
git clone https://github.com/Ruwad-io/pocketping-test-fastapi
cd pocketping-test-fastapi

# Install dependencies
pip install -r requirements.txt

# Configure (copy and edit .env)
cp .env.example .env
# Edit .env with your Telegram bot token (see setup guide below)

# Run
uvicorn main:app --reload
```

**Option B: Any language** - Use the Bridge Server

```bash
# Clone PocketPing
git clone https://github.com/Ruwad-io/pocketping
cd pocketping/bridge-server

# Configure
cp .env.example .env
# Edit .env with your bot tokens

# Run with Docker
docker compose up -d

# Or build from source (requires Go 1.21+)
go build -o bridge-server ./cmd/server && ./bridge-server
```

Then your backend just needs to call the Bridge Server API. See [Bridge Server docs](bridge-server/README.md).

### Step 3: Get notified!

Open your site, send a message, and watch it appear in Telegram!

---

## How it Works

```
+-------------+      +-------------+      +-------------+
|   Visitor   |      | Your Server |      |  Your Phone |
|   Browser   |      |  (Backend)  |      |  Telegram   |
+------+------+      +------+------+      +------+------+
       |                    |                    |
       |  "Hi, I need help" |                    |
       |------------------->|                    |
       |                    |  New message!      |
       |                    |------------------->|
       |                    |                    |
       |                    |   "How can I help?"|
       |                    |<-------------------|
       |  "How can I help?" |                    |
       |<-------------------|                    |
       |                    |                    |
```

**That's it.** Widget talks to your backend. Backend pings your phone. You reply. Visitor sees your response instantly.

---

## Setup Guides

> **Tip:** Use the interactive CLI for guided setup:
> ```bash
> npx @pocketping/cli init
> ```
> It will walk you through configuring Telegram, Discord, or Slack and validate your credentials.

### Reply behavior (all modes)

- **Telegram:** replies appear as native Telegram replies when replying to a message.
- **Discord:** replies appear as native Discord replies inside the thread.
- **Slack:** Slack doesn't support message‑level replies inside threads, so replies show as a quoted block (left bar).

### Telegram (Recommended)

Telegram is the easiest to set up and works great on mobile.

<details>
<summary><strong>Click to expand Telegram setup (5 minutes)</strong></summary>

#### 1. Create a bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Choose a name (e.g., "My Support Bot")
4. Choose a username (e.g., "mysupport_bot")
5. **Save the token** (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

#### 2. Create a group with Topics

1. Create a new Telegram group
2. Go to **Group Settings** -> **Group Type** -> **Convert to Supergroup**
3. Go to **Group Settings** -> **Topics** -> **Enable Topics**
4. Add your bot to the group
5. Make the bot an **admin** with "Manage Topics" permission

#### 3. Get your chat ID

1. Forward any message from your group to [@userinfobot](https://t.me/userinfobot)
2. It will reply with a chat ID like `-1001234567890`
3. **Save this ID**

#### 4. Configure PocketPing

Add to your `.env` file:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_FORUM_CHAT_ID=-1001234567890
```

#### How it looks

Each visitor conversation becomes a **separate topic**:

```
Your Telegram Group
|-- visitor-abc - /pricing     <- Visitor from pricing page
|   |-- "Hi, what's the price?"
|   +-- [You reply here]
|-- visitor-def - /features    <- Another visitor
|   +-- "Does it support X?"
+-- visitor-ghi - /home        <- Closed conversation
```

**Commands:**
- Just type in the topic to reply (no need to swipe-reply)
- `/read` - Mark all messages as read
- `/close` - Close a conversation

</details>

### Discord

<details>
<summary><strong>Click to expand Discord setup (5 minutes)</strong></summary>

#### 1. Create a bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** -> Give it a name -> **Create**
3. Go to **Bot** -> Click **Add Bot**
4. Under **Token**, click **Copy** (or Reset Token first)
5. **Save this token**

#### 2. Enable required intents

1. In **Bot** settings, scroll to **Privileged Gateway Intents**
2. Enable **MESSAGE CONTENT INTENT** (required!)
3. Save changes

#### 3. Invite the bot

1. Go to **OAuth2** -> **URL Generator**
2. Check **bot** under Scopes
3. Check these permissions:
   - Send Messages
   - Create Public Threads
   - Send Messages in Threads
   - Read Message History
   - Add Reactions
4. Copy the URL and open it to invite your bot

#### 4. Get your channel ID

1. In Discord, go to **User Settings** -> **App Settings** -> **Advanced**
2. Enable **Developer Mode**
3. Right-click your support channel -> **Copy Channel ID**
4. **Save this ID**

#### 5. Configure PocketPing

```env
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CHANNEL_ID=123456789012345678
```

**Commands:**
- Reply in thread to respond
- `!read` - Mark all messages as read
- `!close` - Close conversation

</details>

### Slack

<details>
<summary><strong>Click to expand Slack setup (10 minutes)</strong></summary>

#### 1. Create an app

1. Go to [Slack API](https://api.slack.com/apps)
2. Click **Create New App** -> **From scratch**
3. Name it (e.g., "PocketPing") and select your workspace

#### 2. Add bot permissions

1. Go to **OAuth & Permissions**
2. Under **Scopes** -> **Bot Token Scopes**, add:
   - `chat:write`
   - `channels:history`
   - `channels:read`
   - `groups:history`
   - `groups:read`
   - `users:read`

#### 3. Install to workspace

1. Go to **Install App** in the sidebar
2. Click **Install to Workspace**
3. **Save the Bot Token** (starts with `xoxb-`)

#### 4. Subscribe to events

1. Go to **Event Subscriptions**
2. Toggle **Enable Events** to ON
3. Set the **Request URL** to your webhook endpoint (e.g., `https://your-domain.com/api/webhooks/slack`)
4. Wait for verification, then under **Subscribe to bot events**, add:
   - `message.channels`
   - `message.groups`
5. Save changes

#### 5. Invite bot to channel

1. In Slack, go to your support channel
2. Type `/invite @YourBotName`
3. Right-click the channel name -> **View channel details** -> Copy Channel ID

#### 6. Configure PocketPing

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_CHANNEL_ID=C0123456789
```

**Commands:**
- Reply in thread to respond
- `@PocketPing read` - Mark all messages as read

</details>

---

## Three Deployment Options

The widget can connect to **3 different servers**. All three provide the **same features**:
bidirectional messaging, file attachments, message edit/delete, read receipts, and more.

```
┌────────────┐
│   Widget   │──────► Option 1: pocketping.io (SaaS)
│ (your site)│──────► Option 2: bridge-server (Self-hosted standalone)
└────────────┘──────► Option 3: your backend + SDK (Self-hosted custom)
```

### Option 1: SaaS (pocketping.io)

The simplest option. We host everything.

```
Widget  ◀──────────────▶  pocketping.io  ◀──────────────▶  Telegram/Discord/Slack
        (WebSocket/SSE)                        (HTTP)
```

**When to use:** You just want it to work, no infrastructure to manage.

### Option 2: Bridge-Server (Self-Hosted Standalone)

A ready-to-use Go server. Deploy with Docker, configure your tokens, done.
Zero code to write.

```
Widget  ◀──────────────▶  bridge-server  ◀──────────────▶  Telegram/Discord/Slack
              (SSE)        (Go, Docker)        (HTTP)
```

```bash
docker run -d -p 3001:3001 \
  -e TELEGRAM_BOT_TOKEN=your-token \
  -e TELEGRAM_FORUM_CHAT_ID=-100123456789 \
  pocketping/bridge-server
```

**When to use:** Self-hosted without writing code.

### Option 3: SDK Integration (Self-Hosted Custom)

Full control. The **SDK is a library** you integrate into your existing backend.
You write the routes, you control the database.

```
Widget  ◀──────────────▶  YOUR BACKEND + SDK  ◀──────────────▶  Telegram/Discord/Slack
              (SSE)       (Express/FastAPI/      (HTTP)
                           Gin/Laravel/Rails)
```

The SDK provides:
- Handlers: `handleConnect()`, `handleMessage()`, `handleEdit()`, `handleDelete()`
- **WebhookHandler**: Receive operator replies from Telegram/Discord/Slack
- Bridges: Send notifications to messaging platforms

**When to use:** You have an existing backend and want full customization.

### Quick Comparison

| | pocketping.io | bridge-server | SDK |
|---|---|---|---|
| Widget connects to | pocketping.io | Your bridge-server | Your backend |
| Hosting | Us | You | You |
| Code to write | None | Config only | Routes + handlers |
| Database | Managed | In-memory/Redis | Your choice |
| Customization | Limited | Medium | Full |

---

## Features

### Read Receipts (Check Marks)

Like WhatsApp:
- ✓ Message sent
- ✓✓ Delivered to Telegram/Discord/Slack
- ✓✓ (blue) Operator saw it

### Message Editing & Deletion

Visitors can edit or delete their own messages:

**Widget:**
```javascript
// Edit a message
PocketPing.editMessage(messageId, 'Updated content');

// Delete a message (soft delete)
PocketPing.deleteMessage(messageId);
```

**What happens:**
- Edits/deletes sync to all connected bridges (Telegram, Discord, Slack)
- The actual message in the bridge is edited/deleted (not just a notification)
- Deleted messages show "This message was deleted" in the chat

**Backend (Python):**
```python
# Handle edit event
@pp.on_message_edited
async def handle_edit(session_id, message_id, new_content, edited_at):
    print(f"Message {message_id} edited to: {new_content}")

# Handle delete event
@pp.on_message_deleted
async def handle_delete(session_id, message_id, deleted_at):
    print(f"Message {message_id} was deleted")
```

### File Attachments

Share images, documents, and files in conversations:

**Widget:**
```javascript
// Attachments are handled automatically via the file picker button
// Or programmatically:
const attachment = await PocketPing.uploadFile(file);
PocketPing.sendMessage('Check this file!', { attachments: [attachment.id] });
```

**What happens:**
- Files are uploaded via presigned URL (direct to your storage)
- Images display inline in the widget and bridges
- Other files show as downloadable links
- Supports: images, PDFs, documents, audio, video

**Attachment metadata:**
```javascript
{
  id: 'att_abc123',
  filename: 'document.pdf',
  mimeType: 'application/pdf',
  size: 102400,  // bytes
  url: 'https://...',
  thumbnailUrl: 'https://...',  // for images
  status: 'ready'
}
```

### AI Fallback

If you don't respond in X minutes, AI takes over:

```python
pp = PocketPing(
    ai_provider=OpenAIProvider(api_key="sk-..."),
    ai_takeover_delay=300,  # 5 minutes
)
```

Supports: **OpenAI**, **Google Gemini**, **Anthropic Claude**

### Custom Events (Bidirectional)

Trigger events from your website to get notified, or send events to the widget:

**Widget → Backend → Bridges:**

```javascript
// User clicked pricing? Get notified!
PocketPing.trigger('clicked_pricing', { plan: 'pro' });

// Track any user action
PocketPing.trigger('viewed_demo');
PocketPing.trigger('error_occurred', { code: 500, page: '/checkout' });
```

**Backend → Widget:**

```python
# Send a special offer to the visitor
pp.emit_event(session_id, 'show_offer', {'discount': 20})

# Broadcast to all connected visitors
pp.broadcast_event('announcement', {'message': 'New feature launched!'})
```

**Subscribe to events:**

```javascript
// In widget
const unsubscribe = PocketPing.onEvent('show_offer', (data) => {
  showPopup(`${data.discount}% off!`);
});

// In backend (Python)
@pp.on_event('clicked_pricing')
async def handle_pricing_click(event, session):
    print(f"User {session.id} interested in {event.data['plan']}")
```

Events appear in your Telegram/Discord/Slack with full context!

### Webhook Forwarding

Forward all custom events to your own webhook for integrations with **Zapier**, **Make**, **n8n**, or your custom backend:

**Python:**
```python
pp = PocketPing(
    webhook_url='https://your-server.com/pocketping-events',
    webhook_secret='your-hmac-secret',  # Optional: adds X-PocketPing-Signature header
)
```

**Node.js:**
```javascript
const pp = new PocketPing({
  webhookUrl: 'https://your-server.com/pocketping-events',
  webhookSecret: 'your-hmac-secret',  // Optional: adds X-PocketPing-Signature
});
```

**Bridge-server (Docker):**
```bash
EVENTS_WEBHOOK_URL=https://your-server.com/pocketping-events
EVENTS_WEBHOOK_SECRET=your-hmac-secret
```

**Webhook payload:**
```json
{
  "event": {
    "name": "clicked_pricing",
    "data": { "plan": "pro" },
    "timestamp": "2026-01-21T00:00:00.000Z",
    "sessionId": "sess_abc123"
  },
  "session": {
    "id": "sess_abc123",
    "visitorId": "visitor_xyz",
    "metadata": { "url": "...", "country": "France" }
  },
  "sentAt": "2026-01-21T00:00:00.000Z"
}
```

### Cross-Bridge Sync

When you have Telegram + Discord + Slack all configured:

```
Alice replies on Telegram
        |
        v
Bob (on Discord) sees Alice's reply
Carol (on Slack) sees it too
        |
        v
Everyone stays in sync!
```

### Session Persistence

Visitors can close the tab and come back - their conversation continues.

### Rich Metadata

See where visitors came from:

```
New Conversation

Session: abc12345...
Page: https://yoursite.com/pricing
Device: desktop - Chrome - macOS
Location: Paris, France
```

---

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [@pocketping/widget](packages/widget) | Chat widget (~15KB) | Ready |
| [@pocketping/cli](packages/cli) | Interactive setup CLI | Ready |
| [pocketping](packages/sdk-python) | Python SDK (FastAPI, Django, Flask) | Ready |
| [@pocketping/sdk-node](packages/sdk-node) | Node.js SDK (Express) | Ready |
| [pocketping-go](packages/sdk-go) | Go SDK (net/http, Gin, Echo) | Ready |
| [pocketping-php](packages/sdk-php) | PHP SDK (Laravel, Symfony) | Ready |
| [pocketping-ruby](packages/sdk-ruby) | Ruby SDK (Rails, Sinatra) | Ready |
| [bridge-server](bridge-server) | Standalone bridge server (Go) | Ready |

---

## Configuration Reference

### Widget Options

```javascript
PocketPing.init({
  // Required
  endpoint: 'https://yoursite.com/pocketping',

  // Branding
  operatorName: 'Acme Support',
  operatorAvatar: 'https://yoursite.com/avatar.png',
  welcomeMessage: 'Hi! How can we help?',

  // Appearance
  theme: 'auto',  // 'light', 'dark', or 'auto'
  primaryColor: '#6366f1',
  position: 'bottom-right',

  // Behavior
  autoOpenDelay: 0,  // ms before auto-opening (0 = disabled)
  soundEnabled: true,

  // Callbacks
  onOpen: () => console.log('Chat opened'),
  onMessage: (msg) => console.log('New message', msg),
});

// Widget API Methods
PocketPing.open();                              // Open chat
PocketPing.close();                             // Close chat
PocketPing.toggle();                            // Toggle chat
PocketPing.sendMessage('Hello!');               // Send message
PocketPing.trigger('event_name', { data });     // Trigger custom event
PocketPing.onEvent('event_name', handler);      // Subscribe to event
PocketPing.offEvent('event_name', handler);     // Unsubscribe
PocketPing.destroy();                           // Cleanup
```

See [Widget README](packages/widget/README.md) for all options.

### Backend Options (Python)

```python
pp = PocketPing(
    # Messages
    welcome_message="Hi! How can we help?",

    # AI
    ai_provider=OpenAIProvider(api_key="sk-..."),
    ai_takeover_delay=300,  # seconds
    ai_system_prompt="You are a helpful assistant for Acme Inc...",

    # Bridges
    bridges=[
        TelegramBridge(bot_token="...", forum_chat_id="..."),
        DiscordBridge(bot_token="...", channel_id=123),
        SlackBridge(bot_token="...", channel_id="..."),
    ],

    # Callbacks
    on_new_session=lambda s: print(f"New session: {s.id}"),
    on_message=lambda m, s: print(f"Message: {m.content}"),
    on_event=lambda e, s: print(f"Event: {e.name}"),  # Custom events
)

# Event API Methods
pp.on_event('clicked_pricing', handler)           # Subscribe to event
pp.off_event('clicked_pricing', handler)          # Unsubscribe
await pp.emit_event(session_id, 'show_offer', {}) # Send event to session
await pp.broadcast_event('announcement', {})       # Send to all sessions
```

See [Python SDK README](packages/sdk-python/README.md) for all options.

---

## Troubleshooting

### Widget not showing?

1. Check browser console for errors
2. Verify your endpoint URL is correct
3. Make sure your backend is running and accessible

### Not receiving Telegram notifications?

1. Make sure your bot token is correct
2. Check that the bot is an admin in your group
3. Verify the chat ID (should start with `-100` for supergroups)
4. Check your server logs for errors

### Messages not appearing in widget?

1. Open browser DevTools -> Network tab
2. Look for WebSocket connection to `/stream`
3. If failing, check your backend WebSocket setup

### AI not responding?

1. Verify your AI API key is correct
2. Check that `ai_takeover_delay` has passed
3. Look at server logs for API errors

---

## Development

### Quick Start (Docker)

The easiest way to get started is with Docker:

```bash
# Clone the repo
git clone https://github.com/Ruwad-io/pocketping
cd pocketping

# Start dev environment (demo + bridge + watchers)
make dev

# Services:
# - Demo:   http://localhost:3000
# - Bridge: http://localhost:3001
```

### Manual Setup

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run E2E tests (requires Playwright)
pnpm test:e2e
```

### Make Commands

```bash
make dev          # Start dev environment
make dev-docs     # Start with docs site (localhost:3002)
make test         # Run all SDK tests
make test-node    # Run Node.js SDK tests
make test-python  # Run Python SDK tests
make test-go      # Run Go SDK tests
make test-php     # Run PHP SDK tests
make test-ruby    # Run Ruby SDK tests
make clean        # Remove Docker containers
```

### Project Structure

```
pocketping/
├── packages/
│   ├── widget/          # Chat widget (Preact, ~15KB)
│   ├── cli/             # Interactive setup CLI
│   ├── sdk-node/        # Node.js SDK
│   ├── sdk-python/      # Python SDK
│   ├── sdk-go/          # Go SDK
│   ├── sdk-php/         # PHP SDK
│   └── sdk-ruby/        # Ruby SDK
├── bridge-server/       # Standalone bridge server (Go)
├── docs-site/           # Documentation (Docusaurus)
├── docker/              # Docker configs for dev
└── assets/              # Logo and branding
```

---

## Contributing

We welcome contributions! Here's how:

1. Fork the repo
2. Create a branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`pnpm test`)
5. Commit (`git commit -m 'Add amazing feature'`)
6. Push (`git push origin feature/amazing-feature`)
7. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## Philosophy

1. **Mobile-first** - Founders are on the go. Telegram/Discord in your pocket beats desktop dashboards.
2. **Protocol over platform** - Use any backend, any database. We're not a SaaS.
3. **AI as backup** - Humans first. AI catches what falls through.
4. **Open source** - Self-host everything. No vendor lock-in.

---

## License

MIT - Use it however you want.

---

<p align="center">
  Built with love for indie hackers, founders, and developers who care about their users.
</p>

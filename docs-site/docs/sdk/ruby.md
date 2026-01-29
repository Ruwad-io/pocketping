---
sidebar_position: 6
title: Ruby SDK
description: Backend integration with the PocketPing Ruby SDK
---

# Ruby SDK

Integrate PocketPing into your Ruby backend.

## Installation

```bash
gem install pocketping
```

Or add to your Gemfile:

```ruby
gem 'pocketping'
```

## Quick Start

### Rails

```ruby
# config/initializers/pocketping.rb
require 'pocketping'

POCKETPING = PocketPing.new(
  bridge_url: ENV['BRIDGE_URL'] || 'http://localhost:3001',
  welcome_message: 'Hi! How can we help?'
)

# config/routes.rb
Rails.application.routes.draw do
  mount POCKETPING.rack_app => '/pocketping'
end
```

### Sinatra

```ruby
require 'sinatra'
require 'pocketping'

pp = PocketPing.new(
  bridge_url: 'http://localhost:3001'
)

# Mount at /pocketping
use Rack::Builder do
  map '/pocketping' do
    run pp.rack_app
  end
end
```

### Rack

```ruby
# config.ru
require 'pocketping'

pp = PocketPing.new(
  bridge_url: 'http://localhost:3001'
)

map '/pocketping' do
  run pp.rack_app
end

map '/' do
  run MyApp
end
```

## Built-in Bridges

The SDK includes built-in bridges for Telegram, Discord, and Slack with automatic validation and helpful setup guides.

```ruby
require 'pocketping'

pp = PocketPing.new

# Add Telegram bridge
begin
  pp.add_bridge(PocketPing::TelegramBridge.new(
    bot_token: ENV['TELEGRAM_BOT_TOKEN'],
    chat_id: ENV['TELEGRAM_CHAT_ID']
  ))
rescue PocketPing::SetupError => e
  # Helpful error with setup guide
  puts e.formatted_guide
  exit 1
end

# Add Discord bridge (bot mode)
begin
  pp.add_bridge(PocketPing::DiscordBotBridge.new(
    bot_token: ENV['DISCORD_BOT_TOKEN'],
    channel_id: ENV['DISCORD_CHANNEL_ID']
  ))
rescue PocketPing::SetupError => e
  puts e.formatted_guide
  exit 1
end

# Add Slack bridge (bot mode)
begin
  pp.add_bridge(PocketPing::SlackBotBridge.new(
    bot_token: ENV['SLACK_BOT_TOKEN'],
    channel_id: ENV['SLACK_CHANNEL_ID']
  ))
rescue PocketPing::SetupError => e
  puts e.formatted_guide
  exit 1
end
```

### Validation Errors

If configuration is missing or invalid, you'll see a helpful setup guide:

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️  Discord Setup Required
├─────────────────────────────────────────────────────────────┤
│
│  Missing: bot_token
│
│  To set up Discord Bot mode:
│
│  1. Go to https://discord.com/developers/applications
│  2. Create a new application
│  3. Go to Bot → Add Bot → Reset Token
│  4. Copy the token and set DISCORD_BOT_TOKEN
│
│  Enable MESSAGE CONTENT INTENT in Bot settings!
│
│  📖 Full guide: https://pocketping.io/docs/discord
│
│  💡 Quick fix: npx @pocketping/cli init discord
│
└─────────────────────────────────────────────────────────────┘
```

### Bridge Modes

| Bridge | Mode | Class | Features |
|--------|------|-------|----------|
| Telegram | Bot | `TelegramBridge` | Send, edit, delete |
| Discord | Webhook | `DiscordWebhookBridge` | Send only |
| Discord | Bot | `DiscordBotBridge` | Send, edit, delete |
| Slack | Webhook | `SlackWebhookBridge` | Send only |
| Slack | Bot | `SlackBotBridge` | Send, edit, delete |

:::tip Bot vs Webhook
Use **Bot mode** for full bidirectional communication. Webhooks are simpler but only support sending messages.
:::

:::warning Discord Bot requires long-running server
**Discord bot mode** uses the Discord Gateway (WebSocket) to receive operator replies. This only works on **long-running servers** (Puma, Unicorn, etc.).

**Does NOT work with:**
- AWS Lambda
- Any serverless environment

**For serverless + Discord bidirectional:** Use the [Bridge Server](/bridges/docker) instead, or use `DiscordWebhookBridge` (send-only).
:::

:::info Telegram & Slack work with serverless
**Telegram** and **Slack** use HTTP webhooks (not WebSocket), so they work fully with serverless environments like Lambda, etc.
:::

---

## Configuration

```ruby
pp = PocketPing.new(
  # Bridge server URL (alternative to built-in bridges)
  bridge_url: 'http://localhost:3001',

  # Welcome message for new visitors
  welcome_message: 'Hi! How can we help?',

  # Event handlers
  on_session_start: ->(session) {
    Rails.logger.info "New session: #{session.id}"
  },
  on_message: ->(session, message) {
    Rails.logger.info "Message: #{message.content}"
  },
  on_event: ->(session, event) {
    Rails.logger.info "Event: #{event.name}"
  },

  # Custom storage (optional)
  storage: PostgresStorage.new
)
```

## API

### Sessions

```ruby
# Get all active sessions
sessions = pp.get_sessions

# Get a specific session
session = pp.get_session('sess_xxx')

# Get session messages
messages = pp.get_messages('sess_xxx')

# Close a session
pp.close_session('sess_xxx')
```

### Messages

```ruby
# Send a message to a session
pp.send_message('sess_xxx',
  content: 'Hello from the server!',
  type: 'operator'
)
```

### Custom Events

```ruby
# Receive events from widget
pp = PocketPing.new(
  on_event: ->(session, event) {
    if event.name == 'clicked_pricing'
      # Track analytics, trigger automation, etc.
    end
  }
)

# Send events to widget
pp.emit_event('sess_xxx', 'show_offer',
  discount: 20,
  code: 'SAVE20'
)
```

## Custom Storage

Implement the storage interface for persistence:

```ruby
class PostgresStorage
  def initialize(connection_string)
    @conn = PG.connect(connection_string)
  end

  def create_session(session)
    @conn.exec_params(
      'INSERT INTO sessions (id, visitor_id, created_at) VALUES ($1, $2, $3)',
      [session[:id], session[:visitor_id], session[:created_at]]
    )
  end

  def get_session(id)
    result = @conn.exec_params('SELECT * FROM sessions WHERE id = $1', [id])
    result.first
  end

  def save_message(session_id, message)
    @conn.exec_params(
      'INSERT INTO messages (id, session_id, content, type, created_at) VALUES ($1, $2, $3, $4, $5)',
      [message[:id], session_id, message[:content], message[:type], message[:created_at]]
    )
  end

  def get_messages(session_id)
    result = @conn.exec_params(
      'SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at',
      [session_id]
    )
    result.to_a
  end
end
```

## User-Agent Filtering

Block bots and automated requests from creating chat sessions.

### Quick Setup

```ruby
require 'pocketping'

pp = PocketPing.new(
  ua_filter: PocketPing::UaFilterConfig.new(
    enabled: true,
    use_default_bots: true  # Block ~50 known bot patterns
  )
)
```

### Configuration Options

```ruby
pp = PocketPing.new(
  ua_filter: PocketPing::UaFilterConfig.new(
    enabled: true,
    mode: :blocklist,  # :blocklist | :allowlist | :both
    use_default_bots: true,
    blocklist: [
      'my-custom-scraper',
      'bad-bot',
      '/spam-\d+/',  # Regex pattern
    ],
    allowlist: [
      'my-monitoring-bot',
      '/internal-.*/',  # Regex: allow internal tools
    ],
    log_blocked: true,
    blocked_status_code: 403,
    blocked_message: 'Forbidden'
  )
)
```

### Manual Filtering

```ruby
require 'pocketping/user_agent_filter'

# Quick bot check
if PocketPing::UserAgentFilter.bot?(request.user_agent)
  render json: { error: 'Bots not allowed' }, status: :forbidden
  return
end

# Full filter check
result = PocketPing::UserAgentFilter.check_ua_filter(
  request.user_agent,
  PocketPing::UaFilterConfig.new(enabled: true, use_default_bots: true),
  { path: request.path }
)

unless result.allowed
  Rails.logger.warn "Blocked: #{result.reason}, pattern: #{result.matched_pattern}"
end
```

---

## Next Steps

- [Python SDK](/sdk/python) - Backend integration for Python
- [Node.js SDK](/sdk/nodejs) - Backend integration for Node.js
- [API Reference](/api) - Full REST API documentation

# PocketPing Ruby SDK

Ruby SDK for PocketPing - real-time customer chat with mobile notifications.

## Installation

Add this line to your application's Gemfile:

```ruby
gem 'pocketping'
```

And then execute:

```bash
bundle install
```

Or install it yourself:

```bash
gem install pocketping
```

## Quick Start with Rails

```ruby
# config/initializers/pocketping.rb
require 'pocketping'

POCKETPING = PocketPing::Client.new(
  welcome_message: "Hi! How can we help you today?",
  ai_takeover_delay: 300, # 5 minutes before AI takes over
  on_new_session: ->(session) {
    Rails.logger.info "New PocketPing session: #{session.id}"
  },
  on_message: ->(message, session) {
    Rails.logger.info "Message from #{message.sender}: #{message.content}"
  }
)

POCKETPING.start
```

```ruby
# app/controllers/pocketping_controller.rb
class PocketpingController < ApplicationController
  skip_before_action :verify_authenticity_token

  def connect
    request = PocketPing::ConnectRequest.new(
      visitor_id: params[:visitorId],
      session_id: params[:sessionId],
      metadata: build_metadata
    )

    response = POCKETPING.handle_connect(request)
    render json: response.to_h
  end

  def message
    request = PocketPing::SendMessageRequest.new(
      session_id: params[:sessionId],
      content: params[:content],
      sender: params[:sender]
    )

    response = POCKETPING.handle_message(request)
    render json: response.to_h
  rescue PocketPing::SessionNotFoundError
    render json: { error: 'Session not found' }, status: :not_found
  end

  def identify
    request = PocketPing::IdentifyRequest.new(
      session_id: params[:sessionId],
      identity: PocketPing::UserIdentity.new(
        id: params.dig(:identity, :id),
        email: params.dig(:identity, :email),
        name: params.dig(:identity, :name)
      )
    )

    response = POCKETPING.handle_identify(request)
    render json: response.to_h
  end

  private

  def build_metadata
    PocketPing::SessionMetadata.new(
      url: params.dig(:metadata, :url),
      user_agent: request.user_agent,
      ip: request.remote_ip
    )
  end
end
```

## Configuration Options

```ruby
PocketPing::Client.new(
  # Storage adapter (default: MemoryStorage)
  storage: PocketPing::Storage::MemoryStorage.new,

  # Notification bridges
  bridges: [MyTelegramBridge.new, MySlackBridge.new],

  # Welcome message for new sessions
  welcome_message: "Hi! How can we help?",

  # AI fallback settings
  ai_provider: MyAIProvider.new,
  ai_system_prompt: "You are a helpful assistant...",
  ai_takeover_delay: 300, # seconds

  # Callbacks
  on_new_session: ->(session) { ... },
  on_message: ->(message, session) { ... },
  on_event: ->(event, session) { ... },
  on_identify: ->(session) { ... },

  # Webhook configuration
  webhook_url: 'https://your-server.com/webhook',
  webhook_secret: 'your-hmac-secret',
  webhook_timeout: 5.0,

  # Version management
  min_widget_version: '0.2.0',
  latest_widget_version: '0.3.0',
  version_warning_message: 'Please upgrade your widget',
  version_upgrade_url: 'https://docs.example.com/upgrade',

  # IP filtering (see IP Filtering section below)
  ip_filter: PocketPing::IpFilterConfig.new(
    enabled: true,
    mode: :blocklist,
    blocklist: ['203.0.113.0/24']
  )
)
```

## IP Filtering

Block or allow specific IP addresses or CIDR ranges:

```ruby
pp = PocketPing::Client.new(
  ip_filter: PocketPing::IpFilterConfig.new(
    enabled: true,
    mode: :blocklist,  # :allowlist | :blocklist | :both
    blocklist: [
      '203.0.113.0/24',   # CIDR range
      '198.51.100.50',    # Single IP
    ],
    allowlist: [
      '10.0.0.0/8',       # Internal network
    ],
    log_blocked: true,    # Log blocked requests (default: true)
    blocked_status_code: 403,
    blocked_message: 'Forbidden'
  )
)

# Or with a custom filter proc
pp = PocketPing::Client.new(
  ip_filter: PocketPing::IpFilterConfig.new(
    enabled: true,
    mode: :blocklist,
    custom_filter: ->(ip, request) {
      # Return true to allow, false to block, nil to defer to list-based filtering
      return true if ip.start_with?('192.168.')  # Always allow local
      nil  # Use blocklist/allowlist
    }
  )
)
```

### Modes

| Mode | Behavior |
|------|----------|
| `:blocklist` | Block IPs in blocklist, allow all others (default) |
| `:allowlist` | Only allow IPs in allowlist, block all others |
| `:both` | Allowlist takes precedence, then blocklist is applied |

### CIDR Support

The SDK uses Ruby's built-in `IPAddr` class for CIDR matching:
- Single IP: `192.168.1.1` (treated as `/32`)
- Class C: `192.168.1.0/24` (256 addresses)
- Class B: `172.16.0.0/16` (65,536 addresses)
- Class A: `10.0.0.0/8` (16M addresses)

### Manual IP Check

```ruby
# Check IP manually
result = pp.check_ip_filter('192.168.1.50')
# result: IpFilterResult with #allowed?, #reason, #matched_rule

# Get client IP from request (Rack env)
client_ip = pp.get_client_ip(request.env)
# Checks: CF-Connecting-IP, X-Real-IP, X-Forwarded-For
```

### Rack Middleware

For Rails, Sinatra, or any Rack-compatible framework:

```ruby
# config.ru or application.rb
require 'pocketping'

use PocketPing::Middleware::IpFilterMiddleware, PocketPing::IpFilterConfig.new(
  enabled: true,
  mode: :blocklist,
  blocklist: ['203.0.113.0/24']
)

run MyApp
```

## Custom Events

PocketPing supports bidirectional custom events between your website and backend.

### Listening for Events (Widget -> Backend)

```ruby
pp = PocketPing::Client.new(
  # Using callback
  on_event: ->(event, session) {
    puts "Event #{event.name} from session #{session.id}"
  }
)

# Or using subscription
unsubscribe = pp.on_event('clicked_pricing') do |event, session|
  puts "User interested in: #{event.data['plan']}"
  # Notify sales team, log to analytics, etc.
end

# Subscribe to all events with wildcard
pp.on_event('*') do |event, session|
  puts "Event: #{event.name} | Data: #{event.data}"
end

# Unsubscribe when needed
unsubscribe.call
# or
pp.off_event('clicked_pricing', handler)
```

### Sending Events (Backend -> Widget)

```ruby
# Send to a specific session
pp.emit_event(
  'session-123',
  'show_offer',
  { discount: 20, code: 'SAVE20' }
)

# Broadcast to all connected sessions
pp.broadcast_event(
  'announcement',
  { message: 'New feature launched!' }
)
```

## Custom Storage

Implement the `Storage::Base` interface for persistence:

```ruby
class RedisStorage < PocketPing::Storage::Base
  def initialize(redis_client)
    @redis = redis_client
  end

  def create_session(session)
    @redis.set("session:#{session.id}", session.to_json)
  end

  def get_session(session_id)
    data = @redis.get("session:#{session_id}")
    return nil unless data
    # Parse and return Session object
  end

  def update_session(session)
    @redis.set("session:#{session.id}", session.to_json)
  end

  def delete_session(session_id)
    @redis.del("session:#{session_id}")
  end

  def save_message(message)
    @redis.rpush("messages:#{message.session_id}", message.to_json)
  end

  def get_messages(session_id, after: nil, limit: 50)
    # Implement message retrieval
  end

  def get_message(message_id)
    # Implement single message lookup
  end
end

pp = PocketPing::Client.new(storage: RedisStorage.new(Redis.new))
```

## Custom Bridges

Create bridges for Telegram, Discord, Slack, or any notification channel:

```ruby
class TelegramBridge < PocketPing::Bridge::Base
  def initialize(bot_token:, chat_id:)
    @bot_token = bot_token
    @chat_id = chat_id
  end

  def name
    "telegram"
  end

  def on_new_session(session)
    send_telegram("New visitor from #{session.metadata&.country}")
  end

  def on_message(message, session)
    return unless message.sender == PocketPing::Sender::VISITOR
    send_telegram("Message: #{message.content}")
  end

  def on_identity_update(session)
    return unless session.identity
    send_telegram("User identified: #{session.identity.email}")
  end

  private

  def send_telegram(text)
    # Implementation using Telegram Bot API
  end
end

pp = PocketPing::Client.new(
  bridges: [TelegramBridge.new(bot_token: ENV['BOT_TOKEN'], chat_id: ENV['CHAT_ID'])]
)
```

## Webhook Forwarding

Forward events to external services (Zapier, Make, n8n):

```ruby
pp = PocketPing::Client.new(
  webhook_url: 'https://hooks.zapier.com/...',
  webhook_secret: 'your-secret' # Optional HMAC signature
)
```

**Webhook payload:**

```json
{
  "event": {
    "name": "clicked_pricing",
    "data": { "plan": "pro" },
    "timestamp": "2026-01-22T00:00:00Z",
    "sessionId": "sess_abc123"
  },
  "session": {
    "id": "sess_abc123",
    "visitorId": "visitor_xyz",
    "metadata": { "url": "...", "country": "France" },
    "identity": { "id": "user-1", "email": "user@example.com" }
  },
  "sentAt": "2026-01-22T00:00:00Z"
}
```

**Verifying signatures:**

```ruby
def verify_signature(body, signature, secret)
  expected = OpenSSL::HMAC.hexdigest('SHA256', secret, body)
  signature == "sha256=#{expected}"
end
```

## Version Management

Check widget version compatibility:

```ruby
pp = PocketPing::Client.new(
  min_widget_version: '0.2.0',
  latest_widget_version: '0.3.0'
)

# In your controller
widget_version = request.headers['X-PocketPing-Version']
version_check = pp.check_widget_version(widget_version)

unless version_check.can_continue
  render json: { error: 'Widget version unsupported' }, status: 426
  return
end

# Set response headers
pp.get_version_headers(version_check).each do |key, value|
  response.headers[key] = value
end
```

## Operator Functions

```ruby
# Send a message as the operator
pp.send_operator_message(
  session_id,
  "Hello! I'm here to help.",
  source_bridge: "web",
  operator_name: "John"
)

# Set operator online status
pp.set_operator_online(true)

# Check operator status
puts pp.operator_online? # => true
```

## Reply Behavior

- **Telegram:** native replies when `reply_to` is set and Telegram message ID is known.
- **Discord:** native replies via `message_reference` when Discord message ID is known.
- **Slack:** quoted block (left bar) inside the thread.

## API Reference

### Client Methods

| Method | Description |
|--------|-------------|
| `handle_connect(request)` | Handle connection request |
| `handle_message(request)` | Handle message send |
| `handle_identify(request)` | Handle user identification |
| `handle_read(request)` | Handle read receipts |
| `handle_typing(request)` | Handle typing indicator |
| `handle_presence` | Get operator presence status |
| `get_session(session_id)` | Get session by ID |
| `send_operator_message(...)` | Send message as operator |
| `set_operator_online(online)` | Set operator status |
| `on_event(name, &handler)` | Subscribe to events |
| `emit_event(session_id, name, data)` | Emit event to session |
| `broadcast_event(name, data)` | Broadcast event to all |
| `check_widget_version(version)` | Check version compatibility |
| `add_bridge(bridge)` | Add a bridge dynamically |

### Models

- `Session` - Chat session
- `Message` - Chat message
- `UserIdentity` - User identity data
- `SessionMetadata` - Session metadata
- `CustomEvent` - Custom event
- `TrackedElement` - Tracked element config
- `ConnectRequest/Response` - Connection types
- `SendMessageRequest/Response` - Message types
- `IdentifyRequest/Response` - Identity types
- `ReadRequest/Response` - Read receipt types
- `VersionCheckResult` - Version check result

## Requirements

- Ruby 3.1 or higher

## Development

```bash
# Install dependencies
bundle install

# Run tests
bundle exec rspec

# Run linter
bundle exec rubocop
```

## License

MIT

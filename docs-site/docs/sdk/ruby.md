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

## Configuration

```ruby
pp = PocketPing.new(
  # Bridge server URL
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

## Next Steps

- [Python SDK](/sdk/python) - Backend integration for Python
- [Node.js SDK](/sdk/nodejs) - Backend integration for Node.js
- [API Reference](/api) - Full REST API documentation

# frozen_string_literal: true

require "securerandom"
require "time"
require "json"
require "openssl"
require "net/http"
require "uri"
require "set"

module PocketPing
  # Main PocketPing client class for handling chat sessions
  #
  # @example Basic usage
  #   pp = PocketPing::Client.new(
  #     welcome_message: "Hi! How can we help?",
  #     on_new_session: ->(session) { puts "New session!" }
  #   )
  #
  # @example With bridges and webhooks
  #   pp = PocketPing::Client.new(
  #     bridges: [TelegramBridge.new(token: "...")],
  #     webhook_url: "https://example.com/webhook",
  #     webhook_secret: "secret123"
  #   )
  class Client
    # @return [Storage::Base] The storage adapter
    attr_reader :storage

    # @return [Array<Bridge::Base>] The notification bridges
    attr_reader :bridges

    # @return [String, nil] Welcome message for new sessions
    attr_reader :welcome_message

    # @return [Integer] Seconds before AI takes over
    attr_reader :ai_takeover_delay

    # @return [String, nil] Webhook URL for event forwarding
    attr_reader :webhook_url

    # @return [String, nil] Minimum supported widget version
    attr_reader :min_widget_version

    # @return [String, nil] Latest available widget version
    attr_reader :latest_widget_version

    # @return [String, nil] Version upgrade URL
    attr_reader :version_upgrade_url

    # Initialize a new PocketPing client
    #
    # @param storage [Storage::Base, nil] Storage adapter (default: MemoryStorage)
    # @param bridges [Array<Bridge::Base>, nil] Notification bridges
    # @param ai_provider [Object, nil] AI provider for auto-responses
    # @param ai_system_prompt [String, nil] System prompt for AI
    # @param ai_takeover_delay [Integer] Seconds before AI takes over (default: 300)
    # @param welcome_message [String, nil] Welcome message for new sessions
    # @param on_new_session [Proc, nil] Callback for new sessions
    # @param on_message [Proc, nil] Callback for messages
    # @param on_event [Proc, nil] Callback for custom events
    # @param on_identify [Proc, nil] Callback for user identification
    # @param webhook_url [String, nil] Webhook URL for event forwarding
    # @param webhook_secret [String, nil] HMAC secret for webhook signatures
    # @param webhook_timeout [Float] Webhook request timeout (default: 5.0)
    # @param min_widget_version [String, nil] Minimum supported widget version
    # @param latest_widget_version [String, nil] Latest available widget version
    # @param version_warning_message [String, nil] Custom version warning message
    # @param version_upgrade_url [String, nil] URL to upgrade instructions
    def initialize(
      storage: nil,
      bridges: nil,
      ai_provider: nil,
      ai_system_prompt: nil,
      ai_takeover_delay: 300,
      welcome_message: nil,
      on_new_session: nil,
      on_message: nil,
      on_event: nil,
      on_identify: nil,
      webhook_url: nil,
      webhook_secret: nil,
      webhook_timeout: 5.0,
      min_widget_version: nil,
      latest_widget_version: nil,
      version_warning_message: nil,
      version_upgrade_url: nil
    )
      @storage = storage || Storage::MemoryStorage.new
      @bridges = bridges || []
      @ai_provider = ai_provider
      @ai_system_prompt = ai_system_prompt || default_ai_system_prompt
      @ai_takeover_delay = ai_takeover_delay
      @welcome_message = welcome_message

      @on_new_session = on_new_session
      @on_message = on_message
      @on_event_callback = on_event
      @on_identify_callback = on_identify

      @webhook_url = webhook_url
      @webhook_secret = webhook_secret
      @webhook_timeout = webhook_timeout

      @min_widget_version = min_widget_version
      @latest_widget_version = latest_widget_version
      @version_warning_message = version_warning_message
      @version_upgrade_url = version_upgrade_url || "https://docs.pocketping.io/widget/installation"

      @operator_online = false
      @last_operator_activity = {}
      @websocket_connections = {}
      @event_handlers = {}
      @mutex = Mutex.new
    end

    # ─────────────────────────────────────────────────────────────────
    # Lifecycle
    # ─────────────────────────────────────────────────────────────────

    # Start PocketPing (initialize bridges)
    #
    # @return [void]
    def start
      @bridges.each { |bridge| bridge.init(self) }
    end

    # Stop PocketPing gracefully
    #
    # @return [void]
    def stop
      @bridges.each(&:destroy)
    end

    # ─────────────────────────────────────────────────────────────────
    # Protocol Handlers
    # ─────────────────────────────────────────────────────────────────

    # Handle a connection request from the widget
    #
    # @param request [ConnectRequest] The connection request
    # @return [ConnectResponse] The connection response
    def handle_connect(request)
      session = nil

      # Try to resume existing session by session_id
      if request.session_id
        session = @storage.get_session(request.session_id)
      end

      # Try to find existing session by visitor_id
      session ||= @storage.get_session_by_visitor_id(request.visitor_id)

      # Create new session if needed
      if session.nil?
        session = Session.new(
          id: generate_id,
          visitor_id: request.visitor_id,
          created_at: Time.now.utc,
          last_activity: Time.now.utc,
          operator_online: @operator_online,
          ai_active: false,
          metadata: request.metadata,
          identity: request.identity
        )
        @storage.create_session(session)

        # Notify bridges
        notify_bridges_new_session(session)

        # Callback
        @on_new_session&.call(session)
      else
        needs_update = false

        # Update metadata if provided
        if request.metadata
          if session.metadata
            # Preserve server-side fields
            request.metadata.ip ||= session.metadata.ip
            request.metadata.country ||= session.metadata.country
            request.metadata.city ||= session.metadata.city
          end
          session.metadata = request.metadata
          needs_update = true
        end

        # Update identity if provided
        if request.identity
          session.identity = request.identity
          needs_update = true
        end

        if needs_update
          session.last_activity = Time.now.utc
          @storage.update_session(session)
        end
      end

      # Get existing messages
      messages = @storage.get_messages(session.id)

      ConnectResponse.new(
        session_id: session.id,
        visitor_id: session.visitor_id,
        operator_online: @operator_online,
        welcome_message: @welcome_message,
        messages: messages
      )
    end

    # Handle a message from visitor or operator
    #
    # @param request [SendMessageRequest] The message request
    # @return [SendMessageResponse] The message response
    # @raise [SessionNotFoundError] If session not found
    def handle_message(request)
      request.validate!

      session = @storage.get_session(request.session_id)
      raise SessionNotFoundError, "Session not found" unless session

      message = Message.new(
        id: generate_id,
        session_id: request.session_id,
        content: request.content,
        sender: request.sender,
        timestamp: Time.now.utc,
        reply_to: request.reply_to
      )

      @storage.save_message(message)

      # Update session activity
      session.last_activity = Time.now.utc
      @storage.update_session(session)

      # Track operator activity
      if request.sender == Sender::OPERATOR
        @mutex.synchronize do
          @last_operator_activity[request.session_id] = Time.now
        end

        # If operator responds, disable AI for this session
        if session.ai_active
          session.ai_active = false
          @storage.update_session(session)
        end
      end

      # Notify bridges (only for visitor messages)
      if request.sender == Sender::VISITOR
        notify_bridges_message(message, session)
      end

      # Broadcast to WebSocket clients
      broadcast_to_session(
        request.session_id,
        WebSocketEvent.new(type: "message", data: message.to_h)
      )

      # Callback
      @on_message&.call(message, session)

      SendMessageResponse.new(
        message_id: message.id,
        timestamp: message.timestamp
      )
    end

    # Get messages for a session
    #
    # @param session_id [String] The session ID
    # @param after [String, nil] Return messages after this ID
    # @param limit [Integer] Maximum messages to return (max 100)
    # @return [Hash] { messages: Array, has_more: Boolean }
    def handle_get_messages(session_id, after: nil, limit: 50)
      limit = [limit, 100].min
      messages = @storage.get_messages(session_id, after: after, limit: limit + 1)

      {
        messages: messages.first(limit).map(&:to_h),
        has_more: messages.length > limit
      }
    end

    # Handle typing indicator
    #
    # @param request [TypingRequest] The typing request
    # @return [Hash] { ok: true }
    def handle_typing(request)
      broadcast_to_session(
        request.session_id,
        WebSocketEvent.new(
          type: "typing",
          data: {
            sessionId: request.session_id,
            sender: request.sender,
            isTyping: request.is_typing
          }
        )
      )
      { ok: true }
    end

    # Get operator presence status
    #
    # @return [PresenceResponse]
    def handle_presence
      PresenceResponse.new(
        online: @operator_online,
        ai_enabled: !@ai_provider.nil?,
        ai_active_after: @ai_takeover_delay
      )
    end

    # Handle message read/delivered status update
    #
    # @param request [ReadRequest] The read request
    # @return [ReadResponse]
    def handle_read(request)
      updated = 0
      now = Time.now.utc

      request.message_ids.each do |message_id|
        message = @storage.get_message(message_id)
        next unless message && message.session_id == request.session_id

        message.status = request.status
        if request.status == MessageStatus::DELIVERED
          message.delivered_at = now
        elsif request.status == MessageStatus::READ
          message.delivered_at ||= now
          message.read_at = now
        end

        @storage.save_message(message)
        updated += 1
      end

      # Broadcast read event
      if updated > 0
        broadcast_data = {
          sessionId: request.session_id,
          messageIds: request.message_ids,
          status: request.status
        }

        if request.status == MessageStatus::DELIVERED
          broadcast_data[:deliveredAt] = now.iso8601
        elsif request.status == MessageStatus::READ
          broadcast_data[:readAt] = now.iso8601
          broadcast_data[:deliveredAt] = now.iso8601
        end

        broadcast_to_session(
          request.session_id,
          WebSocketEvent.new(type: "read", data: broadcast_data)
        )

        # Notify bridges
        session = @storage.get_session(request.session_id)
        notify_bridges_read(request.session_id, request.message_ids, request.status, session) if session
      end

      ReadResponse.new(updated: updated)
    end

    # ─────────────────────────────────────────────────────────────────
    # User Identity
    # ─────────────────────────────────────────────────────────────────

    # Handle user identification from widget
    #
    # @param request [IdentifyRequest] The identify request
    # @return [IdentifyResponse]
    # @raise [ValidationError] If identity.id is missing
    # @raise [SessionNotFoundError] If session not found
    def handle_identify(request)
      request.validate!

      session = @storage.get_session(request.session_id)
      raise SessionNotFoundError, "Session not found" unless session

      # Update session with identity
      session.identity = request.identity
      session.last_activity = Time.now.utc
      @storage.update_session(session)

      # Notify bridges
      notify_bridges_identity(session)

      # Callback
      @on_identify_callback&.call(session)

      # Forward to webhook
      forward_identity_to_webhook(session) if @webhook_url

      IdentifyResponse.new(ok: true)
    end

    # Get a session by ID
    #
    # @param session_id [String] The session ID
    # @return [Session, nil]
    def get_session(session_id)
      @storage.get_session(session_id)
    end

    # ─────────────────────────────────────────────────────────────────
    # Operator Actions
    # ─────────────────────────────────────────────────────────────────

    # Send a message as the operator
    #
    # @param session_id [String] The session to send to
    # @param content [String] Message content
    # @param source_bridge [String, nil] Name of the bridge that originated this message
    # @param operator_name [String, nil] Name of the operator
    # @return [Message]
    def send_operator_message(session_id, content, source_bridge: nil, operator_name: nil)
      response = handle_message(
        SendMessageRequest.new(
          session_id: session_id,
          content: content,
          sender: Sender::OPERATOR
        )
      )

      message = Message.new(
        id: response.message_id,
        session_id: session_id,
        content: content,
        sender: Sender::OPERATOR,
        timestamp: response.timestamp
      )

      # Notify bridges for cross-bridge sync
      session = @storage.get_session(session_id)
      if session
        notify_bridges_operator_message(message, session, source_bridge || "api", operator_name)
      end

      message
    end

    # Set operator online/offline status
    #
    # @param online [Boolean] Whether operator is online
    # @return [void]
    def set_operator_online(online)
      @operator_online = online

      # Get session IDs while holding the lock, then broadcast outside the lock
      session_ids = @mutex.synchronize { @websocket_connections.keys.dup }

      session_ids.each do |session_id|
        broadcast_to_session(
          session_id,
          WebSocketEvent.new(type: "presence", data: { online: online })
        )
      end
    end

    # Check if operator is online
    #
    # @return [Boolean]
    def operator_online?
      @operator_online
    end

    alias is_operator_online operator_online?

    # ─────────────────────────────────────────────────────────────────
    # WebSocket Management
    # ─────────────────────────────────────────────────────────────────

    # Register a WebSocket connection for a session
    #
    # @param session_id [String] The session ID
    # @param websocket [Object] The WebSocket connection
    # @return [void]
    def register_websocket(session_id, websocket)
      @mutex.synchronize do
        @websocket_connections[session_id] ||= Set.new
        @websocket_connections[session_id] << websocket
      end
    end

    # Unregister a WebSocket connection
    #
    # @param session_id [String] The session ID
    # @param websocket [Object] The WebSocket connection
    # @return [void]
    def unregister_websocket(session_id, websocket)
      @mutex.synchronize do
        @websocket_connections[session_id]&.delete(websocket)
      end
    end

    # Broadcast an event to all WebSocket connections for a session
    #
    # @param session_id [String] The session ID
    # @param event [WebSocketEvent] The event to broadcast
    # @return [void]
    def broadcast_to_session(session_id, event)
      connections = @mutex.synchronize { @websocket_connections[session_id]&.dup }
      return unless connections

      message = event.to_json
      dead_connections = []

      connections.each do |ws|
        ws.send_text(message)
      rescue StandardError
        dead_connections << ws
      end

      # Clean up dead connections
      dead_connections.each { |ws| unregister_websocket(session_id, ws) }
    end

    # ─────────────────────────────────────────────────────────────────
    # Custom Events
    # ─────────────────────────────────────────────────────────────────

    # Subscribe to a custom event
    #
    # @param event_name [String] Event name or '*' for all events
    # @param handler [Proc] Handler to call when event is received
    # @return [Proc] Unsubscribe function
    #
    # @example
    #   unsubscribe = pp.on_event('clicked_pricing') do |event, session|
    #     puts "User clicked pricing: #{event.data}"
    #   end
    #
    #   # Later...
    #   unsubscribe.call
    def on_event(event_name, &handler)
      @mutex.synchronize do
        @event_handlers[event_name] ||= Set.new
        @event_handlers[event_name] << handler
      end

      -> { off_event(event_name, handler) }
    end

    # Unsubscribe from a custom event
    #
    # @param event_name [String] The event name
    # @param handler [Proc] The handler to remove
    # @return [void]
    def off_event(event_name, handler)
      @mutex.synchronize do
        @event_handlers[event_name]&.delete(handler)
      end
    end

    # Emit a custom event to a specific session
    #
    # @param session_id [String] The session ID
    # @param event_name [String] The event name
    # @param data [Hash, nil] Optional payload
    # @return [void]
    def emit_event(session_id, event_name, data = nil)
      event = CustomEvent.new(
        name: event_name,
        data: data,
        timestamp: Time.now.utc,
        session_id: session_id
      )

      broadcast_to_session(
        session_id,
        WebSocketEvent.new(type: "event", data: event.to_h)
      )
    end

    # Broadcast a custom event to all connected sessions
    #
    # @param event_name [String] The event name
    # @param data [Hash, nil] Optional payload
    # @return [void]
    def broadcast_event(event_name, data = nil)
      # Get session IDs while holding the lock, then emit outside the lock
      session_ids = @mutex.synchronize { @websocket_connections.keys.dup }

      session_ids.each do |session_id|
        emit_event(session_id, event_name, data)
      end
    end

    # Handle an incoming custom event from the widget
    #
    # @param session_id [String] The session that sent the event
    # @param event [CustomEvent] The custom event
    # @return [void]
    def handle_custom_event(session_id, event)
      session = @storage.get_session(session_id)
      unless session
        warn "[PocketPing] Session #{session_id} not found for custom event"
        return
      end

      event.session_id = session_id

      # Call specific event handlers
      handlers = @mutex.synchronize { @event_handlers[event.name]&.dup }
      handlers&.each do |handler|
        handler.call(event, session)
      rescue StandardError => e
        warn "[PocketPing] Error in event handler for '#{event.name}': #{e.message}"
      end

      # Call wildcard handlers
      wildcard_handlers = @mutex.synchronize { @event_handlers["*"]&.dup }
      wildcard_handlers&.each do |handler|
        handler.call(event, session)
      rescue StandardError => e
        warn "[PocketPing] Error in wildcard event handler: #{e.message}"
      end

      # Call config callback
      @on_event_callback&.call(event, session)

      # Notify bridges
      notify_bridges_event(event, session)

      # Forward to webhook
      forward_to_webhook(event, session) if @webhook_url
    end

    # ─────────────────────────────────────────────────────────────────
    # Version Management
    # ─────────────────────────────────────────────────────────────────

    # Check widget version compatibility
    #
    # @param widget_version [String, nil] Version from X-PocketPing-Version header
    # @return [VersionCheckResult]
    def check_widget_version(widget_version)
      VersionChecker.check_version(
        widget_version,
        min_version: @min_widget_version,
        latest_version: @latest_widget_version,
        warning_message: @version_warning_message
      )
    end

    # Get HTTP headers for version information
    #
    # @param version_check [VersionCheckResult]
    # @return [Hash<String, String>]
    def get_version_headers(version_check)
      VersionChecker.get_version_headers(version_check)
    end

    # Send a version warning via WebSocket
    #
    # @param session_id [String] Session to send warning to
    # @param version_check [VersionCheckResult]
    # @param current_version [String] The widget's current version
    # @return [void]
    def send_version_warning(session_id, version_check, current_version)
      warning = VersionChecker.create_version_warning(
        version_check,
        current_version,
        upgrade_url: @version_upgrade_url
      )

      broadcast_to_session(
        session_id,
        WebSocketEvent.new(type: "version_warning", data: warning.to_h)
      )
    end

    # ─────────────────────────────────────────────────────────────────
    # Bridge Management
    # ─────────────────────────────────────────────────────────────────

    # Add a bridge dynamically
    #
    # @param bridge [Bridge::Base] The bridge to add
    # @return [void]
    def add_bridge(bridge)
      bridge.init(self)
      @bridges << bridge
    end

    private

    # ─────────────────────────────────────────────────────────────────
    # Bridge Notifications
    # ─────────────────────────────────────────────────────────────────

    def notify_bridges_new_session(session)
      @bridges.each do |bridge|
        bridge.on_new_session(session)
      rescue StandardError => e
        warn "[PocketPing] Bridge #{bridge.name} error: #{e.message}"
      end
    end

    def notify_bridges_message(message, session)
      @bridges.each do |bridge|
        bridge.on_visitor_message(message, session)
      rescue StandardError => e
        warn "[PocketPing] Bridge #{bridge.name} error: #{e.message}"
      end
    end

    def notify_bridges_operator_message(message, session, source_bridge, operator_name)
      @bridges.each do |bridge|
        bridge.on_operator_message(message, session, source_bridge, operator_name)
      rescue StandardError => e
        warn "[PocketPing] Bridge #{bridge.name} sync error: #{e.message}"
      end
    end

    def notify_bridges_read(session_id, message_ids, status, session)
      @bridges.each do |bridge|
        bridge.on_message_read(session_id, message_ids, status, session)
      rescue StandardError => e
        warn "[PocketPing] Bridge #{bridge.name} read notification error: #{e.message}"
      end
    end

    def notify_bridges_event(event, session)
      @bridges.each do |bridge|
        bridge.on_custom_event(event, session)
      rescue StandardError => e
        warn "[PocketPing] Bridge #{bridge.name} error on custom event: #{e.message}"
      end
    end

    def notify_bridges_identity(session)
      @bridges.each do |bridge|
        bridge.on_identity_update(session)
      rescue StandardError => e
        warn "[PocketPing] Bridge #{bridge.name} identity notification error: #{e.message}"
      end
    end

    # ─────────────────────────────────────────────────────────────────
    # Webhook Forwarding
    # ─────────────────────────────────────────────────────────────────

    def forward_to_webhook(event, session)
      return unless @webhook_url

      payload = {
        event: {
          name: event.name,
          data: event.data,
          timestamp: event.timestamp&.iso8601,
          sessionId: event.session_id
        },
        session: {
          id: session.id,
          visitorId: session.visitor_id,
          metadata: session.metadata&.to_h,
          identity: session.identity&.to_h
        },
        sentAt: Time.now.utc.iso8601
      }

      send_webhook(payload)
    end

    def forward_identity_to_webhook(session)
      return unless @webhook_url && session.identity

      event = CustomEvent.new(
        name: "identify",
        data: session.identity.to_h,
        timestamp: Time.now.utc,
        session_id: session.id
      )

      forward_to_webhook(event, session)
    end

    def send_webhook(payload)
      Thread.new do
        body = payload.to_json
        uri = URI.parse(@webhook_url)

        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = uri.scheme == "https"
        http.open_timeout = @webhook_timeout
        http.read_timeout = @webhook_timeout

        request = Net::HTTP::Post.new(uri.request_uri)
        request["Content-Type"] = "application/json"

        # Add HMAC signature if secret is configured
        if @webhook_secret
          signature = OpenSSL::HMAC.hexdigest("SHA256", @webhook_secret, body)
          request["X-PocketPing-Signature"] = "sha256=#{signature}"
        end

        request.body = body

        response = http.request(request)
        unless response.is_a?(Net::HTTPSuccess)
          warn "[PocketPing] Webhook returned #{response.code}: #{response.body}"
        end
      rescue Net::OpenTimeout, Net::ReadTimeout
        warn "[PocketPing] Webhook timed out after #{@webhook_timeout}s"
      rescue StandardError => e
        warn "[PocketPing] Webhook error: #{e.message}"
      end
    end

    # ─────────────────────────────────────────────────────────────────
    # Utilities
    # ─────────────────────────────────────────────────────────────────

    def generate_id
      timestamp = (Time.now.to_f * 1000).to_i.to_s(16)
      random_part = SecureRandom.hex(4)
      "#{timestamp}-#{random_part}"
    end

    def default_ai_system_prompt
      "You are a helpful customer support assistant. " \
        "Be friendly, concise, and helpful. " \
        "If you don't know something, say so and offer to connect them with a human."
    end
  end
end

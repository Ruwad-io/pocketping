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
    # Maximum allowed attachment size in bytes (10 MiB)
    MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

    # Default list of MIME types accepted for upload
    DEFAULT_ALLOWED_MIME_TYPES = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/zip",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "video/mp4",
      "audio/mpeg"
    ].freeze

    # Default base URL used to build presigned upload/access URLs
    DEFAULT_UPLOAD_BASE_URL = "https://uploads.pocketping.local"

    # How long a presigned upload URL remains valid, in seconds (15 minutes)
    UPLOAD_URL_TTL_SECONDS = 900

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

    # @return [IpFilterConfig, nil] IP filter configuration
    attr_reader :ip_filter

    # @return [Integer] Maximum allowed attachment size in bytes
    attr_reader :max_attachment_size

    # @return [Array<String>] Allowed MIME types for uploads
    attr_reader :allowed_mime_types

    # @return [String] Base URL used to build presigned upload/access URLs
    attr_reader :upload_base_url

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
    # @param on_csat [Proc, nil] Callback when a visitor submits a CSAT rating
    # @param webhook_url [String, nil] Webhook URL for event forwarding
    # @param webhook_secret [String, nil] HMAC secret for webhook signatures
    # @param webhook_timeout [Float] Webhook request timeout (default: 5.0)
    # @param min_widget_version [String, nil] Minimum supported widget version
    # @param latest_widget_version [String, nil] Latest available widget version
    # @param version_warning_message [String, nil] Custom version warning message
    # @param version_upgrade_url [String, nil] URL to upgrade instructions
    # @param ip_filter [IpFilterConfig, Hash, nil] IP filtering configuration
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
      on_csat: nil,
      webhook_url: nil,
      webhook_secret: nil,
      webhook_timeout: 5.0,
      min_widget_version: nil,
      latest_widget_version: nil,
      version_warning_message: nil,
      version_upgrade_url: nil,
      ip_filter: nil,
      max_attachment_size: MAX_ATTACHMENT_SIZE,
      allowed_mime_types: DEFAULT_ALLOWED_MIME_TYPES,
      upload_base_url: DEFAULT_UPLOAD_BASE_URL
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
      @on_csat_callback = on_csat

      @webhook_url = webhook_url
      @webhook_secret = webhook_secret
      @webhook_timeout = webhook_timeout

      @min_widget_version = min_widget_version
      @latest_widget_version = latest_widget_version
      @version_warning_message = version_warning_message
      @version_upgrade_url = version_upgrade_url || "https://docs.pocketping.io/widget/installation"

      # IP filtering - accept Hash or IpFilterConfig
      @ip_filter = if ip_filter.is_a?(Hash)
                     IpFilterConfig.from_hash(ip_filter)
                   else
                     ip_filter
                   end

      # File attachment configuration
      @max_attachment_size = max_attachment_size
      @allowed_mime_types = allowed_mime_types
      @upload_base_url = upload_base_url

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
    # IP Filtering
    # ─────────────────────────────────────────────────────────────────

    # Check if an IP address is allowed by the filter
    #
    # @param ip [String] The IP address to check
    # @param request_info [Hash, nil] Additional request information
    # @return [IpFilterResult]
    def check_ip_filter(ip, request_info = nil)
      IpFilter.check_ip_filter(ip, @ip_filter, request_info)
    end

    # Check IP filter and return a blocked response if not allowed
    #
    # @param ip [String] The IP address to check
    # @param request_info [Hash, nil] Additional request information
    # @return [IpFilterResult]
    def check_ip_filter_with_logging(ip, request_info = nil)
      result = check_ip_filter(ip, request_info)
      IpFilter.log_filter_event(@ip_filter, result, ip, request_info) unless result.allowed
      result
    end

    # Get client IP from a Rack request
    #
    # @param request [Rack::Request] The Rack request
    # @return [String] The client IP address
    def get_client_ip(request)
      IpFilter.get_client_ip(request)
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

      # Link any uploaded attachments to this message BEFORE persisting and
      # notifying bridges so the broadcast and bridges see the attachments.
      message.attachments = link_attachments(request.attachment_ids, message)

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

      # AI fallback: when the operator is offline and takeover is due, let the
      # configured AI provider answer the visitor automatically.
      if request.sender == Sender::VISITOR
        maybe_ai_respond(session)
      end

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

    # Handle editing a visitor's message
    #
    # @param request [EditMessageRequest] The edit request
    # @return [EditMessageResponse]
    # @raise [ValidationError] If content is empty or too long
    # @raise [SessionNotFoundError] If session not found
    # @raise [MessageNotFoundError] If message not found
    # @raise [UnauthorizedError] If message doesn't belong to visitor
    def handle_edit_message(request)
      request.validate!

      session = @storage.get_session(request.session_id)
      raise SessionNotFoundError, "Session not found" unless session

      message = @storage.get_message(request.message_id)
      raise MessageNotFoundError, "Message not found" unless message

      # Verify message belongs to this session
      raise MessageNotFoundError, "Message not found" unless message.session_id == request.session_id

      # Only visitors can edit their own messages
      raise UnauthorizedError, "Unauthorized: can only edit own messages" unless message.sender == Sender::VISITOR

      # Cannot edit deleted messages
      raise ValidationError, "Cannot edit deleted message" if message.deleted_at

      now = Time.now.utc
      message.content = request.content
      message.edited_at = now

      @storage.update_message(message)

      # Sync edit to bridges
      sync_edit_to_bridges(message, session)

      # Broadcast to WebSocket
      broadcast_to_session(
        request.session_id,
        WebSocketEvent.new(
          type: "message_edited",
          data: {
            messageId: request.message_id,
            content: request.content,
            editedAt: now.iso8601
          }
        )
      )

      EditMessageResponse.new(
        message: {
          id: message.id,
          content: message.content,
          editedAt: now.iso8601
        }
      )
    end

    # Handle deleting a visitor's message
    #
    # @param request [DeleteMessageRequest] The delete request
    # @return [DeleteMessageResponse]
    # @raise [SessionNotFoundError] If session not found
    # @raise [MessageNotFoundError] If message not found
    # @raise [UnauthorizedError] If message doesn't belong to visitor
    def handle_delete_message(request)
      session = @storage.get_session(request.session_id)
      raise SessionNotFoundError, "Session not found" unless session

      message = @storage.get_message(request.message_id)
      raise MessageNotFoundError, "Message not found" unless message

      # Verify message belongs to this session
      raise MessageNotFoundError, "Message not found" unless message.session_id == request.session_id

      # Only visitors can delete their own messages
      raise UnauthorizedError, "Unauthorized: can only delete own messages" unless message.sender == Sender::VISITOR

      # Sync delete to bridges BEFORE soft delete (we need bridge IDs)
      now = Time.now.utc
      sync_delete_to_bridges(message, session)

      # Soft delete the message
      message.deleted_at = now
      @storage.update_message(message)

      # Broadcast to WebSocket
      broadcast_to_session(
        request.session_id,
        WebSocketEvent.new(
          type: "message_deleted",
          data: {
            messageId: request.message_id,
            deletedAt: now.iso8601
          }
        )
      )

      DeleteMessageResponse.new(deleted: true)
    end

    # ─────────────────────────────────────────────────────────────────
    # File Attachments
    # ─────────────────────────────────────────────────────────────────

    # Handle a presigned upload URL request for a file attachment
    #
    # @param request [UploadRequest] The upload request
    # @return [UploadResponse] The presigned upload response
    # @raise [SessionNotFoundError] If the session is not found
    # @raise [ValidationError] If the MIME type is not allowed or the size is invalid
    def handle_upload_request(request)
      # Fail fast if the storage does not implement attachment persistence (the
      # base Storage methods are no-ops); otherwise the returned attachment id /
      # upload URL could never be completed.
      if @storage.method(:save_attachment).owner == Storage::Base
        raise ValidationError, "Storage does not support attachments"
      end

      session = @storage.get_session(request.session_id)
      raise SessionNotFoundError, "Session not found" unless session

      unless @allowed_mime_types.include?(request.mime_type)
        raise ValidationError, "Invalid mime type: #{request.mime_type}"
      end

      size = request.size
      if size.nil? || size <= 0 || size > @max_attachment_size
        raise ValidationError, "File too large: #{size} exceeds maximum of #{@max_attachment_size} bytes"
      end

      now = Time.now.utc
      id = generate_id
      attachment = Attachment.new(
        id: id,
        message_id: nil,
        filename: request.filename,
        mime_type: request.mime_type,
        size: size,
        url: "#{@upload_base_url}/#{id}",
        thumbnail_url: nil,
        status: AttachmentStatus::PENDING,
        created_at: now
      )

      @storage.save_attachment(attachment)

      UploadResponse.new(
        attachment_id: id,
        upload_url: "#{@upload_base_url}/#{id}",
        expires_at: now + UPLOAD_URL_TTL_SECONDS
      )
    end

    # Mark an attachment as ready once its upload has completed
    #
    # @param attachment_id [String] The attachment ID
    # @return [Attachment] The updated attachment
    # @raise [ValidationError] If the attachment is not found
    def handle_upload_complete(attachment_id)
      attachment = @storage.get_attachment(attachment_id)
      raise ValidationError, "Attachment not found: #{attachment_id}" unless attachment

      attachment.status = AttachmentStatus::READY
      @storage.update_attachment(attachment)
      attachment
    end

    # Mark an attachment as failed if its upload could not be completed
    #
    # @param attachment_id [String] The attachment ID
    # @return [Attachment] The updated attachment
    # @raise [ValidationError] If the attachment is not found
    def handle_upload_failed(attachment_id)
      attachment = @storage.get_attachment(attachment_id)
      raise ValidationError, "Attachment not found: #{attachment_id}" unless attachment

      attachment.status = AttachmentStatus::FAILED
      @storage.update_attachment(attachment)
      attachment
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
    # CSAT (post-conversation satisfaction rating)
    # ─────────────────────────────────────────────────────────────────

    # Ask the visitor to rate the conversation. Sets the session's CSAT request
    # state and pushes a `csat_request` event so the widget shows the rating
    # card. Typically called from an operator command or after a resolved
    # conversation.
    #
    # @param session_id [String] The session ID
    # @return [Hash] { ok: true }
    # @raise [SessionNotFoundError] If the session is not found
    def request_csat(session_id)
      session = @storage.get_session(session_id)
      raise SessionNotFoundError, "Session not found" unless session

      session.csat_pending = true
      session.csat_requested_at = Time.now.utc
      @storage.update_session(session)

      broadcast_to_session(
        session_id,
        WebSocketEvent.new(
          type: "csat_request",
          data: { requestedAt: session.csat_requested_at.iso8601 }
        )
      )

      { ok: true }
    end

    # Handle a visitor's CSAT submission. Stores the score, clears the pending
    # flag, notifies bridges with a one-liner, fires the `csat_submitted`
    # webhook, and runs the `on_csat` callback. Idempotent once a rating exists.
    #
    # @param request [CsatRequest] The CSAT submission
    # @return [CsatResponse]
    # @raise [SessionNotFoundError] If the session is not found
    # @raise [ValidationError] If the score is not an integer 1..5
    def handle_csat(request)
      session = @storage.get_session(request.session_id)
      raise SessionNotFoundError, "Session not found" unless session

      validate_csat_score!(request.score)
      return CsatResponse.new(ok: true, already_rated: true) if session.csat_responded_at

      comment = normalize_csat_comment(request.comment)

      session.csat_pending = false
      session.csat_score = request.score
      session.csat_comment = comment
      session.csat_responded_at = Time.now.utc
      @storage.update_session(session)

      notify_bridges_csat(session, request.score, comment)
      forward_csat_to_webhook(session, request.score, comment) if @webhook_url
      @on_csat_callback&.call(session, { score: request.score, comment: comment })

      CsatResponse.new(ok: true)
    end

    # ─────────────────────────────────────────────────────────────────
    # Stats
    # ─────────────────────────────────────────────────────────────────

    # Compute mini support stats over your storage for a time window.
    # Requires the storage adapter to implement `list_sessions`.
    #
    # @param from [Time, nil] Window start (default: 7 days ago)
    # @param to [Time, nil] Window end (default: now)
    # @return [SdkStats]
    # @raise [PocketPing::Error] If the storage cannot list sessions
    def get_stats(from: nil, to: nil)
      unless @storage.respond_to?(:list_sessions) &&
             @storage.method(:list_sessions).owner != Storage::Base
        raise Error,
              "get_stats requires Storage#list_sessions. The bundled MemoryStorage " \
              "implements it; add it to your custom storage adapter to use stats."
      end

      to ||= Time.now.utc
      from ||= to - (7 * 24 * 60 * 60)

      sessions = @storage.list_sessions(since: from)
      entries = sessions.map do |session|
        { session: session, messages: @storage.get_messages(session.id, limit: 1000) }
      end

      Stats.compute_stats(entries, from: from, to: to)
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
      bridge_ids = nil
      @bridges.each do |bridge|
        result = bridge.on_visitor_message(message, session)
        platform_id = result.respond_to?(:message_id) ? result.message_id : nil
        next unless platform_id

        ids = bridge_ids_for(bridge, platform_id)
        next unless ids

        bridge_ids = bridge_ids ? bridge_ids.merge_with(ids) : ids
      rescue StandardError => e
        warn "[PocketPing] Bridge #{bridge.name} error: #{e.message}"
      end

      return unless bridge_ids && @storage.respond_to?(:save_bridge_message_ids)

      @storage.save_bridge_message_ids(message.id, bridge_ids)
    end

    # Build a BridgeMessageIds for a single bridge result, keyed by platform.
    def bridge_ids_for(bridge, platform_message_id)
      case bridge.name
      when /\Atelegram/ then BridgeMessageIds.new(telegram_message_id: platform_message_id.to_i)
      when /\Adiscord/ then BridgeMessageIds.new(discord_message_id: platform_message_id.to_s)
      when /\Aslack/ then BridgeMessageIds.new(slack_message_ts: platform_message_id.to_s)
      end
    end

    # Resolve the platform-specific message ID for a bridge from stored IDs.
    def platform_message_id_for(bridge, bridge_ids)
      case bridge.name
      when /\Atelegram/ then bridge_ids.telegram_message_id
      when /\Adiscord/ then bridge_ids.discord_message_id
      when /\Aslack/ then bridge_ids.slack_message_ts
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

    # Notify bridges of a CSAT rating with a one-line caption.
    def notify_bridges_csat(session, score, comment)
      caption = "⭐ #{csat_face(score)} #{score}/5"
      caption += " — \"#{comment}\"" if comment
      @bridges.each do |bridge|
        bridge.notify_disconnect(session, caption)
      rescue StandardError => e
        warn "[PocketPing] Bridge #{bridge.name} CSAT notification error: #{e.message}"
      end
    end

    # Emoji face for a 1..5 score (matches the widget card and SaaS bridge notif).
    def csat_face(score)
      faces = ["😡", "😕", "😐", "🙂", "😍"]
      faces[score.round.clamp(1, 5) - 1]
    end

    # Validate that a CSAT score is an integer in 1..5.
    def validate_csat_score!(score)
      return if score.is_a?(Integer) && score >= 1 && score <= 5

      raise ValidationError, "CSAT score must be an integer 1-5"
    end

    # Strip a CSAT comment and coerce a blank/nil comment to nil.
    def normalize_csat_comment(comment)
      stripped = comment&.strip
      stripped unless stripped.nil? || stripped.empty?
    end

    def sync_edit_to_bridges(message, session)
      bridge_ids = stored_bridge_ids(message.id)
      return unless bridge_ids

      @bridges.each do |bridge|
        next unless bridge.respond_to?(:on_message_edit)

        platform_id = platform_message_id_for(bridge, bridge_ids)
        next unless platform_id

        bridge.on_message_edit(message, session, platform_id)
      rescue StandardError => e
        warn "[PocketPing] Bridge #{bridge.name} edit sync error: #{e.message}"
      end
    end

    def sync_delete_to_bridges(message, session)
      bridge_ids = stored_bridge_ids(message.id)
      return unless bridge_ids

      @bridges.each do |bridge|
        next unless bridge.respond_to?(:on_message_delete)

        platform_id = platform_message_id_for(bridge, bridge_ids)
        next unless platform_id

        bridge.on_message_delete(message, session, platform_id)
      rescue StandardError => e
        warn "[PocketPing] Bridge #{bridge.name} delete sync error: #{e.message}"
      end
    end

    def stored_bridge_ids(message_id)
      return nil unless @storage.respond_to?(:get_bridge_message_ids)

      @storage.get_bridge_message_ids(message_id)
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

    # Fire a `csat_submitted` webhook (same `{ type, data, sentAt }` shape as SaaS).
    def forward_csat_to_webhook(session, score, comment)
      return unless @webhook_url

      payload = {
        type: "csat_submitted",
        data: {
          sessionId: session.id,
          score: score,
          comment: comment,
          respondedAt: (session.csat_responded_at || Time.now.utc).iso8601
        },
        sentAt: Time.now.utc.iso8601
      }

      send_webhook(payload)
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
    # Attachments
    # ─────────────────────────────────────────────────────────────────

    # Link previously uploaded attachments to a message and return them.
    #
    # @param attachment_ids [Array<String>, nil] IDs of attachments to link
    # @param message [Message] The message they belong to
    # @return [Array<Attachment>] The linked attachments
    def link_attachments(attachment_ids, message)
      return [] if attachment_ids.nil? || attachment_ids.empty?
      return [] unless @storage.respond_to?(:get_attachment)

      attachment_ids.each_with_object([]) do |attachment_id, linked|
        attachment = @storage.get_attachment(attachment_id)
        next unless attachment

        attachment.message_id = message.id
        @storage.update_attachment(attachment)
        linked << attachment
      end
    end

    # ─────────────────────────────────────────────────────────────────
    # AI Fallback
    # ─────────────────────────────────────────────────────────────────

    # Maybe generate an AI reply for a visitor message when the operator is
    # offline and takeover is due. Errors are logged and never propagate so
    # they cannot break message handling.
    #
    # Triggers when ALL of the following hold:
    #   1. an AI provider is configured
    #   2. the operator is not online
    #   3. takeover is due (delay <= 0, or enough time has elapsed since the
    #      last operator activity for the session, or the operator never showed)
    #
    # @param session [Session] The session that just received a visitor message
    # @return [void]
    def maybe_ai_respond(session)
      return unless @ai_provider
      return if operator_online?
      return unless ai_takeover_due?(session.id)

      # Mark the session as AI-handled and persist.
      session.ai_active = true
      @storage.update_session(session)

      messages = @storage.get_messages(session.id)
      reply = @ai_provider.generate_response(messages, @ai_system_prompt)
      return if reply.nil? || reply.to_s.strip.empty?

      ai_message = Message.new(
        id: generate_id,
        session_id: session.id,
        content: reply,
        sender: Sender::AI,
        timestamp: Time.now.utc
      )
      @storage.save_message(ai_message)

      # Broadcast to WebSocket clients.
      broadcast_to_session(
        session.id,
        WebSocketEvent.new(type: "message", data: ai_message.to_h)
      )

      # Surface the AI reply on bridges (Telegram/etc.) via the operator path.
      notify_bridges_operator_message(ai_message, session, "ai", "AI")
    rescue StandardError => e
      warn "[PocketPing] AI fallback error: #{e.message}"
    end

    # Whether AI takeover is due for the given session.
    #
    # @param session_id [String]
    # @return [Boolean]
    def ai_takeover_due?(session_id)
      return true if @ai_takeover_delay <= 0

      last_activity = @mutex.synchronize { @last_operator_activity[session_id] }
      # No recorded operator activity -> operator never showed up -> due.
      return true if last_activity.nil?

      (Time.now - last_activity) >= @ai_takeover_delay
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

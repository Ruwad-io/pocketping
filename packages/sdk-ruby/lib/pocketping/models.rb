# frozen_string_literal: true

require "time"
require "json"

module PocketPing
  # Sender types for messages
  module Sender
    VISITOR = "visitor"
    OPERATOR = "operator"
    AI = "ai"

    ALL = [VISITOR, OPERATOR, AI].freeze

    def self.valid?(value)
      ALL.include?(value)
    end
  end

  # Message status types
  module MessageStatus
    SENDING = "sending"
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"

    ALL = [SENDING, SENT, DELIVERED, READ].freeze

    def self.valid?(value)
      ALL.include?(value)
    end
  end

  # Version check status types
  module VersionStatus
    OK = "ok"
    OUTDATED = "outdated"
    DEPRECATED = "deprecated"
    UNSUPPORTED = "unsupported"

    ALL = [OK, OUTDATED, DEPRECATED, UNSUPPORTED].freeze

    def self.valid?(value)
      ALL.include?(value)
    end
  end

  # Base model class with common functionality
  class Model
    class << self
      def attributes
        @attributes ||= []
      end

      def attribute(name, type: nil, default: nil, alias_name: nil)
        attributes << { name: name, type: type, default: default, alias_name: alias_name }

        attr_accessor name

        # Define alias accessor if specified
        if alias_name
          alias_method alias_name, name
          alias_method :"#{alias_name}=", :"#{name}="
        end
      end
    end

    def initialize(**attrs)
      self.class.attributes.each do |attr|
        value = attrs.key?(attr[:name]) ? attrs[attr[:name]] : nil
        value ||= attrs[attr[:alias_name]] if attr[:alias_name] && attrs.key?(attr[:alias_name])
        value = attr[:default].is_a?(Proc) ? attr[:default].call : attr[:default] if value.nil?
        instance_variable_set(:"@#{attr[:name]}", value)
      end
    end

    def to_h
      self.class.attributes.each_with_object({}) do |attr, hash|
        value = instance_variable_get(:"@#{attr[:name]}")
        key = attr[:alias_name] || attr[:name]
        hash[key] = serialize_value(value)
      end
    end

    def to_json(*args)
      to_h.to_json(*args)
    end

    private

    def serialize_value(value)
      case value
      when Time
        value.utc.iso8601
      when Model
        value.to_h
      when Array
        value.map { |v| serialize_value(v) }
      when Hash
        value.transform_values { |v| serialize_value(v) }
      else
        value
      end
    end
  end

  # User identity data from PocketPing.identify()
  #
  # @example
  #   identity = UserIdentity.new(
  #     id: "user-123",
  #     email: "user@example.com",
  #     name: "John Doe",
  #     plan: "pro"
  #   )
  class UserIdentity < Model
    attribute :id, type: String
    attribute :email, type: String
    attribute :name, type: String

    attr_accessor :custom_fields

    def initialize(id:, email: nil, name: nil, **custom_fields)
      super(id: id, email: email, name: name)
      @custom_fields = custom_fields
    end

    def to_h
      hash = super
      hash.merge(@custom_fields || {})
    end

    def [](key)
      return send(key) if respond_to?(key)

      @custom_fields&.[](key)
    end

    def []=(key, value)
      if respond_to?(:"#{key}=")
        send(:"#{key}=", value)
      else
        @custom_fields ||= {}
        @custom_fields[key] = value
      end
    end
  end

  # Metadata about the visitor's session
  class SessionMetadata < Model
    # Page info
    attribute :url, type: String
    attribute :referrer, type: String
    attribute :page_title, type: String, alias_name: :pageTitle

    # Client info
    attribute :user_agent, type: String, alias_name: :userAgent
    attribute :timezone, type: String
    attribute :language, type: String
    attribute :screen_resolution, type: String, alias_name: :screenResolution

    # Geo info (populated server-side)
    attribute :ip, type: String
    attribute :country, type: String
    attribute :city, type: String

    # Device info
    attribute :device_type, type: String, alias_name: :deviceType
    attribute :browser, type: String
    attribute :os, type: String
  end

  # A chat session with a visitor
  class Session < Model
    attribute :id, type: String
    attribute :visitor_id, type: String, alias_name: :visitorId
    attribute :created_at, type: Time, default: -> { Time.now.utc }, alias_name: :createdAt
    attribute :last_activity, type: Time, default: -> { Time.now.utc }, alias_name: :lastActivity
    attribute :operator_online, type: :boolean, default: false, alias_name: :operatorOnline
    attribute :ai_active, type: :boolean, default: false, alias_name: :aiActive
    attribute :metadata, type: SessionMetadata
    attribute :identity, type: UserIdentity
  end

  # A chat message
  class Message < Model
    attribute :id, type: String
    attribute :session_id, type: String, alias_name: :sessionId
    attribute :content, type: String
    attribute :sender, type: String
    attribute :timestamp, type: Time, default: -> { Time.now.utc }
    attribute :reply_to, type: String, alias_name: :replyTo
    attribute :metadata, type: Hash

    # Read receipt fields
    attribute :status, type: String, default: MessageStatus::SENT
    attribute :delivered_at, type: Time, alias_name: :deliveredAt
    attribute :read_at, type: Time, alias_name: :readAt
  end

  # Tracked element configuration (for SaaS auto-tracking)
  class TrackedElement < Model
    attribute :selector, type: String
    attribute :event, type: String, default: "click"
    attribute :name, type: String
    attribute :widget_message, type: String, alias_name: :widgetMessage
    attribute :data, type: Hash
  end

  # Options for trigger() method
  class TriggerOptions < Model
    attribute :widget_message, type: String, alias_name: :widgetMessage
  end

  # Custom event for bidirectional communication
  class CustomEvent < Model
    attribute :name, type: String
    attribute :data, type: Hash
    attribute :timestamp, type: Time, default: -> { Time.now.utc }
    attribute :session_id, type: String, alias_name: :sessionId
  end

  # WebSocket event structure
  class WebSocketEvent < Model
    attribute :type, type: String
    attribute :data, type: Hash
  end

  # Request/Response Models

  # Request to connect/create a session
  class ConnectRequest < Model
    attribute :visitor_id, type: String, alias_name: :visitorId
    attribute :session_id, type: String, alias_name: :sessionId
    attribute :metadata, type: SessionMetadata
    attribute :identity, type: UserIdentity
  end

  # Response after connecting
  class ConnectResponse < Model
    attribute :session_id, type: String, alias_name: :sessionId
    attribute :visitor_id, type: String, alias_name: :visitorId
    attribute :operator_online, type: :boolean, default: false, alias_name: :operatorOnline
    attribute :welcome_message, type: String, alias_name: :welcomeMessage
    attribute :messages, type: Array, default: -> { [] }
    attribute :tracked_elements, type: Array, alias_name: :trackedElements
  end

  # Request to send a message
  class SendMessageRequest < Model
    attribute :session_id, type: String, alias_name: :sessionId
    attribute :content, type: String
    attribute :sender, type: String
    attribute :reply_to, type: String, alias_name: :replyTo

    MAX_CONTENT_LENGTH = 4000

    def validate!
      raise ValidationError, "content is required" if content.nil? || content.empty?
      raise ValidationError, "content exceeds maximum length of #{MAX_CONTENT_LENGTH}" if content.length > MAX_CONTENT_LENGTH
      raise ValidationError, "invalid sender: #{sender}" unless Sender.valid?(sender)

      true
    end
  end

  # Response after sending a message
  class SendMessageResponse < Model
    attribute :message_id, type: String, alias_name: :messageId
    attribute :timestamp, type: Time
  end

  # Request to send typing indicator
  class TypingRequest < Model
    attribute :session_id, type: String, alias_name: :sessionId
    attribute :sender, type: String
    attribute :is_typing, type: :boolean, default: true, alias_name: :isTyping
  end

  # Request to mark messages as read/delivered
  class ReadRequest < Model
    attribute :session_id, type: String, alias_name: :sessionId
    attribute :message_ids, type: Array, alias_name: :messageIds
    attribute :status, type: String, default: MessageStatus::READ
  end

  # Response after marking messages as read
  class ReadResponse < Model
    attribute :updated, type: Integer
  end

  # Request to identify a user
  class IdentifyRequest < Model
    attribute :session_id, type: String, alias_name: :sessionId
    attribute :identity, type: UserIdentity

    def validate!
      raise ValidationError, "identity is required" if identity.nil?
      raise ValidationError, "identity.id is required" if identity.id.nil? || identity.id.empty?

      true
    end
  end

  # Response after identifying a user
  class IdentifyResponse < Model
    attribute :ok, type: :boolean, default: true
  end

  # Response for presence check
  class PresenceResponse < Model
    attribute :online, type: :boolean
    attribute :operators, type: Array
    attribute :ai_enabled, type: :boolean, default: false, alias_name: :aiEnabled
    attribute :ai_active_after, type: Integer, alias_name: :aiActiveAfter
  end

  # Result of checking widget version
  class VersionCheckResult < Model
    attribute :status, type: String
    attribute :message, type: String
    attribute :min_version, type: String, alias_name: :minVersion
    attribute :latest_version, type: String, alias_name: :latestVersion
    attribute :can_continue, type: :boolean, default: true, alias_name: :canContinue
  end

  # Version warning sent to widget
  class VersionWarning < Model
    attribute :severity, type: String # "info", "warning", "error"
    attribute :message, type: String
    attribute :current_version, type: String, alias_name: :currentVersion
    attribute :min_version, type: String, alias_name: :minVersion
    attribute :latest_version, type: String, alias_name: :latestVersion
    attribute :can_continue, type: :boolean, default: true, alias_name: :canContinue
    attribute :upgrade_url, type: String, alias_name: :upgradeUrl
  end

  # Payload sent to webhook URL
  class WebhookPayload < Model
    attribute :event, type: CustomEvent
    attribute :session, type: Hash
    attribute :sent_at, type: Time, alias_name: :sentAt
  end
end

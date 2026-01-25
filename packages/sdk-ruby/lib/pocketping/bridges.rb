# frozen_string_literal: true

module PocketPing
  module Bridge
    # Abstract base class for notification bridges
    #
    # Implement this interface to create custom bridges for
    # Telegram, Discord, Slack, or other notification channels.
    #
    # @abstract Subclass and override the callback methods
    #
    # @example Creating a custom bridge
    #   class SlackBridge < PocketPing::Bridge::Base
    #     def initialize(webhook_url:)
    #       @webhook_url = webhook_url
    #     end
    #
    #     def name
    #       "slack"
    #     end
    #
    #     def on_new_session(session)
    #       post_to_slack("New visitor: #{session.visitor_id}")
    #     end
    #
    #     def on_visitor_message(message, session)
    #       post_to_slack("Message from #{message.sender}: #{message.content}")
    #     end
    #   end
    class Base
      # @return [PocketPing::Client, nil] Reference to the PocketPing client
      attr_reader :pocketping

      # Unique name for this bridge
      #
      # @return [String] The bridge name
      # @abstract
      def name
        raise NotImplementedError, "#{self.class} must implement #name"
      end

      # Called when the bridge is added to PocketPing
      #
      # @param pocketping [PocketPing::Client] The PocketPing client instance
      # @return [void]
      def init(pocketping)
        @pocketping = pocketping
      end

      # Called when a new chat session is created
      #
      # @param session [Session] The new session
      # @return [void]
      def on_new_session(session)
        # Override in subclass
      end

      # Called when a visitor sends a message
      #
      # @param message [Message] The message
      # @param session [Session] The session
      # @return [void]
      def on_visitor_message(message, session)
        # Override in subclass
      end

      # Called when an operator sends a message (for cross-bridge sync)
      #
      # @param message [Message] The message
      # @param session [Session] The session
      # @param source_bridge [String] Name of the bridge that originated the message
      # @param operator_name [String, nil] Name of the operator
      # @return [void]
      def on_operator_message(message, session, source_bridge, operator_name = nil)
        # Override in subclass for cross-bridge sync
      end

      # Called when visitor starts/stops typing
      #
      # @param session_id [String] The session ID
      # @param is_typing [Boolean] Whether the visitor is typing
      # @return [void]
      def on_typing(session_id, is_typing)
        # Override in subclass
      end

      # Called when messages are marked as read/delivered
      #
      # @param session_id [String] The session ID
      # @param message_ids [Array<String>] IDs of the messages
      # @param status [String] The new status (delivered/read)
      # @param session [Session] The session
      # @return [void]
      def on_message_read(session_id, message_ids, status, session)
        # Override in subclass
      end

      # Called when a custom event is received
      #
      # @param event [CustomEvent] The custom event
      # @param session [Session] The session
      # @return [void]
      def on_custom_event(event, session)
        # Override in subclass
      end

      # Called when AI takes over a conversation
      #
      # @param session [Session] The session
      # @param reason [String] The reason for AI takeover
      # @return [void]
      def on_ai_takeover(session, reason)
        # Override in subclass
      end

      # Called when a user identifies themselves
      #
      # @param session [Session] The session with updated identity
      # @return [void]
      def on_identity_update(session)
        # Override in subclass
      end

      # Cleanup when bridge is removed
      #
      # @return [void]
      def destroy
        @pocketping = nil
      end
    end

    # A bridge that forwards events to multiple bridges
    #
    # @example
    #   composite = CompositeBridge.new([
    #     TelegramBridge.new(token: "..."),
    #     DiscordBridge.new(token: "...")
    #   ])
    #   pp = PocketPing::Client.new(bridges: [composite])
    class CompositeBridge < Base
      # @param bridges [Array<Base>] The bridges to forward to
      def initialize(bridges)
        super()
        @bridges = bridges
      end

      # @return [String] "composite"
      def name
        "composite"
      end

      def init(pocketping)
        super
        @bridges.each { |bridge| bridge.init(pocketping) }
      end

      def on_new_session(session)
        @bridges.each do |bridge|
          bridge.on_new_session(session)
        rescue StandardError => e
          warn "[PocketPing] Bridge #{bridge.name} error: #{e.message}"
        end
      end

      def on_visitor_message(message, session)
        @bridges.each do |bridge|
          bridge.on_visitor_message(message, session)
        rescue StandardError => e
          warn "[PocketPing] Bridge #{bridge.name} error: #{e.message}"
        end
      end

      def on_operator_message(message, session, source_bridge, operator_name = nil)
        @bridges.each do |bridge|
          bridge.on_operator_message(message, session, source_bridge, operator_name)
        rescue StandardError => e
          warn "[PocketPing] Bridge #{bridge.name} error: #{e.message}"
        end
      end

      def on_typing(session_id, is_typing)
        @bridges.each do |bridge|
          bridge.on_typing(session_id, is_typing)
        rescue StandardError => e
          warn "[PocketPing] Bridge #{bridge.name} error: #{e.message}"
        end
      end

      def on_message_read(session_id, message_ids, status, session)
        @bridges.each do |bridge|
          bridge.on_message_read(session_id, message_ids, status, session)
        rescue StandardError => e
          warn "[PocketPing] Bridge #{bridge.name} error: #{e.message}"
        end
      end

      def on_custom_event(event, session)
        @bridges.each do |bridge|
          bridge.on_custom_event(event, session)
        rescue StandardError => e
          warn "[PocketPing] Bridge #{bridge.name} error: #{e.message}"
        end
      end

      def on_ai_takeover(session, reason)
        @bridges.each do |bridge|
          bridge.on_ai_takeover(session, reason)
        rescue StandardError => e
          warn "[PocketPing] Bridge #{bridge.name} error: #{e.message}"
        end
      end

      def on_identity_update(session)
        @bridges.each do |bridge|
          bridge.on_identity_update(session)
        rescue StandardError => e
          warn "[PocketPing] Bridge #{bridge.name} error: #{e.message}"
        end
      end

      def destroy
        @bridges.each(&:destroy)
        super
      end

      # Add a bridge dynamically
      #
      # @param bridge [Base] The bridge to add
      # @return [void]
      def add_bridge(bridge)
        bridge.init(@pocketping) if @pocketping
        @bridges << bridge
      end

      # Remove a bridge
      #
      # @param bridge [Base] The bridge to remove
      # @return [void]
      def remove_bridge(bridge)
        bridge.destroy
        @bridges.delete(bridge)
      end

      # @return [Array<Base>] The list of bridges
      attr_reader :bridges
    end
  end
end

# Require bridge implementations after Base class is defined
require_relative "bridges/telegram_bridge"
require_relative "bridges/discord_bridge"
require_relative "bridges/slack_bridge"

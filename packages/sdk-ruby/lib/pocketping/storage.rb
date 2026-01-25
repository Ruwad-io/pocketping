# frozen_string_literal: true

require "time"

module PocketPing
  module Storage
    # Abstract base class for storage adapters
    #
    # Implement this interface to create custom storage backends
    # (PostgreSQL, Redis, MongoDB, etc.)
    #
    # @abstract Subclass and override the abstract methods
    #
    # @example Creating a custom storage adapter
    #   class RedisStorage < PocketPing::Storage::Base
    #     def initialize(redis_client)
    #       @redis = redis_client
    #     end
    #
    #     def create_session(session)
    #       @redis.set("session:#{session.id}", session.to_json)
    #     end
    #
    #     # ... implement other methods
    #   end
    class Base
      # Create a new session
      #
      # @param session [Session] The session to create
      # @return [void]
      def create_session(session)
        raise NotImplementedError, "#{self.class} must implement #create_session"
      end

      # Get a session by ID
      #
      # @param session_id [String] The session ID
      # @return [Session, nil] The session or nil if not found
      def get_session(session_id)
        raise NotImplementedError, "#{self.class} must implement #get_session"
      end

      # Update an existing session
      #
      # @param session [Session] The session to update
      # @return [void]
      def update_session(session)
        raise NotImplementedError, "#{self.class} must implement #update_session"
      end

      # Delete a session
      #
      # @param session_id [String] The session ID
      # @return [void]
      def delete_session(session_id)
        raise NotImplementedError, "#{self.class} must implement #delete_session"
      end

      # Save a message
      #
      # @param message [Message] The message to save
      # @return [void]
      def save_message(message)
        raise NotImplementedError, "#{self.class} must implement #save_message"
      end

      # Get messages for a session
      #
      # @param session_id [String] The session ID
      # @param after [String, nil] Return messages after this message ID
      # @param limit [Integer] Maximum number of messages to return
      # @return [Array<Message>] List of messages
      def get_messages(session_id, after: nil, limit: 50)
        raise NotImplementedError, "#{self.class} must implement #get_messages"
      end

      # Get a message by ID
      #
      # @param message_id [String] The message ID
      # @return [Message, nil] The message or nil if not found
      def get_message(message_id)
        raise NotImplementedError, "#{self.class} must implement #get_message"
      end

      # Clean up old sessions
      #
      # @param older_than [Time] Delete sessions with last_activity before this time
      # @return [Integer] Number of sessions deleted
      def cleanup_old_sessions(older_than)
        0
      end

      # Get the most recent session for a visitor
      #
      # @param visitor_id [String] The visitor ID
      # @return [Session, nil] The session or nil if not found
      def get_session_by_visitor_id(visitor_id)
        nil
      end

      # Update an existing message (for edit/delete)
      # Optional: defaults to save_message
      #
      # @param message [Message] The message to update
      # @return [void]
      def update_message(message)
        save_message(message)
      end

      # Save platform-specific message IDs for a message
      # Optional: implement for edit/delete synchronization with bridges
      #
      # @param message_id [String] The message ID
      # @param bridge_ids [BridgeMessageIds] The bridge message IDs
      # @return [void]
      def save_bridge_message_ids(message_id, bridge_ids)
        nil
      end

      # Get platform-specific message IDs for a message
      # Optional: implement for edit/delete synchronization with bridges
      #
      # @param message_id [String] The message ID
      # @return [BridgeMessageIds, nil] The bridge message IDs or nil
      def get_bridge_message_ids(message_id)
        nil
      end
    end

    # In-memory storage adapter
    #
    # Useful for development, testing, and simple deployments.
    # Note: Data is lost when the process restarts.
    #
    # @example
    #   storage = PocketPing::Storage::MemoryStorage.new
    #   pp = PocketPing::Client.new(storage: storage)
    class MemoryStorage < Base
      def initialize
        @sessions = {}
        @messages = {}
        @message_by_id = {}
        @bridge_message_ids = {}
        @mutex = Mutex.new
      end

      # @see Base#create_session
      def create_session(session)
        @mutex.synchronize do
          @sessions[session.id] = session
          @messages[session.id] = []
        end
        nil
      end

      # @see Base#get_session
      def get_session(session_id)
        @mutex.synchronize do
          @sessions[session_id]
        end
      end

      # @see Base#update_session
      def update_session(session)
        @mutex.synchronize do
          @sessions[session.id] = session
        end
        nil
      end

      # @see Base#delete_session
      def delete_session(session_id)
        @mutex.synchronize do
          @sessions.delete(session_id)
          messages = @messages.delete(session_id) || []
          messages.each { |msg| @message_by_id.delete(msg.id) }
        end
        nil
      end

      # @see Base#save_message
      def save_message(message)
        @mutex.synchronize do
          @messages[message.session_id] ||= []

          # Check if message already exists (update case)
          existing_index = @messages[message.session_id].index { |m| m.id == message.id }
          if existing_index
            @messages[message.session_id][existing_index] = message
          else
            @messages[message.session_id] << message
          end

          @message_by_id[message.id] = message
        end
        nil
      end

      # @see Base#get_messages
      def get_messages(session_id, after: nil, limit: 50)
        @mutex.synchronize do
          messages = @messages[session_id] || []

          if after
            start_index = 0
            messages.each_with_index do |msg, i|
              if msg.id == after
                start_index = i + 1
                break
              end
            end
            messages = messages[start_index..] || []
          end

          messages.first(limit)
        end
      end

      # @see Base#get_message
      def get_message(message_id)
        @mutex.synchronize do
          @message_by_id[message_id]
        end
      end

      # @see Base#cleanup_old_sessions
      def cleanup_old_sessions(older_than)
        count = 0
        to_delete = []

        @mutex.synchronize do
          @sessions.each do |session_id, session|
            if session.last_activity < older_than
              to_delete << session_id
            end
          end
        end

        to_delete.each do |session_id|
          delete_session(session_id)
          count += 1
        end

        count
      end

      # @see Base#get_session_by_visitor_id
      def get_session_by_visitor_id(visitor_id)
        @mutex.synchronize do
          visitor_sessions = @sessions.values.select { |s| s.visitor_id == visitor_id }
          return nil if visitor_sessions.empty?

          # Return most recent by last_activity
          visitor_sessions.max_by(&:last_activity)
        end
      end

      # Get all sessions (useful for admin/debug)
      #
      # @return [Array<Session>] All sessions
      def get_all_sessions
        @mutex.synchronize do
          @sessions.values.dup
        end
      end

      # Get total session count
      #
      # @return [Integer] Number of sessions
      def get_session_count
        @mutex.synchronize do
          @sessions.size
        end
      end

      # Clear all data (useful for testing)
      #
      # @return [void]
      def clear!
        @mutex.synchronize do
          @sessions.clear
          @messages.clear
          @message_by_id.clear
          @bridge_message_ids.clear
        end
        nil
      end

      # @see Base#update_message
      def update_message(message)
        @mutex.synchronize do
          return unless @message_by_id.key?(message.id)

          # Update in message_by_id
          @message_by_id[message.id] = message

          # Update in the session's messages array
          if @messages[message.session_id]
            existing_index = @messages[message.session_id].index { |m| m.id == message.id }
            @messages[message.session_id][existing_index] = message if existing_index
          end
        end
        nil
      end

      # @see Base#save_bridge_message_ids
      def save_bridge_message_ids(message_id, bridge_ids)
        @mutex.synchronize do
          existing = @bridge_message_ids[message_id]
          if existing
            @bridge_message_ids[message_id] = existing.merge_with(bridge_ids)
          else
            @bridge_message_ids[message_id] = bridge_ids
          end
        end
        nil
      end

      # @see Base#get_bridge_message_ids
      def get_bridge_message_ids(message_id)
        @mutex.synchronize do
          @bridge_message_ids[message_id]
        end
      end
    end
  end
end

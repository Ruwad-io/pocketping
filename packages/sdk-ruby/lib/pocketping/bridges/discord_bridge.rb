# frozen_string_literal: true

require "net/http"
require "uri"
require "json"

module PocketPing
  module Bridge
    # Discord webhook bridge for sending notifications via Discord webhooks
    #
    # @example Basic usage
    #   bridge = DiscordWebhookBridge.new(
    #     webhook_url: "https://discord.com/api/webhooks/123/abc..."
    #   )
    #   pp = PocketPing::Client.new(bridges: [bridge])
    #
    # @example With custom username and avatar
    #   bridge = DiscordWebhookBridge.new(
    #     webhook_url: "https://discord.com/api/webhooks/123/abc...",
    #     username: "PocketPing Bot",
    #     avatar_url: "https://example.com/avatar.png"
    #   )
    class DiscordWebhookBridge < Base
      # @param webhook_url [String] Discord webhook URL
      # @param username [String, nil] Override webhook username
      # @param avatar_url [String, nil] Override webhook avatar URL
      def initialize(webhook_url:, username: nil, avatar_url: nil)
        super()
        @webhook_url = webhook_url
        @username = username
        @avatar_url = avatar_url

        # Extract webhook ID and token from URL for edit/delete operations
        match = webhook_url.match(%r{/webhooks/(\d+)/([^/]+)})
        @webhook_id = match[1] if match
        @webhook_token = match[2] if match
      end

      # @return [String] "discord_webhook"
      def name
        "discord_webhook"
      end

      # Called when a new chat session is created
      #
      # @param session [Session] The new session
      # @return [void]
      def on_new_session(session)
        visitor_id = session.visitor_id || "Unknown"
        url = session.metadata&.url || "No URL"

        content = format_new_session_message(visitor_id, url)
        send_webhook_message(content)
      rescue StandardError => e
        warn "[PocketPing] DiscordWebhookBridge error in on_new_session: #{e.message}"
      end

      # Called when a visitor sends a message
      #
      # @param message [Message] The message
      # @param session [Session] The session
      # @return [BridgeMessageResult, nil] Result with Discord message ID
      def on_visitor_message(message, session)
        visitor_id = session.visitor_id || "Unknown"
        content = message.content || ""

        text = format_visitor_message(visitor_id, content)
        result = send_webhook_message(text, wait: true)
        return nil unless result

        message_id = result["id"]
        return nil unless message_id

        BridgeMessageResult.new(message_id: message_id)
      rescue StandardError => e
        warn "[PocketPing] DiscordWebhookBridge error in on_visitor_message: #{e.message}"
        nil
      end

      # Called when a message is edited
      #
      # @param message [Message] The edited message
      # @param session [Session] The session
      # @param discord_message_id [String] The Discord message ID to edit
      # @return [void]
      def on_message_edit(message, session, discord_message_id)
        return unless discord_message_id && @webhook_id && @webhook_token

        visitor_id = session.visitor_id || "Unknown"
        content = message.content || ""
        text = format_visitor_message(visitor_id, content, edited: true)

        edit_webhook_message(discord_message_id, text)
      rescue StandardError => e
        warn "[PocketPing] DiscordWebhookBridge error in on_message_edit: #{e.message}"
      end

      # Called when a message is deleted
      #
      # @param message [Message] The deleted message
      # @param session [Session] The session
      # @param discord_message_id [String] The Discord message ID to delete
      # @return [void]
      def on_message_delete(message, session, discord_message_id)
        return unless discord_message_id && @webhook_id && @webhook_token

        delete_webhook_message(discord_message_id)
      rescue StandardError => e
        warn "[PocketPing] DiscordWebhookBridge error in on_message_delete: #{e.message}"
      end

      private

      def format_new_session_message(visitor_id, url)
        [
          "\u{1F195} New chat session",
          "\u{1F464} Visitor: #{visitor_id}",
          "\u{1F4CD} #{url}"
        ].join("\n")
      end

      def format_visitor_message(visitor_id, content, edited: false)
        prefix = edited ? "\u{1F4DD} [edited] " : ""
        "\u{1F4AC} #{prefix}#{visitor_id}:\n#{content}"
      end

      def send_webhook_message(content, wait: false)
        uri = URI(@webhook_url)
        uri.query = "wait=true" if wait

        body = { content: content }
        body[:username] = @username if @username
        body[:avatar_url] = @avatar_url if @avatar_url

        make_request(uri, :post, body)
      end

      def edit_webhook_message(message_id, content)
        uri = URI("https://discord.com/api/webhooks/#{@webhook_id}/#{@webhook_token}/messages/#{message_id}")
        body = { content: content }
        make_request(uri, :patch, body)
      end

      def delete_webhook_message(message_id)
        uri = URI("https://discord.com/api/webhooks/#{@webhook_id}/#{@webhook_token}/messages/#{message_id}")
        make_request(uri, :delete, nil)
      end

      def make_request(uri, method, body)
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = true
        http.open_timeout = 10
        http.read_timeout = 30

        request = case method
                  when :post
                    Net::HTTP::Post.new(uri)
                  when :patch
                    Net::HTTP::Patch.new(uri)
                  when :delete
                    Net::HTTP::Delete.new(uri)
                  else
                    raise ArgumentError, "Unknown HTTP method: #{method}"
                  end

        request["Content-Type"] = "application/json"
        request.body = body.to_json if body

        response = http.request(request)

        # Discord returns 204 No Content for successful delete
        return {} if response.is_a?(Net::HTTPNoContent)

        unless response.is_a?(Net::HTTPSuccess)
          warn "[PocketPing] Discord API error: #{response.code} - #{response.body}"
          return nil
        end

        return {} if response.body.nil? || response.body.empty?

        JSON.parse(response.body)
      rescue Net::OpenTimeout, Net::ReadTimeout => e
        warn "[PocketPing] Discord API timeout: #{e.message}"
        nil
      rescue JSON::ParserError => e
        warn "[PocketPing] Discord API invalid JSON response: #{e.message}"
        nil
      rescue StandardError => e
        warn "[PocketPing] Discord API error: #{e.message}"
        nil
      end
    end

    # Discord bot bridge for sending notifications via Discord Bot API
    #
    # @example Basic usage
    #   bridge = DiscordBotBridge.new(
    #     bot_token: "Bot MTIz...",
    #     channel_id: "1234567890"
    #   )
    #   pp = PocketPing::Client.new(bridges: [bridge])
    class DiscordBotBridge < Base
      DISCORD_API_BASE = "https://discord.com/api/v10"

      # @param bot_token [String] Discord bot token
      # @param channel_id [String] Channel ID to send messages to
      def initialize(bot_token:, channel_id:)
        super()
        @bot_token = bot_token
        @channel_id = channel_id
      end

      # @return [String] "discord_bot"
      def name
        "discord_bot"
      end

      # Called when a new chat session is created
      #
      # @param session [Session] The new session
      # @return [void]
      def on_new_session(session)
        visitor_id = session.visitor_id || "Unknown"
        url = session.metadata&.url || "No URL"

        content = format_new_session_message(visitor_id, url)
        send_message(content)
      rescue StandardError => e
        warn "[PocketPing] DiscordBotBridge error in on_new_session: #{e.message}"
      end

      # Called when a visitor sends a message
      #
      # @param message [Message] The message
      # @param session [Session] The session
      # @return [BridgeMessageResult, nil] Result with Discord message ID
      def on_visitor_message(message, session)
        visitor_id = session.visitor_id || "Unknown"
        content = message.content || ""

        # Send typing indicator first
        trigger_typing

        text = format_visitor_message(visitor_id, content)
        result = send_message(text)
        return nil unless result

        message_id = result["id"]
        return nil unless message_id

        BridgeMessageResult.new(message_id: message_id)
      rescue StandardError => e
        warn "[PocketPing] DiscordBotBridge error in on_visitor_message: #{e.message}"
        nil
      end

      # Called when a message is edited
      #
      # @param message [Message] The edited message
      # @param session [Session] The session
      # @param discord_message_id [String] The Discord message ID to edit
      # @return [void]
      def on_message_edit(message, session, discord_message_id)
        return unless discord_message_id

        visitor_id = session.visitor_id || "Unknown"
        content = message.content || ""
        text = format_visitor_message(visitor_id, content, edited: true)

        edit_message(discord_message_id, text)
      rescue StandardError => e
        warn "[PocketPing] DiscordBotBridge error in on_message_edit: #{e.message}"
      end

      # Called when a message is deleted
      #
      # @param message [Message] The deleted message
      # @param session [Session] The session
      # @param discord_message_id [String] The Discord message ID to delete
      # @return [void]
      def on_message_delete(message, session, discord_message_id)
        return unless discord_message_id

        delete_message(discord_message_id)
      rescue StandardError => e
        warn "[PocketPing] DiscordBotBridge error in on_message_delete: #{e.message}"
      end

      # Called when visitor starts/stops typing
      #
      # @param session_id [String] The session ID
      # @param is_typing [Boolean] Whether the visitor is typing
      # @return [void]
      def on_typing(session_id, is_typing)
        return unless is_typing

        trigger_typing
      rescue StandardError => e
        warn "[PocketPing] DiscordBotBridge error in on_typing: #{e.message}"
      end

      private

      def format_new_session_message(visitor_id, url)
        [
          "\u{1F195} New chat session",
          "\u{1F464} Visitor: #{visitor_id}",
          "\u{1F4CD} #{url}"
        ].join("\n")
      end

      def format_visitor_message(visitor_id, content, edited: false)
        prefix = edited ? "\u{1F4DD} [edited] " : ""
        "\u{1F4AC} #{prefix}#{visitor_id}:\n#{content}"
      end

      def send_message(content)
        uri = URI("#{DISCORD_API_BASE}/channels/#{@channel_id}/messages")
        body = { content: content }
        make_request(uri, :post, body)
      end

      def edit_message(message_id, content)
        uri = URI("#{DISCORD_API_BASE}/channels/#{@channel_id}/messages/#{message_id}")
        body = { content: content }
        make_request(uri, :patch, body)
      end

      def delete_message(message_id)
        uri = URI("#{DISCORD_API_BASE}/channels/#{@channel_id}/messages/#{message_id}")
        make_request(uri, :delete, nil)
      end

      def trigger_typing
        uri = URI("#{DISCORD_API_BASE}/channels/#{@channel_id}/typing")
        make_request(uri, :post, nil)
      end

      def make_request(uri, method, body)
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = true
        http.open_timeout = 10
        http.read_timeout = 30

        request = case method
                  when :post
                    Net::HTTP::Post.new(uri)
                  when :patch
                    Net::HTTP::Patch.new(uri)
                  when :delete
                    Net::HTTP::Delete.new(uri)
                  else
                    raise ArgumentError, "Unknown HTTP method: #{method}"
                  end

        request["Authorization"] = "Bot #{@bot_token}"
        request["Content-Type"] = "application/json"
        request.body = body.to_json if body

        response = http.request(request)

        # Discord returns 204 No Content for successful delete and typing
        return {} if response.is_a?(Net::HTTPNoContent)

        unless response.is_a?(Net::HTTPSuccess)
          warn "[PocketPing] Discord API error: #{response.code} - #{response.body}"
          return nil
        end

        return {} if response.body.nil? || response.body.empty?

        JSON.parse(response.body)
      rescue Net::OpenTimeout, Net::ReadTimeout => e
        warn "[PocketPing] Discord API timeout: #{e.message}"
        nil
      rescue JSON::ParserError => e
        warn "[PocketPing] Discord API invalid JSON response: #{e.message}"
        nil
      rescue StandardError => e
        warn "[PocketPing] Discord API error: #{e.message}"
        nil
      end
    end
  end
end

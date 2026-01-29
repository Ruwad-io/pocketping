# frozen_string_literal: true

require "net/http"
require "uri"
require "json"
require_relative "../errors"

module PocketPing
  module Bridge
    # Telegram bridge for sending notifications via Telegram Bot API
    #
    # @example Basic usage
    #   bridge = TelegramBridge.new(
    #     bot_token: "123456:ABC-DEF...",
    #     chat_id: "-1001234567890"
    #   )
    #   pp = PocketPing::Client.new(bridges: [bridge])
    #
    # @example With options
    #   bridge = TelegramBridge.new(
    #     bot_token: "123456:ABC-DEF...",
    #     chat_id: "-1001234567890",
    #     parse_mode: "Markdown",
    #     disable_notification: true
    #   )
    class TelegramBridge < Base
      TELEGRAM_API_BASE = "https://api.telegram.org"

      # @param bot_token [String] Telegram bot token from @BotFather
      # @param chat_id [String, Integer] Chat ID to send messages to
      # @param parse_mode [String] Message parse mode ("HTML", "Markdown", "MarkdownV2")
      # @param disable_notification [Boolean] Send messages silently
      # @raise [SetupError] if bot_token or chat_id is missing or invalid
      def initialize(bot_token:, chat_id:, parse_mode: "HTML", disable_notification: false)
        super()

        # Validate bot_token
        if bot_token.nil? || bot_token.to_s.empty?
          raise SetupError.new(bridge: "Telegram", missing: "bot_token")
        end

        unless bot_token.to_s.match?(/^\d+:[A-Za-z0-9_-]+$/)
          raise SetupError.new(
            bridge: "Telegram",
            missing: "valid bot_token",
            guide: "Bot token format should be: 123456789:ABCdef...\n\n" +
                   SetupError::SETUP_GUIDES[:telegram][:bot_token]
          )
        end

        # Validate chat_id
        if chat_id.nil? || chat_id.to_s.empty?
          raise SetupError.new(bridge: "Telegram", missing: "chat_id")
        end

        @bot_token = bot_token
        @chat_id = chat_id
        @parse_mode = parse_mode
        @disable_notification = disable_notification
      end

      # @return [String] "telegram"
      def name
        "telegram"
      end

      # Called when a new chat session is created
      #
      # @param session [Session] The new session
      # @return [void]
      def on_new_session(session)
        text = format_new_session_message(session)
        send_message(text)
      rescue StandardError => e
        warn "[PocketPing] TelegramBridge error in on_new_session: #{e.message}"
      end

      # Called when a visitor sends a message
      #
      # @param message [Message] The message
      # @param session [Session] The session
      # @return [BridgeMessageResult, nil] Result with Telegram message ID
      def on_visitor_message(message, session)
        visitor_id = session.visitor_id || "Unknown"
        content = message.content || ""

        text = format_visitor_message(visitor_id, content)

        # Send typing indicator first
        send_chat_action("typing")

        reply_to_message_id = nil
        if message.reply_to && pocketping&.storage&.respond_to?(:get_bridge_message_ids)
          bridge_ids = pocketping.storage.get_bridge_message_ids(message.reply_to)
          reply_to_message_id = bridge_ids&.telegram_message_id
        end

        result = send_message(text, reply_to_message_id: reply_to_message_id)
        return nil unless result

        message_id = result.dig("result", "message_id")
        return nil unless message_id

        BridgeMessageResult.new(message_id: message_id)
      rescue StandardError => e
        warn "[PocketPing] TelegramBridge error in on_visitor_message: #{e.message}"
        nil
      end

      # Called when a message is edited
      #
      # @param message [Message] The edited message
      # @param session [Session] The session
      # @param telegram_message_id [Integer] The Telegram message ID to edit
      # @return [void]
      def on_message_edit(message, session, telegram_message_id)
        return unless telegram_message_id

        visitor_id = session.visitor_id || "Unknown"
        content = message.content || ""
        text = format_visitor_message(visitor_id, content, edited: true)

        edit_message(telegram_message_id, text)
      rescue StandardError => e
        warn "[PocketPing] TelegramBridge error in on_message_edit: #{e.message}"
      end

      # Called when a message is deleted
      #
      # @param message [Message] The deleted message
      # @param session [Session] The session
      # @param telegram_message_id [Integer] The Telegram message ID to delete
      # @return [void]
      def on_message_delete(message, session, telegram_message_id)
        return unless telegram_message_id

        delete_message(telegram_message_id)
      rescue StandardError => e
        warn "[PocketPing] TelegramBridge error in on_message_delete: #{e.message}"
      end

      # Called when visitor starts/stops typing
      #
      # @param session_id [String] The session ID
      # @param is_typing [Boolean] Whether the visitor is typing
      # @return [void]
      def on_typing(session_id, is_typing)
        return unless is_typing

        send_chat_action("typing")
      rescue StandardError => e
        warn "[PocketPing] TelegramBridge error in on_typing: #{e.message}"
      end

      private

      def format_new_session_message(session)
        url = session.metadata&.url || "No URL"
        email = session.identity&.email
        phone = session.user_phone
        user_agent = session.metadata&.user_agent

        lines = ["\u{1F195} New chat session", ""]

        lines << "\u{1F4E7} #{escape_html(email)}" if email && !email.empty?
        lines << "\u{1F4DE} #{escape_html(phone)}" if phone && !phone.empty?
        lines << "\u{1F310} #{escape_html(parse_user_agent(user_agent))}" if user_agent && !user_agent.empty?
        lines << "" if email || phone || user_agent
        lines << "\u{1F4CD} #{escape_html(url)}"

        lines.join("\n")
      end

      def parse_user_agent(ua)
        return "Unknown" if ua.nil? || ua.empty?

        browser = case ua
                  when /Firefox/i then "Firefox"
                  when /Edg/i then "Edge"
                  when /Chrome/i then "Chrome"
                  when /Safari/i then "Safari"
                  when /Opera|OPR/i then "Opera"
                  else "Browser"
                  end

        os = case ua
             when /Windows/i then "Windows"
             when /Macintosh|Mac OS/i then "macOS"
             when /Linux/i then "Linux"
             when /Android/i then "Android"
             when /iPhone|iPad|iOS/i then "iOS"
             else "Unknown"
             end

        "#{browser}/#{os}"
      end

      def format_visitor_message(visitor_id, content, edited: false)
        prefix = edited ? "\u{1F4DD} [edited] " : ""
        "\u{1F4AC} #{prefix}#{escape_html(visitor_id)}:\n#{escape_html(content)}"
      end

      def escape_html(text)
        return "" if text.nil?

        text.to_s
            .gsub("&", "&amp;")
            .gsub("<", "&lt;")
            .gsub(">", "&gt;")
      end

      def send_message(text, reply_to_message_id: nil)
        uri = URI("#{TELEGRAM_API_BASE}/bot#{@bot_token}/sendMessage")

        body = {
          chat_id: @chat_id,
          text: text,
          parse_mode: @parse_mode,
          disable_notification: @disable_notification
        }
        body[:reply_to_message_id] = reply_to_message_id if reply_to_message_id

        make_request(uri, body)
      end

      def edit_message(message_id, text)
        uri = URI("#{TELEGRAM_API_BASE}/bot#{@bot_token}/editMessageText")

        body = {
          chat_id: @chat_id,
          message_id: message_id,
          text: text,
          parse_mode: @parse_mode
        }

        make_request(uri, body)
      end

      def delete_message(message_id)
        uri = URI("#{TELEGRAM_API_BASE}/bot#{@bot_token}/deleteMessage")

        body = {
          chat_id: @chat_id,
          message_id: message_id
        }

        make_request(uri, body)
      end

      def send_chat_action(action)
        uri = URI("#{TELEGRAM_API_BASE}/bot#{@bot_token}/sendChatAction")

        body = {
          chat_id: @chat_id,
          action: action
        }

        make_request(uri, body)
      end

      def make_request(uri, body)
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = true
        http.open_timeout = 10
        http.read_timeout = 30

        request = Net::HTTP::Post.new(uri)
        request["Content-Type"] = "application/json"
        request.body = body.to_json

        response = http.request(request)

        unless response.is_a?(Net::HTTPSuccess)
          warn "[PocketPing] Telegram API error: #{response.code} - #{response.body}"
          return nil
        end

        JSON.parse(response.body)
      rescue Net::OpenTimeout, Net::ReadTimeout => e
        warn "[PocketPing] Telegram API timeout: #{e.message}"
        nil
      rescue JSON::ParserError => e
        warn "[PocketPing] Telegram API invalid JSON response: #{e.message}"
        nil
      rescue StandardError => e
        warn "[PocketPing] Telegram API error: #{e.message}"
        nil
      end
    end
  end
end

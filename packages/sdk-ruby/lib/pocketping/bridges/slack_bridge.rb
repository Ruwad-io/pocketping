# frozen_string_literal: true

require "net/http"
require "uri"
require "json"
require_relative "../errors"

module PocketPing
  module Bridge
    # Slack webhook bridge for sending notifications via Slack incoming webhooks
    #
    # @example Basic usage
    #   bridge = SlackWebhookBridge.new(
    #     webhook_url: "https://hooks.slack.com/services/T00/B00/XXX"
    #   )
    #   pp = PocketPing::Client.new(bridges: [bridge])
    #
    # @example With custom username and icon
    #   bridge = SlackWebhookBridge.new(
    #     webhook_url: "https://hooks.slack.com/services/T00/B00/XXX",
    #     username: "PocketPing Bot",
    #     icon_emoji: ":robot_face:"
    #   )
    class SlackWebhookBridge < Base
      # @param webhook_url [String] Slack incoming webhook URL
      # @param username [String, nil] Override webhook username
      # @param icon_emoji [String, nil] Override webhook icon emoji
      # @raise [SetupError] if webhook_url is missing or invalid
      def initialize(webhook_url:, username: nil, icon_emoji: nil)
        super()

        # Validate webhook_url
        if webhook_url.nil? || webhook_url.empty?
          raise SetupError.new(bridge: "Slack", missing: "webhook_url")
        end

        unless webhook_url.start_with?("https://hooks.slack.com/")
          raise SetupError.new(
            bridge: "Slack",
            missing: "valid webhook_url",
            guide: "Webhook URL must start with https://hooks.slack.com/\n\n" +
                   SetupError::SETUP_GUIDES[:slack][:webhook_url]
          )
        end

        @webhook_url = webhook_url
        @username = username
        @icon_emoji = icon_emoji
      end

      # @return [String] "slack_webhook"
      def name
        "slack_webhook"
      end

      # Called when a new chat session is created
      #
      # @param session [Session] The new session
      # @return [void]
      def on_new_session(session)
        visitor_id = session.visitor_id || "Unknown"
        url = session.metadata&.url || "No URL"

        text = format_new_session_message(visitor_id, url)
        send_webhook_message(text)
      rescue StandardError => e
        warn "[PocketPing] SlackWebhookBridge error in on_new_session: #{e.message}"
      end

      # Called when a visitor sends a message
      #
      # @param message [Message] The message
      # @param session [Session] The session
      # @return [BridgeMessageResult, nil] Result (always nil for webhook, no message ID returned)
      def on_visitor_message(message, session)
        visitor_id = session.visitor_id || "Unknown"
        content = message.content || ""

        text = format_visitor_message(visitor_id, content)
        quote = build_reply_quote(message)
        text = "#{quote}\n#{text}" if quote
        send_webhook_message(text)

        # Slack webhooks don't return a message ID, so we can't support edit/delete
        nil
      rescue StandardError => e
        warn "[PocketPing] SlackWebhookBridge error in on_visitor_message: #{e.message}"
        nil
      end

      # Called when a message is edited (not supported for webhooks)
      #
      # @param message [Message] The edited message
      # @param session [Session] The session
      # @param slack_message_ts [String] The Slack message timestamp
      # @return [void]
      def on_message_edit(message, session, slack_message_ts)
        # Slack webhooks don't support editing messages
        # Would need the Bot API for this
        warn "[PocketPing] SlackWebhookBridge does not support message editing"
      end

      # Called when a message is deleted (not supported for webhooks)
      #
      # @param message [Message] The deleted message
      # @param session [Session] The session
      # @param slack_message_ts [String] The Slack message timestamp
      # @return [void]
      def on_message_delete(message, session, slack_message_ts)
        # Slack webhooks don't support deleting messages
        # Would need the Bot API for this
        warn "[PocketPing] SlackWebhookBridge does not support message deletion"
      end

      private

      def format_new_session_message(visitor_id, url)
        [
          "\u{1F195} New chat session",
          "\u{1F464} Visitor: #{escape_slack(visitor_id)}",
          "\u{1F4CD} #{escape_slack(url)}"
        ].join("\n")
      end

      def format_visitor_message(visitor_id, content, edited: false)
        prefix = edited ? "\u{1F4DD} [edited] " : ""
        "\u{1F4AC} #{prefix}#{escape_slack(visitor_id)}:\n#{escape_slack(content)}"
      end

      def build_reply_quote(message)
        return nil unless message.reply_to && pocketping&.storage&.respond_to?(:get_message)

        reply_target = pocketping.storage.get_message(message.reply_to)
        return nil unless reply_target

        sender_label =
          case reply_target.sender
          when "operator" then "Support"
          when "ai" then "AI"
          else "Visitor"
          end

        preview = if reply_target.deleted_at
                    "Message deleted"
                  else
                    reply_target.content.to_s.empty? ? "Message" : reply_target.content
                  end
        preview = preview[0, 140] + "..." if preview.length > 140

        "> *#{escape_slack(sender_label)}* — #{escape_slack(preview)}"
      end

      def escape_slack(text)
        return "" if text.nil?

        text.to_s
            .gsub("&", "&amp;")
            .gsub("<", "&lt;")
            .gsub(">", "&gt;")
      end

      def send_webhook_message(text)
        uri = URI(@webhook_url)

        body = { text: text }
        body[:username] = @username if @username
        body[:icon_emoji] = @icon_emoji if @icon_emoji

        make_request(uri, :post, body)
      end

      def make_request(uri, method, body)
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = true
        http.open_timeout = 10
        http.read_timeout = 30

        request = Net::HTTP::Post.new(uri)
        request["Content-Type"] = "application/json"
        request.body = body.to_json

        response = http.request(request)

        unless response.is_a?(Net::HTTPSuccess)
          warn "[PocketPing] Slack API error: #{response.code} - #{response.body}"
          return nil
        end

        # Slack webhooks return "ok" as plain text, not JSON
        { ok: response.body == "ok" }
      rescue Net::OpenTimeout, Net::ReadTimeout => e
        warn "[PocketPing] Slack API timeout: #{e.message}"
        nil
      rescue StandardError => e
        warn "[PocketPing] Slack API error: #{e.message}"
        nil
      end
    end

    # Slack bot bridge for sending notifications via Slack Bot API
    #
    # @example Basic usage
    #   bridge = SlackBotBridge.new(
    #     bot_token: "xoxb-...",
    #     channel_id: "C1234567890"
    #   )
    #   pp = PocketPing::Client.new(bridges: [bridge])
    class SlackBotBridge < Base
      SLACK_API_BASE = "https://slack.com/api"

      # @param bot_token [String] Slack bot token (xoxb-...)
      # @param channel_id [String] Channel ID to send messages to
      # @raise [SetupError] if bot_token or channel_id is missing or invalid
      def initialize(bot_token:, channel_id:)
        super()

        # Validate bot_token
        if bot_token.nil? || bot_token.empty?
          raise SetupError.new(bridge: "Slack", missing: "bot_token")
        end

        unless bot_token.start_with?("xoxb-")
          raise SetupError.new(
            bridge: "Slack",
            missing: "valid bot_token",
            guide: "Bot token must start with xoxb-\n\n" +
                   SetupError::SETUP_GUIDES[:slack][:bot_token]
          )
        end

        # Validate channel_id
        if channel_id.nil? || channel_id.empty?
          raise SetupError.new(bridge: "Slack", missing: "channel_id")
        end

        @bot_token = bot_token
        @channel_id = channel_id
      end

      # @return [String] "slack_bot"
      def name
        "slack_bot"
      end

      # Called when a new chat session is created
      #
      # @param session [Session] The new session
      # @return [void]
      def on_new_session(session)
        visitor_id = session.visitor_id || "Unknown"
        url = session.metadata&.url || "No URL"

        text = format_new_session_message(visitor_id, url)
        post_message(text)
      rescue StandardError => e
        warn "[PocketPing] SlackBotBridge error in on_new_session: #{e.message}"
      end

      # Called when a visitor sends a message
      #
      # @param message [Message] The message
      # @param session [Session] The session
      # @return [BridgeMessageResult, nil] Result with Slack message timestamp
      def on_visitor_message(message, session)
        visitor_id = session.visitor_id || "Unknown"
        content = message.content || ""

        text = format_visitor_message(visitor_id, content)
        quote = build_reply_quote(message)
        text = "#{quote}\n#{text}" if quote
        result = post_message(text)
        return nil unless result && result["ok"]

        message_ts = result["ts"]
        return nil unless message_ts

        BridgeMessageResult.new(message_id: message_ts)
      rescue StandardError => e
        warn "[PocketPing] SlackBotBridge error in on_visitor_message: #{e.message}"
        nil
      end

      # Called when a message is edited
      #
      # @param message [Message] The edited message
      # @param session [Session] The session
      # @param slack_message_ts [String] The Slack message timestamp to edit
      # @return [void]
      def on_message_edit(message, session, slack_message_ts)
        return unless slack_message_ts

        visitor_id = session.visitor_id || "Unknown"
        content = message.content || ""
        text = format_visitor_message(visitor_id, content, edited: true)

        update_message(slack_message_ts, text)
      rescue StandardError => e
        warn "[PocketPing] SlackBotBridge error in on_message_edit: #{e.message}"
      end

      # Called when a message is deleted
      #
      # @param message [Message] The deleted message
      # @param session [Session] The session
      # @param slack_message_ts [String] The Slack message timestamp to delete
      # @return [void]
      def on_message_delete(message, session, slack_message_ts)
        return unless slack_message_ts

        delete_message(slack_message_ts)
      rescue StandardError => e
        warn "[PocketPing] SlackBotBridge error in on_message_delete: #{e.message}"
      end

      private

      def format_new_session_message(visitor_id, url)
        [
          "\u{1F195} New chat session",
          "\u{1F464} Visitor: #{escape_slack(visitor_id)}",
          "\u{1F4CD} #{escape_slack(url)}"
        ].join("\n")
      end

      def format_visitor_message(visitor_id, content, edited: false)
        prefix = edited ? "\u{1F4DD} [edited] " : ""
        "\u{1F4AC} #{prefix}#{escape_slack(visitor_id)}:\n#{escape_slack(content)}"
      end

      def escape_slack(text)
        return "" if text.nil?

        text.to_s
            .gsub("&", "&amp;")
            .gsub("<", "&lt;")
            .gsub(">", "&gt;")
      end

      def build_reply_quote(message)
        return nil unless message.reply_to && pocketping&.storage&.respond_to?(:get_message)

        reply_target = pocketping.storage.get_message(message.reply_to)
        return nil unless reply_target

        sender_label =
          case reply_target.sender
          when "operator" then "Support"
          when "ai" then "AI"
          else "Visitor"
          end

        preview = if reply_target.deleted_at
                    "Message deleted"
                  else
                    reply_target.content.to_s.empty? ? "Message" : reply_target.content
                  end
        preview = preview[0, 140] + "..." if preview.length > 140

        "> *#{escape_slack(sender_label)}* — #{escape_slack(preview)}"
      end

      def post_message(text)
        uri = URI("#{SLACK_API_BASE}/chat.postMessage")

        body = {
          channel: @channel_id,
          text: text
        }

        make_request(uri, body)
      end

      def update_message(ts, text)
        uri = URI("#{SLACK_API_BASE}/chat.update")

        body = {
          channel: @channel_id,
          ts: ts,
          text: text
        }

        make_request(uri, body)
      end

      def delete_message(ts)
        uri = URI("#{SLACK_API_BASE}/chat.delete")

        body = {
          channel: @channel_id,
          ts: ts
        }

        make_request(uri, body)
      end

      def make_request(uri, body)
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = true
        http.open_timeout = 10
        http.read_timeout = 30

        request = Net::HTTP::Post.new(uri)
        request["Authorization"] = "Bearer #{@bot_token}"
        request["Content-Type"] = "application/json"
        request.body = body.to_json

        response = http.request(request)

        unless response.is_a?(Net::HTTPSuccess)
          warn "[PocketPing] Slack API error: #{response.code} - #{response.body}"
          return nil
        end

        result = JSON.parse(response.body)

        unless result["ok"]
          warn "[PocketPing] Slack API error: #{result["error"]}"
          return nil
        end

        result
      rescue Net::OpenTimeout, Net::ReadTimeout => e
        warn "[PocketPing] Slack API timeout: #{e.message}"
        nil
      rescue JSON::ParserError => e
        warn "[PocketPing] Slack API invalid JSON response: #{e.message}"
        nil
      rescue StandardError => e
        warn "[PocketPing] Slack API error: #{e.message}"
        nil
      end
    end
  end
end

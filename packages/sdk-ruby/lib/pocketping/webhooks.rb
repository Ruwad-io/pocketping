# frozen_string_literal: true

require "net/http"
require "uri"
require "json"

module PocketPing
  # Attachment from an operator message received via webhook
  class OperatorAttachment
    attr_reader :filename, :mime_type, :size, :data, :bridge_file_id

    def initialize(filename:, mime_type:, size:, data:, bridge_file_id: nil)
      @filename = filename
      @mime_type = mime_type
      @size = size
      @data = data
      @bridge_file_id = bridge_file_id
    end

    def to_h
      {
        filename: @filename,
        mimeType: @mime_type,
        size: @size,
        bridgeFileId: @bridge_file_id
      }
    end
  end

  # Configuration for webhook handlers
  class WebhookConfig
    attr_reader :telegram_bot_token, :slack_bot_token, :discord_bot_token
    attr_accessor :on_operator_message

    # @param telegram_bot_token [String, nil] Telegram bot token for downloading files
    # @param slack_bot_token [String, nil] Slack bot token for downloading files
    # @param discord_bot_token [String, nil] Discord bot token (for future use)
    # @param on_operator_message [Proc] Callback when operator sends a message
    #   Receives: session_id, content, operator_name, source_bridge, attachments
    def initialize(telegram_bot_token: nil, slack_bot_token: nil, discord_bot_token: nil, on_operator_message: nil)
      @telegram_bot_token = telegram_bot_token
      @slack_bot_token = slack_bot_token
      @discord_bot_token = discord_bot_token
      @on_operator_message = on_operator_message
    end
  end

  # Handles incoming webhooks from bridges (Telegram, Slack, Discord)
  #
  # @example Usage with Rails
  #   class WebhooksController < ApplicationController
  #     def telegram
  #       handler = WebhookHandler.new(WebhookConfig.new(
  #         telegram_bot_token: ENV['TELEGRAM_BOT_TOKEN'],
  #         on_operator_message: ->(session_id, content, operator_name, source_bridge, attachments) {
  #           # Handle the message
  #         }
  #       ))
  #       response = handler.handle_telegram_webhook(params.to_unsafe_h)
  #       render json: response
  #     end
  #   end
  class WebhookHandler
    def initialize(config)
      @config = config
    end

    # ─────────────────────────────────────────────────────────────────
    # Telegram Webhook
    # ─────────────────────────────────────────────────────────────────

    # Handle an incoming Telegram webhook
    #
    # @param payload [Hash] The parsed JSON payload from Telegram
    # @return [Hash] Response to send back
    def handle_telegram_webhook(payload)
      return { error: "Telegram not configured" } unless @config.telegram_bot_token

      message = payload["message"]
      return { ok: true } unless message

      text = message["text"] || ""
      caption = message["caption"] || ""

      # Skip commands
      return { ok: true } if text.start_with?("/")

      # Use caption if no text
      text = caption if text.empty?

      # Parse media
      media = parse_telegram_media(message)

      # Skip if no content
      return { ok: true } if text.empty? && media.nil?

      # Get topic ID (session identifier)
      topic_id = message["message_thread_id"]
      return { ok: true } unless topic_id

      # Get operator name
      operator_name = message.dig("from", "first_name") || "Operator"

      # Download media if present
      attachments = []
      if media
        data = download_telegram_file(media[:file_id])
        if data
          attachments << OperatorAttachment.new(
            filename: media[:filename],
            mime_type: media[:mime_type],
            size: media[:size],
            data: data,
            bridge_file_id: media[:file_id]
          )
        end
      end

      # Call callback
      if @config.on_operator_message
        @config.on_operator_message.call(
          topic_id.to_s,
          text,
          operator_name,
          "telegram",
          attachments
        )
      end

      { ok: true }
    end

    # ─────────────────────────────────────────────────────────────────
    # Slack Webhook
    # ─────────────────────────────────────────────────────────────────

    # Handle an incoming Slack webhook
    #
    # @param payload [Hash] The parsed JSON payload from Slack
    # @return [Hash] Response to send back
    def handle_slack_webhook(payload)
      return { error: "Slack not configured" } unless @config.slack_bot_token

      # Handle URL verification challenge
      if payload["type"] == "url_verification" && payload["challenge"]
        return { challenge: payload["challenge"] }
      end

      # Handle event callbacks
      if payload["type"] == "event_callback" && payload["event"]
        event = payload["event"]

        has_content = event["type"] == "message" &&
                      event["thread_ts"] &&
                      !event["bot_id"] &&
                      !event["subtype"]

        files = event["files"] || []
        has_files = files.any?

        if has_content && (event["text"].to_s != "" || has_files)
          thread_ts = event["thread_ts"]
          text = event["text"] || ""

          # Download files if present
          attachments = []
          if has_files
            files.each do |file|
              data = download_slack_file(file)
              if data
                attachments << OperatorAttachment.new(
                  filename: file["name"] || "file",
                  mime_type: file["mimetype"] || "application/octet-stream",
                  size: file["size"] || 0,
                  data: data,
                  bridge_file_id: file["id"]
                )
              end
            end
          end

          # Get operator name
          operator_name = "Operator"
          user_id = event["user"]
          if user_id
            name = get_slack_user_name(user_id)
            operator_name = name if name
          end

          # Call callback
          if @config.on_operator_message
            @config.on_operator_message.call(
              thread_ts,
              text,
              operator_name,
              "slack",
              attachments
            )
          end
        end
      end

      { ok: true }
    end

    # ─────────────────────────────────────────────────────────────────
    # Discord Webhook
    # ─────────────────────────────────────────────────────────────────

    # Handle an incoming Discord webhook (interactions endpoint)
    #
    # @param payload [Hash] The parsed JSON payload from Discord
    # @return [Hash] Response to send back
    def handle_discord_webhook(payload)
      ping = 1
      application_command = 2
      pong = 1
      channel_message = 4

      interaction_type = payload["type"] || 0

      # Handle PING (verification)
      return { type: pong } if interaction_type == ping

      # Handle Application Commands (slash commands)
      if interaction_type == application_command && payload["data"]
        data = payload["data"]
        if data["name"] == "reply"
          thread_id = payload["channel_id"]
          content = nil

          (data["options"] || []).each do |opt|
            if opt["name"] == "message"
              content = opt["value"]
              break
            end
          end

          if thread_id && content
            # Get operator name
            operator_name = payload.dig("member", "user", "username") ||
                            payload.dig("user", "username") ||
                            "Operator"

            # Call callback
            if @config.on_operator_message
              @config.on_operator_message.call(
                thread_id,
                content,
                operator_name,
                "discord",
                []
              )
            end

            return {
              type: channel_message,
              data: { content: "✅ Message sent to visitor" }
            }
          end
        end
      end

      { type: pong }
    end

    private

    # ─────────────────────────────────────────────────────────────────
    # Telegram Helpers
    # ─────────────────────────────────────────────────────────────────

    def parse_telegram_media(message)
      if message["photo"].is_a?(Array) && message["photo"].any?
        largest = message["photo"].last
        {
          file_id: largest["file_id"],
          filename: "photo_#{Time.now.to_i}.jpg",
          mime_type: "image/jpeg",
          size: largest["file_size"] || 0
        }
      elsif message["document"]
        doc = message["document"]
        {
          file_id: doc["file_id"],
          filename: doc["file_name"] || "document_#{Time.now.to_i}",
          mime_type: doc["mime_type"] || "application/octet-stream",
          size: doc["file_size"] || 0
        }
      elsif message["audio"]
        audio = message["audio"]
        {
          file_id: audio["file_id"],
          filename: audio["file_name"] || "audio_#{Time.now.to_i}.mp3",
          mime_type: audio["mime_type"] || "audio/mpeg",
          size: audio["file_size"] || 0
        }
      elsif message["video"]
        video = message["video"]
        {
          file_id: video["file_id"],
          filename: video["file_name"] || "video_#{Time.now.to_i}.mp4",
          mime_type: video["mime_type"] || "video/mp4",
          size: video["file_size"] || 0
        }
      elsif message["voice"]
        voice = message["voice"]
        {
          file_id: voice["file_id"],
          filename: "voice_#{Time.now.to_i}.ogg",
          mime_type: voice["mime_type"] || "audio/ogg",
          size: voice["file_size"] || 0
        }
      end
    end

    def download_telegram_file(file_id)
      bot_token = @config.telegram_bot_token
      return nil unless bot_token

      # Get file path
      uri = URI("https://api.telegram.org/bot#{bot_token}/getFile?file_id=#{URI.encode_www_form_component(file_id)}")
      response = Net::HTTP.get_response(uri)
      return nil unless response.is_a?(Net::HTTPSuccess)

      result = JSON.parse(response.body)
      return nil unless result["ok"] && result.dig("result", "file_path")

      file_path = result["result"]["file_path"]

      # Download file
      download_uri = URI("https://api.telegram.org/file/bot#{bot_token}/#{file_path}")
      file_response = Net::HTTP.get_response(download_uri)
      return nil unless file_response.is_a?(Net::HTTPSuccess)

      file_response.body
    rescue StandardError => e
      warn "[WebhookHandler] Telegram file download error: #{e.message}"
      nil
    end

    # ─────────────────────────────────────────────────────────────────
    # Slack Helpers
    # ─────────────────────────────────────────────────────────────────

    def download_slack_file(file)
      download_url = file["url_private_download"] || file["url_private"]
      return nil unless download_url

      uri = URI(download_url)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true

      request = Net::HTTP::Get.new(uri)
      request["Authorization"] = "Bearer #{@config.slack_bot_token}"

      response = http.request(request)
      return nil unless response.is_a?(Net::HTTPSuccess)

      response.body
    rescue StandardError => e
      warn "[WebhookHandler] Slack file download error: #{e.message}"
      nil
    end

    def get_slack_user_name(user_id)
      uri = URI("https://slack.com/api/users.info?user=#{URI.encode_www_form_component(user_id)}")
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true

      request = Net::HTTP::Get.new(uri)
      request["Authorization"] = "Bearer #{@config.slack_bot_token}"

      response = http.request(request)
      return nil unless response.is_a?(Net::HTTPSuccess)

      result = JSON.parse(response.body)
      return nil unless result["ok"]

      result.dig("user", "real_name") || result.dig("user", "name")
    rescue StandardError
      nil
    end
  end
end

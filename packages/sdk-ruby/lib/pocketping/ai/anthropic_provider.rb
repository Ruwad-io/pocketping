# frozen_string_literal: true

require_relative "base"

module PocketPing
  module AI
    # Anthropic Claude Messages provider.
    #
    # @example
    #   provider = PocketPing::AI::AnthropicProvider.new(api_key: ENV["ANTHROPIC_API_KEY"])
    #   client = PocketPing::Client.new(ai_provider: provider)
    class AnthropicProvider < Base
      DEFAULT_MODEL = "claude-sonnet-4-20250514"
      DEFAULT_BASE_URL = "https://api.anthropic.com/v1"
      DEFAULT_SYSTEM_PROMPT = "You are a helpful customer support assistant."
      ANTHROPIC_VERSION = "2023-06-01"

      # @param api_key [String] Anthropic API key (required)
      # @param model [String] Model name (default: "claude-sonnet-4-20250514")
      # @param base_url [String] API base URL (default: "https://api.anthropic.com/v1")
      def initialize(api_key:, model: DEFAULT_MODEL, base_url: DEFAULT_BASE_URL)
        super()
        raise ArgumentError, "api_key is required" if api_key.nil? || api_key.empty?

        @api_key = api_key
        @model = model
        @base_url = base_url.chomp("/")
      end

      # @return [String] "anthropic"
      def name
        "anthropic"
      end

      # @param messages [Array<PocketPing::Message>]
      # @param system_prompt [String, nil]
      # @return [String]
      def generate_response(messages, system_prompt = nil)
        chat_messages = messages.map do |message|
          { role: role_for(message), content: message.content }
        end

        body = {
          model: @model,
          max_tokens: 1000,
          system: system_prompt || DEFAULT_SYSTEM_PROMPT,
          messages: chat_messages
        }

        data = post_json("#{@base_url}/messages", body, headers)
        data.dig("content", 0, "text") || ""
      end

      # Anthropic has no health endpoint; available when an API key is set.
      #
      # @return [Boolean]
      def available?
        !@api_key.nil? && !@api_key.empty?
      end

      private

      def headers
        {
          "x-api-key" => @api_key,
          "anthropic-version" => ANTHROPIC_VERSION
        }
      end
    end
  end
end

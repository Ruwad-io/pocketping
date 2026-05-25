# frozen_string_literal: true

require_relative "base"

module PocketPing
  module AI
    # OpenAI Chat Completions provider.
    #
    # @example
    #   provider = PocketPing::AI::OpenAIProvider.new(api_key: ENV["OPENAI_API_KEY"])
    #   client = PocketPing::Client.new(ai_provider: provider)
    class OpenAIProvider < Base
      DEFAULT_MODEL = "gpt-4o-mini"
      DEFAULT_BASE_URL = "https://api.openai.com/v1"

      # @param api_key [String] OpenAI API key (required)
      # @param model [String] Model name (default: "gpt-4o-mini")
      # @param base_url [String] API base URL (default: "https://api.openai.com/v1")
      def initialize(api_key:, model: DEFAULT_MODEL, base_url: DEFAULT_BASE_URL)
        super()
        raise ArgumentError, "api_key is required" if api_key.nil? || api_key.empty?

        @api_key = api_key
        @model = model
        @base_url = base_url.chomp("/")
      end

      # @return [String] "openai"
      def name
        "openai"
      end

      # @param messages [Array<PocketPing::Message>]
      # @param system_prompt [String, nil]
      # @return [String]
      def generate_response(messages, system_prompt = nil)
        chat_messages = []
        chat_messages << { role: "system", content: system_prompt } if system_prompt
        messages.each do |message|
          chat_messages << { role: role_for(message), content: message.content }
        end

        body = {
          model: @model,
          messages: chat_messages,
          max_tokens: 1000,
          temperature: 0.7
        }

        data = post_json("#{@base_url}/chat/completions", body, auth_headers)
        data.dig("choices", 0, "message", "content") || ""
      end

      # Check availability by listing models.
      #
      # @return [Boolean]
      def available?
        response = get("#{@base_url}/models", auth_headers)
        response.is_a?(Net::HTTPSuccess)
      rescue StandardError
        false
      end

      private

      def auth_headers
        { "Authorization" => "Bearer #{@api_key}" }
      end
    end
  end
end

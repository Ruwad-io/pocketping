# frozen_string_literal: true

require_relative "base"

module PocketPing
  module AI
    # Google Gemini generateContent provider.
    #
    # @example
    #   provider = PocketPing::AI::GeminiProvider.new(api_key: ENV["GEMINI_API_KEY"])
    #   client = PocketPing::Client.new(ai_provider: provider)
    class GeminiProvider < Base
      DEFAULT_MODEL = "gemini-1.5-flash"
      DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

      # @param api_key [String] Google AI API key (required)
      # @param model [String] Model name (default: "gemini-1.5-flash")
      # @param base_url [String] API base host (default Google endpoint, overridable for tests)
      def initialize(api_key:, model: DEFAULT_MODEL, base_url: DEFAULT_BASE_URL)
        super()
        raise ArgumentError, "api_key is required" if api_key.nil? || api_key.empty?

        @api_key = api_key
        @model = model
        @base_url = base_url.chomp("/")
      end

      # @return [String] "gemini"
      def name
        "gemini"
      end

      # @param messages [Array<PocketPing::Message>]
      # @param system_prompt [String, nil]
      # @return [String]
      def generate_response(messages, system_prompt = nil)
        contents = messages.map do |message|
          {
            role: message.sender == Sender::VISITOR ? "user" : "model",
            parts: [{ text: message.content }]
          }
        end

        # Prepend the system prompt to the first user turn, if any.
        if system_prompt && (first = contents.find { |c| c[:role] == "user" })
          original = first[:parts][0][:text]
          first[:parts][0][:text] = "#{system_prompt}\n\nUser: #{original}"
        end

        body = {
          contents: contents,
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.7
          }
        }

        url = "#{@base_url}/models/#{@model}:generateContent?key=#{@api_key}"
        data = post_json(url, body)
        data.dig("candidates", 0, "content", "parts", 0, "text") || ""
      end

      # Gemini has no lightweight health endpoint; available when a key is set.
      #
      # @return [Boolean]
      def available?
        !@api_key.nil? && !@api_key.empty?
      end
    end
  end
end

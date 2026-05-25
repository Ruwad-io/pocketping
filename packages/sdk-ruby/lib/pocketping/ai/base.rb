# frozen_string_literal: true

require "net/http"
require "uri"
require "json"

module PocketPing
  # AI provider integrations for the offline-takeover fallback.
  #
  # An AI provider is any object that responds to the duck-typed interface:
  #
  #   - #name                                         -> String
  #   - #generate_response(messages, system_prompt = nil) -> String
  #   - #available?                                   -> Boolean
  #
  # {AI::Base} is an optional convenience superclass that documents the
  # interface and provides a shared {#post_json} / {#get} helper built on
  # +Net::HTTP+. Providers may subclass it or simply duck-type the interface.
  module AI
    # Base class / duck interface for AI providers.
    #
    # @abstract Subclass and override {#name}, {#generate_response}, and {#available?}
    class Base
      # Unique name for this provider (e.g. "openai", "anthropic", "gemini").
      #
      # @return [String]
      # @abstract
      def name
        raise NotImplementedError, "#{self.class} must implement #name"
      end

      # Generate a reply for the given conversation.
      #
      # @param messages [Array<PocketPing::Message>] Conversation history
      # @param system_prompt [String, nil] Optional system prompt
      # @return [String] The generated reply (may be empty)
      # @abstract
      def generate_response(messages, system_prompt = nil)
        raise NotImplementedError, "#{self.class} must implement #generate_response"
      end

      # Whether the provider is currently usable.
      #
      # @return [Boolean]
      # @abstract
      def available?
        raise NotImplementedError, "#{self.class} must implement #available?"
      end

      private

      # Map a PocketPing message into the role/content pair most providers use.
      #
      # @param message [PocketPing::Message]
      # @return [String] "user" for visitor messages, "assistant" otherwise
      def role_for(message)
        message.sender == Sender::VISITOR ? "user" : "assistant"
      end

      # Perform a JSON POST request and return the parsed response body.
      #
      # @param url [String] Full request URL
      # @param body [Hash] Request body (serialized to JSON)
      # @param headers [Hash<String, String>] Additional request headers
      # @return [Hash] Parsed JSON response
      def post_json(url, body, headers = {})
        uri = URI(url)
        request = Net::HTTP::Post.new(uri)
        request["Content-Type"] = "application/json"
        headers.each { |key, value| request[key] = value }
        request.body = body.to_json

        response = http_for(uri).request(request)
        JSON.parse(response.body || "{}")
      end

      # Perform a GET request and return the raw +Net::HTTPResponse+.
      #
      # @param url [String] Full request URL
      # @param headers [Hash<String, String>] Additional request headers
      # @return [Net::HTTPResponse]
      def get(url, headers = {})
        uri = URI(url)
        request = Net::HTTP::Get.new(uri)
        headers.each { |key, value| request[key] = value }
        http_for(uri).request(request)
      end

      def http_for(uri)
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = uri.scheme == "https"
        http.open_timeout = 10
        http.read_timeout = 60
        http
      end
    end
  end
end

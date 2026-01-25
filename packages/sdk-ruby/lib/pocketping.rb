# frozen_string_literal: true

require_relative "pocketping/version"
require_relative "pocketping/models"
require_relative "pocketping/storage"
require_relative "pocketping/bridges"
require_relative "pocketping/version_checker"
require_relative "pocketping/ip_filter"
require_relative "pocketping/middleware/ip_filter_middleware"
require_relative "pocketping/core"

# PocketPing - Real-time customer chat with mobile notifications
#
# @example Basic usage with Rails
#   pp = PocketPing::Client.new(
#     welcome_message: "Hi! How can we help?",
#     on_new_session: ->(session) { puts "New session: #{session.id}" }
#   )
#
# @example With bridges
#   pp = PocketPing::Client.new(
#     bridges: [MyTelegramBridge.new],
#     ai_takeover_delay: 300
#   )
#
module PocketPing
  class Error < StandardError; end
  class SessionNotFoundError < Error; end
  class MessageNotFoundError < Error; end
  class UnauthorizedError < Error; end
  class InvalidRequestError < Error; end
  class ValidationError < Error; end

  class << self
    # Create a new PocketPing client instance
    #
    # @param options [Hash] Configuration options
    # @option options [Storage::Base] :storage Storage adapter (default: MemoryStorage)
    # @option options [Array<Bridge::Base>] :bridges Notification bridges
    # @option options [String] :welcome_message Welcome message for new sessions
    # @option options [Integer] :ai_takeover_delay Seconds before AI takes over
    # @option options [Proc] :on_new_session Callback for new sessions
    # @option options [Proc] :on_message Callback for messages
    # @option options [Proc] :on_event Callback for custom events
    # @option options [Proc] :on_identify Callback for user identification
    # @option options [String] :webhook_url Webhook URL for event forwarding
    # @option options [String] :webhook_secret HMAC secret for webhook signatures
    # @option options [Float] :webhook_timeout Webhook request timeout
    # @option options [String] :min_widget_version Minimum supported widget version
    # @option options [String] :latest_widget_version Latest available widget version
    # @return [Client] A new PocketPing client
    def new(**options)
      Client.new(**options)
    end
  end
end

# frozen_string_literal: true

require "rack"

module PocketPing
  module Middleware
    # Rack middleware for IP filtering on PocketPing routes
    #
    # @example With Rails
    #   # config/application.rb
    #   config.middleware.use PocketPing::Middleware::IpFilterMiddleware,
    #     pocketping: @pocketping_client,
    #     path_prefix: "/pocketping"
    #
    # @example With Sinatra
    #   use PocketPing::Middleware::IpFilterMiddleware,
    #     pocketping: @pocketping_client,
    #     path_prefix: "/pocketping"
    class IpFilterMiddleware
      # @param app [Object] The Rack app
      # @param options [Hash] Middleware options
      # @option options [PocketPing::Client] :pocketping The PocketPing client
      # @option options [String] :path_prefix Path prefix to filter (default: "/pocketping")
      def initialize(app, options = {})
        @app = app
        @pocketping = options[:pocketping]
        @path_prefix = options[:path_prefix] || "/pocketping"

        raise ArgumentError, "pocketping option is required" unless @pocketping
      end

      def call(env)
        request = Rack::Request.new(env)

        # Only filter requests to PocketPing routes
        unless request.path_info.start_with?(@path_prefix)
          return @app.call(env)
        end

        # Skip if IP filtering is disabled
        unless @pocketping.ip_filter&.enabled
          return @app.call(env)
        end

        # Get client IP
        ip = @pocketping.get_client_ip(request)

        # Check IP filter
        request_info = {
          path: request.path_info,
          method: request.request_method,
          user_agent: request.user_agent
        }

        result = @pocketping.check_ip_filter_with_logging(ip, request_info)

        if result.allowed
          @app.call(env)
        else
          blocked_response(@pocketping.ip_filter)
        end
      end

      private

      def blocked_response(config)
        status = config&.blocked_status_code || 403
        message = config&.blocked_message || "Forbidden"

        body = { error: message }.to_json

        [
          status,
          {
            "Content-Type" => "application/json",
            "Content-Length" => body.bytesize.to_s
          },
          [body]
        ]
      end
    end
  end
end

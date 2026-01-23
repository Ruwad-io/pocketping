# frozen_string_literal: true

require "ipaddr"

module PocketPing
  # IP filtering modes
  module IpFilterMode
    BLOCKLIST = "blocklist"
    ALLOWLIST = "allowlist"
    BOTH = "both"
  end

  # Reasons for IP filter decisions
  module IpFilterReason
    BLOCKLIST = "blocklist"
    ALLOWLIST = "allowlist"
    NOT_IN_ALLOWLIST = "not_in_allowlist"
    CUSTOM = "custom"
    DEFAULT = "default"
    DISABLED = "disabled"
  end

  # Result of an IP filter check
  class IpFilterResult
    # @return [Boolean] Whether the IP is allowed
    attr_reader :allowed

    # @return [String] The reason for the decision
    attr_reader :reason

    # @return [String, nil] The matching rule (CIDR or IP)
    attr_reader :matched_rule

    def initialize(allowed:, reason:, matched_rule: nil)
      @allowed = allowed
      @reason = reason
      @matched_rule = matched_rule
    end

    def to_h
      {
        allowed: @allowed,
        reason: @reason,
        matched_rule: @matched_rule
      }.compact
    end
  end

  # Log event for IP filter decisions
  class IpFilterLogEvent
    # @return [String] The client IP address
    attr_reader :ip

    # @return [Boolean] Whether access was allowed
    attr_reader :allowed

    # @return [String] The reason for the decision
    attr_reader :reason

    # @return [String, nil] The matching rule
    attr_reader :matched_rule

    # @return [Time] When the event occurred
    attr_reader :timestamp

    # @return [Hash, nil] Request metadata
    attr_reader :request_info

    def initialize(ip:, allowed:, reason:, matched_rule: nil, request_info: nil)
      @ip = ip
      @allowed = allowed
      @reason = reason
      @matched_rule = matched_rule
      @timestamp = Time.now.utc
      @request_info = request_info
    end

    def to_h
      {
        ip: @ip,
        allowed: @allowed,
        reason: @reason,
        matched_rule: @matched_rule,
        timestamp: @timestamp.iso8601,
        request_info: @request_info
      }.compact
    end
  end

  # IP filtering configuration
  class IpFilterConfig
    # @return [Boolean] Whether IP filtering is enabled
    attr_accessor :enabled

    # @return [String] The filter mode (blocklist, allowlist, both)
    attr_accessor :mode

    # @return [Array<String>] List of allowed IPs/CIDRs
    attr_accessor :allowlist

    # @return [Array<String>] List of blocked IPs/CIDRs
    attr_accessor :blocklist

    # @return [Proc, nil] Custom filter function (ip, request_info) -> Boolean | nil
    attr_accessor :custom_filter

    # @return [Boolean] Whether to log blocked requests
    attr_accessor :log_blocked

    # @return [Integer] HTTP status code for blocked requests
    attr_accessor :blocked_status_code

    # @return [String] Message for blocked requests
    attr_accessor :blocked_message

    # @return [Proc, nil] Callback for log events
    attr_accessor :on_blocked

    def initialize(
      enabled: false,
      mode: IpFilterMode::BLOCKLIST,
      allowlist: [],
      blocklist: [],
      custom_filter: nil,
      log_blocked: true,
      blocked_status_code: 403,
      blocked_message: "Forbidden",
      on_blocked: nil
    )
      @enabled = enabled
      @mode = mode
      @allowlist = allowlist || []
      @blocklist = blocklist || []
      @custom_filter = custom_filter
      @log_blocked = log_blocked
      @blocked_status_code = blocked_status_code
      @blocked_message = blocked_message
      @on_blocked = on_blocked
    end

    # Create from a hash of options
    #
    # @param options [Hash]
    # @return [IpFilterConfig]
    def self.from_hash(options)
      return nil if options.nil?

      new(
        enabled: options[:enabled] || options["enabled"] || false,
        mode: options[:mode] || options["mode"] || IpFilterMode::BLOCKLIST,
        allowlist: options[:allowlist] || options["allowlist"] || [],
        blocklist: options[:blocklist] || options["blocklist"] || [],
        custom_filter: options[:custom_filter] || options["custom_filter"],
        log_blocked: options.fetch(:log_blocked, options.fetch("log_blocked", true)),
        blocked_status_code: options[:blocked_status_code] || options["blocked_status_code"] || 403,
        blocked_message: options[:blocked_message] || options["blocked_message"] || "Forbidden",
        on_blocked: options[:on_blocked] || options["on_blocked"]
      )
    end
  end

  # IP filtering utility methods
  module IpFilter
    class << self
      # Check if an IP matches a CIDR range or exact IP
      #
      # @param ip [String] The IP address to check
      # @param cidr [String] The CIDR range or exact IP
      # @return [Boolean]
      def ip_matches_cidr?(ip, cidr)
        # Parse the CIDR (or treat as /32 if no prefix)
        range = if cidr.include?("/")
                  IPAddr.new(cidr)
                else
                  IPAddr.new(cidr)
                end

        # Parse the IP to check
        ip_addr = IPAddr.new(ip)

        # Check if IP is in range
        range.include?(ip_addr)
      rescue IPAddr::InvalidAddressError, IPAddr::AddressFamilyError
        false
      end

      # Check if an IP matches any entry in a list
      #
      # @param ip [String] The IP address to check
      # @param entries [Array<String>] List of IPs/CIDRs to check against
      # @return [String, nil] The matching entry or nil
      def ip_matches_any(ip, entries)
        return nil if entries.nil? || entries.empty?

        entries.find { |entry| ip_matches_cidr?(ip, entry) }
      end

      # Check if an IP should be allowed based on config (without custom filter)
      #
      # @param ip [String] The IP address to check
      # @param config [IpFilterConfig] The filter configuration
      # @return [IpFilterResult]
      def should_allow_ip(ip, config)
        return IpFilterResult.new(allowed: true, reason: IpFilterReason::DISABLED) if config.nil? || !config.enabled

        case config.mode
        when IpFilterMode::BLOCKLIST
          check_blocklist_mode(ip, config)
        when IpFilterMode::ALLOWLIST
          check_allowlist_mode(ip, config)
        when IpFilterMode::BOTH
          check_both_mode(ip, config)
        else
          IpFilterResult.new(allowed: true, reason: IpFilterReason::DEFAULT)
        end
      end

      # Full IP filter check including custom filter
      #
      # @param ip [String] The IP address to check
      # @param config [IpFilterConfig] The filter configuration
      # @param request_info [Hash, nil] Additional request information
      # @return [IpFilterResult]
      def check_ip_filter(ip, config, request_info = nil)
        return IpFilterResult.new(allowed: true, reason: IpFilterReason::DISABLED) if config.nil? || !config.enabled

        # Check custom filter first
        if config.custom_filter
          begin
            custom_result = config.custom_filter.call(ip, request_info)
            unless custom_result.nil?
              return IpFilterResult.new(
                allowed: custom_result,
                reason: IpFilterReason::CUSTOM
              )
            end
          rescue StandardError => e
            warn "[PocketPing] Custom IP filter error: #{e.message}"
          end
        end

        # Fall back to list-based filtering
        should_allow_ip(ip, config)
      end

      # Get client IP from a Rack request
      #
      # @param request [Rack::Request] The Rack request
      # @return [String] The client IP address
      def get_client_ip(request)
        # Check common proxy headers
        if (forwarded = request.env["HTTP_X_FORWARDED_FOR"])
          # X-Forwarded-For can contain multiple IPs - take the first (client)
          return forwarded.split(",").first.strip
        end

        if (real_ip = request.env["HTTP_X_REAL_IP"])
          return real_ip.strip
        end

        if (cf_ip = request.env["HTTP_CF_CONNECTING_IP"])
          return cf_ip.strip
        end

        # Fall back to direct IP
        request.ip
      end

      # Log an IP filter event
      #
      # @param config [IpFilterConfig] The filter configuration
      # @param result [IpFilterResult] The filter result
      # @param ip [String] The client IP
      # @param request_info [Hash, nil] Request metadata
      # @return [void]
      def log_filter_event(config, result, ip, request_info = nil)
        return unless config&.log_blocked && !result.allowed

        event = IpFilterLogEvent.new(
          ip: ip,
          allowed: result.allowed,
          reason: result.reason,
          matched_rule: result.matched_rule,
          request_info: request_info
        )

        warn "[PocketPing] IP blocked: #{ip} (reason: #{result.reason}#{result.matched_rule ? ", rule: #{result.matched_rule}" : ""})"

        # Call on_blocked callback if provided
        config.on_blocked&.call(event)
      end

      private

      def check_blocklist_mode(ip, config)
        matched = ip_matches_any(ip, config.blocklist)
        if matched
          IpFilterResult.new(
            allowed: false,
            reason: IpFilterReason::BLOCKLIST,
            matched_rule: matched
          )
        else
          IpFilterResult.new(allowed: true, reason: IpFilterReason::DEFAULT)
        end
      end

      def check_allowlist_mode(ip, config)
        matched = ip_matches_any(ip, config.allowlist)
        if matched
          IpFilterResult.new(
            allowed: true,
            reason: IpFilterReason::ALLOWLIST,
            matched_rule: matched
          )
        else
          IpFilterResult.new(allowed: false, reason: IpFilterReason::NOT_IN_ALLOWLIST)
        end
      end

      def check_both_mode(ip, config)
        # Allowlist takes precedence
        allowlist_matched = ip_matches_any(ip, config.allowlist)
        if allowlist_matched
          return IpFilterResult.new(
            allowed: true,
            reason: IpFilterReason::ALLOWLIST,
            matched_rule: allowlist_matched
          )
        end

        # Then check blocklist
        blocklist_matched = ip_matches_any(ip, config.blocklist)
        if blocklist_matched
          return IpFilterResult.new(
            allowed: false,
            reason: IpFilterReason::BLOCKLIST,
            matched_rule: blocklist_matched
          )
        end

        # Default allow if not in either list
        IpFilterResult.new(allowed: true, reason: IpFilterReason::DEFAULT)
      end
    end
  end
end

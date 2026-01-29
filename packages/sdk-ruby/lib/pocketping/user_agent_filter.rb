# frozen_string_literal: true

require 'time'

module PocketPing
  # User-Agent Filtering utilities for PocketPing SDK.
  # Blocks bots and unwanted user agents to prevent spam sessions.
  # Supports both substring matching and regex patterns.

  module UaFilterMode
    BLOCKLIST = 'blocklist'
    ALLOWLIST = 'allowlist'
    BOTH = 'both'
  end

  module UaFilterReason
    BLOCKLIST = 'blocklist'
    ALLOWLIST = 'allowlist'
    DEFAULT_BOT = 'default_bot'
    CUSTOM = 'custom'
    NOT_IN_ALLOWLIST = 'not_in_allowlist'
    DEFAULT = 'default'
  end

  # Default bot patterns to block.
  # These are known bots, crawlers, and automated tools that shouldn't create chat sessions.
  DEFAULT_BOT_PATTERNS = [
    # Search Engine Crawlers
    'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
    'yandexbot', 'sogou', 'exabot', 'facebot', 'ia_archiver',
    # SEO/Analytics Tools
    'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot', 'rogerbot',
    'screaming frog', 'seokicks', 'sistrix', 'linkdexbot', 'blexbot',
    # Generic Bot Indicators
    'bot/', 'crawler', 'spider', 'scraper', 'headless',
    'phantomjs', 'selenium', 'puppeteer', 'playwright', 'webdriver',
    # Monitoring/Uptime Services
    'pingdom', 'uptimerobot', 'statuscake', 'site24x7', 'newrelic',
    'datadog', 'gtmetrix', 'pagespeed',
    # Social Media Crawlers
    'twitterbot', 'linkedinbot', 'pinterestbot', 'telegrambot',
    'whatsapp', 'slackbot', 'discordbot', 'applebot',
    # AI/LLM Crawlers
    'gptbot', 'chatgpt-user', 'anthropic-ai', 'claude-web',
    'perplexitybot', 'ccbot', 'bytespider', 'cohere-ai',
    # HTTP Libraries (automated requests)
    'curl/', 'wget/', 'httpie/', 'python-requests', 'python-urllib',
    'axios/', 'node-fetch', 'go-http-client', 'java/', 'okhttp',
    'libwww-perl', 'httpclient',
    # Archive/Research Bots
    'archive.org_bot', 'wayback', 'commoncrawl',
    # Security Scanners
    'nmap', 'nikto', 'sqlmap', 'masscan', 'zgrab'
  ].freeze

  class UaFilterResult
    attr_reader :allowed, :reason, :matched_pattern

    def initialize(allowed:, reason:, matched_pattern: nil)
      @allowed = allowed
      @reason = reason
      @matched_pattern = matched_pattern
    end
  end

  class UaFilterLogEvent
    attr_reader :type, :user_agent, :reason, :matched_pattern, :path, :timestamp, :session_id

    def initialize(type:, user_agent:, reason:, matched_pattern:, path:, timestamp:, session_id: nil)
      @type = type
      @user_agent = user_agent
      @reason = reason
      @matched_pattern = matched_pattern
      @path = path
      @timestamp = timestamp
      @session_id = session_id
    end
  end

  class UaFilterConfig
    attr_accessor :enabled, :mode, :allowlist, :blocklist, :use_default_bots,
                  :custom_filter, :log_blocked, :logger,
                  :blocked_status_code, :blocked_message

    def initialize(
      enabled: false,
      mode: UaFilterMode::BLOCKLIST,
      allowlist: [],
      blocklist: [],
      use_default_bots: true,
      custom_filter: nil,
      log_blocked: true,
      logger: nil,
      blocked_status_code: 403,
      blocked_message: 'Forbidden'
    )
      @enabled = enabled
      @mode = mode
      @allowlist = allowlist
      @blocklist = blocklist
      @use_default_bots = use_default_bots
      @custom_filter = custom_filter
      @log_blocked = log_blocked
      @logger = logger
      @blocked_status_code = blocked_status_code
      @blocked_message = blocked_message
    end
  end

  class UserAgentFilter
    # Check if a pattern is a regex (starts and ends with /).
    def self.regex_pattern?(pattern)
      pattern.length > 2 && pattern.start_with?('/') && pattern.end_with?('/')
    end

    # Extract regex from pattern string (removes leading/trailing /).
    def self.extract_regex(pattern)
      regex_str = pattern[1..-2]
      Regexp.new(regex_str, Regexp::IGNORECASE)
    rescue RegexpError
      nil
    end

    # Check if a user-agent matches any pattern in the list.
    # Supports both substring matching and regex patterns (e.g., /bot-\d+/).
    # Returns the matched pattern or nil.
    def self.matches_any_pattern(user_agent, patterns)
      ua_lower = user_agent.downcase
      patterns.each do |pattern|
        # Check if pattern is a regex
        if regex_pattern?(pattern)
          regex = extract_regex(pattern)
          return pattern if regex&.match?(ua_lower)
        else
          # Simple substring match (case-insensitive)
          return pattern if ua_lower.include?(pattern.downcase)
        end
      end
      nil
    end

    # Main UA filter function - determines if a user-agent should be allowed.
    def self.should_allow_ua(user_agent, config)
      mode = config.mode
      allowlist = config.allowlist || []
      blocklist = (config.blocklist || []).dup

      # Add default bot patterns if enabled
      blocklist.concat(DEFAULT_BOT_PATTERNS) if config.use_default_bots

      case mode
      when UaFilterMode::ALLOWLIST
        # Only allow if in allowlist
        matched = matches_any_pattern(user_agent, allowlist)
        if matched
          return UaFilterResult.new(allowed: true, reason: UaFilterReason::ALLOWLIST, matched_pattern: matched)
        end

        UaFilterResult.new(allowed: false, reason: UaFilterReason::NOT_IN_ALLOWLIST)

      when UaFilterMode::BLOCKLIST
        # Block if in blocklist, allow otherwise
        matched = matches_any_pattern(user_agent, blocklist)
        if matched
          # Determine if it's a default bot or custom blocklist
          is_default_bot = matches_any_pattern(user_agent, config.blocklist || []).nil?
          reason = is_default_bot ? UaFilterReason::DEFAULT_BOT : UaFilterReason::BLOCKLIST
          return UaFilterResult.new(allowed: false, reason: reason, matched_pattern: matched)
        end
        UaFilterResult.new(allowed: true, reason: UaFilterReason::DEFAULT)

      when UaFilterMode::BOTH
        # Allowlist takes precedence, then check blocklist
        allow_matched = matches_any_pattern(user_agent, allowlist)
        if allow_matched
          return UaFilterResult.new(allowed: true, reason: UaFilterReason::ALLOWLIST, matched_pattern: allow_matched)
        end

        block_matched = matches_any_pattern(user_agent, blocklist)
        if block_matched
          is_default_bot = matches_any_pattern(user_agent, config.blocklist || []).nil?
          reason = is_default_bot ? UaFilterReason::DEFAULT_BOT : UaFilterReason::BLOCKLIST
          return UaFilterResult.new(allowed: false, reason: reason, matched_pattern: block_matched)
        end
        UaFilterResult.new(allowed: true, reason: UaFilterReason::DEFAULT)

      else
        UaFilterResult.new(allowed: true, reason: UaFilterReason::DEFAULT)
      end
    end

    # Check UA filter with support for custom filter callback.
    def self.check_ua_filter(user_agent, config, request_info = {})
      # No user-agent = allow (could be internal request)
      return UaFilterResult.new(allowed: true, reason: UaFilterReason::DEFAULT) if user_agent.nil? || user_agent.empty?

      # Disabled = allow all
      return UaFilterResult.new(allowed: true, reason: UaFilterReason::DEFAULT) unless config.enabled

      # 1. Check custom filter first
      if config.custom_filter.respond_to?(:call)
        result = config.custom_filter.call(user_agent, request_info)
        return UaFilterResult.new(allowed: true, reason: UaFilterReason::CUSTOM) if result == true
        return UaFilterResult.new(allowed: false, reason: UaFilterReason::CUSTOM) if result == false
        # nil = fall through to list-based filtering
      end

      # 2. Apply list-based filtering
      should_allow_ua(user_agent, config)
    end

    # Create a UA filter log event.
    def self.create_log_event(event_type, user_agent, reason, matched_pattern, path, session_id: nil)
      UaFilterLogEvent.new(
        type: event_type,
        user_agent: user_agent,
        reason: reason,
        matched_pattern: matched_pattern,
        path: path,
        timestamp: Time.now.utc,
        session_id: session_id
      )
    end

    # Check if a user-agent looks like a bot based on default patterns.
    # Utility function for quick bot detection.
    def self.bot?(user_agent)
      !matches_any_pattern(user_agent, DEFAULT_BOT_PATTERNS).nil?
    end
  end
end

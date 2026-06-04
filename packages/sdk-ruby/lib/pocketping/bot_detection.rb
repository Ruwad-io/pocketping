# frozen_string_literal: true

require "ipaddr"

module PocketPing
  # Heuristic bot detection for widget connections.
  #
  # Many widget sessions are bots that load the page (running JS, so the widget
  # connects) but never send a message. They spoof real-browser User-Agents — so
  # UA-pattern filtering does NOT catch them — but they originate from datacenter
  # / cloud IP ranges. This lets callers flag such connections and skip the
  # operator "new visitor" notification (the session can still be created, and a
  # thread created on-demand if the visitor ever actually sends a message, so
  # false positives self-heal).
  #
  # Dependency-free: a bundled list of well-known cloud/datacenter CIDR ranges
  # plus obvious headless/automation UA markers, and an optional ASN org-name
  # signal. Mirrors the SaaS lib/bot-detection.ts for cross-mode parity.
  module BotDetection
    # Curated (non-exhaustive) list of cloud/datacenter ranges that dominate
    # scraper / headless-browser traffic. Refresh periodically from providers'
    # published ranges.
    DEFAULT_DATACENTER_CIDRS = [
      # Google Cloud (the 34.x / 35.x ranges seen dominating real traffic)
      "34.0.0.0/9", "34.128.0.0/10", "35.184.0.0/13", "35.192.0.0/14",
      "35.196.0.0/15", "35.198.0.0/16", "35.200.0.0/13", "35.208.0.0/12",
      "35.224.0.0/12", "35.240.0.0/13", "104.196.0.0/14", "104.154.0.0/15",
      "130.211.0.0/16", "146.148.0.0/17",
      # Amazon AWS
      "3.0.0.0/9", "13.32.0.0/15", "15.177.0.0/18", "18.32.0.0/11",
      "52.0.0.0/11", "54.64.0.0/11", "99.77.0.0/18",
      # Microsoft Azure
      "13.64.0.0/11", "20.0.0.0/11", "40.64.0.0/10", "52.224.0.0/11", "104.40.0.0/13",
      # DigitalOcean
      "104.131.0.0/16", "138.197.0.0/16", "142.93.0.0/16", "159.65.0.0/16",
      "165.227.0.0/16", "167.71.0.0/16", "167.99.0.0/16", "178.62.0.0/16",
      "188.166.0.0/16",
      # OVH
      "51.68.0.0/14", "51.75.0.0/16", "51.81.0.0/16", "54.36.0.0/16",
      "145.239.0.0/16", "147.135.0.0/16", "198.27.64.0/18",
      # Hetzner
      "5.9.0.0/16", "78.46.0.0/15", "88.99.0.0/16", "94.130.0.0/16",
      "116.202.0.0/15", "135.181.0.0/16", "136.243.0.0/16", "142.132.0.0/16",
      "157.90.0.0/16", "159.69.0.0/16", "167.235.0.0/16", "168.119.0.0/16",
      "188.40.0.0/16",
      # Linode / Akamai
      "45.33.0.0/16", "45.56.0.0/16", "45.79.0.0/16", "139.144.0.0/16",
      "172.104.0.0/15", "173.255.192.0/18",
      # Scaleway / Online.net
      "51.15.0.0/16", "51.158.0.0/15", "163.172.0.0/16", "195.154.0.0/16",
      "212.83.128.0/19",
      # Datacenter IPv6 prefixes
      "2600:1f00::/24", "2a05:d000::/24", "2001:41d0::/32", "2a01:4f8::/29",
      "2604:a880::/32", "2a03:b0c0::/32", "2607:f8b0::/32", "2a00:1450::/32"
    ].freeze

    # Obvious automation/headless User-Agent substrings.
    HEADLESS_UA_MARKERS = [
      "headlesschrome", "phantomjs", "electron", "puppeteer", "playwright",
      "selenium", "webdriver", "python-requests", "curl/", "wget/",
      "go-http-client", "node-fetch", "axios/", "java/", "okhttp"
    ].freeze

    # UNAMBIGUOUS hosting/datacenter ASN org-name substrings. Broad consumer
    # brands (google/amazon/microsoft/cloudflare) are intentionally excluded —
    # they also run residential ASNs (e.g. "Google Fiber") and their cloud
    # ranges are covered by DEFAULT_DATACENTER_CIDRS instead.
    HOSTING_ORG_MARKERS = [
      "digitalocean", "ovh", "hetzner", "linode", "scaleway", "vultr",
      "leaseweb", "contabo", "datacamp", "m247", "choopa", "datacenter",
      "data center", "hosting"
    ].freeze

    # Pre-parsed datacenter networks for fast containment checks.
    DATACENTER_NETS = DEFAULT_DATACENTER_CIDRS.map do |cidr|
      IPAddr.new(cidr)
    rescue IPAddr::Error
      nil
    end.compact.freeze

    # Result of a bot-detection verdict.
    class BotVerdict
      # @return [Boolean] Whether the connection is flagged as a bot
      attr_reader :is_bot

      # @return [String, nil] "datacenter_ip" | "hosting_asn" | "headless_ua" | nil
      attr_reader :reason

      def initialize(is_bot:, reason: nil)
        @is_bot = is_bot
        @reason = reason
      end

      def to_h
        { is_bot: @is_bot, reason: @reason }
      end
    end

    class << self
      # Report whether ip belongs to a known datacenter/cloud range.
      #
      # @param ip [String, nil] The IP address to check
      # @return [Boolean]
      def datacenter_ip?(ip)
        return false if ip.nil?

        ip = ip.strip
        return false if ip.empty? || ip.casecmp("unknown").zero?

        ip = ip.delete("[]")
        parsed = begin
          IPAddr.new(ip)
        rescue IPAddr::Error
          nil
        end
        return false if parsed.nil?

        DATACENTER_NETS.any? { |net| net.include?(parsed) }
      end

      # Report whether ua contains an obvious automation marker.
      #
      # @param user_agent [String, nil] The User-Agent string
      # @return [Boolean]
      def headless_user_agent?(user_agent)
        return false if user_agent.nil? || user_agent.empty?

        lower = user_agent.downcase
        HEADLESS_UA_MARKERS.any? { |marker| lower.include?(marker) }
      end

      # Report whether org is an unambiguous hosting/cloud provider.
      #
      # @param org [String, nil] The ASN org name
      # @return [Boolean]
      def hosting_org?(org)
        return false if org.nil? || org.empty?

        lower = org.downcase
        HOSTING_ORG_MARKERS.any? { |marker| lower.include?(marker) }
      end

      # Return a heuristic verdict for a widget connection. A connection is
      # flagged when it comes from a datacenter IP (or hosting ASN) or carries a
      # headless UA marker.
      #
      # @param ip [String, nil] The client IP address
      # @param user_agent [String, nil] The client User-Agent
      # @param org [String, nil] The ASN org name, when available
      # @return [BotVerdict]
      def detect_bot(ip:, user_agent:, org:)
        return BotVerdict.new(is_bot: true, reason: "datacenter_ip") if datacenter_ip?(ip)
        return BotVerdict.new(is_bot: true, reason: "hosting_asn") if hosting_org?(org)
        return BotVerdict.new(is_bot: true, reason: "headless_ua") if headless_user_agent?(user_agent)

        BotVerdict.new(is_bot: false, reason: nil)
      end
    end
  end
end

# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::IpFilter do
  describe ".ip_matches_cidr?" do
    context "with exact IP match" do
      it "returns true for matching IP" do
        expect(described_class.ip_matches_cidr?("192.168.1.1", "192.168.1.1")).to be true
      end

      it "returns false for non-matching IP" do
        expect(described_class.ip_matches_cidr?("192.168.1.2", "192.168.1.1")).to be false
      end
    end

    context "with /24 subnet" do
      it "matches IP at start of range" do
        expect(described_class.ip_matches_cidr?("192.168.1.0", "192.168.1.0/24")).to be true
      end

      it "matches IP in middle of range" do
        expect(described_class.ip_matches_cidr?("192.168.1.1", "192.168.1.0/24")).to be true
      end

      it "matches IP at end of range" do
        expect(described_class.ip_matches_cidr?("192.168.1.255", "192.168.1.0/24")).to be true
      end

      it "does not match IP outside range" do
        expect(described_class.ip_matches_cidr?("192.168.2.0", "192.168.1.0/24")).to be false
      end
    end

    context "with /16 subnet" do
      it "matches IP in range" do
        expect(described_class.ip_matches_cidr?("192.168.0.0", "192.168.0.0/16")).to be true
        expect(described_class.ip_matches_cidr?("192.168.255.255", "192.168.0.0/16")).to be true
      end

      it "does not match IP outside range" do
        expect(described_class.ip_matches_cidr?("192.169.0.0", "192.168.0.0/16")).to be false
      end
    end

    context "with /8 subnet" do
      it "matches IP in range" do
        expect(described_class.ip_matches_cidr?("10.0.0.1", "10.0.0.0/8")).to be true
        expect(described_class.ip_matches_cidr?("10.255.255.255", "10.0.0.0/8")).to be true
      end

      it "does not match IP outside range" do
        expect(described_class.ip_matches_cidr?("11.0.0.0", "10.0.0.0/8")).to be false
      end
    end

    context "with /32 (single IP)" do
      it "matches exact IP" do
        expect(described_class.ip_matches_cidr?("203.0.113.50", "203.0.113.50/32")).to be true
      end

      it "does not match different IP" do
        expect(described_class.ip_matches_cidr?("203.0.113.51", "203.0.113.50/32")).to be false
      end
    end

    context "with /0 (all IPs)" do
      it "matches any IP" do
        expect(described_class.ip_matches_cidr?("1.2.3.4", "0.0.0.0/0")).to be true
        expect(described_class.ip_matches_cidr?("255.255.255.255", "0.0.0.0/0")).to be true
      end
    end

    context "with invalid inputs" do
      it "returns false for invalid IP" do
        expect(described_class.ip_matches_cidr?("invalid", "192.168.1.0/24")).to be false
      end

      it "returns false for invalid CIDR" do
        expect(described_class.ip_matches_cidr?("192.168.1.1", "invalid/24")).to be false
      end
    end
  end

  describe ".ip_matches_any" do
    let(:entries) { ["192.168.1.0/24", "10.0.0.0/8", "203.0.113.50"] }

    it "returns matching entry for IP in first range" do
      expect(described_class.ip_matches_any("192.168.1.100", entries)).to eq("192.168.1.0/24")
    end

    it "returns matching entry for IP in second range" do
      expect(described_class.ip_matches_any("10.50.25.1", entries)).to eq("10.0.0.0/8")
    end

    it "returns matching entry for exact IP match" do
      expect(described_class.ip_matches_any("203.0.113.50", entries)).to eq("203.0.113.50")
    end

    it "returns nil for IP not in any entry" do
      expect(described_class.ip_matches_any("172.16.0.1", entries)).to be_nil
      expect(described_class.ip_matches_any("8.8.8.8", entries)).to be_nil
    end

    it "returns nil for empty list" do
      expect(described_class.ip_matches_any("192.168.1.1", [])).to be_nil
    end
  end

  describe ".should_allow_ip" do
    context "with blocklist mode" do
      let(:config) do
        PocketPing::IpFilterConfig.new(
          enabled: true,
          mode: PocketPing::IpFilterMode::BLOCKLIST,
          blocklist: ["192.168.1.0/24", "203.0.113.0/24"]
        )
      end

      it "blocks IPs in blocklist" do
        result = described_class.should_allow_ip("192.168.1.50", config)
        expect(result.allowed).to be false
        expect(result.reason).to eq(PocketPing::IpFilterReason::BLOCKLIST)
      end

      it "allows IPs not in blocklist" do
        result = described_class.should_allow_ip("10.0.0.1", config)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::IpFilterReason::DEFAULT)
      end
    end

    context "with allowlist mode" do
      let(:config) do
        PocketPing::IpFilterConfig.new(
          enabled: true,
          mode: PocketPing::IpFilterMode::ALLOWLIST,
          allowlist: ["10.0.0.0/8", "192.168.0.0/16"]
        )
      end

      it "allows IPs in allowlist" do
        result = described_class.should_allow_ip("10.0.0.50", config)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::IpFilterReason::ALLOWLIST)
      end

      it "blocks IPs not in allowlist" do
        result = described_class.should_allow_ip("172.16.0.1", config)
        expect(result.allowed).to be false
        expect(result.reason).to eq(PocketPing::IpFilterReason::NOT_IN_ALLOWLIST)
      end
    end

    context "with both mode" do
      let(:config) do
        PocketPing::IpFilterConfig.new(
          enabled: true,
          mode: PocketPing::IpFilterMode::BOTH,
          allowlist: ["10.0.0.1"],
          blocklist: ["10.0.0.0/24"]
        )
      end

      it "allows IP in allowlist even if in blocklist range" do
        result = described_class.should_allow_ip("10.0.0.1", config)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::IpFilterReason::ALLOWLIST)
      end

      it "blocks IP in blocklist but not in allowlist" do
        result = described_class.should_allow_ip("10.0.0.2", config)
        expect(result.allowed).to be false
        expect(result.reason).to eq(PocketPing::IpFilterReason::BLOCKLIST)
      end

      it "allows IP not in either list" do
        result = described_class.should_allow_ip("8.8.8.8", config)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::IpFilterReason::DEFAULT)
      end
    end

    context "with disabled config" do
      it "allows all IPs when config is nil" do
        result = described_class.should_allow_ip("192.168.1.1", nil)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::IpFilterReason::DISABLED)
      end

      it "allows all IPs when enabled is false" do
        config = PocketPing::IpFilterConfig.new(
          enabled: false,
          blocklist: ["192.168.1.0/24"]
        )
        result = described_class.should_allow_ip("192.168.1.50", config)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::IpFilterReason::DISABLED)
      end
    end
  end

  describe ".check_ip_filter" do
    context "with custom filter" do
      it "blocks when custom filter returns false" do
        config = PocketPing::IpFilterConfig.new(
          enabled: true,
          mode: PocketPing::IpFilterMode::BLOCKLIST,
          blocklist: ["192.168.1.0/24"],
          custom_filter: ->(ip, _request_info) { ip.start_with?("10.") ? false : nil }
        )

        result = described_class.check_ip_filter("10.0.0.1", config, nil)
        expect(result.allowed).to be false
        expect(result.reason).to eq(PocketPing::IpFilterReason::CUSTOM)
      end

      it "allows when custom filter returns true" do
        config = PocketPing::IpFilterConfig.new(
          enabled: true,
          mode: PocketPing::IpFilterMode::BLOCKLIST,
          blocklist: ["192.168.1.0/24"],
          custom_filter: ->(ip, _request_info) { ip == "8.8.8.8" ? true : nil }
        )

        result = described_class.check_ip_filter("8.8.8.8", config, nil)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::IpFilterReason::CUSTOM)
      end

      it "defers to list-based filtering when custom filter returns nil" do
        config = PocketPing::IpFilterConfig.new(
          enabled: true,
          mode: PocketPing::IpFilterMode::BLOCKLIST,
          blocklist: ["192.168.1.0/24"],
          custom_filter: ->(_ip, _request_info) { nil }
        )

        result = described_class.check_ip_filter("192.168.1.50", config, nil)
        expect(result.allowed).to be false
        expect(result.reason).to eq(PocketPing::IpFilterReason::BLOCKLIST)
      end

      it "handles custom filter errors gracefully" do
        config = PocketPing::IpFilterConfig.new(
          enabled: true,
          mode: PocketPing::IpFilterMode::BLOCKLIST,
          blocklist: [],
          custom_filter: ->(_ip, _request_info) { raise "test error" }
        )

        # Should not raise, falls back to list-based filtering
        result = described_class.check_ip_filter("192.168.1.1", config, nil)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::IpFilterReason::DEFAULT)
      end
    end
  end
end

RSpec.describe PocketPing::IpFilterConfig do
  describe ".from_hash" do
    it "creates config from hash with symbol keys" do
      config = described_class.from_hash(
        enabled: true,
        mode: "blocklist",
        blocklist: ["192.168.1.0/24"]
      )

      expect(config.enabled).to be true
      expect(config.mode).to eq("blocklist")
      expect(config.blocklist).to eq(["192.168.1.0/24"])
    end

    it "creates config from hash with string keys" do
      config = described_class.from_hash(
        "enabled" => true,
        "mode" => "allowlist",
        "allowlist" => ["10.0.0.0/8"]
      )

      expect(config.enabled).to be true
      expect(config.mode).to eq("allowlist")
      expect(config.allowlist).to eq(["10.0.0.0/8"])
    end

    it "returns nil for nil input" do
      expect(described_class.from_hash(nil)).to be_nil
    end

    it "uses defaults for missing values" do
      config = described_class.from_hash({})

      expect(config.enabled).to be false
      expect(config.mode).to eq(PocketPing::IpFilterMode::BLOCKLIST)
      expect(config.allowlist).to eq([])
      expect(config.blocklist).to eq([])
      expect(config.log_blocked).to be true
      expect(config.blocked_status_code).to eq(403)
      expect(config.blocked_message).to eq("Forbidden")
    end
  end
end

RSpec.describe PocketPing::Client do
  describe "IP filter integration" do
    it "accepts ip_filter in constructor" do
      client = PocketPing::Client.new(
        ip_filter: {
          enabled: true,
          mode: "blocklist",
          blocklist: ["192.168.1.0/24"]
        }
      )

      expect(client.ip_filter).to be_a(PocketPing::IpFilterConfig)
      expect(client.ip_filter.enabled).to be true
      expect(client.ip_filter.blocklist).to eq(["192.168.1.0/24"])
    end

    it "accepts IpFilterConfig object in constructor" do
      config = PocketPing::IpFilterConfig.new(
        enabled: true,
        mode: PocketPing::IpFilterMode::ALLOWLIST,
        allowlist: ["10.0.0.0/8"]
      )

      client = PocketPing::Client.new(ip_filter: config)

      expect(client.ip_filter).to eq(config)
    end

    describe "#check_ip_filter" do
      let(:client) do
        PocketPing::Client.new(
          ip_filter: {
            enabled: true,
            mode: "blocklist",
            blocklist: ["192.168.1.0/24"]
          }
        )
      end

      it "returns blocked result for blocked IP" do
        result = client.check_ip_filter("192.168.1.50")
        expect(result.allowed).to be false
        expect(result.reason).to eq(PocketPing::IpFilterReason::BLOCKLIST)
      end

      it "returns allowed result for allowed IP" do
        result = client.check_ip_filter("10.0.0.1")
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::IpFilterReason::DEFAULT)
      end
    end
  end
end

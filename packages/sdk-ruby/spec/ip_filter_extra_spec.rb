# frozen_string_literal: true

require "spec_helper"
require "rack"

RSpec.describe PocketPing::IpFilter do
  describe ".get_client_ip" do
    def request_with(env_overrides)
      env = Rack::MockRequest.env_for("/", "REMOTE_ADDR" => "127.0.0.1")
      env.merge!(env_overrides)
      Rack::Request.new(env)
    end

    it "prefers the first IP from X-Forwarded-For" do
      req = request_with("HTTP_X_FORWARDED_FOR" => "203.0.113.1, 10.0.0.1")
      expect(described_class.get_client_ip(req)).to eq("203.0.113.1")
    end

    it "falls back to X-Real-IP" do
      req = request_with("HTTP_X_REAL_IP" => " 198.51.100.2 ")
      expect(described_class.get_client_ip(req)).to eq("198.51.100.2")
    end

    it "falls back to CF-Connecting-IP" do
      req = request_with("HTTP_CF_CONNECTING_IP" => " 198.51.100.3 ")
      expect(described_class.get_client_ip(req)).to eq("198.51.100.3")
    end

    it "falls back to the direct request IP" do
      req = request_with({})
      expect(described_class.get_client_ip(req)).to eq("127.0.0.1")
    end
  end

  describe ".log_filter_event" do
    it "does nothing when the result is allowed" do
      config = PocketPing::IpFilterConfig.new(enabled: true, log_blocked: true)
      result = PocketPing::IpFilterResult.new(allowed: true, reason: "default")
      expect { described_class.log_filter_event(config, result, "1.2.3.4") }.not_to output.to_stderr
    end

    it "does nothing when logging is disabled" do
      config = PocketPing::IpFilterConfig.new(enabled: true, log_blocked: false)
      result = PocketPing::IpFilterResult.new(allowed: false, reason: "blocklist", matched_rule: "1.2.3.4")
      expect { described_class.log_filter_event(config, result, "1.2.3.4") }.not_to output.to_stderr
    end

    it "warns and invokes on_blocked when blocked" do
      seen = []
      config = PocketPing::IpFilterConfig.new(enabled: true, log_blocked: true, on_blocked: ->(e) { seen << e })
      result = PocketPing::IpFilterResult.new(allowed: false, reason: "blocklist", matched_rule: "1.2.3.4")
      expect { described_class.log_filter_event(config, result, "1.2.3.4", { path: "/x" }) }
        .to output(/IP blocked: 1\.2\.3\.4/).to_stderr
      expect(seen.length).to eq(1)
      expect(seen.first.matched_rule).to eq("1.2.3.4")
    end
  end

  describe ".check_ip_filter custom filter errors" do
    it "swallows custom filter errors and falls back to list filtering" do
      config = PocketPing::IpFilterConfig.new(
        enabled: true, mode: "blocklist", blocklist: ["1.2.3.4"],
        custom_filter: ->(_ip, _req) { raise "kaboom" }
      )
      expect do
        result = described_class.check_ip_filter("1.2.3.4", config)
        expect(result.allowed).to be false
        expect(result.reason).to eq("blocklist")
      end.to output(/Custom IP filter error/).to_stderr
    end

    it "returns disabled when config is nil" do
      result = described_class.check_ip_filter("1.2.3.4", nil)
      expect(result.allowed).to be true
      expect(result.reason).to eq("disabled")
    end
  end

  describe ".should_allow_ip default branch" do
    it "allows when mode is unrecognized" do
      config = PocketPing::IpFilterConfig.new(enabled: true, mode: "nonsense")
      result = described_class.should_allow_ip("1.2.3.4", config)
      expect(result.allowed).to be true
      expect(result.reason).to eq("default")
    end
  end
end

RSpec.describe PocketPing::IpFilterLogEvent do
  it "serializes to a compact hash with an ISO timestamp" do
    event = described_class.new(
      ip: "1.2.3.4", allowed: false, reason: "blocklist",
      matched_rule: "1.2.3.0/24", request_info: { path: "/x" }
    )
    hash = event.to_h
    expect(hash[:ip]).to eq("1.2.3.4")
    expect(hash[:allowed]).to be false
    expect(hash[:reason]).to eq("blocklist")
    expect(hash[:matched_rule]).to eq("1.2.3.0/24")
    expect(hash[:request_info]).to eq(path: "/x")
    expect(hash[:timestamp]).to match(/\dT\d/)
  end
end

RSpec.describe PocketPing::IpFilterResult do
  it "omits a nil matched_rule from the hash" do
    result = described_class.new(allowed: true, reason: "default")
    expect(result.to_h).to eq(allowed: true, reason: "default")
  end
end

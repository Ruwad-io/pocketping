# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::UserAgentFilter do
  describe ".regex_pattern?" do
    it "detects a slash-wrapped regex pattern" do
      expect(described_class.regex_pattern?("/bot-\\d+/")).to be true
    end

    it "returns false for a substring pattern" do
      expect(described_class.regex_pattern?("googlebot")).to be false
    end

    it "returns false for a too-short pattern" do
      expect(described_class.regex_pattern?("//")).to be false
    end

    it "returns false when only the leading slash is present" do
      expect(described_class.regex_pattern?("/abc")).to be false
    end
  end

  describe ".extract_regex" do
    it "builds a case-insensitive regex" do
      regex = described_class.extract_regex("/bot-\\d+/")
      expect(regex).to be_a(Regexp)
      expect(regex.match?("BOT-42")).to be true
    end

    it "returns nil for an invalid regex" do
      expect(described_class.extract_regex("/[/")).to be_nil
    end
  end

  describe ".matches_any_pattern" do
    it "matches a substring case-insensitively" do
      expect(described_class.matches_any_pattern("Mozilla Googlebot/2.1", ["googlebot"])).to eq("googlebot")
    end

    it "matches a regex pattern" do
      expect(described_class.matches_any_pattern("custom-bot-123", ["/bot-\\d+/"])).to eq("/bot-\\d+/")
    end

    it "skips an invalid regex pattern without raising" do
      expect(described_class.matches_any_pattern("custom-bot-123", ["/[/"])).to be_nil
    end

    it "returns nil when nothing matches" do
      expect(described_class.matches_any_pattern("Mozilla/5.0", ["googlebot"])).to be_nil
    end
  end

  describe ".bot?" do
    it "detects a known bot from default patterns" do
      expect(described_class.bot?("Mozilla/5.0 (compatible; Googlebot/2.1)")).to be true
    end

    it "detects an HTTP library user agent" do
      expect(described_class.bot?("curl/8.0.1")).to be true
    end

    it "returns false for a real browser" do
      ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
      expect(described_class.bot?(ua)).to be false
    end
  end

  describe ".should_allow_ua" do
    context "with blocklist mode" do
      it "blocks a default bot with default_bot reason" do
        config = PocketPing::UaFilterConfig.new(enabled: true, mode: PocketPing::UaFilterMode::BLOCKLIST)
        result = described_class.should_allow_ua("Googlebot/2.1", config)
        expect(result.allowed).to be false
        expect(result.reason).to eq(PocketPing::UaFilterReason::DEFAULT_BOT)
      end

      it "blocks a custom blocklist entry with blocklist reason" do
        config = PocketPing::UaFilterConfig.new(
          enabled: true,
          mode: PocketPing::UaFilterMode::BLOCKLIST,
          blocklist: ["evilcorp"],
          use_default_bots: false
        )
        result = described_class.should_allow_ua("EvilCorp Scanner", config)
        expect(result.allowed).to be false
        expect(result.reason).to eq(PocketPing::UaFilterReason::BLOCKLIST)
      end

      it "allows a normal browser" do
        config = PocketPing::UaFilterConfig.new(enabled: true, mode: PocketPing::UaFilterMode::BLOCKLIST)
        result = described_class.should_allow_ua("Mozilla/5.0 Firefox/120", config)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::UaFilterReason::DEFAULT)
      end
    end

    context "with allowlist mode" do
      it "allows an allowlisted user agent" do
        config = PocketPing::UaFilterConfig.new(
          enabled: true,
          mode: PocketPing::UaFilterMode::ALLOWLIST,
          allowlist: ["mycustomapp"]
        )
        result = described_class.should_allow_ua("MyCustomApp/1.0", config)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::UaFilterReason::ALLOWLIST)
        expect(result.matched_pattern).to eq("mycustomapp")
      end

      it "blocks anything not in the allowlist" do
        config = PocketPing::UaFilterConfig.new(
          enabled: true,
          mode: PocketPing::UaFilterMode::ALLOWLIST,
          allowlist: ["mycustomapp"]
        )
        result = described_class.should_allow_ua("Mozilla/5.0", config)
        expect(result.allowed).to be false
        expect(result.reason).to eq(PocketPing::UaFilterReason::NOT_IN_ALLOWLIST)
      end
    end

    context "with both mode" do
      it "allowlist takes precedence over blocklist" do
        config = PocketPing::UaFilterConfig.new(
          enabled: true,
          mode: PocketPing::UaFilterMode::BOTH,
          allowlist: ["goodbot"],
          blocklist: ["goodbot"],
          use_default_bots: false
        )
        result = described_class.should_allow_ua("GoodBot/1.0", config)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::UaFilterReason::ALLOWLIST)
      end

      it "blocks a default bot when not allowlisted" do
        config = PocketPing::UaFilterConfig.new(
          enabled: true,
          mode: PocketPing::UaFilterMode::BOTH,
          allowlist: ["goodbot"]
        )
        result = described_class.should_allow_ua("Googlebot/2.1", config)
        expect(result.allowed).to be false
        expect(result.reason).to eq(PocketPing::UaFilterReason::DEFAULT_BOT)
      end

      it "blocks a custom blocklist entry with blocklist reason in both mode" do
        config = PocketPing::UaFilterConfig.new(
          enabled: true,
          mode: PocketPing::UaFilterMode::BOTH,
          blocklist: ["evilcorp"],
          use_default_bots: false
        )
        result = described_class.should_allow_ua("EvilCorp", config)
        expect(result.allowed).to be false
        expect(result.reason).to eq(PocketPing::UaFilterReason::BLOCKLIST)
      end

      it "allows when in neither list" do
        config = PocketPing::UaFilterConfig.new(
          enabled: true,
          mode: PocketPing::UaFilterMode::BOTH,
          use_default_bots: false
        )
        result = described_class.should_allow_ua("Mozilla/5.0", config)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::UaFilterReason::DEFAULT)
      end
    end

    context "with an unknown mode" do
      it "defaults to allow" do
        config = PocketPing::UaFilterConfig.new(enabled: true, mode: "weird")
        result = described_class.should_allow_ua("anything", config)
        expect(result.allowed).to be true
        expect(result.reason).to eq(PocketPing::UaFilterReason::DEFAULT)
      end
    end
  end

  describe ".check_ua_filter" do
    it "allows when the user agent is nil" do
      config = PocketPing::UaFilterConfig.new(enabled: true)
      result = described_class.check_ua_filter(nil, config)
      expect(result.allowed).to be true
      expect(result.reason).to eq(PocketPing::UaFilterReason::DEFAULT)
    end

    it "allows when the user agent is empty" do
      config = PocketPing::UaFilterConfig.new(enabled: true)
      result = described_class.check_ua_filter("", config)
      expect(result.allowed).to be true
    end

    it "allows everything when disabled" do
      config = PocketPing::UaFilterConfig.new(enabled: false)
      result = described_class.check_ua_filter("Googlebot/2.1", config)
      expect(result.allowed).to be true
      expect(result.reason).to eq(PocketPing::UaFilterReason::DEFAULT)
    end

    it "honors a custom filter that allows" do
      config = PocketPing::UaFilterConfig.new(enabled: true, custom_filter: ->(_ua, _req) { true })
      result = described_class.check_ua_filter("Googlebot/2.1", config)
      expect(result.allowed).to be true
      expect(result.reason).to eq(PocketPing::UaFilterReason::CUSTOM)
    end

    it "honors a custom filter that blocks" do
      config = PocketPing::UaFilterConfig.new(enabled: true, custom_filter: ->(_ua, _req) { false })
      result = described_class.check_ua_filter("Mozilla/5.0", config)
      expect(result.allowed).to be false
      expect(result.reason).to eq(PocketPing::UaFilterReason::CUSTOM)
    end

    it "falls through to list filtering when custom filter returns nil" do
      config = PocketPing::UaFilterConfig.new(enabled: true, custom_filter: ->(_ua, _req) { nil })
      result = described_class.check_ua_filter("Googlebot/2.1", config)
      expect(result.allowed).to be false
      expect(result.reason).to eq(PocketPing::UaFilterReason::DEFAULT_BOT)
    end
  end

  describe ".create_log_event" do
    it "builds a log event with a timestamp" do
      event = described_class.create_log_event(
        "blocked", "Googlebot/2.1", PocketPing::UaFilterReason::DEFAULT_BOT,
        "googlebot", "/connect", session_id: "sess-1"
      )
      expect(event.type).to eq("blocked")
      expect(event.user_agent).to eq("Googlebot/2.1")
      expect(event.reason).to eq(PocketPing::UaFilterReason::DEFAULT_BOT)
      expect(event.matched_pattern).to eq("googlebot")
      expect(event.path).to eq("/connect")
      expect(event.session_id).to eq("sess-1")
      expect(event.timestamp).to be_a(Time)
    end
  end
end

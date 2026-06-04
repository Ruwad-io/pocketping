# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::BotDetection do
  describe ".datacenter_ip?" do
    it "flags Google Cloud IPv4" do
      expect(described_class.datacenter_ip?("34.72.176.129")).to be true
    end

    it "flags OVH IPv4" do
      expect(described_class.datacenter_ip?("51.75.1.1")).to be true
    end

    it "flags Hetzner IPv4" do
      expect(described_class.datacenter_ip?("5.9.1.1")).to be true
    end

    it "flags DigitalOcean IPv4" do
      expect(described_class.datacenter_ip?("159.65.1.1")).to be true
    end

    it "flags an OVH IPv6 address" do
      expect(described_class.datacenter_ip?("2001:41d0:350:1400::1")).to be true
    end

    it "flags a Hetzner IPv6 address" do
      expect(described_class.datacenter_ip?("2a01:4f8::1")).to be true
    end

    it "flags an IPv4-mapped IPv6 datacenter address" do
      expect(described_class.datacenter_ip?("::ffff:34.72.176.129")).to be true
    end

    it "does not flag a residential IPv4" do
      expect(described_class.datacenter_ip?("203.0.113.7")).to be false
    end

    it "returns false for 'unknown'" do
      expect(described_class.datacenter_ip?("unknown")).to be false
    end

    it "returns false for garbage input" do
      expect(described_class.datacenter_ip?("not-an-ip")).to be false
    end

    it "returns false for an empty string" do
      expect(described_class.datacenter_ip?("")).to be false
    end

    it "returns false for nil" do
      expect(described_class.datacenter_ip?(nil)).to be false
    end

    it "strips bracket-wrapped IPv6 addresses" do
      expect(described_class.datacenter_ip?("[2a01:4f8::1]")).to be true
    end
  end

  describe ".headless_user_agent?" do
    it "flags HeadlessChrome" do
      ua = "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36"
      expect(described_class.headless_user_agent?(ua)).to be true
    end

    it "flags python-requests" do
      expect(described_class.headless_user_agent?("python-requests/2.31.0")).to be true
    end

    it "flags curl" do
      expect(described_class.headless_user_agent?("curl/8.0.1")).to be true
    end

    it "does not flag a real Chrome user agent" do
      ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " \
           "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      expect(described_class.headless_user_agent?(ua)).to be false
    end

    it "returns false for an empty string" do
      expect(described_class.headless_user_agent?("")).to be false
    end

    it "returns false for nil" do
      expect(described_class.headless_user_agent?(nil)).to be false
    end
  end

  describe ".hosting_org?" do
    it "flags Hetzner" do
      expect(described_class.hosting_org?("Hetzner Online GmbH")).to be true
    end

    it "flags DigitalOcean" do
      expect(described_class.hosting_org?("DigitalOcean, LLC")).to be true
    end

    it "flags Vultr" do
      expect(described_class.hosting_org?("The Constant Company / Vultr")).to be true
    end

    it "does not flag Google Fiber Inc." do
      expect(described_class.hosting_org?("Google Fiber Inc.")).to be false
    end

    it "does not flag Google LLC" do
      expect(described_class.hosting_org?("Google LLC")).to be false
    end

    it "does not flag AMAZON-02" do
      expect(described_class.hosting_org?("AMAZON-02")).to be false
    end

    it "does not flag Orange S.A." do
      expect(described_class.hosting_org?("Orange S.A.")).to be false
    end

    it "returns false for nil" do
      expect(described_class.hosting_org?(nil)).to be false
    end
  end

  describe ".detect_bot" do
    it "flags a datacenter IP with datacenter_ip reason" do
      verdict = described_class.detect_bot(ip: "34.72.176.129", user_agent: "Mozilla/5.0", org: nil)
      expect(verdict.is_bot).to be true
      expect(verdict.reason).to eq("datacenter_ip")
    end

    it "works when the optional org is omitted" do
      verdict = described_class.detect_bot(ip: "34.72.176.129", user_agent: "Mozilla/5.0")
      expect(verdict.is_bot).to be true
      expect(verdict.reason).to eq("datacenter_ip")
    end

    it "flags a hosting ASN with hosting_asn reason" do
      verdict = described_class.detect_bot(ip: "203.0.113.7", user_agent: "Mozilla/5.0", org: "Hetzner Online GmbH")
      expect(verdict.is_bot).to be true
      expect(verdict.reason).to eq("hosting_asn")
    end

    it "flags a headless UA with headless_ua reason" do
      verdict = described_class.detect_bot(ip: "203.0.113.7", user_agent: "python-requests/2.31.0", org: nil)
      expect(verdict.is_bot).to be true
      expect(verdict.reason).to eq("headless_ua")
    end

    it "does not flag a clean residential connection" do
      ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " \
           "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      verdict = described_class.detect_bot(ip: "203.0.113.7", user_agent: ua, org: "Orange S.A.")
      expect(verdict.is_bot).to be false
      expect(verdict.reason).to be_nil
    end

    it "prioritizes datacenter_ip over headless_ua" do
      verdict = described_class.detect_bot(ip: "34.72.176.129", user_agent: "curl/8.0.1", org: nil)
      expect(verdict.reason).to eq("datacenter_ip")
    end
  end
end

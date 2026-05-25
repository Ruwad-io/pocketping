# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::VersionChecker do
  describe ".get_version_headers" do
    it "includes only the status when nothing else is set" do
      result = PocketPing::VersionCheckResult.new(status: PocketPing::VersionStatus::OK)
      headers = described_class.get_version_headers(result)
      expect(headers).to eq("X-PocketPing-Version-Status" => "ok")
    end

    it "includes min/latest/message headers when present" do
      result = PocketPing::VersionCheckResult.new(
        status: PocketPing::VersionStatus::DEPRECATED,
        message: "upgrade please",
        min_version: "1.0.0",
        latest_version: "3.0.0"
      )
      headers = described_class.get_version_headers(result)
      expect(headers["X-PocketPing-Min-Version"]).to eq("1.0.0")
      expect(headers["X-PocketPing-Latest-Version"]).to eq("3.0.0")
      expect(headers["X-PocketPing-Version-Message"]).to eq("upgrade please")
    end
  end

  describe ".severity_for_status" do
    it "maps unsupported to error" do
      expect(described_class.severity_for_status(PocketPing::VersionStatus::UNSUPPORTED)).to eq("error")
    end

    it "maps deprecated to warning" do
      expect(described_class.severity_for_status(PocketPing::VersionStatus::DEPRECATED)).to eq("warning")
    end

    it "maps everything else to info" do
      expect(described_class.severity_for_status(PocketPing::VersionStatus::OK)).to eq("info")
      expect(described_class.severity_for_status(PocketPing::VersionStatus::OUTDATED)).to eq("info")
    end
  end

  describe ".create_version_warning" do
    it "builds a warning carrying severity and versions" do
      result = PocketPing::VersionCheckResult.new(
        status: PocketPing::VersionStatus::UNSUPPORTED,
        message: "too old",
        min_version: "2.0.0",
        latest_version: "3.0.0",
        can_continue: false
      )
      warning = described_class.create_version_warning(result, "1.0.0", upgrade_url: "https://up.example.com")
      expect(warning.severity).to eq("error")
      expect(warning.message).to eq("too old")
      expect(warning.current_version).to eq("1.0.0")
      expect(warning.upgrade_url).to eq("https://up.example.com")
      expect(warning.can_continue).to be false
    end

    it "uses a default upgrade url and empty message fallback" do
      result = PocketPing::VersionCheckResult.new(status: PocketPing::VersionStatus::OK)
      warning = described_class.create_version_warning(result, "1.0.0")
      expect(warning.message).to eq("")
      expect(warning.upgrade_url).to include("docs.pocketping.io")
    end
  end

  describe ".check_version outdated/deprecated branches" do
    it "returns OUTDATED for a minor-behind version" do
      result = described_class.check_version("1.2.0", latest_version: "1.5.0")
      expect(result.status).to eq(PocketPing::VersionStatus::OUTDATED)
      expect(result.can_continue).to be true
    end

    it "returns DEPRECATED for a major-behind version" do
      result = described_class.check_version("1.0.0", latest_version: "2.0.0")
      expect(result.status).to eq(PocketPing::VersionStatus::DEPRECATED)
    end
  end
end

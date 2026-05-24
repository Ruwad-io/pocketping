# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::SetupError do
  it "builds a message and resolves the guide from SETUP_GUIDES" do
    error = described_class.new(bridge: "Telegram", missing: "bot_token")
    expect(error.message).to include("Telegram configuration error: bot_token is required")
    expect(error.bridge).to eq("Telegram")
    expect(error.missing).to eq("bot_token")
    expect(error.guide).to include("@BotFather")
    expect(error.docs_url).to eq("https://pocketping.io/docs/telegram")
  end

  it "uses an explicit guide when provided" do
    error = described_class.new(bridge: "Discord", missing: "webhook_url", guide: "custom guide text")
    expect(error.guide).to eq("custom guide text")
  end

  it "falls back to an empty guide for an unknown missing key" do
    error = described_class.new(bridge: "Slack", missing: "totally_unknown")
    expect(error.guide).to eq("")
  end

  it "accepts a custom docs_url" do
    error = described_class.new(bridge: "Slack", missing: "bot_token", docs_url: "https://example.com/help")
    expect(error.docs_url).to eq("https://example.com/help")
  end

  it "renders a formatted guide box including bridge, missing, and docs url" do
    error = described_class.new(bridge: "Discord", missing: "channel_id")
    output = error.formatted_guide
    expect(output).to include("Discord Setup Required")
    expect(output).to include("Missing: channel_id")
    expect(output).to include("Developer Mode")
    expect(output).to include("Full guide: https://pocketping.io/docs/discord")
  end

  it "is a StandardError subclass" do
    expect(described_class.ancestors).to include(StandardError)
  end
end

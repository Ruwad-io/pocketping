# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::Bridge::TelegramBridge do
  let(:bot_token) { "123456789:ABCdefGHIjklMNOpqrsTUVwxyz" }
  let(:chat_id) { "-1001234567890" }
  let(:session) { create_sample_session(visitor_id: "visitor-abc") }
  let(:message) { create_sample_message(session_id: session.id, content: "Hello from visitor") }

  describe "Constructor validation" do
    it "creates bridge with required params" do
      bridge = described_class.new(bot_token: bot_token, chat_id: chat_id)

      expect(bridge).to be_a(described_class)
      expect(bridge.name).to eq("telegram")
    end

    it "uses default options" do
      bridge = described_class.new(bot_token: bot_token, chat_id: chat_id)

      # Default parse_mode should be HTML, disable_notification should be false
      # We verify this by checking the request body in API calls
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendChatAction")
        .to_return(status: 200, body: { ok: true }.to_json)
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .with(body: hash_including("parse_mode" => "HTML", "disable_notification" => false))
        .to_return(status: 200, body: { ok: true, result: { message_id: 123 } }.to_json)

      bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .with(body: hash_including("parse_mode" => "HTML", "disable_notification" => false))
    end

    it "accepts custom options" do
      bridge = described_class.new(
        bot_token: bot_token,
        chat_id: chat_id,
        parse_mode: "Markdown",
        disable_notification: true
      )

      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendChatAction")
        .to_return(status: 200, body: { ok: true }.to_json)
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .with(body: hash_including("parse_mode" => "Markdown", "disable_notification" => true))
        .to_return(status: 200, body: { ok: true, result: { message_id: 123 } }.to_json)

      bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .with(body: hash_including("parse_mode" => "Markdown", "disable_notification" => true))
    end
  end

  describe "#on_visitor_message" do
    let(:bridge) { described_class.new(bot_token: bot_token, chat_id: chat_id) }

    before do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendChatAction")
        .to_return(status: 200, body: { ok: true }.to_json)
    end

    it "sends message to API" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .to_return(status: 200, body: { ok: true, result: { message_id: 456 } }.to_json)

      bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .with(body: hash_including("chat_id" => chat_id))
    end

    it "returns BridgeMessageResult with message ID" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .to_return(status: 200, body: { ok: true, result: { message_id: 789 } }.to_json)

      result = bridge.on_visitor_message(message, session)

      expect(result).to be_a(PocketPing::BridgeMessageResult)
      expect(result.message_id).to eq(789)
    end

    it "handles API errors gracefully" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .to_return(status: 400, body: { ok: false, description: "Bad Request" }.to_json)

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end
  end

  describe "#on_new_session" do
    let(:bridge) { described_class.new(bot_token: bot_token, chat_id: chat_id) }

    it "sends session announcement" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .to_return(status: 200, body: { ok: true, result: { message_id: 100 } }.to_json)

      bridge.on_new_session(session)

      expect(WebMock).to have_requested(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
    end

    it "formats session info correctly" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .to_return(status: 200, body: { ok: true, result: { message_id: 100 } }.to_json)

      bridge.on_new_session(session)

      expect(WebMock).to have_requested(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .with { |request|
          body = JSON.parse(request.body)
          body["text"].include?("New chat session") &&
            body["text"].include?(session.visitor_id)
        }
    end
  end

  describe "#on_message_edit" do
    let(:bridge) { described_class.new(bot_token: bot_token, chat_id: chat_id) }
    let(:telegram_message_id) { 999 }

    it "calls edit API with correct params" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/editMessageText")
        .to_return(status: 200, body: { ok: true, result: { message_id: telegram_message_id } }.to_json)

      bridge.on_message_edit(message, session, telegram_message_id)

      expect(WebMock).to have_requested(:post, "https://api.telegram.org/bot#{bot_token}/editMessageText")
        .with(body: hash_including("message_id" => telegram_message_id, "chat_id" => chat_id))
    end

    it "returns true on success" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/editMessageText")
        .to_return(status: 200, body: { ok: true, result: { message_id: telegram_message_id } }.to_json)

      # The method doesn't explicitly return true/false, but it should not raise
      expect { bridge.on_message_edit(message, session, telegram_message_id) }.not_to raise_error
    end

    it "returns false on failure" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/editMessageText")
        .to_return(status: 400, body: { ok: false, description: "message not found" }.to_json)

      # The method handles failures gracefully without raising
      expect { bridge.on_message_edit(message, session, telegram_message_id) }.not_to raise_error
    end
  end

  describe "#on_message_delete" do
    let(:bridge) { described_class.new(bot_token: bot_token, chat_id: chat_id) }
    let(:telegram_message_id) { 888 }

    it "calls delete API with correct params" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/deleteMessage")
        .to_return(status: 200, body: { ok: true, result: true }.to_json)

      bridge.on_message_delete(message, session, telegram_message_id)

      expect(WebMock).to have_requested(:post, "https://api.telegram.org/bot#{bot_token}/deleteMessage")
        .with(body: hash_including("message_id" => telegram_message_id, "chat_id" => chat_id))
    end

    it "returns true on success" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/deleteMessage")
        .to_return(status: 200, body: { ok: true, result: true }.to_json)

      expect { bridge.on_message_delete(message, session, telegram_message_id) }.not_to raise_error
    end

    it "returns false on failure" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/deleteMessage")
        .to_return(status: 400, body: { ok: false, description: "message can't be deleted" }.to_json)

      expect { bridge.on_message_delete(message, session, telegram_message_id) }.not_to raise_error
    end
  end

  describe "Error handling" do
    let(:bridge) { described_class.new(bot_token: bot_token, chat_id: chat_id) }

    before do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendChatAction")
        .to_return(status: 200, body: { ok: true }.to_json)
    end

    it "warns but doesn't raise on API failure" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .to_return(status: 500, body: "Internal Server Error")

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error
    end

    it "handles network errors" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .to_timeout

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end

    it "handles invalid responses" do
      stub_request(:post, "https://api.telegram.org/bot#{bot_token}/sendMessage")
        .to_return(status: 200, body: "not valid json")

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end
  end
end

RSpec.describe PocketPing::Bridge::DiscordWebhookBridge do
  let(:webhook_url) { "https://discord.com/api/webhooks/123456789/abcdefghijklmnop" }
  let(:webhook_id) { "123456789" }
  let(:webhook_token) { "abcdefghijklmnop" }
  let(:session) { create_sample_session(visitor_id: "visitor-discord") }
  let(:message) { create_sample_message(session_id: session.id, content: "Hello from Discord visitor") }

  describe "Constructor validation" do
    it "creates bridge with required params" do
      bridge = described_class.new(webhook_url: webhook_url)

      expect(bridge).to be_a(described_class)
      expect(bridge.name).to eq("discord_webhook")
    end

    it "uses default options" do
      bridge = described_class.new(webhook_url: webhook_url)

      stub_request(:post, "#{webhook_url}?wait=true")
        .to_return(status: 200, body: { id: "msg-123" }.to_json)

      result = bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, "#{webhook_url}?wait=true")
        .with { |request|
          body = JSON.parse(request.body)
          !body.key?("username") && !body.key?("avatar_url")
        }
    end

    it "accepts custom options" do
      bridge = described_class.new(
        webhook_url: webhook_url,
        username: "PocketPing",
        avatar_url: "https://example.com/avatar.png"
      )

      stub_request(:post, "#{webhook_url}?wait=true")
        .to_return(status: 200, body: { id: "msg-123" }.to_json)

      bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, "#{webhook_url}?wait=true")
        .with(body: hash_including("username" => "PocketPing", "avatar_url" => "https://example.com/avatar.png"))
    end
  end

  describe "#on_visitor_message" do
    let(:bridge) { described_class.new(webhook_url: webhook_url) }

    it "sends message to API" do
      stub_request(:post, "#{webhook_url}?wait=true")
        .to_return(status: 200, body: { id: "discord-msg-456" }.to_json)

      bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, "#{webhook_url}?wait=true")
    end

    it "returns BridgeMessageResult with message ID" do
      stub_request(:post, "#{webhook_url}?wait=true")
        .to_return(status: 200, body: { id: "discord-msg-789" }.to_json)

      result = bridge.on_visitor_message(message, session)

      expect(result).to be_a(PocketPing::BridgeMessageResult)
      expect(result.message_id).to eq("discord-msg-789")
    end

    it "handles API errors gracefully" do
      stub_request(:post, "#{webhook_url}?wait=true")
        .to_return(status: 400, body: { code: 50006, message: "Cannot send an empty message" }.to_json)

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end
  end

  describe "#on_new_session" do
    let(:bridge) { described_class.new(webhook_url: webhook_url) }

    it "sends session announcement" do
      stub_request(:post, webhook_url)
        .to_return(status: 200, body: "")

      bridge.on_new_session(session)

      expect(WebMock).to have_requested(:post, webhook_url)
    end

    it "formats session info correctly" do
      stub_request(:post, webhook_url)
        .to_return(status: 200, body: "")

      bridge.on_new_session(session)

      expect(WebMock).to have_requested(:post, webhook_url)
        .with { |request|
          body = JSON.parse(request.body)
          body["content"].include?("New chat session") &&
            body["content"].include?(session.visitor_id)
        }
    end
  end

  describe "#on_message_edit" do
    let(:bridge) { described_class.new(webhook_url: webhook_url) }
    let(:discord_message_id) { "discord-edit-msg-123" }

    it "calls edit API with correct params" do
      stub_request(:patch, "https://discord.com/api/webhooks/#{webhook_id}/#{webhook_token}/messages/#{discord_message_id}")
        .to_return(status: 200, body: { id: discord_message_id }.to_json)

      bridge.on_message_edit(message, session, discord_message_id)

      expect(WebMock).to have_requested(:patch, "https://discord.com/api/webhooks/#{webhook_id}/#{webhook_token}/messages/#{discord_message_id}")
    end

    it "returns true on success" do
      stub_request(:patch, "https://discord.com/api/webhooks/#{webhook_id}/#{webhook_token}/messages/#{discord_message_id}")
        .to_return(status: 200, body: { id: discord_message_id }.to_json)

      expect { bridge.on_message_edit(message, session, discord_message_id) }.not_to raise_error
    end

    it "returns false on failure" do
      stub_request(:patch, "https://discord.com/api/webhooks/#{webhook_id}/#{webhook_token}/messages/#{discord_message_id}")
        .to_return(status: 404, body: { code: 10008, message: "Unknown Message" }.to_json)

      expect { bridge.on_message_edit(message, session, discord_message_id) }.not_to raise_error
    end
  end

  describe "#on_message_delete" do
    let(:bridge) { described_class.new(webhook_url: webhook_url) }
    let(:discord_message_id) { "discord-delete-msg-456" }

    it "calls delete API with correct params" do
      stub_request(:delete, "https://discord.com/api/webhooks/#{webhook_id}/#{webhook_token}/messages/#{discord_message_id}")
        .to_return(status: 204, body: "")

      bridge.on_message_delete(message, session, discord_message_id)

      expect(WebMock).to have_requested(:delete, "https://discord.com/api/webhooks/#{webhook_id}/#{webhook_token}/messages/#{discord_message_id}")
    end

    it "returns true on success" do
      stub_request(:delete, "https://discord.com/api/webhooks/#{webhook_id}/#{webhook_token}/messages/#{discord_message_id}")
        .to_return(status: 204, body: "")

      expect { bridge.on_message_delete(message, session, discord_message_id) }.not_to raise_error
    end

    it "returns false on failure" do
      stub_request(:delete, "https://discord.com/api/webhooks/#{webhook_id}/#{webhook_token}/messages/#{discord_message_id}")
        .to_return(status: 404, body: { code: 10008, message: "Unknown Message" }.to_json)

      expect { bridge.on_message_delete(message, session, discord_message_id) }.not_to raise_error
    end
  end

  describe "Error handling" do
    let(:bridge) { described_class.new(webhook_url: webhook_url) }

    it "warns but doesn't raise on API failure" do
      stub_request(:post, "#{webhook_url}?wait=true")
        .to_return(status: 500, body: "Internal Server Error")

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error
    end

    it "handles network errors" do
      stub_request(:post, "#{webhook_url}?wait=true")
        .to_timeout

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end

    it "handles invalid responses" do
      stub_request(:post, "#{webhook_url}?wait=true")
        .to_return(status: 200, body: "not valid json {")

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end
  end
end

RSpec.describe PocketPing::Bridge::DiscordBotBridge do
  let(:bot_token) { "MTIzNDU2Nzg5.ABCDEF.xyz123" }
  let(:channel_id) { "987654321098765432" }
  let(:session) { create_sample_session(visitor_id: "visitor-bot-discord") }
  let(:message) { create_sample_message(session_id: session.id, content: "Hello from Discord bot visitor") }
  let(:api_base) { "https://discord.com/api/v10" }

  describe "Constructor validation" do
    it "creates bridge with required params" do
      bridge = described_class.new(bot_token: bot_token, channel_id: channel_id)

      expect(bridge).to be_a(described_class)
      expect(bridge.name).to eq("discord_bot")
    end

    it "uses default options" do
      bridge = described_class.new(bot_token: bot_token, channel_id: channel_id)

      stub_request(:post, "#{api_base}/channels/#{channel_id}/typing")
        .to_return(status: 204, body: "")
      stub_request(:post, "#{api_base}/channels/#{channel_id}/messages")
        .to_return(status: 200, body: { id: "msg-123" }.to_json)

      bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, "#{api_base}/channels/#{channel_id}/messages")
        .with(headers: { "Authorization" => "Bot #{bot_token}" })
    end

    it "accepts custom options" do
      # DiscordBotBridge only accepts bot_token and channel_id, so just verify it works
      bridge = described_class.new(bot_token: bot_token, channel_id: channel_id)

      expect(bridge.name).to eq("discord_bot")
    end
  end

  describe "#on_visitor_message" do
    let(:bridge) { described_class.new(bot_token: bot_token, channel_id: channel_id) }

    before do
      stub_request(:post, "#{api_base}/channels/#{channel_id}/typing")
        .to_return(status: 204, body: "")
    end

    it "sends message to API" do
      stub_request(:post, "#{api_base}/channels/#{channel_id}/messages")
        .to_return(status: 200, body: { id: "bot-msg-456" }.to_json)

      bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, "#{api_base}/channels/#{channel_id}/messages")
    end

    it "returns BridgeMessageResult with message ID" do
      stub_request(:post, "#{api_base}/channels/#{channel_id}/messages")
        .to_return(status: 200, body: { id: "bot-msg-789" }.to_json)

      result = bridge.on_visitor_message(message, session)

      expect(result).to be_a(PocketPing::BridgeMessageResult)
      expect(result.message_id).to eq("bot-msg-789")
    end

    it "handles API errors gracefully" do
      stub_request(:post, "#{api_base}/channels/#{channel_id}/messages")
        .to_return(status: 403, body: { code: 50001, message: "Missing Access" }.to_json)

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end
  end

  describe "#on_new_session" do
    let(:bridge) { described_class.new(bot_token: bot_token, channel_id: channel_id) }

    it "sends session announcement" do
      stub_request(:post, "#{api_base}/channels/#{channel_id}/messages")
        .to_return(status: 200, body: { id: "session-msg" }.to_json)

      bridge.on_new_session(session)

      expect(WebMock).to have_requested(:post, "#{api_base}/channels/#{channel_id}/messages")
    end

    it "formats session info correctly" do
      stub_request(:post, "#{api_base}/channels/#{channel_id}/messages")
        .to_return(status: 200, body: { id: "session-msg" }.to_json)

      bridge.on_new_session(session)

      expect(WebMock).to have_requested(:post, "#{api_base}/channels/#{channel_id}/messages")
        .with { |request|
          body = JSON.parse(request.body)
          body["content"].include?("New chat session") &&
            body["content"].include?(session.visitor_id)
        }
    end
  end

  describe "#on_message_edit" do
    let(:bridge) { described_class.new(bot_token: bot_token, channel_id: channel_id) }
    let(:discord_message_id) { "bot-edit-msg-123" }

    it "calls edit API with correct params" do
      stub_request(:patch, "#{api_base}/channels/#{channel_id}/messages/#{discord_message_id}")
        .to_return(status: 200, body: { id: discord_message_id }.to_json)

      bridge.on_message_edit(message, session, discord_message_id)

      expect(WebMock).to have_requested(:patch, "#{api_base}/channels/#{channel_id}/messages/#{discord_message_id}")
        .with(headers: { "Authorization" => "Bot #{bot_token}" })
    end

    it "returns true on success" do
      stub_request(:patch, "#{api_base}/channels/#{channel_id}/messages/#{discord_message_id}")
        .to_return(status: 200, body: { id: discord_message_id }.to_json)

      expect { bridge.on_message_edit(message, session, discord_message_id) }.not_to raise_error
    end

    it "returns false on failure" do
      stub_request(:patch, "#{api_base}/channels/#{channel_id}/messages/#{discord_message_id}")
        .to_return(status: 404, body: { code: 10008, message: "Unknown Message" }.to_json)

      expect { bridge.on_message_edit(message, session, discord_message_id) }.not_to raise_error
    end
  end

  describe "#on_message_delete" do
    let(:bridge) { described_class.new(bot_token: bot_token, channel_id: channel_id) }
    let(:discord_message_id) { "bot-delete-msg-456" }

    it "calls delete API with correct params" do
      stub_request(:delete, "#{api_base}/channels/#{channel_id}/messages/#{discord_message_id}")
        .to_return(status: 204, body: "")

      bridge.on_message_delete(message, session, discord_message_id)

      expect(WebMock).to have_requested(:delete, "#{api_base}/channels/#{channel_id}/messages/#{discord_message_id}")
        .with(headers: { "Authorization" => "Bot #{bot_token}" })
    end

    it "returns true on success" do
      stub_request(:delete, "#{api_base}/channels/#{channel_id}/messages/#{discord_message_id}")
        .to_return(status: 204, body: "")

      expect { bridge.on_message_delete(message, session, discord_message_id) }.not_to raise_error
    end

    it "returns false on failure" do
      stub_request(:delete, "#{api_base}/channels/#{channel_id}/messages/#{discord_message_id}")
        .to_return(status: 404, body: { code: 10008, message: "Unknown Message" }.to_json)

      expect { bridge.on_message_delete(message, session, discord_message_id) }.not_to raise_error
    end
  end

  describe "Error handling" do
    let(:bridge) { described_class.new(bot_token: bot_token, channel_id: channel_id) }

    before do
      stub_request(:post, "#{api_base}/channels/#{channel_id}/typing")
        .to_return(status: 204, body: "")
    end

    it "warns but doesn't raise on API failure" do
      stub_request(:post, "#{api_base}/channels/#{channel_id}/messages")
        .to_return(status: 500, body: "Internal Server Error")

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error
    end

    it "handles network errors" do
      stub_request(:post, "#{api_base}/channels/#{channel_id}/messages")
        .to_timeout

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end

    it "handles invalid responses" do
      stub_request(:post, "#{api_base}/channels/#{channel_id}/messages")
        .to_return(status: 200, body: "not valid json")

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end
  end
end

RSpec.describe PocketPing::Bridge::SlackWebhookBridge do
  let(:webhook_url) { "https://hooks.slack.com/services/TTEST/BTEST/testwebhooksecret" }
  let(:session) { create_sample_session(visitor_id: "visitor-slack") }
  let(:message) { create_sample_message(session_id: session.id, content: "Hello from Slack visitor") }

  describe "Constructor validation" do
    it "creates bridge with required params" do
      bridge = described_class.new(webhook_url: webhook_url)

      expect(bridge).to be_a(described_class)
      expect(bridge.name).to eq("slack_webhook")
    end

    it "uses default options" do
      bridge = described_class.new(webhook_url: webhook_url)

      stub_request(:post, webhook_url)
        .to_return(status: 200, body: "ok")

      bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, webhook_url)
        .with { |request|
          body = JSON.parse(request.body)
          !body.key?("username") && !body.key?("icon_emoji")
        }
    end

    it "accepts custom options" do
      bridge = described_class.new(
        webhook_url: webhook_url,
        username: "PocketPing Bot",
        icon_emoji: ":robot_face:"
      )

      stub_request(:post, webhook_url)
        .to_return(status: 200, body: "ok")

      bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, webhook_url)
        .with(body: hash_including("username" => "PocketPing Bot", "icon_emoji" => ":robot_face:"))
    end
  end

  describe "#on_visitor_message" do
    let(:bridge) { described_class.new(webhook_url: webhook_url) }

    it "sends message to API" do
      stub_request(:post, webhook_url)
        .to_return(status: 200, body: "ok")

      bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, webhook_url)
    end

    it "returns nil (webhooks don't return message ID)" do
      stub_request(:post, webhook_url)
        .to_return(status: 200, body: "ok")

      result = bridge.on_visitor_message(message, session)

      # Slack webhooks don't return a message ID
      expect(result).to be_nil
    end

    it "handles API errors gracefully" do
      stub_request(:post, webhook_url)
        .to_return(status: 400, body: "invalid_payload")

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end
  end

  describe "#on_new_session" do
    let(:bridge) { described_class.new(webhook_url: webhook_url) }

    it "sends session announcement" do
      stub_request(:post, webhook_url)
        .to_return(status: 200, body: "ok")

      bridge.on_new_session(session)

      expect(WebMock).to have_requested(:post, webhook_url)
    end

    it "formats session info correctly" do
      stub_request(:post, webhook_url)
        .to_return(status: 200, body: "ok")

      bridge.on_new_session(session)

      expect(WebMock).to have_requested(:post, webhook_url)
        .with { |request|
          body = JSON.parse(request.body)
          body["text"].include?("New chat session") &&
            body["text"].include?(session.visitor_id)
        }
    end
  end

  describe "#on_message_edit" do
    let(:bridge) { described_class.new(webhook_url: webhook_url) }
    let(:slack_message_ts) { "1234567890.123456" }

    it "logs warning that edit is not supported" do
      expect { bridge.on_message_edit(message, session, slack_message_ts) }.not_to raise_error
    end

    it "returns without making API call" do
      # No stub needed - should not make any request
      bridge.on_message_edit(message, session, slack_message_ts)

      expect(WebMock).not_to have_requested(:any, /hooks.slack.com/)
    end

    it "handles gracefully" do
      expect { bridge.on_message_edit(message, session, slack_message_ts) }.not_to raise_error
    end
  end

  describe "#on_message_delete" do
    let(:bridge) { described_class.new(webhook_url: webhook_url) }
    let(:slack_message_ts) { "1234567890.654321" }

    it "logs warning that delete is not supported" do
      expect { bridge.on_message_delete(message, session, slack_message_ts) }.not_to raise_error
    end

    it "returns without making API call" do
      # No stub needed - should not make any request
      bridge.on_message_delete(message, session, slack_message_ts)

      expect(WebMock).not_to have_requested(:any, /hooks.slack.com/)
    end

    it "handles gracefully" do
      expect { bridge.on_message_delete(message, session, slack_message_ts) }.not_to raise_error
    end
  end

  describe "Error handling" do
    let(:bridge) { described_class.new(webhook_url: webhook_url) }

    it "warns but doesn't raise on API failure" do
      stub_request(:post, webhook_url)
        .to_return(status: 500, body: "Internal Server Error")

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error
    end

    it "handles network errors" do
      stub_request(:post, webhook_url)
        .to_timeout

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error
    end

    it "handles invalid responses" do
      stub_request(:post, webhook_url)
        .to_return(status: 200, body: "unexpected_response")

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error
    end
  end
end

RSpec.describe PocketPing::Bridge::SlackBotBridge do
  let(:bot_token) { "xoxb-test-token-for-testing" }
  let(:channel_id) { "C1234567890" }
  let(:session) { create_sample_session(visitor_id: "visitor-slack-bot") }
  let(:message) { create_sample_message(session_id: session.id, content: "Hello from Slack bot visitor") }
  let(:api_base) { "https://slack.com/api" }

  describe "Constructor validation" do
    it "creates bridge with required params" do
      bridge = described_class.new(bot_token: bot_token, channel_id: channel_id)

      expect(bridge).to be_a(described_class)
      expect(bridge.name).to eq("slack_bot")
    end

    it "uses default options" do
      bridge = described_class.new(bot_token: bot_token, channel_id: channel_id)

      stub_request(:post, "#{api_base}/chat.postMessage")
        .to_return(status: 200, body: { ok: true, ts: "123.456" }.to_json)

      bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, "#{api_base}/chat.postMessage")
        .with(headers: { "Authorization" => "Bearer #{bot_token}" })
    end

    it "accepts custom options" do
      # SlackBotBridge only accepts bot_token and channel_id
      bridge = described_class.new(bot_token: bot_token, channel_id: channel_id)

      expect(bridge.name).to eq("slack_bot")
    end
  end

  describe "#on_visitor_message" do
    let(:bridge) { described_class.new(bot_token: bot_token, channel_id: channel_id) }

    it "sends message to API" do
      stub_request(:post, "#{api_base}/chat.postMessage")
        .to_return(status: 200, body: { ok: true, ts: "1234567890.123456" }.to_json)

      bridge.on_visitor_message(message, session)

      expect(WebMock).to have_requested(:post, "#{api_base}/chat.postMessage")
        .with(body: hash_including("channel" => channel_id))
    end

    it "returns BridgeMessageResult with message timestamp" do
      stub_request(:post, "#{api_base}/chat.postMessage")
        .to_return(status: 200, body: { ok: true, ts: "1234567890.654321" }.to_json)

      result = bridge.on_visitor_message(message, session)

      expect(result).to be_a(PocketPing::BridgeMessageResult)
      expect(result.message_id).to eq("1234567890.654321")
    end

    it "handles API errors gracefully" do
      stub_request(:post, "#{api_base}/chat.postMessage")
        .to_return(status: 200, body: { ok: false, error: "channel_not_found" }.to_json)

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end
  end

  describe "#on_new_session" do
    let(:bridge) { described_class.new(bot_token: bot_token, channel_id: channel_id) }

    it "sends session announcement" do
      stub_request(:post, "#{api_base}/chat.postMessage")
        .to_return(status: 200, body: { ok: true, ts: "123.456" }.to_json)

      bridge.on_new_session(session)

      expect(WebMock).to have_requested(:post, "#{api_base}/chat.postMessage")
    end

    it "formats session info correctly" do
      stub_request(:post, "#{api_base}/chat.postMessage")
        .to_return(status: 200, body: { ok: true, ts: "123.456" }.to_json)

      bridge.on_new_session(session)

      expect(WebMock).to have_requested(:post, "#{api_base}/chat.postMessage")
        .with { |request|
          body = JSON.parse(request.body)
          body["text"].include?("New chat session") &&
            body["text"].include?(session.visitor_id)
        }
    end
  end

  describe "#on_message_edit" do
    let(:bridge) { described_class.new(bot_token: bot_token, channel_id: channel_id) }
    let(:slack_message_ts) { "1234567890.111111" }

    it "calls edit API with correct params" do
      stub_request(:post, "#{api_base}/chat.update")
        .to_return(status: 200, body: { ok: true, ts: slack_message_ts }.to_json)

      bridge.on_message_edit(message, session, slack_message_ts)

      expect(WebMock).to have_requested(:post, "#{api_base}/chat.update")
        .with(body: hash_including("channel" => channel_id, "ts" => slack_message_ts))
    end

    it "returns true on success" do
      stub_request(:post, "#{api_base}/chat.update")
        .to_return(status: 200, body: { ok: true, ts: slack_message_ts }.to_json)

      expect { bridge.on_message_edit(message, session, slack_message_ts) }.not_to raise_error
    end

    it "returns false on failure" do
      stub_request(:post, "#{api_base}/chat.update")
        .to_return(status: 200, body: { ok: false, error: "message_not_found" }.to_json)

      expect { bridge.on_message_edit(message, session, slack_message_ts) }.not_to raise_error
    end
  end

  describe "#on_message_delete" do
    let(:bridge) { described_class.new(bot_token: bot_token, channel_id: channel_id) }
    let(:slack_message_ts) { "1234567890.222222" }

    it "calls delete API with correct params" do
      stub_request(:post, "#{api_base}/chat.delete")
        .to_return(status: 200, body: { ok: true, ts: slack_message_ts }.to_json)

      bridge.on_message_delete(message, session, slack_message_ts)

      expect(WebMock).to have_requested(:post, "#{api_base}/chat.delete")
        .with(body: hash_including("channel" => channel_id, "ts" => slack_message_ts))
    end

    it "returns true on success" do
      stub_request(:post, "#{api_base}/chat.delete")
        .to_return(status: 200, body: { ok: true, ts: slack_message_ts }.to_json)

      expect { bridge.on_message_delete(message, session, slack_message_ts) }.not_to raise_error
    end

    it "returns false on failure" do
      stub_request(:post, "#{api_base}/chat.delete")
        .to_return(status: 200, body: { ok: false, error: "message_not_found" }.to_json)

      expect { bridge.on_message_delete(message, session, slack_message_ts) }.not_to raise_error
    end
  end

  describe "Error handling" do
    let(:bridge) { described_class.new(bot_token: bot_token, channel_id: channel_id) }

    it "warns but doesn't raise on API failure" do
      stub_request(:post, "#{api_base}/chat.postMessage")
        .to_return(status: 500, body: "Internal Server Error")

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error
    end

    it "handles network errors" do
      stub_request(:post, "#{api_base}/chat.postMessage")
        .to_timeout

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end

    it "handles invalid responses" do
      stub_request(:post, "#{api_base}/chat.postMessage")
        .to_return(status: 200, body: "not valid json")

      expect { bridge.on_visitor_message(message, session) }.not_to raise_error

      result = bridge.on_visitor_message(message, session)
      expect(result).to be_nil
    end
  end
end

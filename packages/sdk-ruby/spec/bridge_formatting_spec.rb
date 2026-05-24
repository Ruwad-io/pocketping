# frozen_string_literal: true

require "spec_helper"

# Exercises the message-formatting helpers (parse_user_agent, rich new-session
# messages with identity/phone/user-agent, reply quotes) and the constructor
# validation/error branches across all bridge variants.
RSpec.describe "Bridge message formatting" do
  # Build a session carrying identity, phone and a browser user agent so the
  # optional formatting lines are exercised.
  def rich_session(user_agent:)
    PocketPing::Session.new(
      id: "s1",
      visitor_id: "visitor-1",
      created_at: Time.now.utc,
      last_activity: Time.now.utc,
      identity: PocketPing::UserIdentity.new(id: "u1", email: "vip@example.com"),
      user_phone: "+33612345678",
      metadata: PocketPing::SessionMetadata.new(url: "https://shop.example.com", user_agent: user_agent)
    )
  end

  shared_examples "a bridge that parses user agents" do
    {
      "Mozilla/5.0 Firefox/120.0" => %w[Firefox],
      "Mozilla/5.0 (Windows NT 10.0) Edg/120.0" => %w[Edge Windows],
      "Mozilla/5.0 Chrome/120.0 Safari/537" => %w[Chrome],
      "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605" => %w[Safari macOS],
      "Opera/9.80 OPR/100" => %w[Opera],
      "SomethingWeird/1.0" => %w[Browser],
      "Mozilla/5.0 (Android 13; Mobile)" => %w[Android],
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17)" => %w[iOS],
      "Mozilla/5.0 (X11; Linux x86_64)" => %w[Linux]
    }.each do |ua, expected_fragments|
      it "renders new-session info for UA #{ua.split.first}" do
        captured = nil
        send(:stub_send) { |body| captured = body }
        bridge.on_new_session(rich_session(user_agent: ua))
        expect(captured).to include("New chat session")
        expect(captured).to include("vip@example.com")
        expect(captured).to include("+33612345678")
        expect(captured).to include("shop.example.com")
        expected_fragments.each { |frag| expect(captured).to include(frag) }
      end
    end
  end

  describe PocketPing::Bridge::TelegramBridge do
    let(:bot_token) { "123456789:ABCdefGHIjklMNOpqrsTUVwxyz" }
    let(:bridge) { described_class.new(bot_token: bot_token, chat_id: "-100") }

    def stub_send
      stub_request(:post, %r{api\.telegram\.org/bot.*/sendMessage})
        .to_return do |req|
          yield(JSON.parse(req.body)["text"])
          { status: 200, body: { ok: true, result: { message_id: 1 } }.to_json }
        end
    end

    include_examples "a bridge that parses user agents"

    it "raises a SetupError when bot_token is missing" do
      expect { described_class.new(bot_token: nil, chat_id: "1") }.to raise_error(PocketPing::SetupError)
    end

    it "raises a SetupError when bot_token has an invalid format" do
      expect { described_class.new(bot_token: "not-a-token", chat_id: "1") }.to raise_error(PocketPing::SetupError)
    end

    it "raises a SetupError when chat_id is missing" do
      expect { described_class.new(bot_token: bot_token, chat_id: "") }.to raise_error(PocketPing::SetupError)
    end

    it "escapes HTML in visitor content" do
      stub_request(:post, %r{/sendChatAction}).to_return(status: 200, body: { ok: true }.to_json)
      captured = nil
      stub_request(:post, %r{/sendMessage}).to_return do |req|
        captured = JSON.parse(req.body)["text"]
        { status: 200, body: { ok: true, result: { message_id: 2 } }.to_json }
      end
      msg = create_sample_message(session_id: "s1", content: "<script> & </tag>")
      bridge.on_visitor_message(msg, rich_session(user_agent: "Firefox"))
      expect(captured).to include("&lt;script&gt;").and include("&amp;")
    end

    it "swallows errors raised inside on_typing" do
      allow(bridge).to receive(:send_chat_action).and_raise("net down")
      expect { bridge.on_typing("s1", true) }.not_to raise_error
    end

    it "does nothing on typing when not typing" do
      expect(bridge.on_typing("s1", false)).to be_nil
    end
  end

  describe PocketPing::Bridge::DiscordBotBridge do
    let(:bridge) { described_class.new(bot_token: "Bot xyz", channel_id: "chan-1") }

    def stub_send
      stub_request(:post, %r{discord\.com/api/v10/channels/.*/messages})
        .to_return do |req|
          yield(JSON.parse(req.body)["content"])
          { status: 200, body: { id: "1" }.to_json }
        end
    end

    include_examples "a bridge that parses user agents"

    it "raises a SetupError when bot_token is missing" do
      expect { described_class.new(bot_token: "", channel_id: "c") }.to raise_error(PocketPing::SetupError)
    end

    it "raises a SetupError when channel_id is missing" do
      expect { described_class.new(bot_token: "Bot x", channel_id: nil) }.to raise_error(PocketPing::SetupError)
    end

    it "triggers a typing indicator on visitor message" do
      stub_request(:post, %r{/channels/chan-1/typing}).to_return(status: 204, body: "")
      stub_request(:post, %r{/channels/chan-1/messages}).to_return(status: 200, body: { id: "55" }.to_json)
      result = bridge.on_visitor_message(create_sample_message(session_id: "s1"), rich_session(user_agent: "Chrome"))
      expect(result.message_id).to eq("55")
      expect(WebMock).to have_requested(:post, %r{/channels/chan-1/typing})
    end

    it "swallows on_typing errors" do
      allow(bridge).to receive(:trigger_typing).and_raise("x")
      expect { bridge.on_typing("s1", true) }.not_to raise_error
    end
  end

  describe PocketPing::Bridge::DiscordWebhookBridge do
    let(:webhook_url) { "https://discord.com/api/webhooks/123/abc-token" }
    let(:bridge) { described_class.new(webhook_url: webhook_url) }

    def stub_send
      stub_request(:post, %r{discord\.com/api/webhooks/123})
        .to_return do |req|
          yield(JSON.parse(req.body)["content"])
          { status: 200, body: { id: "1" }.to_json }
        end
    end

    include_examples "a bridge that parses user agents"

    it "raises a SetupError when webhook_url is missing" do
      expect { described_class.new(webhook_url: "") }.to raise_error(PocketPing::SetupError)
    end

    it "raises a SetupError when webhook_url is invalid" do
      expect { described_class.new(webhook_url: "https://example.com/x") }.to raise_error(PocketPing::SetupError)
    end

    it "skips edit when webhook id/token cannot be parsed" do
      # A malformed-but-valid-prefixed URL parses no id/token, so edit is a no-op.
      bridge = described_class.new(webhook_url: "https://discord.com/api/webhooks/")
      expect { bridge.on_message_edit(create_sample_message(session_id: "s1"), rich_session(user_agent: "Chrome"), "mid") }.not_to raise_error
    end

    it "sends username and avatar overrides" do
      b = described_class.new(webhook_url: webhook_url, username: "Bot", avatar_url: "https://img/x.png")
      captured = nil
      stub_request(:post, %r{discord\.com/api/webhooks/123}).to_return do |req|
        captured = JSON.parse(req.body)
        { status: 200, body: { id: "9" }.to_json }
      end
      b.on_visitor_message(create_sample_message(session_id: "s1"), rich_session(user_agent: "Chrome"))
      expect(captured["username"]).to eq("Bot")
      expect(captured["avatar_url"]).to eq("https://img/x.png")
    end
  end

  describe PocketPing::Bridge::SlackWebhookBridge do
    let(:webhook_url) { "https://hooks.slack.com/services/T/B/X" }
    let(:bridge) { described_class.new(webhook_url: webhook_url) }

    def stub_send
      stub_request(:post, webhook_url).to_return do |req|
        yield(JSON.parse(req.body)["text"])
        { status: 200, body: "ok" }
      end
    end

    include_examples "a bridge that parses user agents"

    it "raises a SetupError when webhook_url is missing" do
      expect { described_class.new(webhook_url: nil) }.to raise_error(PocketPing::SetupError)
    end

    it "raises a SetupError when webhook_url is invalid" do
      expect { described_class.new(webhook_url: "https://example.com/x") }.to raise_error(PocketPing::SetupError)
    end

    it "warns and does not raise on edit/delete (unsupported)" do
      msg = create_sample_message(session_id: "s1")
      sess = rich_session(user_agent: "Chrome")
      expect { bridge.on_message_edit(msg, sess, "ts") }.not_to raise_error
      expect { bridge.on_message_delete(msg, sess, "ts") }.not_to raise_error
    end
  end

  describe PocketPing::Bridge::SlackBotBridge do
    let(:bridge) { described_class.new(bot_token: "xoxb-123", channel_id: "C1") }

    def stub_send
      stub_request(:post, %r{slack\.com/api/chat\.postMessage})
        .to_return do |req|
          yield(JSON.parse(req.body)["text"])
          { status: 200, body: { ok: true, ts: "1.1" }.to_json }
        end
    end

    include_examples "a bridge that parses user agents"

    it "raises a SetupError when bot_token is missing" do
      expect { described_class.new(bot_token: "", channel_id: "C1") }.to raise_error(PocketPing::SetupError)
    end

    it "raises a SetupError when bot_token has the wrong prefix" do
      expect { described_class.new(bot_token: "wrong-prefix", channel_id: "C1") }.to raise_error(PocketPing::SetupError)
    end

    it "raises a SetupError when channel_id is missing" do
      expect { described_class.new(bot_token: "xoxb-1", channel_id: nil) }.to raise_error(PocketPing::SetupError)
    end

    it "warns and returns nil when the Slack API reports not ok" do
      stub_request(:post, %r{chat\.postMessage}).to_return(status: 200, body: { ok: false, error: "channel_not_found" }.to_json)
      result = bridge.on_visitor_message(create_sample_message(session_id: "s1"), rich_session(user_agent: "Chrome"))
      expect(result).to be_nil
    end

    it "builds a reply quote referencing a prior message" do
      client = PocketPing::Client.new
      target = create_sample_message(session_id: "s1", sender: PocketPing::Sender::OPERATOR, content: "earlier reply")
      client.storage.create_session(create_sample_session(id: "s1"))
      client.storage.save_message(target)
      bridge.init(client)

      captured = nil
      stub_request(:post, %r{chat\.postMessage}).to_return do |req|
        captured = JSON.parse(req.body)["text"]
        { status: 200, body: { ok: true, ts: "2.2" }.to_json }
      end

      reply = PocketPing::Message.new(
        id: "m2", session_id: "s1", content: "my reply",
        sender: PocketPing::Sender::VISITOR, timestamp: Time.now.utc, reply_to: target.id
      )
      bridge.on_visitor_message(reply, client.storage.get_session("s1"))
      expect(captured).to include("Support").and include("earlier reply")
    end

    it "truncates a long reply preview" do
      client = PocketPing::Client.new
      long = create_sample_message(session_id: "s1", content: "a" * 300)
      client.storage.create_session(create_sample_session(id: "s1"))
      client.storage.save_message(long)
      bridge.init(client)

      captured = nil
      stub_request(:post, %r{chat\.postMessage}).to_return do |req|
        captured = JSON.parse(req.body)["text"]
        { status: 200, body: { ok: true, ts: "2.2" }.to_json }
      end
      reply = PocketPing::Message.new(
        id: "m9", session_id: "s1", content: "x",
        sender: PocketPing::Sender::VISITOR, timestamp: Time.now.utc, reply_to: long.id
      )
      bridge.on_visitor_message(reply, client.storage.get_session("s1"))
      expect(captured).to include("...")
    end

    it "shows a deleted-message placeholder in the reply quote" do
      client = PocketPing::Client.new
      deleted = create_sample_message(session_id: "s1", sender: PocketPing::Sender::AI, content: "gone")
      deleted.deleted_at = Time.now.utc
      client.storage.create_session(create_sample_session(id: "s1"))
      client.storage.save_message(deleted)
      bridge.init(client)

      captured = nil
      stub_request(:post, %r{chat\.postMessage}).to_return do |req|
        captured = JSON.parse(req.body)["text"]
        { status: 200, body: { ok: true, ts: "3.3" }.to_json }
      end
      reply = PocketPing::Message.new(
        id: "m10", session_id: "s1", content: "x",
        sender: PocketPing::Sender::VISITOR, timestamp: Time.now.utc, reply_to: deleted.id
      )
      bridge.on_visitor_message(reply, client.storage.get_session("s1"))
      expect(captured).to include("Message deleted").and include("AI")
    end
  end
end

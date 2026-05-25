# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::WebhookHandler do
  before { WebMock.reset! }

  # ─────────────────────────────────────────────────────────────────
  # OperatorAttachment / WebhookConfig
  # ─────────────────────────────────────────────────────────────────

  describe PocketPing::OperatorAttachment do
    it "serializes to a hash" do
      att = described_class.new(filename: "f.png", mime_type: "image/png", size: 10, data: "bytes", bridge_file_id: "abc")
      expect(att.to_h).to eq(filename: "f.png", mimeType: "image/png", size: 10, bridgeFileId: "abc")
      expect(att.data).to eq("bytes")
    end
  end

  describe PocketPing::WebhookConfig do
    it "defaults allowed_bot_ids to an empty array" do
      config = described_class.new
      expect(config.allowed_bot_ids).to eq([])
    end
  end

  # ─────────────────────────────────────────────────────────────────
  # Telegram
  # ─────────────────────────────────────────────────────────────────

  describe "#handle_telegram_webhook" do
    it "returns an error when telegram is not configured" do
      handler = described_class.new(PocketPing::WebhookConfig.new)
      expect(handler.handle_telegram_webhook({})).to eq(error: "Telegram not configured")
    end

    it "delivers a plain text operator message" do
      calls = []
      config = PocketPing::WebhookConfig.new(
        telegram_bot_token: "tok",
        on_operator_message: ->(*args) { calls << args }
      )
      handler = described_class.new(config)

      payload = {
        "message" => {
          "message_id" => 5,
          "message_thread_id" => 99,
          "text" => "Hi there",
          "from" => { "first_name" => "Alice" }
        }
      }
      expect(handler.handle_telegram_webhook(payload)).to eq(ok: true)
      expect(calls.length).to eq(1)
      session_id, content, operator_name, source = calls[0]
      expect(session_id).to eq("99")
      expect(content).to eq("Hi there")
      expect(operator_name).to eq("Alice")
      expect(source).to eq("telegram")
    end

    it "calls on_operator_message_with_ids including the bridge message id" do
      calls = []
      config = PocketPing::WebhookConfig.new(
        telegram_bot_token: "tok",
        on_operator_message_with_ids: ->(*args) { calls << args }
      )
      handler = described_class.new(config)
      payload = { "message" => { "message_id" => 7, "message_thread_id" => 1, "text" => "yo" } }
      handler.handle_telegram_webhook(payload)
      expect(calls[0].last).to eq("7")
    end

    it "uses caption when text is empty" do
      calls = []
      config = PocketPing::WebhookConfig.new(telegram_bot_token: "tok", on_operator_message: ->(*a) { calls << a })
      handler = described_class.new(config)
      payload = { "message" => { "message_id" => 1, "message_thread_id" => 2, "caption" => "from caption" } }
      handler.handle_telegram_webhook(payload)
      expect(calls[0][1]).to eq("from caption")
    end

    it "skips slash commands other than /delete" do
      calls = []
      config = PocketPing::WebhookConfig.new(telegram_bot_token: "tok", on_operator_message: ->(*a) { calls << a })
      handler = described_class.new(config)
      payload = { "message" => { "message_id" => 1, "message_thread_id" => 2, "text" => "/start" } }
      expect(handler.handle_telegram_webhook(payload)).to eq(ok: true)
      expect(calls).to be_empty
    end

    it "ignores messages without a topic id" do
      calls = []
      config = PocketPing::WebhookConfig.new(telegram_bot_token: "tok", on_operator_message: ->(*a) { calls << a })
      handler = described_class.new(config)
      payload = { "message" => { "message_id" => 1, "text" => "no topic" } }
      expect(handler.handle_telegram_webhook(payload)).to eq(ok: true)
      expect(calls).to be_empty
    end

    it "returns ok when there is no message, edited_message, or reaction" do
      config = PocketPing::WebhookConfig.new(telegram_bot_token: "tok")
      handler = described_class.new(config)
      expect(handler.handle_telegram_webhook({ "update_id" => 1 })).to eq(ok: true)
    end

    it "ignores an edited message that is only a command" do
      calls = []
      config = PocketPing::WebhookConfig.new(telegram_bot_token: "tok", on_operator_message_edit: ->(*a) { calls << a })
      handler = described_class.new(config)
      payload = { "edited_message" => { "message_id" => 1, "message_thread_id" => 2, "text" => "/cmd" } }
      handler.handle_telegram_webhook(payload)
      expect(calls).to be_empty
    end

    it "ignores an edited message with no text and no topic" do
      calls = []
      config = PocketPing::WebhookConfig.new(telegram_bot_token: "tok", on_operator_message_edit: ->(*a) { calls << a })
      handler = described_class.new(config)
      payload = { "edited_message" => { "message_id" => 1, "text" => "" } }
      handler.handle_telegram_webhook(payload)
      expect(calls).to be_empty
    end

    it "ignores a reaction that is not a trash emoji" do
      calls = []
      config = PocketPing::WebhookConfig.new(telegram_bot_token: "tok", on_operator_message_delete: ->(*a) { calls << a })
      handler = described_class.new(config)
      payload = {
        "message_reaction" => {
          "message_id" => 9, "message_thread_id" => 2,
          "new_reaction" => [{ "type" => "emoji", "emoji" => "👍" }]
        }
      }
      handler.handle_telegram_webhook(payload)
      expect(calls).to be_empty
    end

    it "downloads a photo attachment and forwards it" do
      stub_request(:get, /api\.telegram\.org\/bot.*\/getFile/)
        .to_return(status: 200, body: { ok: true, result: { file_path: "photos/file_1.jpg" } }.to_json)
      stub_request(:get, "https://api.telegram.org/file/bottok/photos/file_1.jpg")
        .to_return(status: 200, body: "IMAGE-BYTES")

      attachments_seen = nil
      config = PocketPing::WebhookConfig.new(
        telegram_bot_token: "tok",
        on_operator_message: ->(_s, _c, _o, _b, attachments, _r) { attachments_seen = attachments }
      )
      handler = described_class.new(config)
      payload = {
        "message" => {
          "message_id" => 1, "message_thread_id" => 2,
          "photo" => [{ "file_id" => "small", "file_size" => 100 }, { "file_id" => "big", "file_size" => 500 }]
        }
      }
      handler.handle_telegram_webhook(payload)
      expect(attachments_seen.length).to eq(1)
      expect(attachments_seen.first.mime_type).to eq("image/jpeg")
      expect(attachments_seen.first.data).to eq("IMAGE-BYTES")
      expect(attachments_seen.first.bridge_file_id).to eq("big")
    end

    it "parses a document attachment" do
      stub_request(:get, /getFile/).to_return(status: 200, body: { ok: true, result: { file_path: "docs/d.pdf" } }.to_json)
      stub_request(:get, %r{/file/bottok/docs/d\.pdf}).to_return(status: 200, body: "PDF")
      seen = nil
      config = PocketPing::WebhookConfig.new(
        telegram_bot_token: "tok",
        on_operator_message: ->(_s, _c, _o, _b, atts, _r) { seen = atts }
      )
      payload = {
        "message" => {
          "message_id" => 1, "message_thread_id" => 2,
          "document" => { "file_id" => "doc1", "file_name" => "report.pdf", "mime_type" => "application/pdf", "file_size" => 9 }
        }
      }
      described_class.new(config).handle_telegram_webhook(payload)
      expect(seen.first.filename).to eq("report.pdf")
      expect(seen.first.mime_type).to eq("application/pdf")
    end

    it "skips when media download fails" do
      stub_request(:get, /getFile/).to_return(status: 500, body: "err")
      seen = []
      config = PocketPing::WebhookConfig.new(
        telegram_bot_token: "tok",
        on_operator_message: ->(_s, _c, _o, _b, atts, _r) { seen = atts }
      )
      payload = {
        "message" => {
          "message_id" => 1, "message_thread_id" => 2,
          "voice" => { "file_id" => "v1", "file_size" => 3 }
        }
      }
      described_class.new(config).handle_telegram_webhook(payload)
      expect(seen).to be_empty
    end
  end

  # ─────────────────────────────────────────────────────────────────
  # Slack
  # ─────────────────────────────────────────────────────────────────

  describe "#handle_slack_webhook" do
    it "returns an error when slack is not configured" do
      handler = described_class.new(PocketPing::WebhookConfig.new)
      expect(handler.handle_slack_webhook({})).to eq(error: "Slack not configured")
    end

    it "answers the url_verification challenge" do
      handler = described_class.new(PocketPing::WebhookConfig.new(slack_bot_token: "xoxb"))
      payload = { "type" => "url_verification", "challenge" => "abc123" }
      expect(handler.handle_slack_webhook(payload)).to eq(challenge: "abc123")
    end

    it "ignores non-message events" do
      handler = described_class.new(PocketPing::WebhookConfig.new(slack_bot_token: "xoxb"))
      payload = { "type" => "event_callback", "event" => { "type" => "reaction_added" } }
      expect(handler.handle_slack_webhook(payload)).to eq(ok: true)
    end

    it "delivers an operator message and resolves the user name" do
      stub_request(:get, /slack\.com\/api\/users\.info/)
        .to_return(status: 200, body: { ok: true, user: { real_name: "Bob Smith" } }.to_json)
      calls = []
      config = PocketPing::WebhookConfig.new(slack_bot_token: "xoxb", on_operator_message: ->(*a) { calls << a })
      handler = described_class.new(config)
      payload = {
        "type" => "event_callback",
        "event" => { "type" => "message", "thread_ts" => "1.1", "ts" => "2.2", "text" => "hello", "user" => "U1" }
      }
      handler.handle_slack_webhook(payload)
      expect(calls[0][0]).to eq("1.1")
      expect(calls[0][1]).to eq("hello")
      expect(calls[0][2]).to eq("Bob Smith")
    end

    it "calls on_operator_message_with_ids with the message ts" do
      stub_request(:get, /users\.info/).to_return(status: 200, body: { ok: true, user: { name: "u" } }.to_json)
      calls = []
      config = PocketPing::WebhookConfig.new(slack_bot_token: "xoxb", on_operator_message_with_ids: ->(*a) { calls << a })
      payload = {
        "type" => "event_callback",
        "event" => { "type" => "message", "thread_ts" => "1.1", "ts" => "2.2", "text" => "x", "user" => "U1" }
      }
      described_class.new(config).handle_slack_webhook(payload)
      expect(calls[0].last).to eq("2.2")
    end

    it "downloads slack files and forwards them" do
      stub_request(:get, "https://files.slack.com/download/file.png")
        .with(headers: { "Authorization" => "Bearer xoxb" })
        .to_return(status: 200, body: "FILEDATA")
      seen = nil
      config = PocketPing::WebhookConfig.new(
        slack_bot_token: "xoxb",
        on_operator_message: ->(_s, _c, _o, _b, atts, _r) { seen = atts }
      )
      payload = {
        "type" => "event_callback",
        "event" => {
          "type" => "message", "thread_ts" => "1.1", "ts" => "2.2", "text" => "",
          "files" => [{ "name" => "file.png", "mimetype" => "image/png", "size" => 8, "id" => "F1",
                        "url_private_download" => "https://files.slack.com/download/file.png" }]
        }
      }
      described_class.new(config).handle_slack_webhook(payload)
      expect(seen.length).to eq(1)
      expect(seen.first.data).to eq("FILEDATA")
    end

    it "handles a message_changed edit event" do
      calls = []
      config = PocketPing::WebhookConfig.new(slack_bot_token: "xoxb", on_operator_message_edit: ->(*a) { calls << a })
      payload = {
        "type" => "event_callback",
        "event" => {
          "type" => "message", "subtype" => "message_changed",
          "message" => { "ts" => "2.2", "thread_ts" => "1.1", "text" => "edited" }
        }
      }
      described_class.new(config).handle_slack_webhook(payload)
      expect(calls[0][0]).to eq("1.1")
      expect(calls[0][1]).to eq("2.2")
      expect(calls[0][2]).to eq("edited")
    end

    it "ignores edits from disallowed bots" do
      calls = []
      config = PocketPing::WebhookConfig.new(slack_bot_token: "xoxb", on_operator_message_edit: ->(*a) { calls << a })
      payload = {
        "type" => "event_callback",
        "event" => {
          "type" => "message", "subtype" => "message_changed",
          "message" => { "ts" => "2.2", "thread_ts" => "1.1", "text" => "x", "bot_id" => "B_OTHER" }
        }
      }
      described_class.new(config).handle_slack_webhook(payload)
      expect(calls).to be_empty
    end

    it "handles a message_deleted event" do
      calls = []
      config = PocketPing::WebhookConfig.new(slack_bot_token: "xoxb", on_operator_message_delete: ->(*a) { calls << a })
      payload = {
        "type" => "event_callback",
        "event" => {
          "type" => "message", "subtype" => "message_deleted",
          "deleted_ts" => "2.2",
          "previous_message" => { "thread_ts" => "1.1", "ts" => "2.2" }
        }
      }
      described_class.new(config).handle_slack_webhook(payload)
      expect(calls[0][0]).to eq("1.1")
      expect(calls[0][1]).to eq("2.2")
    end
  end

  # ─────────────────────────────────────────────────────────────────
  # Discord
  # ─────────────────────────────────────────────────────────────────

  describe "#handle_discord_webhook" do
    it "responds to a PING with a PONG" do
      handler = described_class.new(PocketPing::WebhookConfig.new)
      expect(handler.handle_discord_webhook({ "type" => 1 })).to eq(type: 1)
    end

    it "handles a /reply slash command" do
      calls = []
      config = PocketPing::WebhookConfig.new(on_operator_message: ->(*a) { calls << a })
      handler = described_class.new(config)
      payload = {
        "type" => 2,
        "channel_id" => "chan-1",
        "data" => { "name" => "reply", "options" => [{ "name" => "message", "value" => "Hello from Discord" }] },
        "member" => { "user" => { "username" => "Operator99" } }
      }
      result = handler.handle_discord_webhook(payload)
      expect(result[:type]).to eq(4)
      expect(calls[0][0]).to eq("chan-1")
      expect(calls[0][1]).to eq("Hello from Discord")
      expect(calls[0][2]).to eq("Operator99")
    end

    it "returns a pong for an unknown command" do
      handler = described_class.new(PocketPing::WebhookConfig.new(on_operator_message: ->(*_a) {}))
      payload = { "type" => 2, "data" => { "name" => "other" } }
      expect(handler.handle_discord_webhook(payload)).to eq(type: 1)
    end

    it "returns a pong when the reply command has no message option" do
      handler = described_class.new(PocketPing::WebhookConfig.new(on_operator_message: ->(*_a) {}))
      payload = { "type" => 2, "channel_id" => "c", "data" => { "name" => "reply", "options" => [] } }
      expect(handler.handle_discord_webhook(payload)).to eq(type: 1)
    end
  end
end

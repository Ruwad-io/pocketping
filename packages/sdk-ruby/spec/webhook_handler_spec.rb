# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::WebhookHandler do
  it "calls on_operator_message_edit for edited Telegram messages" do
    calls = []
    config = PocketPing::WebhookConfig.new(
      telegram_bot_token: "test-token",
      on_operator_message_edit: lambda do |session_id, bridge_message_id, content, source_bridge, edited_at|
        calls << [session_id, bridge_message_id, content, source_bridge, edited_at]
      end
    )
    handler = described_class.new(config)

    payload = {
      "edited_message" => {
        "message_id" => 123,
        "message_thread_id" => 456,
        "text" => "Updated message"
      }
    }

    response = handler.handle_telegram_webhook(payload)

    expect(response).to eq({ ok: true })
    expect(calls.length).to eq(1)
    session_id, bridge_message_id, content, source_bridge, edited_at = calls[0]
    expect(session_id).to eq("456")
    expect(bridge_message_id).to eq("123")
    expect(content).to eq("Updated message")
    expect(source_bridge).to eq("telegram")
    expect(edited_at).to be_a(Time)
  end

  it "calls on_operator_message_delete for /delete reply commands" do
    calls = []
    config = PocketPing::WebhookConfig.new(
      telegram_bot_token: "test-token",
      on_operator_message_delete: lambda do |session_id, bridge_message_id, source_bridge, deleted_at|
        calls << [session_id, bridge_message_id, source_bridge, deleted_at]
      end
    )
    handler = described_class.new(config)

    payload = {
      "message" => {
        "message_id" => 200,
        "message_thread_id" => 456,
        "text" => "/delete",
        "reply_to_message" => { "message_id" => 999 }
      }
    }

    response = handler.handle_telegram_webhook(payload)

    expect(response).to eq({ ok: true })
    expect(calls.length).to eq(1)
    session_id, bridge_message_id, source_bridge, deleted_at = calls[0]
    expect(session_id).to eq("456")
    expect(bridge_message_id).to eq("999")
    expect(source_bridge).to eq("telegram")
    expect(deleted_at).to be_a(Time)
  end

  it "calls on_operator_message_delete for 🗑 reactions" do
    calls = []
    config = PocketPing::WebhookConfig.new(
      telegram_bot_token: "test-token",
      on_operator_message_delete: lambda do |session_id, bridge_message_id, source_bridge, deleted_at|
        calls << [session_id, bridge_message_id, source_bridge, deleted_at]
      end
    )
    handler = described_class.new(config)

    payload = {
      "message_reaction" => {
        "message_id" => 999,
        "message_thread_id" => 456,
        "new_reaction" => [{ "type" => "emoji", "emoji" => "🗑️" }]
      }
    }

    response = handler.handle_telegram_webhook(payload)

    expect(response).to eq({ ok: true })
    expect(calls.length).to eq(1)
    session_id, bridge_message_id, source_bridge, deleted_at = calls[0]
    expect(session_id).to eq("456")
    expect(bridge_message_id).to eq("999")
    expect(source_bridge).to eq("telegram")
    expect(deleted_at).to be_a(Time)
  end
end

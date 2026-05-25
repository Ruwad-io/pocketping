# frozen_string_literal: true

require "spec_helper"

# A real bridge (named like a telegram bridge) that records the calls it
# receives, so we can assert the core passes the correct (message, session,
# platform_message_id) signature and that platform IDs are persisted.
#
# Regression guard: the core previously called on_message_edit with
# (session_id, message_id, content, edited_at) — wrong arity and types — and
# never stored the IDs returned by on_visitor_message, making edit/delete sync
# a silent no-op.
class RecordingTelegramBridge < PocketPing::Bridge::Base
  PLATFORM_MESSAGE_ID = 999

  attr_reader :edit_calls, :delete_calls

  def initialize
    super
    @edit_calls = []
    @delete_calls = []
  end

  def name
    "telegram"
  end

  def on_visitor_message(_message, _session)
    PocketPing::BridgeMessageResult.new(message_id: PLATFORM_MESSAGE_ID)
  end

  def on_message_edit(message, session, telegram_message_id)
    raise "wrong type for message" unless message.is_a?(PocketPing::Message)
    raise "wrong type for session" unless session.is_a?(PocketPing::Session)

    @edit_calls << [message, session, telegram_message_id]
  end

  def on_message_delete(message, session, telegram_message_id)
    raise "wrong type for message" unless message.is_a?(PocketPing::Message)
    raise "wrong type for session" unless session.is_a?(PocketPing::Session)

    @delete_calls << [message, session, telegram_message_id]
  end
end

RSpec.describe "edit/delete bridge sync" do
  let(:bridge) { RecordingTelegramBridge.new }
  let(:client) { PocketPing::Client.new(bridges: [bridge]) }
  let(:session) { create_sample_session }

  def send_visitor_message
    client.storage.create_session(session)
    resp = client.handle_message(
      PocketPing::SendMessageRequest.new(
        session_id: session.id, content: "hi", sender: PocketPing::Sender::VISITOR
      )
    )
    resp.message_id
  end

  it "persists the bridge message IDs returned on send" do
    message_id = send_visitor_message
    ids = client.storage.get_bridge_message_ids(message_id)

    expect(ids).not_to be_nil
    expect(ids.telegram_message_id).to eq(RecordingTelegramBridge::PLATFORM_MESSAGE_ID)
  end

  it "syncs an edit to the bridge with the correct signature" do
    message_id = send_visitor_message
    client.handle_edit_message(
      PocketPing::EditMessageRequest.new(
        session_id: session.id, message_id: message_id, content: "edited!"
      )
    )

    expect(bridge.edit_calls.size).to eq(1)
    message, sess, platform_id = bridge.edit_calls.first
    expect(message.content).to eq("edited!")
    expect(sess.id).to eq(session.id)
    expect(platform_id).to eq(RecordingTelegramBridge::PLATFORM_MESSAGE_ID)
  end

  it "syncs a delete to the bridge with the correct signature" do
    message_id = send_visitor_message
    client.handle_delete_message(
      PocketPing::DeleteMessageRequest.new(session_id: session.id, message_id: message_id)
    )

    expect(bridge.delete_calls.size).to eq(1)
    _message, sess, platform_id = bridge.delete_calls.first
    expect(sess.id).to eq(session.id)
    expect(platform_id).to eq(RecordingTelegramBridge::PLATFORM_MESSAGE_ID)
  end
end

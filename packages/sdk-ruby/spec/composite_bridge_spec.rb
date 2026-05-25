# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::Bridge::CompositeBridge do
  # A bridge that records every callback it receives.
  let(:recorder) do
    Class.new(PocketPing::Bridge::Base) do
      attr_reader :log

      def initialize
        super
        @log = []
      end

      def name = "recorder"
      def on_new_session(session) = @log << [:new_session, session]
      def on_visitor_message(message, session) = @log << [:visitor, message, session]
      def on_operator_message(message, session, source, name = nil) = @log << [:operator, message, session, source, name]
      def on_typing(session_id, is_typing) = @log << [:typing, session_id, is_typing]
      def on_message_read(session_id, ids, status, session) = @log << [:read, session_id, ids, status]
      def on_custom_event(event, session) = @log << [:event, event, session]
      def on_ai_takeover(session, reason) = @log << [:takeover, session, reason]
      def on_identity_update(session) = @log << [:identity, session]
    end.new
  end

  # A bridge that raises in every callback to exercise the rescue paths.
  let(:exploder) do
    Class.new(PocketPing::Bridge::Base) do
      def name = "exploder"
      def on_new_session(_s) = raise "boom"
      def on_visitor_message(_m, _s) = raise "boom"
      def on_operator_message(_m, _s, _src, _n = nil) = raise "boom"
      def on_typing(_id, _t) = raise "boom"
      def on_message_read(_id, _ids, _st, _s) = raise "boom"
      def on_custom_event(_e, _s) = raise "boom"
      def on_ai_takeover(_s, _r) = raise "boom"
      def on_identity_update(_s) = raise "boom"
      def destroy = raise "boom"
    end.new
  end

  let(:session) { create_sample_session }
  let(:message) { create_sample_message(session_id: session.id) }
  let(:event) { PocketPing::CustomEvent.new(name: "ev", data: {}, timestamp: Time.now.utc) }

  it "exposes its name and bridges" do
    composite = described_class.new([recorder])
    expect(composite.name).to eq("composite")
    expect(composite.bridges).to eq([recorder])
  end

  it "initializes all child bridges with the client" do
    composite = described_class.new([recorder])
    client = PocketPing::Client.new
    composite.init(client)
    expect(recorder.pocketping).to eq(client)
  end

  it "forwards every callback to children" do
    composite = described_class.new([recorder])
    composite.on_new_session(session)
    composite.on_visitor_message(message, session)
    composite.on_operator_message(message, session, "api", "Op")
    composite.on_typing(session.id, true)
    composite.on_message_read(session.id, ["m1"], "read", session)
    composite.on_custom_event(event, session)
    composite.on_ai_takeover(session, "offline")
    composite.on_identity_update(session)

    kinds = recorder.log.map(&:first)
    expect(kinds).to eq(%i[new_session visitor operator typing read event takeover identity])
  end

  it "isolates errors from one bridge so others still receive callbacks" do
    composite = described_class.new([exploder, recorder])
    expect do
      composite.on_new_session(session)
      composite.on_visitor_message(message, session)
      composite.on_operator_message(message, session, "api")
      composite.on_typing(session.id, true)
      composite.on_message_read(session.id, ["m1"], "read", session)
      composite.on_custom_event(event, session)
      composite.on_ai_takeover(session, "r")
      composite.on_identity_update(session)
    end.not_to raise_error
    expect(recorder.log.length).to eq(8)
  end

  it "adds a bridge dynamically and initializes it when already started" do
    composite = described_class.new([])
    client = PocketPing::Client.new
    composite.init(client)
    composite.add_bridge(recorder)
    expect(recorder.pocketping).to eq(client)
    expect(composite.bridges).to include(recorder)
  end

  it "removes a bridge and calls destroy" do
    composite = described_class.new([recorder])
    composite.remove_bridge(recorder)
    expect(composite.bridges).to be_empty
  end

  it "destroys all child bridges, swallowing errors" do
    composite = described_class.new([recorder])
    composite.init(PocketPing::Client.new)
    expect { composite.destroy }.not_to raise_error
    expect(composite.pocketping).to be_nil
  end
end

RSpec.describe PocketPing::Bridge::Base do
  let(:base) { described_class.new }

  it "raises NotImplementedError for #name" do
    expect { base.name }.to raise_error(NotImplementedError)
  end

  it "provides no-op defaults that do not raise" do
    session = create_sample_session
    message = create_sample_message(session_id: session.id)
    expect do
      base.on_new_session(session)
      base.on_visitor_message(message, session)
      base.on_operator_message(message, session, "api")
      base.on_typing(session.id, true)
      base.on_message_read(session.id, [], "read", session)
      base.on_custom_event(PocketPing::CustomEvent.new(name: "e"), session)
      base.on_ai_takeover(session, "reason")
      base.on_identity_update(session)
    end.not_to raise_error
  end

  it "clears the client reference on destroy" do
    base.init(PocketPing::Client.new)
    base.destroy
    expect(base.pocketping).to be_nil
  end
end

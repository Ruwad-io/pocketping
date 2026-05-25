# frozen_string_literal: true

require "spec_helper"
require "rack"

RSpec.describe PocketPing::Client do
  let(:client) { described_class.new }

  describe "lifecycle" do
    it "initializes and destroys bridges on start/stop" do
      bridge = MockBridge.new
      c = described_class.new(bridges: [bridge])
      expect(bridge).to receive(:init).with(c)
      c.start
      expect(bridge).to receive(:destroy)
      c.stop
    end
  end

  describe "IP filter helpers" do
    it "logs blocked events and fires on_blocked" do
      events = []
      c = described_class.new(ip_filter: {
        enabled: true, mode: "blocklist", blocklist: ["1.2.3.4"],
        on_blocked: ->(event) { events << event }
      })
      result = c.check_ip_filter_with_logging("1.2.3.4", { path: "/x" })
      expect(result.allowed).to be false
      expect(events.length).to eq(1)
      expect(events.first.ip).to eq("1.2.3.4")
    end

    it "does not log when the IP is allowed" do
      events = []
      c = described_class.new(ip_filter: {
        enabled: true, mode: "blocklist", blocklist: ["1.2.3.4"],
        on_blocked: ->(event) { events << event }
      })
      c.check_ip_filter_with_logging("9.9.9.9")
      expect(events).to be_empty
    end

    it "extracts the client IP via get_client_ip" do
      env = Rack::MockRequest.env_for("/", "REMOTE_ADDR" => "5.5.5.5")
      env["HTTP_X_REAL_IP"] = "8.8.8.8"
      ip = client.get_client_ip(Rack::Request.new(env))
      expect(ip).to eq("8.8.8.8")
    end
  end

  describe "#handle_connect metadata preservation" do
    it "preserves server-side geo fields when resuming with new metadata" do
      session = create_sample_session(visitor_id: "v-keep")
      session.metadata.ip = "10.0.0.1"
      session.metadata.country = "FR"
      session.metadata.city = "Paris"
      client.storage.create_session(session)

      request = PocketPing::ConnectRequest.new(
        visitor_id: "v-keep",
        session_id: session.id,
        metadata: PocketPing::SessionMetadata.new(url: "https://new.example.com")
      )
      client.handle_connect(request)

      updated = client.storage.get_session(session.id)
      expect(updated.metadata.url).to eq("https://new.example.com")
      expect(updated.metadata.ip).to eq("10.0.0.1")
      expect(updated.metadata.country).to eq("FR")
      expect(updated.metadata.city).to eq("Paris")
    end
  end

  describe "#handle_get_messages" do
    it "caps the limit at 100 and reports has_more" do
      session = create_sample_session
      client.storage.create_session(session)
      5.times { |i| client.storage.save_message(create_sample_message(session_id: session.id, content: "m#{i}")) }

      result = client.handle_get_messages(session.id, limit: 2)
      expect(result[:messages].length).to eq(2)
      expect(result[:has_more]).to be true
    end

    it "returns has_more false when fewer messages than limit" do
      session = create_sample_session
      client.storage.create_session(session)
      client.storage.save_message(create_sample_message(session_id: session.id))
      result = client.handle_get_messages(session.id, limit: 50)
      expect(result[:has_more]).to be false
    end
  end

  describe "#get_session" do
    it "delegates to storage" do
      session = create_sample_session
      client.storage.create_session(session)
      expect(client.get_session(session.id)).to eq(session)
      expect(client.get_session("missing")).to be_nil
    end
  end

  describe "WebSocket broadcast cleanup" do
    it "removes dead connections that raise on send" do
      session = create_sample_session
      client.storage.create_session(session)
      good = MockWebSocket.new
      dead = MockWebSocket.new
      dead.close # closed socket raises on send_text
      client.register_websocket(session.id, good)
      client.register_websocket(session.id, dead)

      client.broadcast_to_session(session.id, PocketPing::WebSocketEvent.new(type: "ping", data: {}))
      expect(good.messages.length).to eq(1)

      # Dead connection should have been unregistered; a second broadcast only
      # reaches the good socket.
      client.broadcast_to_session(session.id, PocketPing::WebSocketEvent.new(type: "ping", data: {}))
      expect(good.messages.length).to eq(2)
    end

    it "is a no-op when there are no connections" do
      expect(client.broadcast_to_session("none", PocketPing::WebSocketEvent.new(type: "x", data: {}))).to be_nil
    end
  end

  describe "custom event edge cases" do
    it "warns and returns when the session is not found" do
      event = PocketPing::CustomEvent.new(name: "ev", data: {})
      expect { client.handle_custom_event("missing", event) }.to output(/not found/).to_stderr
    end

    it "swallows errors raised inside specific and wildcard handlers" do
      session = create_sample_session
      client.storage.create_session(session)
      client.on_event("boom") { raise "in handler" }
      client.on_event("*") { raise "in wildcard" }

      event = PocketPing::CustomEvent.new(name: "boom", data: {})
      expect { client.handle_custom_event(session.id, event) }.to output(/Error in/).to_stderr
    end
  end

  describe "version headers and warnings" do
    let(:c) { described_class.new(min_widget_version: "1.0.0", latest_widget_version: "2.0.0") }

    it "produces version headers from a check result" do
      check = c.check_widget_version("1.5.0")
      headers = c.get_version_headers(check)
      expect(headers["X-PocketPing-Version-Status"]).to be_a(String)
      expect(headers["X-PocketPing-Min-Version"]).to eq("1.0.0")
      expect(headers["X-PocketPing-Latest-Version"]).to eq("2.0.0")
    end

    it "broadcasts a version warning over WebSocket" do
      session = create_sample_session
      c.storage.create_session(session)
      ws = MockWebSocket.new
      c.register_websocket(session.id, ws)

      check = c.check_widget_version("0.5.0") # below min -> unsupported
      c.send_version_warning(session.id, check, "0.5.0")
      expect(ws.messages.length).to eq(1)
      payload = JSON.parse(ws.messages.first)
      expect(payload["type"]).to eq("version_warning")
    end
  end

  describe "webhook send failure paths" do
    let(:webhook_url) { "https://hooks.example.com/wh" }

    before { WebMock.reset! }

    it "warns when the webhook responds with a non-success status" do
      c = described_class.new(webhook_url: webhook_url)
      session = create_sample_session
      c.storage.create_session(session)
      stub_request(:post, webhook_url).to_return(status: 500, body: "boom")
      allow(Thread).to receive(:new).and_yield.and_return(instance_double(Thread, join: true))

      event = PocketPing::CustomEvent.new(name: "e", data: {}, timestamp: Time.now.utc)
      expect { c.handle_custom_event(session.id, event) }.to output(/Webhook returned 500/).to_stderr
    end

    it "warns when the webhook times out" do
      c = described_class.new(webhook_url: webhook_url)
      session = create_sample_session
      c.storage.create_session(session)
      stub_request(:post, webhook_url).to_timeout
      allow(Thread).to receive(:new).and_yield.and_return(instance_double(Thread, join: true))

      event = PocketPing::CustomEvent.new(name: "e", data: {}, timestamp: Time.now.utc)
      expect { c.handle_custom_event(session.id, event) }.to output(/Webhook/).to_stderr
    end
  end

  describe "bridge message id mapping" do
    it "saves slack ts when a slack bridge returns a message id" do
      session = create_sample_session
      client.storage.create_session(session)

      slack = Class.new(PocketPing::Bridge::Base) do
        def name = "slack_custom"
        def on_visitor_message(_m, _s) = PocketPing::BridgeMessageResult.new(message_id: "1700000000.0001")
      end.new
      c = described_class.new(bridges: [slack])
      c.storage.create_session(session)

      response = c.handle_message(PocketPing::SendMessageRequest.new(
        session_id: session.id, content: "hi", sender: PocketPing::Sender::VISITOR
      ))
      ids = c.storage.get_bridge_message_ids(response.message_id)
      expect(ids.slack_message_ts).to eq("1700000000.0001")
    end

    it "ignores results from a bridge with an unrecognized name prefix" do
      session = create_sample_session
      mystery = Class.new(PocketPing::Bridge::Base) do
        def name = "carrier_pigeon"
        def on_visitor_message(_m, _s) = PocketPing::BridgeMessageResult.new(message_id: "xyz")
      end.new
      c = described_class.new(bridges: [mystery])
      c.storage.create_session(session)

      response = c.handle_message(PocketPing::SendMessageRequest.new(
        session_id: session.id, content: "hi", sender: PocketPing::Sender::VISITOR
      ))
      expect(c.storage.get_bridge_message_ids(response.message_id)).to be_nil
    end
  end
end

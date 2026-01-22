# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::Client do
  let(:client) { described_class.new }
  let(:sample_session) { create_sample_session }

  describe "PocketPing::Client initialization" do
    it "creates a client with default settings" do
      expect(client.storage).to be_a(PocketPing::Storage::MemoryStorage)
      expect(client.bridges).to eq([])
      expect(client.welcome_message).to be_nil
      expect(client.ai_takeover_delay).to eq(300)
    end

    it "accepts custom configuration" do
      custom_client = described_class.new(
        welcome_message: "Hello!",
        ai_takeover_delay: 600,
        webhook_url: "https://example.com/webhook"
      )

      expect(custom_client.welcome_message).to eq("Hello!")
      expect(custom_client.ai_takeover_delay).to eq(600)
      expect(custom_client.webhook_url).to eq("https://example.com/webhook")
    end
  end

  describe "#handle_connect" do
    context "when creating a new session" do
      it "creates a new session when no session_id provided" do
        request = PocketPing::ConnectRequest.new(
          visitor_id: "new-visitor",
          metadata: PocketPing::SessionMetadata.new(url: "https://example.com")
        )

        response = client.handle_connect(request)

        expect(response.session_id).not_to be_nil
        expect(response.visitor_id).to eq("new-visitor")
        expect(response.messages).to eq([])
      end

      it "assigns a unique session ID" do
        request = PocketPing::ConnectRequest.new(visitor_id: "visitor-1")

        response1 = client.handle_connect(request)

        request2 = PocketPing::ConnectRequest.new(visitor_id: "visitor-2")
        response2 = client.handle_connect(request2)

        expect(response1.session_id).not_to eq(response2.session_id)
      end

      it "includes welcome message in response" do
        client_with_welcome = described_class.new(welcome_message: "Welcome!")
        request = PocketPing::ConnectRequest.new(visitor_id: "visitor")

        response = client_with_welcome.handle_connect(request)

        expect(response.welcome_message).to eq("Welcome!")
      end

      it "calls on_new_session callback" do
        sessions = []
        client_with_callback = described_class.new(
          on_new_session: ->(session) { sessions << session }
        )

        request = PocketPing::ConnectRequest.new(visitor_id: "visitor")
        client_with_callback.handle_connect(request)

        expect(sessions.length).to eq(1)
        expect(sessions.first.visitor_id).to eq("visitor")
      end
    end

    context "when resuming an existing session" do
      before do
        client.storage.create_session(sample_session)
      end

      it "reuses existing session when session_id provided" do
        request = PocketPing::ConnectRequest.new(
          visitor_id: sample_session.visitor_id,
          session_id: sample_session.id
        )

        response = client.handle_connect(request)

        expect(response.session_id).to eq(sample_session.id)
        expect(response.visitor_id).to eq(sample_session.visitor_id)
      end

      it "returns existing messages" do
        message = create_sample_message(session_id: sample_session.id)
        client.storage.save_message(message)

        request = PocketPing::ConnectRequest.new(
          visitor_id: sample_session.visitor_id,
          session_id: sample_session.id
        )

        response = client.handle_connect(request)

        expect(response.messages.length).to eq(1)
        expect(response.messages.first.id).to eq(message.id)
      end

      it "updates metadata on reconnect" do
        request = PocketPing::ConnectRequest.new(
          visitor_id: sample_session.visitor_id,
          session_id: sample_session.id,
          metadata: PocketPing::SessionMetadata.new(url: "https://example.com/new-page")
        )

        client.handle_connect(request)

        session = client.storage.get_session(sample_session.id)
        expect(session.metadata.url).to eq("https://example.com/new-page")
      end

      it "finds session by visitor_id when session_id not provided" do
        request = PocketPing::ConnectRequest.new(
          visitor_id: sample_session.visitor_id
        )

        response = client.handle_connect(request)

        expect(response.session_id).to eq(sample_session.id)
      end
    end
  end

  describe "#handle_message" do
    before do
      client.storage.create_session(sample_session)
    end

    it "handles visitor message" do
      request = PocketPing::SendMessageRequest.new(
        session_id: sample_session.id,
        content: "Hello!",
        sender: PocketPing::Sender::VISITOR
      )

      response = client.handle_message(request)

      expect(response.message_id).not_to be_nil
      expect(response.timestamp).not_to be_nil

      messages = client.storage.get_messages(sample_session.id)
      expect(messages.length).to eq(1)
      expect(messages.first.content).to eq("Hello!")
    end

    it "handles operator message" do
      request = PocketPing::SendMessageRequest.new(
        session_id: sample_session.id,
        content: "Hi there!",
        sender: PocketPing::Sender::OPERATOR
      )

      response = client.handle_message(request)

      messages = client.storage.get_messages(sample_session.id)
      expect(messages.first.sender).to eq(PocketPing::Sender::OPERATOR)
    end

    it "updates session last_activity" do
      original_activity = sample_session.last_activity

      request = PocketPing::SendMessageRequest.new(
        session_id: sample_session.id,
        content: "Hello!",
        sender: PocketPing::Sender::VISITOR
      )

      sleep 0.01 # Ensure time difference
      client.handle_message(request)

      session = client.storage.get_session(sample_session.id)
      expect(session.last_activity).to be > original_activity
    end

    it "raises SessionNotFoundError for invalid session" do
      request = PocketPing::SendMessageRequest.new(
        session_id: "non-existent",
        content: "Hello!",
        sender: PocketPing::Sender::VISITOR
      )

      expect { client.handle_message(request) }.to raise_error(PocketPing::SessionNotFoundError)
    end

    it "disables AI when operator responds" do
      sample_session.ai_active = true
      client.storage.update_session(sample_session)

      request = PocketPing::SendMessageRequest.new(
        session_id: sample_session.id,
        content: "I'm here to help",
        sender: PocketPing::Sender::OPERATOR
      )

      client.handle_message(request)

      session = client.storage.get_session(sample_session.id)
      expect(session.ai_active).to be false
    end

    it "calls on_message callback" do
      messages_received = []
      client_with_callback = described_class.new(
        on_message: ->(message, session) { messages_received << [message, session] }
      )
      client_with_callback.storage.create_session(sample_session)

      request = PocketPing::SendMessageRequest.new(
        session_id: sample_session.id,
        content: "Test",
        sender: PocketPing::Sender::VISITOR
      )

      client_with_callback.handle_message(request)

      expect(messages_received.length).to eq(1)
      expect(messages_received.first[0].content).to eq("Test")
    end

    it "validates content is not empty" do
      request = PocketPing::SendMessageRequest.new(
        session_id: sample_session.id,
        content: "",
        sender: PocketPing::Sender::VISITOR
      )

      expect { client.handle_message(request) }.to raise_error(PocketPing::ValidationError)
    end

    it "validates content does not exceed max length" do
      long_content = "x" * 4001
      request = PocketPing::SendMessageRequest.new(
        session_id: sample_session.id,
        content: long_content,
        sender: PocketPing::Sender::VISITOR
      )

      expect { client.handle_message(request) }.to raise_error(PocketPing::ValidationError)
    end
  end

  describe "#handle_read" do
    let(:message) { create_sample_message(session_id: sample_session.id) }

    before do
      client.storage.create_session(sample_session)
      client.storage.save_message(message)
    end

    it "updates message status to delivered" do
      request = PocketPing::ReadRequest.new(
        session_id: sample_session.id,
        message_ids: [message.id],
        status: PocketPing::MessageStatus::DELIVERED
      )

      response = client.handle_read(request)

      expect(response.updated).to eq(1)

      updated_message = client.storage.get_message(message.id)
      expect(updated_message.status).to eq(PocketPing::MessageStatus::DELIVERED)
      expect(updated_message.delivered_at).not_to be_nil
    end

    it "updates message status to read" do
      request = PocketPing::ReadRequest.new(
        session_id: sample_session.id,
        message_ids: [message.id],
        status: PocketPing::MessageStatus::READ
      )

      client.handle_read(request)

      updated_message = client.storage.get_message(message.id)
      expect(updated_message.status).to eq(PocketPing::MessageStatus::READ)
      expect(updated_message.read_at).not_to be_nil
      expect(updated_message.delivered_at).not_to be_nil
    end

    it "returns count of updated messages" do
      message2 = create_sample_message(session_id: sample_session.id)
      client.storage.save_message(message2)

      request = PocketPing::ReadRequest.new(
        session_id: sample_session.id,
        message_ids: [message.id, message2.id],
        status: PocketPing::MessageStatus::READ
      )

      response = client.handle_read(request)

      expect(response.updated).to eq(2)
    end
  end

  describe "#handle_identify" do
    before do
      client.storage.create_session(sample_session)
    end

    it "updates session with identity" do
      identity = PocketPing::UserIdentity.new(
        id: "user-123",
        email: "user@example.com",
        name: "John Doe"
      )

      request = PocketPing::IdentifyRequest.new(
        session_id: sample_session.id,
        identity: identity
      )

      response = client.handle_identify(request)

      expect(response.ok).to be true

      session = client.storage.get_session(sample_session.id)
      expect(session.identity.id).to eq("user-123")
      expect(session.identity.email).to eq("user@example.com")
    end

    it "raises error when identity.id is missing" do
      identity = PocketPing::UserIdentity.new(id: "")

      request = PocketPing::IdentifyRequest.new(
        session_id: sample_session.id,
        identity: identity
      )

      expect { client.handle_identify(request) }.to raise_error(PocketPing::ValidationError)
    end

    it "raises SessionNotFoundError for invalid session" do
      identity = PocketPing::UserIdentity.new(id: "user-123")

      request = PocketPing::IdentifyRequest.new(
        session_id: "non-existent",
        identity: identity
      )

      expect { client.handle_identify(request) }.to raise_error(PocketPing::SessionNotFoundError)
    end

    it "calls on_identify callback" do
      identified_sessions = []
      client_with_callback = described_class.new(
        on_identify: ->(session) { identified_sessions << session }
      )
      client_with_callback.storage.create_session(sample_session)

      identity = PocketPing::UserIdentity.new(id: "user-123")
      request = PocketPing::IdentifyRequest.new(
        session_id: sample_session.id,
        identity: identity
      )

      client_with_callback.handle_identify(request)

      expect(identified_sessions.length).to eq(1)
    end

    it "supports custom fields in identity" do
      identity = PocketPing::UserIdentity.new(
        id: "user-123",
        email: "user@example.com",
        plan: "pro",
        company: "Acme Inc"
      )

      request = PocketPing::IdentifyRequest.new(
        session_id: sample_session.id,
        identity: identity
      )

      client.handle_identify(request)

      session = client.storage.get_session(sample_session.id)
      expect(session.identity[:plan]).to eq("pro")
      expect(session.identity[:company]).to eq("Acme Inc")
    end
  end

  describe "#handle_typing" do
    before do
      client.storage.create_session(sample_session)
    end

    it "returns ok response" do
      request = PocketPing::TypingRequest.new(
        session_id: sample_session.id,
        sender: PocketPing::Sender::VISITOR,
        is_typing: true
      )

      response = client.handle_typing(request)

      expect(response[:ok]).to be true
    end
  end

  describe "#handle_presence" do
    it "returns operator offline by default" do
      response = client.handle_presence

      expect(response.online).to be false
    end

    it "returns operator online when set" do
      client.set_operator_online(true)

      response = client.handle_presence

      expect(response.online).to be true
    end
  end

  describe "WebSocket management" do
    let(:websocket) { MockWebSocket.new }

    before do
      client.storage.create_session(sample_session)
    end

    it "registers websocket connection" do
      client.register_websocket(sample_session.id, websocket)

      # Send a message to trigger broadcast
      request = PocketPing::SendMessageRequest.new(
        session_id: sample_session.id,
        content: "Test",
        sender: PocketPing::Sender::VISITOR
      )

      client.handle_message(request)

      expect(websocket.messages.length).to eq(1)
      expect(websocket.messages.first).to include("Test")
    end

    it "unregisters websocket connection" do
      client.register_websocket(sample_session.id, websocket)
      client.unregister_websocket(sample_session.id, websocket)

      request = PocketPing::SendMessageRequest.new(
        session_id: sample_session.id,
        content: "Test",
        sender: PocketPing::Sender::VISITOR
      )

      client.handle_message(request)

      expect(websocket.messages).to be_empty
    end

    it "broadcasts to multiple websockets" do
      websocket2 = MockWebSocket.new
      client.register_websocket(sample_session.id, websocket)
      client.register_websocket(sample_session.id, websocket2)

      request = PocketPing::SendMessageRequest.new(
        session_id: sample_session.id,
        content: "Test",
        sender: PocketPing::Sender::VISITOR
      )

      client.handle_message(request)

      expect(websocket.messages.length).to eq(1)
      expect(websocket2.messages.length).to eq(1)
    end
  end

  describe "Operator functions" do
    before do
      client.storage.create_session(sample_session)
    end

    it "sends operator message" do
      message = client.send_operator_message(
        sample_session.id,
        "Hello from operator",
        source_bridge: "web",
        operator_name: "John"
      )

      expect(message.content).to eq("Hello from operator")
      expect(message.sender).to eq(PocketPing::Sender::OPERATOR)

      messages = client.storage.get_messages(sample_session.id)
      expect(messages.length).to eq(1)
    end

    it "sets operator online status" do
      expect(client.operator_online?).to be false

      client.set_operator_online(true)

      expect(client.operator_online?).to be true
    end

    it "broadcasts presence when operator status changes" do
      websocket = MockWebSocket.new
      client.register_websocket(sample_session.id, websocket)

      client.set_operator_online(true)

      expect(websocket.messages.length).to eq(1)
      expect(websocket.messages.first).to include("presence")
    end
  end

  describe "Bridge integration" do
    let(:bridge) { MockBridge.new }

    before do
      client.add_bridge(bridge)
      client.storage.create_session(sample_session)
    end

    it "adds bridge dynamically" do
      expect(client.bridges).to include(bridge)
    end

    it "notifies bridge on new session" do
      client_with_bridge = described_class.new(bridges: [bridge])

      request = PocketPing::ConnectRequest.new(visitor_id: "new-visitor")
      client_with_bridge.handle_connect(request)

      expect(bridge.new_sessions.length).to eq(1)
    end

    it "notifies bridge on visitor message" do
      request = PocketPing::SendMessageRequest.new(
        session_id: sample_session.id,
        content: "Hello!",
        sender: PocketPing::Sender::VISITOR
      )

      client.handle_message(request)

      expect(bridge.messages.length).to eq(1)
    end

    it "does not notify bridge on operator message" do
      request = PocketPing::SendMessageRequest.new(
        session_id: sample_session.id,
        content: "Hello!",
        sender: PocketPing::Sender::OPERATOR
      )

      client.handle_message(request)

      expect(bridge.messages.length).to eq(0)
    end

    it "notifies bridge on identity update" do
      identity = PocketPing::UserIdentity.new(id: "user-123")
      request = PocketPing::IdentifyRequest.new(
        session_id: sample_session.id,
        identity: identity
      )

      client.handle_identify(request)

      expect(bridge.identities.length).to eq(1)
    end
  end

  describe "Custom events" do
    before do
      client.storage.create_session(sample_session)
    end

    it "registers event handler" do
      events_received = []
      client.on_event("test_event") { |event, _session| events_received << event }

      event = PocketPing::CustomEvent.new(
        name: "test_event",
        data: { key: "value" }
      )

      client.handle_custom_event(sample_session.id, event)

      expect(events_received.length).to eq(1)
      expect(events_received.first.name).to eq("test_event")
    end

    it "unsubscribes from event" do
      events_received = []
      handler = ->(event, _session) { events_received << event }
      unsubscribe = client.on_event("test_event", &handler)

      unsubscribe.call

      event = PocketPing::CustomEvent.new(name: "test_event")
      client.handle_custom_event(sample_session.id, event)

      expect(events_received).to be_empty
    end

    it "supports wildcard handlers" do
      events_received = []
      client.on_event("*") { |event, _session| events_received << event }

      event1 = PocketPing::CustomEvent.new(name: "event_a")
      event2 = PocketPing::CustomEvent.new(name: "event_b")

      client.handle_custom_event(sample_session.id, event1)
      client.handle_custom_event(sample_session.id, event2)

      expect(events_received.length).to eq(2)
    end

    it "emits event to session" do
      websocket = MockWebSocket.new
      client.register_websocket(sample_session.id, websocket)

      client.emit_event(sample_session.id, "show_offer", { discount: 20 })

      expect(websocket.messages.length).to eq(1)
      expect(websocket.messages.first).to include("show_offer")
    end

    it "broadcasts event to all sessions" do
      session2 = create_sample_session
      client.storage.create_session(session2)

      ws1 = MockWebSocket.new
      ws2 = MockWebSocket.new
      client.register_websocket(sample_session.id, ws1)
      client.register_websocket(session2.id, ws2)

      client.broadcast_event("announcement", { message: "Hello all!" })

      expect(ws1.messages.length).to eq(1)
      expect(ws2.messages.length).to eq(1)
    end

    it "sets session_id on handled event" do
      events_received = []
      client.on_event("test") { |event, _session| events_received << event }

      event = PocketPing::CustomEvent.new(name: "test")
      client.handle_custom_event(sample_session.id, event)

      expect(events_received.first.session_id).to eq(sample_session.id)
    end

    it "notifies bridges about custom events" do
      bridge = MockBridge.new
      client.add_bridge(bridge)

      event = PocketPing::CustomEvent.new(name: "test_event")
      client.handle_custom_event(sample_session.id, event)

      expect(bridge.events.length).to eq(1)
    end
  end

  describe "Version management" do
    it "returns OK for matching version" do
      client_with_version = described_class.new(
        min_widget_version: "0.2.0",
        latest_widget_version: "0.3.0"
      )

      result = client_with_version.check_widget_version("0.3.0")

      expect(result.status).to eq(PocketPing::VersionStatus::OK)
      expect(result.can_continue).to be true
    end

    it "returns outdated for minor version behind" do
      client_with_version = described_class.new(
        latest_widget_version: "0.3.0"
      )

      result = client_with_version.check_widget_version("0.2.0")

      expect(result.status).to eq(PocketPing::VersionStatus::OUTDATED)
      expect(result.can_continue).to be true
    end

    it "returns deprecated for major version behind" do
      client_with_version = described_class.new(
        latest_widget_version: "1.0.0"
      )

      result = client_with_version.check_widget_version("0.2.0")

      expect(result.status).to eq(PocketPing::VersionStatus::DEPRECATED)
      expect(result.can_continue).to be true
    end

    it "returns unsupported for version below minimum" do
      client_with_version = described_class.new(
        min_widget_version: "0.3.0"
      )

      result = client_with_version.check_widget_version("0.2.0")

      expect(result.status).to eq(PocketPing::VersionStatus::UNSUPPORTED)
      expect(result.can_continue).to be false
    end

    it "returns OK when no version constraints" do
      result = client.check_widget_version("0.1.0")

      expect(result.status).to eq(PocketPing::VersionStatus::OK)
    end

    it "returns OK for nil version" do
      client_with_version = described_class.new(
        min_widget_version: "0.2.0"
      )

      result = client_with_version.check_widget_version(nil)

      expect(result.status).to eq(PocketPing::VersionStatus::OK)
      expect(result.can_continue).to be true
    end
  end
end

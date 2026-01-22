# frozen_string_literal: true

require "spec_helper"

RSpec.describe "PocketPing Models" do
  describe PocketPing::UserIdentity do
    it "requires id field" do
      identity = described_class.new(id: "user-123")
      expect(identity.id).to eq("user-123")
    end

    it "accepts optional email and name" do
      identity = described_class.new(
        id: "user-123",
        email: "user@example.com",
        name: "John Doe"
      )

      expect(identity.email).to eq("user@example.com")
      expect(identity.name).to eq("John Doe")
    end

    it "supports custom fields" do
      identity = described_class.new(
        id: "user-123",
        plan: "pro",
        company: "Acme Inc"
      )

      expect(identity[:plan]).to eq("pro")
      expect(identity[:company]).to eq("Acme Inc")
    end

    it "serializes to hash with custom fields" do
      identity = described_class.new(
        id: "user-123",
        email: "user@example.com",
        plan: "pro"
      )

      hash = identity.to_h
      expect(hash[:id]).to eq("user-123")
      expect(hash[:email]).to eq("user@example.com")
      expect(hash[:plan]).to eq("pro")
    end

    it "allows setting custom fields via bracket notation" do
      identity = described_class.new(id: "user-123")
      identity[:custom_field] = "value"

      expect(identity[:custom_field]).to eq("value")
    end
  end

  describe PocketPing::SessionMetadata do
    it "creates with all fields" do
      metadata = described_class.new(
        url: "https://example.com",
        referrer: "https://google.com",
        page_title: "Home",
        user_agent: "Mozilla/5.0",
        timezone: "America/New_York",
        language: "en-US",
        screen_resolution: "1920x1080",
        ip: "192.168.1.1",
        country: "US",
        city: "New York",
        device_type: "desktop",
        browser: "Chrome",
        os: "macOS"
      )

      expect(metadata.url).to eq("https://example.com")
      expect(metadata.page_title).to eq("Home")
      expect(metadata.device_type).to eq("desktop")
    end

    it "supports alias names for camelCase" do
      metadata = described_class.new(
        pageTitle: "My Page",
        userAgent: "Mozilla",
        deviceType: "mobile"
      )

      expect(metadata.page_title).to eq("My Page")
      expect(metadata.user_agent).to eq("Mozilla")
      expect(metadata.device_type).to eq("mobile")
    end

    it "serializes to hash with alias names" do
      metadata = described_class.new(
        page_title: "Test",
        device_type: "tablet"
      )

      hash = metadata.to_h
      expect(hash[:pageTitle]).to eq("Test")
      expect(hash[:deviceType]).to eq("tablet")
    end
  end

  describe PocketPing::Session do
    it "creates with required fields" do
      session = described_class.new(
        id: "sess-123",
        visitor_id: "visitor-456"
      )

      expect(session.id).to eq("sess-123")
      expect(session.visitor_id).to eq("visitor-456")
    end

    it "sets default timestamps" do
      session = described_class.new(id: "sess", visitor_id: "visitor")

      expect(session.created_at).to be_a(Time)
      expect(session.last_activity).to be_a(Time)
    end

    it "defaults operator_online and ai_active to false" do
      session = described_class.new(id: "sess", visitor_id: "visitor")

      expect(session.operator_online).to be false
      expect(session.ai_active).to be false
    end

    it "accepts metadata and identity" do
      metadata = PocketPing::SessionMetadata.new(url: "https://example.com")
      identity = PocketPing::UserIdentity.new(id: "user-123")

      session = described_class.new(
        id: "sess",
        visitor_id: "visitor",
        metadata: metadata,
        identity: identity
      )

      expect(session.metadata.url).to eq("https://example.com")
      expect(session.identity.id).to eq("user-123")
    end
  end

  describe PocketPing::Message do
    it "creates with required fields" do
      message = described_class.new(
        id: "msg-123",
        session_id: "sess-456",
        content: "Hello!",
        sender: PocketPing::Sender::VISITOR
      )

      expect(message.id).to eq("msg-123")
      expect(message.session_id).to eq("sess-456")
      expect(message.content).to eq("Hello!")
      expect(message.sender).to eq(PocketPing::Sender::VISITOR)
    end

    it "sets default timestamp" do
      message = described_class.new(
        id: "msg",
        session_id: "sess",
        content: "test",
        sender: "visitor"
      )

      expect(message.timestamp).to be_a(Time)
    end

    it "defaults status to sent" do
      message = described_class.new(
        id: "msg",
        session_id: "sess",
        content: "test",
        sender: "visitor"
      )

      expect(message.status).to eq(PocketPing::MessageStatus::SENT)
    end

    it "tracks read receipt fields" do
      now = Time.now.utc
      message = described_class.new(
        id: "msg",
        session_id: "sess",
        content: "test",
        sender: "visitor",
        status: PocketPing::MessageStatus::READ,
        delivered_at: now,
        read_at: now
      )

      expect(message.delivered_at).to eq(now)
      expect(message.read_at).to eq(now)
    end
  end

  describe PocketPing::CustomEvent do
    it "creates with name and data" do
      event = described_class.new(
        name: "clicked_pricing",
        data: { plan: "pro" }
      )

      expect(event.name).to eq("clicked_pricing")
      expect(event.data[:plan]).to eq("pro")
    end

    it "sets default timestamp" do
      event = described_class.new(name: "test")

      expect(event.timestamp).to be_a(Time)
    end

    it "includes session_id when set" do
      event = described_class.new(
        name: "test",
        session_id: "sess-123"
      )

      hash = event.to_h
      expect(hash[:sessionId]).to eq("sess-123")
    end
  end

  describe PocketPing::TrackedElement do
    it "creates with required fields" do
      element = described_class.new(
        selector: ".pricing-btn",
        name: "clicked_pricing"
      )

      expect(element.selector).to eq(".pricing-btn")
      expect(element.name).to eq("clicked_pricing")
    end

    it "defaults event to click" do
      element = described_class.new(selector: ".btn", name: "test")

      expect(element.event).to eq("click")
    end

    it "supports widget_message option" do
      element = described_class.new(
        selector: ".help-btn",
        name: "help_clicked",
        widget_message: "Need help?"
      )

      expect(element.widget_message).to eq("Need help?")
    end
  end

  describe PocketPing::SendMessageRequest do
    it "validates content is required" do
      request = described_class.new(
        session_id: "sess",
        content: "",
        sender: PocketPing::Sender::VISITOR
      )

      expect { request.validate! }.to raise_error(PocketPing::ValidationError, /content is required/)
    end

    it "validates content max length" do
      request = described_class.new(
        session_id: "sess",
        content: "x" * 4001,
        sender: PocketPing::Sender::VISITOR
      )

      expect { request.validate! }.to raise_error(PocketPing::ValidationError, /exceeds maximum length/)
    end

    it "validates sender is valid" do
      request = described_class.new(
        session_id: "sess",
        content: "test",
        sender: "invalid"
      )

      expect { request.validate! }.to raise_error(PocketPing::ValidationError, /invalid sender/)
    end

    it "passes validation for valid request" do
      request = described_class.new(
        session_id: "sess",
        content: "Hello!",
        sender: PocketPing::Sender::VISITOR
      )

      expect(request.validate!).to be true
    end
  end

  describe PocketPing::IdentifyRequest do
    it "validates identity is required" do
      request = described_class.new(
        session_id: "sess",
        identity: nil
      )

      expect { request.validate! }.to raise_error(PocketPing::ValidationError, /identity is required/)
    end

    it "validates identity.id is required" do
      request = described_class.new(
        session_id: "sess",
        identity: PocketPing::UserIdentity.new(id: "")
      )

      expect { request.validate! }.to raise_error(PocketPing::ValidationError, /identity.id is required/)
    end
  end

  describe PocketPing::VersionCheckResult do
    it "creates with all fields" do
      result = described_class.new(
        status: PocketPing::VersionStatus::OUTDATED,
        message: "Please upgrade",
        min_version: "0.2.0",
        latest_version: "0.3.0",
        can_continue: true
      )

      expect(result.status).to eq(PocketPing::VersionStatus::OUTDATED)
      expect(result.message).to eq("Please upgrade")
      expect(result.can_continue).to be true
    end

    it "defaults can_continue to true" do
      result = described_class.new(status: PocketPing::VersionStatus::OK)

      expect(result.can_continue).to be true
    end
  end

  describe "Sender constants" do
    it "defines all sender types" do
      expect(PocketPing::Sender::VISITOR).to eq("visitor")
      expect(PocketPing::Sender::OPERATOR).to eq("operator")
      expect(PocketPing::Sender::AI).to eq("ai")
    end

    it "validates sender types" do
      expect(PocketPing::Sender.valid?("visitor")).to be true
      expect(PocketPing::Sender.valid?("invalid")).to be false
    end
  end

  describe "MessageStatus constants" do
    it "defines all status types" do
      expect(PocketPing::MessageStatus::SENDING).to eq("sending")
      expect(PocketPing::MessageStatus::SENT).to eq("sent")
      expect(PocketPing::MessageStatus::DELIVERED).to eq("delivered")
      expect(PocketPing::MessageStatus::READ).to eq("read")
    end

    it "validates status types" do
      expect(PocketPing::MessageStatus.valid?("read")).to be true
      expect(PocketPing::MessageStatus.valid?("unknown")).to be false
    end
  end

  describe "VersionStatus constants" do
    it "defines all version status types" do
      expect(PocketPing::VersionStatus::OK).to eq("ok")
      expect(PocketPing::VersionStatus::OUTDATED).to eq("outdated")
      expect(PocketPing::VersionStatus::DEPRECATED).to eq("deprecated")
      expect(PocketPing::VersionStatus::UNSUPPORTED).to eq("unsupported")
    end
  end
end

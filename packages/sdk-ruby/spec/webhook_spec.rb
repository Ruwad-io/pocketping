# frozen_string_literal: true

require "spec_helper"
require "json"

RSpec.describe "Webhook forwarding" do
  let(:webhook_url) { "https://example.com/webhook" }
  let(:session) { create_sample_session(id: "session-1", visitor_id: "visitor-1") }

  before do
    WebMock.reset!
  end

  it "posts custom events to webhook with signature" do
    client = PocketPing::Client.new(
      webhook_url: webhook_url,
      webhook_secret: "test-secret"
    )
    client.storage.create_session(session)

    stub = stub_request(:post, webhook_url).to_return(status: 200, body: "{}")
    allow(Thread).to receive(:new).and_yield.and_return(instance_double(Thread, join: true))

    event = PocketPing::CustomEvent.new(
      name: "test_event",
      data: { "foo" => "bar" },
      timestamp: Time.now.utc
    )

    client.handle_custom_event(session.id, event)

    expect(stub).to have_been_requested
    req = WebMock::RequestRegistry.instance.requested_signatures.hash.keys.last
    body = WebMock::RequestRegistry.instance.requested_signatures.hash.keys.last.body
    payload = JSON.parse(body)
    signature = req.headers["X-Pocketping-Signature"] || req.headers["X-PocketPing-Signature"]
    expected = "sha256=" + OpenSSL::HMAC.hexdigest("SHA256", "test-secret", body)

    expect(payload["event"]["name"]).to eq("test_event")
    expect(payload["session"]["id"]).to eq("session-1")
    expect(signature).to eq(expected)
  end

  it "forwards identity updates to webhook" do
    client = PocketPing::Client.new(webhook_url: webhook_url)
    session.identity = PocketPing::UserIdentity.new(id: "user-1", email: "test@example.com")
    client.storage.create_session(session)

    stub = stub_request(:post, webhook_url).to_return(status: 200, body: "{}")
    allow(Thread).to receive(:new).and_yield.and_return(instance_double(Thread, join: true))

    request = PocketPing::IdentifyRequest.new(
      session_id: session.id,
      identity: session.identity
    )

    client.handle_identify(request)

    expect(stub).to have_been_requested
    req = WebMock::RequestRegistry.instance.requested_signatures.hash.keys.last
    body = WebMock::RequestRegistry.instance.requested_signatures.hash.keys.last.body
    payload = JSON.parse(body)

    expect(payload["event"]["name"]).to eq("identify")
    expect(payload["event"]["sessionId"]).to eq("session-1")
    expect(payload["session"]["identity"]["id"]).to eq("user-1")
  end
end

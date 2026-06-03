# frozen_string_literal: true

require "spec_helper"

# A bridge that records the one-line notifications it receives (CSAT/disconnect).
class NotifyBridge < PocketPing::Bridge::Base
  attr_reader :disconnect_calls

  def initialize
    super
    @disconnect_calls = []
  end

  def name
    "telegram"
  end

  def on_visitor_message(_message, _session)
    nil
  end

  def notify_disconnect(session, message)
    @disconnect_calls << { session: session, message: message }
  end
end

RSpec.describe "CSAT (SDK)" do
  let(:bridge) { NotifyBridge.new }
  let(:client) { PocketPing::Client.new(bridges: [bridge]) }

  def new_session(pp = client)
    pp.handle_connect(PocketPing::ConnectRequest.new(visitor_id: "v1")).session_id
  end

  # Spin briefly waiting for a background webhook thread to record its request.
  def wait_until
    20.times do
      break if yield

      sleep 0.02
    end
  end

  # Stub the given URL and record the captured request body + signature header.
  def capture_webhook(url, into:)
    stub_request(:post, url).to_return do |req|
      into[:body] = req.body
      into[:signature] = req.headers["X-Pocketping-Signature"]
      { status: 200, body: "" }
    end
  end

  it "request_csat sets pending and broadcasts csat_request" do
    session_id = new_session
    ws = MockWebSocket.new
    client.register_websocket(session_id, ws)

    client.request_csat(session_id)

    session = client.get_session(session_id)
    expect(session.csat_pending).to be true
    expect(session.csat_requested_at).to be_a(Time)

    event = JSON.parse(ws.messages.last)
    expect(event["type"]).to eq("csat_request")
    expect(event["data"]["requestedAt"]).to be_a(String)
  end

  it "handle_csat stores the score, clears pending, notifies bridge, runs on_csat" do
    received = []
    pp = PocketPing::Client.new(
      bridges: [bridge],
      on_csat: ->(session, rating) { received << [session, rating] }
    )
    session_id = new_session(pp)
    pp.request_csat(session_id)

    res = pp.handle_csat(
      PocketPing::CsatRequest.new(session_id: session_id, score: 5, comment: "  great  ")
    )
    expect(res).to have_attributes(ok: true, already_rated: nil)

    session = pp.get_session(session_id)
    expect(session).to have_attributes(
      csat_score: 5,
      csat_comment: "great",
      csat_pending: false,
      csat_responded_at: be_a(Time)
    )

    expect(bridge.disconnect_calls.last[:message]).to eq('⭐ 😍 5/5 — "great"')
    expect(received.last[1]).to eq({ score: 5, comment: "great" })
  end

  it "omits the comment from the bridge caption when blank" do
    session_id = new_session
    client.handle_csat(
      PocketPing::CsatRequest.new(session_id: session_id, score: 3, comment: "   ")
    )

    session = client.get_session(session_id)
    expect(session.csat_comment).to be_nil
    expect(bridge.disconnect_calls.last[:message]).to eq("⭐ 😐 3/5")
  end

  it "rejects an out-of-range score" do
    session_id = new_session
    expect do
      client.handle_csat(PocketPing::CsatRequest.new(session_id: session_id, score: 0))
    end.to raise_error(PocketPing::ValidationError, /1-5/)
    expect do
      client.handle_csat(PocketPing::CsatRequest.new(session_id: session_id, score: 6))
    end.to raise_error(PocketPing::ValidationError, /1-5/)
  end

  it "rejects a non-integer score" do
    session_id = new_session
    expect do
      client.handle_csat(PocketPing::CsatRequest.new(session_id: session_id, score: 3.5))
    end.to raise_error(PocketPing::ValidationError, /1-5/)
  end

  it "is idempotent once rated" do
    session_id = new_session
    client.handle_csat(PocketPing::CsatRequest.new(session_id: session_id, score: 4))

    second = client.handle_csat(PocketPing::CsatRequest.new(session_id: session_id, score: 1))
    expect(second.ok).to be true
    expect(second.already_rated).to be true

    session = client.get_session(session_id)
    expect(session.csat_score).to eq(4) # unchanged
  end

  it "raises when the session does not exist" do
    expect do
      client.handle_csat(PocketPing::CsatRequest.new(session_id: "nope", score: 3))
    end.to raise_error(PocketPing::SessionNotFoundError, "Session not found")
    expect do
      client.request_csat("nope")
    end.to raise_error(PocketPing::SessionNotFoundError, "Session not found")
  end

  it "fires the csat_submitted webhook signed with HMAC" do
    captured = {}
    capture_webhook("https://hooks.example.com/csat", into: captured)

    pp = PocketPing::Client.new(
      webhook_url: "https://hooks.example.com/csat",
      webhook_secret: "topsecret"
    )
    session_id = new_session(pp)
    pp.handle_csat(PocketPing::CsatRequest.new(session_id: session_id, score: 5, comment: "nice"))

    wait_until { captured[:body] }
    expect(captured[:body]).not_to be_nil

    payload = JSON.parse(captured[:body])
    expect(payload).to include("type" => "csat_submitted")
    expect(payload["data"]).to include(
      "sessionId" => session_id, "score" => 5, "comment" => "nice",
      "respondedAt" => be_a(String)
    )

    digest = OpenSSL::HMAC.hexdigest("SHA256", "topsecret", captured[:body])
    expect(captured[:signature]).to eq("sha256=#{digest}")
  end
end

# A minimal storage adapter that implements the required methods but leaves
# list_sessions as the base (which raises NotImplementedError).
class NoListStorage < PocketPing::Storage::Base
  def create_session(_session); end

  def get_session(_session_id)
    nil
  end

  def update_session(_session); end

  def delete_session(_session_id); end

  def save_message(_message); end

  def get_messages(_session_id, **_opts)
    []
  end

  def get_message(_message_id)
    nil
  end
end

RSpec.describe "get_stats (SDK)" do
  it "computes conversations, response rate and CSAT over storage" do
    pp = PocketPing::Client.new
    a = pp.handle_connect(PocketPing::ConnectRequest.new(visitor_id: "va"))
    b = pp.handle_connect(PocketPing::ConnectRequest.new(visitor_id: "vb"))

    # Session A: visitor msg + operator reply + 5-star rating
    pp.handle_message(
      PocketPing::SendMessageRequest.new(session_id: a.session_id, content: "hi", sender: "visitor")
    )
    pp.send_operator_message(a.session_id, "hello!")
    pp.handle_csat(PocketPing::CsatRequest.new(session_id: a.session_id, score: 5))

    # Session B: visitor msg only (unanswered)
    pp.handle_message(
      PocketPing::SendMessageRequest.new(session_id: b.session_id, content: "anyone?", sender: "visitor")
    )

    stats = pp.get_stats
    expect(stats.conversations).to eq(2)
    expect(stats.response_rate).to eq(0.5)
    expect(stats.unanswered_now).to eq(1)
    expect(stats.csat).to eq({ percent: 1.0, average: 5.0, responses: 1 })
    expect(stats.conversations_sparkline.length).to eq(7)
  end

  it "raises a helpful error when storage cannot list sessions" do
    # A storage adapter that doesn't override list_sessions (base raises).
    pp = PocketPing::Client.new(storage: NoListStorage.new)
    expect { pp.get_stats }.to raise_error(PocketPing::Error, /list_sessions/)
  end
end

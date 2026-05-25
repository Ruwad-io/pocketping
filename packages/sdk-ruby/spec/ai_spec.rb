# frozen_string_literal: true

require "spec_helper"

# A tiny in-test AI provider used for wiring tests. It records the arguments it
# was called with and returns a canned reply (or raises, for error tests).
class FakeAIProvider
  attr_reader :calls

  def initialize(reply: "AI says hi", raise_error: false)
    @reply = reply
    @raise_error = raise_error
    @calls = []
  end

  def name
    "fake"
  end

  def generate_response(messages, system_prompt = nil)
    @calls << { messages: messages, system_prompt: system_prompt }
    raise "boom" if @raise_error

    @reply
  end

  def available?
    true
  end
end

RSpec.describe "PocketPing AI providers" do
  describe PocketPing::AI::OpenAIProvider do
    let(:provider) { described_class.new(api_key: "sk-test", base_url: "https://api.openai.com/v1") }

    it "builds the correct request and parses choices[0].message.content" do
      stub = stub_request(:post, "https://api.openai.com/v1/chat/completions")
             .with(
               headers: {
                 "Content-Type" => "application/json",
                 "Authorization" => "Bearer sk-test"
               }
             )
             .to_return(
               status: 200,
               body: { choices: [{ message: { content: "Hello from OpenAI" } }] }.to_json,
               headers: { "Content-Type" => "application/json" }
             )

      messages = [
        create_sample_message(session_id: "s1", sender: PocketPing::Sender::VISITOR, content: "hi"),
        create_sample_message(session_id: "s1", sender: PocketPing::Sender::AI, content: "earlier reply")
      ]

      reply = provider.generate_response(messages, "Be nice")

      expect(reply).to eq("Hello from OpenAI")
      expect(provider.name).to eq("openai")
      expect(stub).to have_been_requested
      expect(WebMock).to(have_requested(:post, "https://api.openai.com/v1/chat/completions").with do |req|
        body = JSON.parse(req.body)
        expect(body["model"]).to eq("gpt-4o-mini")
        expect(body["max_tokens"]).to eq(1000)
        expect(body["temperature"]).to eq(0.7)
        expect(body["messages"][0]).to eq("role" => "system", "content" => "Be nice")
        expect(body["messages"][1]).to eq("role" => "user", "content" => "hi")
        expect(body["messages"][2]).to eq("role" => "assistant", "content" => "earlier reply")
        true
      end)
    end

    it "returns empty string when content is missing" do
      stub_request(:post, "https://api.openai.com/v1/chat/completions")
        .to_return(status: 200, body: { choices: [{}] }.to_json)

      expect(provider.generate_response([])).to eq("")
    end

    it "reports availability via GET /models" do
      stub_request(:get, "https://api.openai.com/v1/models")
        .with(headers: { "Authorization" => "Bearer sk-test" })
        .to_return(status: 200, body: "{}")

      expect(provider.available?).to be true
    end

    it "reports unavailable when /models fails" do
      stub_request(:get, "https://api.openai.com/v1/models").to_return(status: 401, body: "{}")

      expect(provider.available?).to be false
    end
  end

  describe PocketPing::AI::AnthropicProvider do
    let(:provider) { described_class.new(api_key: "key-123") }

    it "builds the correct request with x-api-key + system field and parses content[0].text" do
      stub_request(:post, "https://api.anthropic.com/v1/messages")
        .with(
          headers: {
            "Content-Type" => "application/json",
            "x-api-key" => "key-123",
            "anthropic-version" => "2023-06-01"
          }
        )
        .to_return(
          status: 200,
          body: { content: [{ text: "Hello from Claude" }] }.to_json,
          headers: { "Content-Type" => "application/json" }
        )

      messages = [
        create_sample_message(session_id: "s1", sender: PocketPing::Sender::VISITOR, content: "hi"),
        create_sample_message(session_id: "s1", sender: PocketPing::Sender::AI, content: "prior")
      ]

      reply = provider.generate_response(messages, "Custom system")

      expect(reply).to eq("Hello from Claude")
      expect(provider.name).to eq("anthropic")
      expect(WebMock).to(have_requested(:post, "https://api.anthropic.com/v1/messages").with do |req|
        body = JSON.parse(req.body)
        expect(body["model"]).to eq("claude-sonnet-4-20250514")
        expect(body["max_tokens"]).to eq(1000)
        expect(body["system"]).to eq("Custom system")
        expect(body["messages"]).to eq(
          [
            { "role" => "user", "content" => "hi" },
            { "role" => "assistant", "content" => "prior" }
          ]
        )
        true
      end)
    end

    it "defaults the system prompt when none is given" do
      stub_request(:post, "https://api.anthropic.com/v1/messages")
        .to_return(status: 200, body: { content: [{ text: "ok" }] }.to_json)

      provider.generate_response([create_sample_message(session_id: "s1", content: "hey")])

      expect(WebMock).to(have_requested(:post, "https://api.anthropic.com/v1/messages").with do |req|
        JSON.parse(req.body)["system"] == "You are a helpful customer support assistant."
      end)
    end

    it "honors a base URL override" do
      custom = described_class.new(api_key: "key-123", base_url: "http://localhost:9999/v1")
      stub_request(:post, "http://localhost:9999/v1/messages")
        .to_return(status: 200, body: { content: [{ text: "local" }] }.to_json)

      expect(custom.generate_response([create_sample_message(session_id: "s1", content: "x")])).to eq("local")
    end

    it "is available when an api key is set" do
      expect(provider.available?).to be true
    end
  end

  describe PocketPing::AI::GeminiProvider do
    let(:provider) { described_class.new(api_key: "g-key") }
    let(:url) do
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=g-key"
    end

    it "builds the correct request with model in URL, user/model roles, and parses the text" do
      stub_request(:post, url)
        .with(headers: { "Content-Type" => "application/json" })
        .to_return(
          status: 200,
          body: { candidates: [{ content: { parts: [{ text: "Hello from Gemini" }] } }] }.to_json,
          headers: { "Content-Type" => "application/json" }
        )

      messages = [
        create_sample_message(session_id: "s1", sender: PocketPing::Sender::VISITOR, content: "hi"),
        create_sample_message(session_id: "s1", sender: PocketPing::Sender::AI, content: "prior")
      ]

      reply = provider.generate_response(messages, "Sys prompt")

      expect(reply).to eq("Hello from Gemini")
      expect(provider.name).to eq("gemini")
      expect(WebMock).to(have_requested(:post, url).with do |req|
        body = JSON.parse(req.body)
        expect(body["contents"][0]["role"]).to eq("user")
        expect(body["contents"][0]["parts"][0]["text"]).to eq("Sys prompt\n\nUser: hi")
        expect(body["contents"][1]["role"]).to eq("model")
        expect(body["contents"][1]["parts"][0]["text"]).to eq("prior")
        expect(body["generationConfig"]).to eq("maxOutputTokens" => 1000, "temperature" => 0.7)
        true
      end)
    end

    it "returns empty string when no candidate text is present" do
      stub_request(:post, url).to_return(status: 200, body: { candidates: [] }.to_json)

      expect(provider.generate_response([create_sample_message(session_id: "s1", content: "x")])).to eq("")
    end
  end
end

RSpec.describe "PocketPing AI fallback wiring" do
  let(:provider) { FakeAIProvider.new }

  def build_client(**opts)
    PocketPing::Client.new(ai_provider: provider, ai_takeover_delay: 0, **opts)
  end

  def visitor_message(session_id, content = "Hello?")
    PocketPing::SendMessageRequest.new(
      session_id: session_id,
      content: content,
      sender: PocketPing::Sender::VISITOR
    )
  end

  it "triggers an AI reply when operator offline and takeover due" do
    client = build_client
    session = create_sample_session
    client.storage.create_session(session)
    client.set_operator_online(false)

    client.handle_message(visitor_message(session.id))

    messages = client.storage.get_messages(session.id)
    ai_messages = messages.select { |m| m.sender == PocketPing::Sender::AI }
    expect(ai_messages.size).to eq(1)
    expect(ai_messages.first.content).to eq("AI says hi")
    expect(provider.calls.size).to eq(1)
    expect(client.storage.get_session(session.id).ai_active).to be true
  end

  it "passes the configured system prompt to the provider" do
    client = build_client(ai_system_prompt: "Custom support prompt")
    session = create_sample_session
    client.storage.create_session(session)

    client.handle_message(visitor_message(session.id))

    expect(provider.calls.first[:system_prompt]).to eq("Custom support prompt")
  end

  it "does NOT trigger when the operator is online" do
    client = build_client
    session = create_sample_session
    client.storage.create_session(session)
    client.set_operator_online(true)

    client.handle_message(visitor_message(session.id))

    ai_messages = client.storage.get_messages(session.id).select { |m| m.sender == PocketPing::Sender::AI }
    expect(ai_messages).to be_empty
    expect(provider.calls).to be_empty
  end

  it "does NOT trigger before takeover delay when operator recently active" do
    client = PocketPing::Client.new(ai_provider: provider, ai_takeover_delay: 300)
    session = create_sample_session
    client.storage.create_session(session)

    # Record recent operator activity for this session.
    client.handle_message(
      PocketPing::SendMessageRequest.new(
        session_id: session.id, content: "operator here", sender: PocketPing::Sender::OPERATOR
      )
    )

    client.handle_message(visitor_message(session.id))

    ai_messages = client.storage.get_messages(session.id).select { |m| m.sender == PocketPing::Sender::AI }
    expect(ai_messages).to be_empty
  end

  it "does NOT trigger when no AI provider is configured" do
    client = PocketPing::Client.new(ai_takeover_delay: 0)
    session = create_sample_session
    client.storage.create_session(session)

    client.handle_message(visitor_message(session.id))

    ai_messages = client.storage.get_messages(session.id).select { |m| m.sender == PocketPing::Sender::AI }
    expect(ai_messages).to be_empty
  end

  it "operator message disables AI after it was active" do
    client = build_client
    session = create_sample_session
    client.storage.create_session(session)

    client.handle_message(visitor_message(session.id))
    expect(client.storage.get_session(session.id).ai_active).to be true

    client.handle_message(
      PocketPing::SendMessageRequest.new(
        session_id: session.id, content: "I'm here now", sender: PocketPing::Sender::OPERATOR
      )
    )

    expect(client.storage.get_session(session.id).ai_active).to be false
  end

  it "handles provider errors gracefully without crashing or storing an AI message" do
    erroring = FakeAIProvider.new(raise_error: true)
    client = PocketPing::Client.new(ai_provider: erroring, ai_takeover_delay: 0)
    session = create_sample_session
    client.storage.create_session(session)

    expect { client.handle_message(visitor_message(session.id)) }.not_to raise_error

    ai_messages = client.storage.get_messages(session.id).select { |m| m.sender == PocketPing::Sender::AI }
    expect(ai_messages).to be_empty
  end

  it "does not store an AI message when the provider returns an empty reply" do
    empty = FakeAIProvider.new(reply: "")
    client = PocketPing::Client.new(ai_provider: empty, ai_takeover_delay: 0)
    session = create_sample_session
    client.storage.create_session(session)

    client.handle_message(visitor_message(session.id))

    ai_messages = client.storage.get_messages(session.id).select { |m| m.sender == PocketPing::Sender::AI }
    expect(ai_messages).to be_empty
  end

  it "notifies bridges of the AI reply via the operator path" do
    bridge = MockBridge.new
    client = PocketPing::Client.new(ai_provider: provider, ai_takeover_delay: 0, bridges: [bridge])
    session = create_sample_session
    client.storage.create_session(session)

    client.handle_message(visitor_message(session.id))

    ai_op = bridge.operator_messages.find { |(msg, _, src, name)| src == "ai" && name == "AI" && msg.sender == PocketPing::Sender::AI }
    expect(ai_op).not_to be_nil
    expect(ai_op[0].content).to eq("AI says hi")
  end

  it "reports aiEnabled and aiActiveAfter from presence" do
    client = PocketPing::Client.new(ai_provider: provider, ai_takeover_delay: 120)
    presence = client.handle_presence
    expect(presence.ai_enabled).to be true
    expect(presence.ai_active_after).to eq(120)
  end
end

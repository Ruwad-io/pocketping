# frozen_string_literal: true

require "bundler/setup"
require "pocketping"
require "webmock/rspec"

RSpec.configure do |config|
  config.expect_with :rspec do |expectations|
    expectations.include_chain_clauses_in_custom_matcher_descriptions = true
  end

  config.mock_with :rspec do |mocks|
    mocks.verify_partial_doubles = true
  end

  config.shared_context_metadata_behavior = :apply_to_host_groups
  config.filter_run_when_matching :focus
  config.example_status_persistence_file_path = "spec/examples.txt"
  config.disable_monkey_patching!
  config.warnings = true

  config.default_formatter = "doc" if config.files_to_run.one?

  config.order = :random
  Kernel.srand config.seed
end

WebMock.disable_net_connect!(allow_localhost: true)

# Helper to create a sample session
def create_sample_session(id: nil, visitor_id: nil)
  PocketPing::Session.new(
    id: id || "session-#{SecureRandom.hex(4)}",
    visitor_id: visitor_id || "visitor-#{SecureRandom.hex(4)}",
    created_at: Time.now.utc,
    last_activity: Time.now.utc,
    operator_online: false,
    ai_active: false,
    metadata: PocketPing::SessionMetadata.new(url: "https://example.com")
  )
end

# Helper to create a sample message
def create_sample_message(session_id:, sender: PocketPing::Sender::VISITOR, content: "Hello!")
  PocketPing::Message.new(
    id: "msg-#{SecureRandom.hex(4)}",
    session_id: session_id,
    content: content,
    sender: sender,
    timestamp: Time.now.utc
  )
end

# Mock WebSocket class for testing
class MockWebSocket
  attr_reader :messages

  def initialize
    @messages = []
    @open = true
  end

  def send_text(message)
    raise "WebSocket closed" unless @open

    @messages << message
  end

  def close
    @open = false
  end

  def open?
    @open
  end
end

# Mock Bridge class for testing
class MockBridge < PocketPing::Bridge::Base
  attr_reader :new_sessions, :messages, :operator_messages, :events, :identities

  def initialize
    super
    @new_sessions = []
    @messages = []
    @operator_messages = []
    @events = []
    @identities = []
  end

  def name
    "mock"
  end

  def on_new_session(session)
    @new_sessions << session
  end

  def on_message(message, session)
    @messages << [message, session]
  end

  def on_visitor_message(message, session)
    on_message(message, session)
  end

  def on_operator_message(message, session, source_bridge, operator_name = nil)
    @operator_messages << [message, session, source_bridge, operator_name]
  end

  def on_custom_event(event, session)
    @events << [event, session]
  end

  def on_identity_update(session)
    @identities << session
  end
end

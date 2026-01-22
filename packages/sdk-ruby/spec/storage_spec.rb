# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::Storage::MemoryStorage do
  let(:storage) { described_class.new }
  let(:session) { create_sample_session }
  let(:message) { create_sample_message(session_id: session.id) }

  describe "#create_session" do
    it "creates a new session" do
      storage.create_session(session)

      retrieved = storage.get_session(session.id)
      expect(retrieved).not_to be_nil
      expect(retrieved.id).to eq(session.id)
    end

    it "initializes message list for session" do
      storage.create_session(session)

      messages = storage.get_messages(session.id)
      expect(messages).to eq([])
    end
  end

  describe "#get_session" do
    it "returns nil for non-existent session" do
      result = storage.get_session("non-existent")
      expect(result).to be_nil
    end

    it "returns the session when it exists" do
      storage.create_session(session)

      result = storage.get_session(session.id)
      expect(result).to eq(session)
    end
  end

  describe "#update_session" do
    it "updates an existing session" do
      storage.create_session(session)

      session.operator_online = true
      storage.update_session(session)

      retrieved = storage.get_session(session.id)
      expect(retrieved.operator_online).to be true
    end
  end

  describe "#delete_session" do
    it "deletes a session" do
      storage.create_session(session)
      storage.delete_session(session.id)

      result = storage.get_session(session.id)
      expect(result).to be_nil
    end

    it "deletes associated messages" do
      storage.create_session(session)
      storage.save_message(message)
      storage.delete_session(session.id)

      messages = storage.get_messages(session.id)
      expect(messages).to eq([])
    end

    it "handles deleting non-existent session gracefully" do
      expect { storage.delete_session("non-existent") }.not_to raise_error
    end
  end

  describe "#save_message" do
    before { storage.create_session(session) }

    it "saves a message" do
      storage.save_message(message)

      messages = storage.get_messages(session.id)
      expect(messages.length).to eq(1)
      expect(messages.first.id).to eq(message.id)
    end

    it "updates existing message" do
      storage.save_message(message)

      message.status = PocketPing::MessageStatus::READ
      storage.save_message(message)

      messages = storage.get_messages(session.id)
      expect(messages.length).to eq(1)
      expect(messages.first.status).to eq(PocketPing::MessageStatus::READ)
    end

    it "saves message to lookup index" do
      storage.save_message(message)

      retrieved = storage.get_message(message.id)
      expect(retrieved).not_to be_nil
      expect(retrieved.id).to eq(message.id)
    end
  end

  describe "#get_messages" do
    before { storage.create_session(session) }

    it "returns empty array for no messages" do
      messages = storage.get_messages(session.id)
      expect(messages).to eq([])
    end

    it "returns messages for session" do
      storage.save_message(message)
      message2 = create_sample_message(session_id: session.id, content: "Second")
      storage.save_message(message2)

      messages = storage.get_messages(session.id)
      expect(messages.length).to eq(2)
    end

    it "respects limit parameter" do
      5.times do |i|
        msg = create_sample_message(session_id: session.id, content: "Message #{i}")
        storage.save_message(msg)
      end

      messages = storage.get_messages(session.id, limit: 3)
      expect(messages.length).to eq(3)
    end

    it "supports pagination with after parameter" do
      msg1 = create_sample_message(session_id: session.id, content: "First")
      msg2 = create_sample_message(session_id: session.id, content: "Second")
      msg3 = create_sample_message(session_id: session.id, content: "Third")

      storage.save_message(msg1)
      storage.save_message(msg2)
      storage.save_message(msg3)

      messages = storage.get_messages(session.id, after: msg1.id)
      expect(messages.length).to eq(2)
      expect(messages.first.content).to eq("Second")
    end
  end

  describe "#get_message" do
    before { storage.create_session(session) }

    it "returns nil for non-existent message" do
      result = storage.get_message("non-existent")
      expect(result).to be_nil
    end

    it "returns the message when it exists" do
      storage.save_message(message)

      result = storage.get_message(message.id)
      expect(result).not_to be_nil
      expect(result.id).to eq(message.id)
    end
  end

  describe "#cleanup_old_sessions" do
    it "deletes sessions older than specified time" do
      old_session = create_sample_session
      old_session.last_activity = Time.now.utc - 3600 # 1 hour ago
      storage.create_session(old_session)

      new_session = create_sample_session
      storage.create_session(new_session)

      cutoff = Time.now.utc - 1800 # 30 minutes ago
      deleted = storage.cleanup_old_sessions(cutoff)

      expect(deleted).to eq(1)
      expect(storage.get_session(old_session.id)).to be_nil
      expect(storage.get_session(new_session.id)).not_to be_nil
    end

    it "returns count of deleted sessions" do
      3.times do
        s = create_sample_session
        s.last_activity = Time.now.utc - 3600
        storage.create_session(s)
      end

      cutoff = Time.now.utc - 1800
      deleted = storage.cleanup_old_sessions(cutoff)

      expect(deleted).to eq(3)
    end
  end

  describe "#get_session_by_visitor_id" do
    it "returns nil when no session exists for visitor" do
      result = storage.get_session_by_visitor_id("non-existent")
      expect(result).to be_nil
    end

    it "returns session for visitor" do
      storage.create_session(session)

      result = storage.get_session_by_visitor_id(session.visitor_id)
      expect(result).not_to be_nil
      expect(result.id).to eq(session.id)
    end

    it "returns most recent session when multiple exist" do
      old_session = create_sample_session(visitor_id: "visitor-123")
      old_session.last_activity = Time.now.utc - 3600
      storage.create_session(old_session)

      new_session = create_sample_session(visitor_id: "visitor-123")
      storage.create_session(new_session)

      result = storage.get_session_by_visitor_id("visitor-123")
      expect(result.id).to eq(new_session.id)
    end
  end

  describe "#get_all_sessions" do
    it "returns empty array when no sessions" do
      sessions = storage.get_all_sessions
      expect(sessions).to eq([])
    end

    it "returns all sessions" do
      storage.create_session(session)
      session2 = create_sample_session
      storage.create_session(session2)

      sessions = storage.get_all_sessions
      expect(sessions.length).to eq(2)
    end
  end

  describe "#get_session_count" do
    it "returns 0 when no sessions" do
      count = storage.get_session_count
      expect(count).to eq(0)
    end

    it "returns correct count" do
      storage.create_session(session)
      storage.create_session(create_sample_session)

      count = storage.get_session_count
      expect(count).to eq(2)
    end
  end

  describe "#clear!" do
    it "removes all data" do
      storage.create_session(session)
      storage.save_message(message)

      storage.clear!

      expect(storage.get_session_count).to eq(0)
      expect(storage.get_messages(session.id)).to eq([])
    end
  end

  describe "thread safety" do
    it "handles concurrent access" do
      threads = 10.times.map do |i|
        Thread.new do
          s = create_sample_session(id: "session-#{i}", visitor_id: "visitor-#{i}")
          storage.create_session(s)
          5.times do |j|
            msg = create_sample_message(session_id: s.id, content: "Message #{i}-#{j}")
            storage.save_message(msg)
          end
        end
      end

      threads.each(&:join)

      expect(storage.get_session_count).to eq(10)
    end
  end
end

RSpec.describe PocketPing::Storage::Base do
  describe "abstract interface" do
    let(:storage) { described_class.new }

    it "raises NotImplementedError for create_session" do
      expect { storage.create_session(nil) }.to raise_error(NotImplementedError)
    end

    it "raises NotImplementedError for get_session" do
      expect { storage.get_session("id") }.to raise_error(NotImplementedError)
    end

    it "raises NotImplementedError for update_session" do
      expect { storage.update_session(nil) }.to raise_error(NotImplementedError)
    end

    it "raises NotImplementedError for delete_session" do
      expect { storage.delete_session("id") }.to raise_error(NotImplementedError)
    end

    it "raises NotImplementedError for save_message" do
      expect { storage.save_message(nil) }.to raise_error(NotImplementedError)
    end

    it "raises NotImplementedError for get_messages" do
      expect { storage.get_messages("id") }.to raise_error(NotImplementedError)
    end

    it "raises NotImplementedError for get_message" do
      expect { storage.get_message("id") }.to raise_error(NotImplementedError)
    end

    it "provides default implementation for cleanup_old_sessions" do
      result = storage.cleanup_old_sessions(Time.now)
      expect(result).to eq(0)
    end

    it "provides default implementation for get_session_by_visitor_id" do
      result = storage.get_session_by_visitor_id("visitor")
      expect(result).to be_nil
    end
  end
end

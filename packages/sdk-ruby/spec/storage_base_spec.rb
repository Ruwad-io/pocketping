# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::Storage::Base do
  let(:base) { described_class.new }
  let(:session) { create_sample_session }
  let(:message) { create_sample_message(session_id: session.id) }

  describe "abstract methods" do
    it "raises NotImplementedError for required operations" do
      expect { base.create_session(session) }.to raise_error(NotImplementedError)
      expect { base.get_session("x") }.to raise_error(NotImplementedError)
      expect { base.update_session(session) }.to raise_error(NotImplementedError)
      expect { base.delete_session("x") }.to raise_error(NotImplementedError)
      expect { base.save_message(message) }.to raise_error(NotImplementedError)
      expect { base.get_messages("x") }.to raise_error(NotImplementedError)
      expect { base.get_message("x") }.to raise_error(NotImplementedError)
    end
  end

  describe "optional defaults" do
    it "cleanup_old_sessions returns 0" do
      expect(base.cleanup_old_sessions(Time.now)).to eq(0)
    end

    it "get_session_by_visitor_id returns nil" do
      expect(base.get_session_by_visitor_id("v")).to be_nil
    end

    it "update_message delegates to save_message" do
      expect(base).to receive(:save_message).with(message)
      base.update_message(message)
    end

    it "bridge message id operations are no-ops by default" do
      expect(base.save_bridge_message_ids("m", nil)).to be_nil
      expect(base.get_bridge_message_ids("m")).to be_nil
    end

    it "attachment operations have safe defaults" do
      expect(base.save_attachment(nil)).to be_nil
      expect(base.get_attachment("a")).to be_nil
      expect(base.get_message_attachments("m")).to eq([])
    end

    it "update_attachment delegates to save_attachment" do
      attachment = PocketPing::Attachment.new(id: "a1", filename: "f", mime_type: "image/png", size: 1, url: "u")
      expect(base).to receive(:save_attachment).with(attachment)
      base.update_attachment(attachment)
    end
  end
end

RSpec.describe PocketPing::Storage::MemoryStorage do
  let(:storage) { described_class.new }

  describe "attachment operations" do
    let(:attachment) do
      PocketPing::Attachment.new(
        id: "att-1", message_id: "msg-1", filename: "f.png",
        mime_type: "image/png", size: 10, url: "https://x/att-1"
      )
    end

    it "saves and retrieves an attachment" do
      storage.save_attachment(attachment)
      expect(storage.get_attachment("att-1")).to eq(attachment)
    end

    it "lists attachments linked to a message" do
      storage.save_attachment(attachment)
      expect(storage.get_message_attachments("msg-1")).to eq([attachment])
      expect(storage.get_message_attachments("other")).to eq([])
    end

    it "updates an attachment" do
      storage.save_attachment(attachment)
      attachment.status = PocketPing::AttachmentStatus::READY
      storage.update_attachment(attachment)
      expect(storage.get_attachment("att-1").status).to eq("ready")
    end

    it "hydrates message attachments on get_message" do
      session = create_sample_session(id: "s-att")
      storage.create_session(session)
      message = create_sample_message(session_id: "s-att")
      message.instance_variable_set(:@id, "msg-h")
      storage.save_message(message)
      linked = PocketPing::Attachment.new(id: "att-h", message_id: "msg-h", filename: "f", mime_type: "image/png", size: 1, url: "u")
      storage.save_attachment(linked)

      fetched = storage.get_message("msg-h")
      expect(fetched.attachments).to eq([linked])
    end
  end

  describe "update_message guard" do
    it "does nothing for an unknown message id" do
      ghost = create_sample_message(session_id: "nope")
      expect { storage.update_message(ghost) }.not_to raise_error
      expect(storage.get_message(ghost.id)).to be_nil
    end
  end

  describe "bridge message id merge" do
    it "merges partial bridge ids across calls" do
      storage.save_bridge_message_ids("m1", PocketPing::BridgeMessageIds.new(telegram_message_id: 5))
      storage.save_bridge_message_ids("m1", PocketPing::BridgeMessageIds.new(discord_message_id: "d9"))
      ids = storage.get_bridge_message_ids("m1")
      expect(ids.telegram_message_id).to eq(5)
      expect(ids.discord_message_id).to eq("d9")
    end
  end
end

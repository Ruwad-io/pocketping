# frozen_string_literal: true

require "spec_helper"

# A bridge that records the messages it receives so we can assert the message
# passed to on_visitor_message already has its attachments populated.
class RecordingAttachmentBridge < PocketPing::Bridge::Base
  attr_reader :visitor_messages

  def initialize
    super
    @visitor_messages = []
  end

  def name
    "telegram"
  end

  def on_visitor_message(message, session)
    @visitor_messages << [message, session]
    nil
  end
end

RSpec.describe "File Attachments" do
  let(:client) { PocketPing::Client.new }
  let(:session) { create_sample_session }

  before do
    client.storage.create_session(session)
  end

  # Helper: create a pending attachment via an upload request.
  def request_upload(filename: "photo.png", mime_type: "image/png", size: 1024)
    client.handle_upload_request(
      PocketPing::UploadRequest.new(
        session_id: session.id,
        filename: filename,
        mime_type: mime_type,
        size: size
      )
    )
  end

  describe "#handle_upload_request" do
    it "creates an upload request with a presigned URL" do
      response = request_upload

      expect(response).to be_a(PocketPing::UploadResponse)
      expect(response.attachment_id).not_to be_nil
      expect(response.upload_url).to include(response.attachment_id)
      expect(response.expires_at).to be > Time.now.utc

      stored = client.storage.get_attachment(response.attachment_id)
      expect(stored).not_to be_nil
      expect(stored.status).to eq(PocketPing::AttachmentStatus::PENDING)
      expect(stored.message_id).to be_nil
      expect(stored.url).to eq(response.upload_url)
    end

    it "raises when the session is not found" do
      expect do
        client.handle_upload_request(
          PocketPing::UploadRequest.new(
            session_id: "missing-session",
            filename: "photo.png",
            mime_type: "image/png",
            size: 1024
          )
        )
      end.to raise_error(PocketPing::SessionNotFoundError)
    end

    it "rejects invalid mime types" do
      expect do
        request_upload(mime_type: "application/x-msdownload")
      end.to raise_error(PocketPing::ValidationError)
    end

    it "rejects files over the size limit" do
      expect do
        request_upload(size: PocketPing::Client::MAX_ATTACHMENT_SIZE + 1)
      end.to raise_error(PocketPing::ValidationError)
    end

    it "rejects files with a non-positive size" do
      expect do
        request_upload(size: 0)
      end.to raise_error(PocketPing::ValidationError)
    end
  end

  describe "#handle_upload_complete" do
    it "marks the attachment as ready after upload" do
      response = request_upload

      attachment = client.handle_upload_complete(response.attachment_id)

      expect(attachment.status).to eq(PocketPing::AttachmentStatus::READY)
      expect(client.storage.get_attachment(response.attachment_id).status)
        .to eq(PocketPing::AttachmentStatus::READY)
    end
  end

  describe "#handle_upload_failed" do
    it "handles upload failure gracefully by marking the attachment failed" do
      response = request_upload

      attachment = client.handle_upload_failed(response.attachment_id)

      expect(attachment.status).to eq(PocketPing::AttachmentStatus::FAILED)
      expect(client.storage.get_attachment(response.attachment_id).status)
        .to eq(PocketPing::AttachmentStatus::FAILED)
    end

    it "returns nil from get_attachment for an unknown id without crashing" do
      expect(client.storage.get_attachment("does-not-exist")).to be_nil
    end
  end

  describe "linking attachments to a message" do
    it "links attachments to the message via attachment_ids" do
      upload = request_upload
      client.handle_upload_complete(upload.attachment_id)

      response = client.handle_message(
        PocketPing::SendMessageRequest.new(
          session_id: session.id,
          content: "Here is a file",
          sender: PocketPing::Sender::VISITOR,
          attachment_ids: [upload.attachment_id]
        )
      )

      stored = client.storage.get_attachment(upload.attachment_id)
      expect(stored.message_id).to eq(response.message_id)
    end

    it "returns attachments with the message from get_messages" do
      upload = request_upload
      client.handle_upload_complete(upload.attachment_id)

      response = client.handle_message(
        PocketPing::SendMessageRequest.new(
          session_id: session.id,
          content: "Here is a file",
          sender: PocketPing::Sender::VISITOR,
          attachment_ids: [upload.attachment_id]
        )
      )

      messages = client.storage.get_messages(session.id)
      message = messages.find { |m| m.id == response.message_id }

      expect(message.attachments).not_to be_nil
      expect(message.attachments.map(&:id)).to include(upload.attachment_id)
    end
  end

  describe "syncing attachments to bridges" do
    it "passes a message with populated attachments to on_visitor_message" do
      bridge = RecordingAttachmentBridge.new
      bridge_client = PocketPing::Client.new(bridges: [bridge])
      bridge_client.storage.create_session(session)

      upload = bridge_client.handle_upload_request(
        PocketPing::UploadRequest.new(
          session_id: session.id,
          filename: "report.pdf",
          mime_type: "application/pdf",
          size: 2048
        )
      )
      bridge_client.handle_upload_complete(upload.attachment_id)

      bridge_client.handle_message(
        PocketPing::SendMessageRequest.new(
          session_id: session.id,
          content: "See attached",
          sender: PocketPing::Sender::VISITOR,
          attachment_ids: [upload.attachment_id]
        )
      )

      expect(bridge.visitor_messages.size).to eq(1)
      message, = bridge.visitor_messages.first
      expect(message.attachments.map(&:id)).to include(upload.attachment_id)
    end
  end

  describe "configuration overrides" do
    it "honors a custom max_attachment_size and allowed_mime_types" do
      custom = PocketPing::Client.new(
        max_attachment_size: 100,
        allowed_mime_types: ["image/png"]
      )
      custom.storage.create_session(session)

      expect do
        custom.handle_upload_request(
          PocketPing::UploadRequest.new(
            session_id: session.id, filename: "a.png", mime_type: "image/png", size: 200
          )
        )
      end.to raise_error(PocketPing::ValidationError)

      expect do
        custom.handle_upload_request(
          PocketPing::UploadRequest.new(
            session_id: session.id, filename: "a.pdf", mime_type: "application/pdf", size: 50
          )
        )
      end.to raise_error(PocketPing::ValidationError)
    end
  end
end

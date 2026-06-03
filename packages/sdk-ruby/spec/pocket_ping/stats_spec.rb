# frozen_string_literal: true

require "spec_helper"

RSpec.describe PocketPing::Stats do
  let(:from) { Time.utc(2026, 1, 1) }
  let(:to) { Time.utc(2026, 1, 8) }

  def session(created_at: nil, csat_score: nil, csat_responded_at: nil)
    PocketPing::Session.new(
      id: "s-#{SecureRandom.hex(4)}",
      visitor_id: "v1",
      created_at: created_at || Time.utc(2026, 1, 2),
      csat_score: csat_score,
      csat_responded_at: csat_responded_at
    )
  end

  def message(session_id:, timestamp:, sender: PocketPing::Sender::VISITOR)
    PocketPing::Message.new(
      id: "m-#{SecureRandom.hex(4)}",
      session_id: session_id,
      content: "hi",
      sender: sender,
      timestamp: timestamp
    )
  end

  it "counts messages by their own timestamp, excluding ones outside the window" do
    sess = session(created_at: Time.utc(2026, 1, 2))
    messages = [
      message(session_id: sess.id, timestamp: Time.utc(2026, 1, 2)),  # in window
      message(session_id: sess.id, timestamp: Time.utc(2026, 1, 5)),  # in window
      message(session_id: sess.id, timestamp: Time.utc(2026, 1, 20)) # outside window
    ]

    stats = described_class.compute_stats(
      [{ session: sess, messages: messages }],
      from: from, to: to
    )

    expect(stats.messages).to eq(2)
  end

  it "includes messages exactly on the window boundaries" do
    sess = session(created_at: from)
    messages = [
      message(session_id: sess.id, timestamp: from),
      message(session_id: sess.id, timestamp: to)
    ]

    stats = described_class.compute_stats(
      [{ session: sess, messages: messages }],
      from: from, to: to
    )

    expect(stats.messages).to eq(2)
  end

  it "counts a CSAT rating submitted within the window" do
    sess = session(csat_score: 5, csat_responded_at: Time.utc(2026, 1, 3))

    stats = described_class.compute_stats(
      [{ session: sess, messages: [] }],
      from: from, to: to
    )

    expect(stats.csat[:responses]).to eq(1)
    expect(stats.csat[:average]).to eq(5.0)
  end

  it "excludes a CSAT rating submitted outside the window" do
    # Conversation created in-window, but the rating was submitted after `to`.
    sess = session(
      created_at: Time.utc(2026, 1, 2),
      csat_score: 5,
      csat_responded_at: Time.utc(2026, 1, 20)
    )

    stats = described_class.compute_stats(
      [{ session: sess, messages: [] }],
      from: from, to: to
    )

    expect(stats.csat[:responses]).to eq(0)
    expect(stats.csat[:percent]).to be_nil
    expect(stats.csat[:average]).to be_nil
  end

  it "excludes a CSAT score with no responded_at timestamp" do
    sess = session(csat_score: 4, csat_responded_at: nil)

    stats = described_class.compute_stats(
      [{ session: sess, messages: [] }],
      from: from, to: to
    )

    expect(stats.csat[:responses]).to eq(0)
  end
end

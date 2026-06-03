# frozen_string_literal: true

require "time"

module PocketPing
  # Mini support stats for self-hosted SDK deployments — the same shape the SaaS
  # `/api/v1/stats` returns (minus the per-project breakdown, since an SDK owns a
  # single deployment). Small, honest numbers, computed over the customer's store.
  #
  # @!attribute [r] from
  #   @return [String] Inclusive window start (ISO-8601)
  # @!attribute [r] to
  #   @return [String] Window end (ISO-8601)
  # @!attribute [r] conversations
  #   @return [Integer] Conversations started in the window
  # @!attribute [r] conversations_sparkline
  #   @return [Array<Integer>] Daily conversation counts (oldest -> newest)
  # @!attribute [r] messages
  #   @return [Integer] Messages (any sender) in the window
  # @!attribute [r] response_rate
  #   @return [Float] Share of windowed conversations with >=1 operator/AI reply (0..1)
  # @!attribute [r] median_first_response_seconds
  #   @return [Float, nil] Median visitor-first -> operator-first reply, in seconds
  # @!attribute [r] unanswered_now
  #   @return [Integer] Conversations whose latest message is still from the visitor
  # @!attribute [r] csat
  #   @return [Hash] { percent:, average:, responses: }
  class SdkStats < Model
    attribute :from, type: String
    attribute :to, type: String
    attribute :conversations, type: Integer, default: 0
    attribute :conversations_sparkline, type: Array, default: -> { [] }, alias_name: :conversationsSparkline
    attribute :messages, type: Integer, default: 0
    attribute :response_rate, type: Float, default: 0.0, alias_name: :responseRate
    attribute :median_first_response_seconds, type: Float, alias_name: :medianFirstResponseSeconds
    attribute :unanswered_now, type: Integer, default: 0, alias_name: :unansweredNow
    attribute :csat, type: Hash, default: -> { { percent: nil, average: nil, responses: 0 } }
  end

  # Pure computation of {SdkStats} from session + message pairs already loaded
  # from storage. No I/O, so it is trivially testable.
  module Stats
    DAY_SECONDS = 24 * 60 * 60

    # Mutable accumulator that folds per-conversation metrics as sessions are
    # visited. Kept tiny so {Stats.compute_stats} stays a flat, readable loop.
    class Accumulator
      attr_reader :buckets, :conversations, :messages, :unanswered_now, :frt_seconds, :csat_scores

      def initialize(days)
        @days = days
        @buckets = Array.new(days, 0)
        @conversations = 0
        @messages = 0
        @answered = 0
        @unanswered_now = 0
        @frt_seconds = []
        @csat_scores = []
      end

      # Fold one in-window conversation (already sorted by timestamp).
      def add(session, ordered, from)
        @conversations += 1
        @messages += ordered.length
        bump_bucket(session.created_at, from)
        record_response_time(ordered)
        @unanswered_now += 1 if ordered.last&.sender == Sender::VISITOR
        @csat_scores << session.csat_score unless session.csat_score.nil?
      end

      # Share of conversations with >=1 operator/AI reply (0..1).
      def response_rate
        @conversations.zero? ? 0.0 : @answered.to_f / @conversations
      end

      private

      def bump_bucket(created, from)
        idx = ((created - from) / DAY_SECONDS).floor
        @buckets[idx] += 1 if idx >= 0 && idx < @days
      end

      AGENT_SENDERS = [Sender::OPERATOR, Sender::AI].freeze
      private_constant :AGENT_SENDERS

      def record_response_time(ordered)
        first_visitor = first_timestamp(ordered) { |m| m.sender == Sender::VISITOR }
        first_operator = first_timestamp(ordered) { |m| AGENT_SENDERS.include?(m.sender) }

        @answered += 1 if first_operator
        return unless replied_after_visitor?(first_visitor, first_operator)

        @frt_seconds << (first_operator - first_visitor).to_f
      end

      def first_timestamp(ordered, &)
        ordered.find(&)&.timestamp
      end

      def replied_after_visitor?(first_visitor, first_operator)
        return false unless first_visitor && first_operator

        first_operator >= first_visitor
      end
    end

    module_function

    # Compute stats from session+message pairs.
    #
    # @param entries [Array<Hash>] Each entry: { session: Session, messages: Array<Message> }
    # @param from [Time] Window start (inclusive)
    # @param to [Time] Window end
    # @return [SdkStats]
    def compute_stats(entries, from:, to:)
      days = [1, ((to - from) / DAY_SECONDS).ceil].max
      acc = Accumulator.new(days)

      entries.each do |entry|
        session = entry[:session]
        next if session.created_at < from || session.created_at > to

        acc.add(session, (entry[:messages] || []).sort_by(&:timestamp), from)
      end

      SdkStats.new(
        from: from.utc.iso8601,
        to: to.utc.iso8601,
        conversations: acc.conversations,
        conversations_sparkline: acc.buckets,
        messages: acc.messages,
        response_rate: acc.response_rate,
        median_first_response_seconds: median(acc.frt_seconds),
        unanswered_now: acc.unanswered_now,
        csat: csat_summary(acc.csat_scores)
      )
    end

    # Median of a list of numbers, or nil when empty.
    #
    # @param values [Array<Numeric>]
    # @return [Float, nil]
    def median(values)
      return nil if values.empty?

      sorted = values.sort
      mid = sorted.length / 2
      if sorted.length.even?
        (sorted[mid - 1] + sorted[mid]) / 2.0
      else
        sorted[mid].to_f
      end
    end

    # Summarize CSAT scores into { percent, average, responses }.
    #
    # @param scores [Array<Integer>]
    # @return [Hash]
    def csat_summary(scores)
      if scores.empty?
        { percent: nil, average: nil, responses: 0 }
      else
        {
          percent: scores.count { |n| n >= 4 }.to_f / scores.length,
          average: scores.sum.to_f / scores.length,
          responses: scores.length
        }
      end
    end
  end
end

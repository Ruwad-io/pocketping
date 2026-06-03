package pocketping

import (
	"sort"
	"time"
)

// SdkStats is the mini support-stats shape returned by GetStats — the same shape
// the SaaS /api/v1/stats returns (minus the per-project breakdown, since an SDK
// owns a single deployment). Small, honest numbers, computed over the store.
type SdkStats struct {
	// From is the inclusive window start.
	From time.Time `json:"from"`
	// To is the window end.
	To time.Time `json:"to"`
	// Conversations is the number of conversations started in the window.
	Conversations int `json:"conversations"`
	// ConversationsSparkline holds daily conversation counts (oldest -> newest).
	ConversationsSparkline []int `json:"conversationsSparkline"`
	// Messages is the number of messages (any sender) in the window.
	Messages int `json:"messages"`
	// ResponseRate is the share of windowed conversations with >=1 operator/AI
	// reply (0..1).
	ResponseRate float64 `json:"responseRate"`
	// MedianFirstResponseSeconds is the median visitor-first -> operator-first
	// reply, in seconds (nil if none).
	MedianFirstResponseSeconds *float64 `json:"medianFirstResponseSeconds"`
	// UnansweredNow is the number of conversations whose latest message is still
	// from the visitor.
	UnansweredNow int `json:"unansweredNow"`
	// Csat holds the CSAT aggregates over the window.
	Csat SdkStatsCsat `json:"csat"`
}

// SdkStatsCsat holds CSAT aggregates for SdkStats.
type SdkStatsCsat struct {
	// Percent is CSAT% = ratings >=4 / responses (0..1), nil when no responses.
	Percent *float64 `json:"percent"`
	// Average is the mean score 1..5, nil when no responses.
	Average *float64 `json:"average"`
	// Responses is the number of ratings submitted in the window.
	Responses int `json:"responses"`
}

// StatsEntry is a session paired with its messages for stats computation.
type StatsEntry struct {
	Session  *Session
	Messages []Message
}

const statsDayMS = int64(24 * 60 * 60 * 1000)

// medianFloat returns the median of values, or nil when empty.
func medianFloat(values []float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	mid := len(sorted) / 2
	var m float64
	if len(sorted)%2 == 0 {
		m = (sorted[mid-1] + sorted[mid]) / 2
	} else {
		m = sorted[mid]
	}
	return &m
}

// ComputeStats computes stats from session+message pairs already loaded from
// storage. Pure function — no I/O — so it is trivially testable.
func ComputeStats(entries []StatsEntry, from, to time.Time) SdkStats {
	fromMS := from.UnixMilli()
	toMS := to.UnixMilli()

	days := int((toMS - fromMS + statsDayMS - 1) / statsDayMS)
	if days < 1 {
		days = 1
	}
	buckets := make([]int, days)

	conversations := 0
	messages := 0
	answered := 0
	unansweredNow := 0
	var frtSeconds []float64
	var csatScores []int

	for _, entry := range entries {
		session := entry.Session
		created := session.CreatedAt.UnixMilli()
		if created < fromMS || created > toMS {
			continue
		}
		conversations++

		idx := int((created - fromMS) / statsDayMS)
		if idx >= 0 && idx < days {
			buckets[idx]++
		}

		ordered := make([]Message, len(entry.Messages))
		copy(ordered, entry.Messages)
		sort.SliceStable(ordered, func(i, j int) bool {
			return ordered[i].Timestamp.Before(ordered[j].Timestamp)
		})
		// Count messages by their own timestamp, not the conversation's — a
		// long-lived session must not inflate the window with messages sent
		// outside it. Equal endpoints are included.
		for i := range ordered {
			ts := ordered[i].Timestamp
			if !ts.Before(from) && !ts.After(to) {
				messages++
			}
		}

		var firstVisitor, firstOperator *time.Time
		for i := range ordered {
			m := &ordered[i]
			if m.Sender == SenderVisitor && firstVisitor == nil {
				t := m.Timestamp
				firstVisitor = &t
			} else if (m.Sender == SenderOperator || m.Sender == SenderAI) && firstOperator == nil {
				t := m.Timestamp
				firstOperator = &t
			}
			if firstVisitor != nil && firstOperator != nil {
				break
			}
		}
		if firstOperator != nil {
			answered++
		}
		if firstVisitor != nil && firstOperator != nil && !firstOperator.Before(*firstVisitor) {
			frtSeconds = append(frtSeconds, firstOperator.Sub(*firstVisitor).Seconds())
		}

		if len(ordered) > 0 {
			last := ordered[len(ordered)-1]
			if last.Sender == SenderVisitor {
				unansweredNow++
			}
		}

		// Count a rating only when it was *submitted* within the window — a score
		// on an in-window conversation rated later (or before) shouldn't leak in.
		// Equal endpoints are included.
		if session.Csat != nil && session.Csat.Score != nil && session.Csat.RespondedAt != nil {
			respondedAt := *session.Csat.RespondedAt
			if !respondedAt.Before(from) && !respondedAt.After(to) {
				csatScores = append(csatScores, *session.Csat.Score)
			}
		}
	}

	responseRate := 0.0
	if conversations > 0 {
		responseRate = float64(answered) / float64(conversations)
	}

	var csatPercent, csatAverage *float64
	if len(csatScores) > 0 {
		good := 0
		sum := 0
		for _, s := range csatScores {
			if s >= 4 {
				good++
			}
			sum += s
		}
		p := float64(good) / float64(len(csatScores))
		a := float64(sum) / float64(len(csatScores))
		csatPercent = &p
		csatAverage = &a
	}

	return SdkStats{
		From:                       from,
		To:                         to,
		Conversations:              conversations,
		ConversationsSparkline:     buckets,
		Messages:                   messages,
		ResponseRate:               responseRate,
		MedianFirstResponseSeconds: medianFloat(frtSeconds),
		UnansweredNow:              unansweredNow,
		Csat: SdkStatsCsat{
			Percent:   csatPercent,
			Average:   csatAverage,
			Responses: len(csatScores),
		},
	}
}

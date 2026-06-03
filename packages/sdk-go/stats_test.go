package pocketping

import (
	"testing"
	"time"
)

func intPtr(v int) *int              { return &v }
func timePtr(t time.Time) *time.Time { return &t }

func TestComputeStats_MessagesCountedByOwnTimestamp(t *testing.T) {
	from := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 1, 20, 0, 0, 0, 0, time.UTC)

	// Session created inside the window, but one of its messages is timestamped
	// before the window — it must NOT be counted.
	session := &Session{
		ID:        "s1",
		CreatedAt: time.Date(2026, 1, 12, 0, 0, 0, 0, time.UTC),
	}
	entries := []StatsEntry{
		{
			Session: session,
			Messages: []Message{
				{ID: "m1", Sender: SenderVisitor, Timestamp: time.Date(2026, 1, 5, 0, 0, 0, 0, time.UTC)},   // before window — excluded
				{ID: "m2", Sender: SenderOperator, Timestamp: time.Date(2026, 1, 12, 0, 0, 0, 0, time.UTC)}, // in window
				{ID: "m3", Sender: SenderVisitor, Timestamp: time.Date(2026, 1, 25, 0, 0, 0, 0, time.UTC)},  // after window — excluded
			},
		},
	}

	stats := ComputeStats(entries, from, to)
	if stats.Messages != 1 {
		t.Fatalf("expected 1 in-window message, got %d", stats.Messages)
	}
}

func TestComputeStats_MessagesIncludeWindowEndpoints(t *testing.T) {
	from := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 1, 20, 0, 0, 0, 0, time.UTC)

	entries := []StatsEntry{
		{
			Session: &Session{ID: "s1", CreatedAt: from},
			Messages: []Message{
				{ID: "m1", Sender: SenderVisitor, Timestamp: from}, // equal to from — included
				{ID: "m2", Sender: SenderOperator, Timestamp: to},  // equal to to — included
			},
		},
	}

	stats := ComputeStats(entries, from, to)
	if stats.Messages != 2 {
		t.Fatalf("expected 2 in-window messages (endpoints inclusive), got %d", stats.Messages)
	}
}

func TestComputeStats_CsatCountedByRespondedAt(t *testing.T) {
	from := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 1, 20, 0, 0, 0, 0, time.UTC)

	entries := []StatsEntry{
		// Session created in window, rated in window — counted.
		{
			Session: &Session{
				ID:        "s1",
				CreatedAt: time.Date(2026, 1, 11, 0, 0, 0, 0, time.UTC),
				Csat: &SessionCsat{
					Score:       intPtr(5),
					RespondedAt: timePtr(time.Date(2026, 1, 12, 0, 0, 0, 0, time.UTC)),
				},
			},
		},
		// Session created in window, but rated AFTER the window — excluded.
		{
			Session: &Session{
				ID:        "s2",
				CreatedAt: time.Date(2026, 1, 12, 0, 0, 0, 0, time.UTC),
				Csat: &SessionCsat{
					Score:       intPtr(1),
					RespondedAt: timePtr(time.Date(2026, 1, 25, 0, 0, 0, 0, time.UTC)),
				},
			},
		},
		// Session created in window, score set but RespondedAt nil — excluded.
		{
			Session: &Session{
				ID:        "s3",
				CreatedAt: time.Date(2026, 1, 13, 0, 0, 0, 0, time.UTC),
				Csat: &SessionCsat{
					Score: intPtr(3),
				},
			},
		},
	}

	stats := ComputeStats(entries, from, to)
	if stats.Csat.Responses != 1 {
		t.Fatalf("expected 1 CSAT response (rated in window), got %d", stats.Csat.Responses)
	}
	if stats.Csat.Average == nil || *stats.Csat.Average != 5 {
		t.Fatalf("expected average 5 from the single in-window rating, got %v", stats.Csat.Average)
	}
}

func TestComputeStats_CsatIncludesRespondedAtEndpoints(t *testing.T) {
	from := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 1, 20, 0, 0, 0, 0, time.UTC)

	entries := []StatsEntry{
		{
			Session: &Session{
				ID:        "s1",
				CreatedAt: from,
				Csat:      &SessionCsat{Score: intPtr(4), RespondedAt: timePtr(from)},
			},
		},
		{
			Session: &Session{
				ID:        "s2",
				CreatedAt: from,
				Csat:      &SessionCsat{Score: intPtr(5), RespondedAt: timePtr(to)},
			},
		},
	}

	stats := ComputeStats(entries, from, to)
	if stats.Csat.Responses != 2 {
		t.Fatalf("expected 2 CSAT responses (endpoints inclusive), got %d", stats.Csat.Responses)
	}
}

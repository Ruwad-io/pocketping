package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	pocketping "github.com/Ruwad-io/pocketping/sdk-go"
	"github.com/pocketping/bridge-server/internal/bridges"
	"github.com/pocketping/bridge-server/internal/config"
)

// seedStats populates a store with a known two-conversation scenario:
//   - session "a": answered (visitor then operator), CSAT 5
//   - session "b": unanswered (visitor only)
func seedStats(st *statsStore, now time.Time) {
	st.recordSession("a", now.Add(-1*time.Hour))
	st.recordMessage("a", pocketping.SenderVisitor, now.Add(-50*time.Minute), time.Time{})
	st.recordMessage("a", pocketping.SenderOperator, now.Add(-49*time.Minute), time.Time{})
	st.recordCsat("a", 5, now.Add(-40*time.Minute))

	st.recordSession("b", now.Add(-2*time.Hour))
	st.recordMessage("b", pocketping.SenderVisitor, now.Add(-2*time.Hour), time.Time{})
}

func TestStatsStore_ComputeStats(t *testing.T) {
	st := newStatsStore()
	now := time.Now()
	seedStats(st, now)

	got := pocketping.ComputeStats(st.entries(), now.Add(-7*24*time.Hour), now)

	if got.Conversations != 2 {
		t.Errorf("conversations = %d, want 2", got.Conversations)
	}
	if got.Messages != 3 {
		t.Errorf("messages = %d, want 3", got.Messages)
	}
	if got.ResponseRate != 0.5 {
		t.Errorf("responseRate = %v, want 0.5", got.ResponseRate)
	}
	if got.UnansweredNow != 1 {
		t.Errorf("unansweredNow = %d, want 1", got.UnansweredNow)
	}
	if got.MedianFirstResponseSeconds == nil || *got.MedianFirstResponseSeconds != 60 {
		t.Errorf("medianFirstResponseSeconds = %v, want 60", got.MedianFirstResponseSeconds)
	}
	if got.Csat.Responses != 1 {
		t.Errorf("csat.responses = %d, want 1", got.Csat.Responses)
	}
	if got.Csat.Percent == nil || *got.Csat.Percent != 1.0 {
		t.Errorf("csat.percent = %v, want 1.0", got.Csat.Percent)
	}
	if got.Csat.Average == nil || *got.Csat.Average != 5.0 {
		t.Errorf("csat.average = %v, want 5.0", got.Csat.Average)
	}
}

// TestStatsStore_recordMessage_upsertsUnknownSession verifies an operator reply
// for a session the relay never saw start still counts.
func TestStatsStore_recordMessage_upsertsUnknownSession(t *testing.T) {
	st := newStatsStore()
	now := time.Now()
	st.recordMessage("ghost", pocketping.SenderOperator, now.Add(-1*time.Minute), time.Time{})

	got := pocketping.ComputeStats(st.entries(), now.Add(-7*24*time.Hour), now)
	if got.Conversations != 1 {
		t.Errorf("conversations = %d, want 1", got.Conversations)
	}
}

// TestStatsStore_prune drops sessions older than the retention window.
func TestStatsStore_prune(t *testing.T) {
	st := newStatsStore()
	now := time.Now()
	st.recordSession("old", now.Add(-statsRetention-24*time.Hour))
	st.recordSession("fresh", now.Add(-1*time.Hour))

	entries := st.entries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 session after prune, got %d", len(entries))
	}
	if entries[0].Session.ID != "fresh" {
		t.Errorf("expected 'fresh' to survive, got %q", entries[0].Session.ID)
	}
}

func TestServer_handleStats_HTTP(t *testing.T) {
	server, mux := setupTestServer([]bridges.Bridge{newMockBridge("telegram")}, &config.Config{})
	now := time.Now()
	seedStats(server.stats, now)

	req := httptest.NewRequest("GET", "/stats?period=7d", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var stats pocketping.SdkStats
	if err := json.NewDecoder(w.Body).Decode(&stats); err != nil {
		t.Fatalf("decode stats: %v", err)
	}
	if stats.Conversations != 2 || stats.Messages != 3 {
		t.Errorf("unexpected stats: conversations=%d messages=%d", stats.Conversations, stats.Messages)
	}
	if stats.Csat.Responses != 1 {
		t.Errorf("csat.responses = %d, want 1", stats.Csat.Responses)
	}
}

func TestServer_handleStats_periodAndRange(t *testing.T) {
	server, mux := setupTestServer([]bridges.Bridge{newMockBridge("telegram")}, &config.Config{})
	now := time.Now()
	// A conversation 10 days ago: outside the default 7d window, inside 30d.
	server.stats.recordSession("old", now.Add(-10*24*time.Hour))
	server.stats.recordMessage("old", pocketping.SenderVisitor, now.Add(-10*24*time.Hour), time.Time{})

	fetch := func(query string) pocketping.SdkStats {
		t.Helper()
		req := httptest.NewRequest("GET", "/stats"+query, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("GET /stats%s: expected 200, got %d", query, w.Code)
		}
		var s pocketping.SdkStats
		if err := json.NewDecoder(w.Body).Decode(&s); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return s
	}

	if s := fetch("?period=7d"); s.Conversations != 0 {
		t.Errorf("7d window: conversations = %d, want 0", s.Conversations)
	}
	if s := fetch("?period=30d"); s.Conversations != 1 {
		t.Errorf("30d window: conversations = %d, want 1", s.Conversations)
	}
	// Explicit from/to override also captures the 10-day-old conversation.
	from := now.Add(-14 * 24 * time.Hour).UTC().Format(time.RFC3339)
	to := now.UTC().Format(time.RFC3339)
	if s := fetch("?from=" + from + "&to=" + to); s.Conversations != 1 {
		t.Errorf("explicit range: conversations = %d, want 1", s.Conversations)
	}
}

package api

import (
	"net/http"
	"sync"
	"time"

	pocketping "github.com/Ruwad-io/pocketping/sdk-go"
)

// statsRetention bounds the in-memory store. Stats windows look back at most
// 30 days, so sessions created before this can be pruned without affecting any
// result.
const statsRetention = 35 * 24 * time.Hour

// statsStore is a minimal in-memory session+message store used solely to
// compute GET /stats. The bridge-server is otherwise a stateless relay, so this
// captures only what the stats computation needs — a session's createdAt, each
// message's sender+timestamp, and the CSAT score+respondedAt.
//
// It is intentionally NOT durable: a restart resets it, and only conversations
// the relay has observed since start are counted. That is the honest limitation
// of computing stats on a relay that owns no database (see the CSAT/stats spec).
type statsStore struct {
	mu        sync.Mutex
	sessions  map[string]*statsSession
	retention time.Duration
}

type statsSession struct {
	createdAt  time.Time
	messages   []pocketping.Message
	csatScore  *int
	csatRespAt *time.Time
}

func newStatsStore() *statsStore {
	return &statsStore{
		sessions:  make(map[string]*statsSession),
		retention: statsRetention,
	}
}

// ensureLocked returns the session record, creating it with createdAt when
// absent (a zero createdAt falls back to now). Caller must hold st.mu.
func (st *statsStore) ensureLocked(id string, createdAt time.Time) *statsSession {
	rec, ok := st.sessions[id]
	if !ok {
		if createdAt.IsZero() {
			createdAt = time.Now()
		}
		rec = &statsSession{createdAt: createdAt}
		st.sessions[id] = rec
	}
	return rec
}

// recordSession upserts a session with its creation time.
func (st *statsStore) recordSession(id string, createdAt time.Time) {
	if id == "" {
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	st.ensureLocked(id, createdAt)
	st.pruneLocked()
}

// recordMessage appends a message (by sender + timestamp) to its session,
// upserting the session when the relay hasn't seen its start.
func (st *statsStore) recordMessage(sessionID string, sender pocketping.Sender, ts, createdAt time.Time) {
	if sessionID == "" {
		return
	}
	if ts.IsZero() {
		ts = time.Now()
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	rec := st.ensureLocked(sessionID, createdAt)
	rec.messages = append(rec.messages, pocketping.Message{Sender: sender, Timestamp: ts})
	st.pruneLocked()
}

// recordCsat stores the submitted score and response time for a session.
func (st *statsStore) recordCsat(sessionID string, score int, respondedAt time.Time) {
	if sessionID == "" {
		return
	}
	if respondedAt.IsZero() {
		respondedAt = time.Now()
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	rec := st.ensureLocked(sessionID, time.Time{})
	s, r := score, respondedAt
	rec.csatScore = &s
	rec.csatRespAt = &r
	st.pruneLocked()
}

// pruneLocked drops sessions created before the retention window. Caller must
// hold st.mu.
func (st *statsStore) pruneLocked() {
	cutoff := time.Now().Add(-st.retention)
	for id, rec := range st.sessions {
		if rec.createdAt.Before(cutoff) {
			delete(st.sessions, id)
		}
	}
}

// entries snapshots the store into pocketping.StatsEntry values, copying slices
// so ComputeStats reads a stable view without holding the lock.
func (st *statsStore) entries() []pocketping.StatsEntry {
	st.mu.Lock()
	defer st.mu.Unlock()
	out := make([]pocketping.StatsEntry, 0, len(st.sessions))
	for id, rec := range st.sessions {
		session := &pocketping.Session{ID: id, CreatedAt: rec.createdAt}
		if rec.csatScore != nil {
			session.Csat = &pocketping.SessionCsat{Score: rec.csatScore, RespondedAt: rec.csatRespAt}
		}
		msgs := make([]pocketping.Message, len(rec.messages))
		copy(msgs, rec.messages)
		out = append(out, pocketping.StatsEntry{Session: session, Messages: msgs})
	}
	return out
}

// handleStats serves GET /stats: mini support-stats over the in-memory store,
// in the same JSON shape as the SaaS /api/v1/stats and the SDK GetStats, so the
// same CLI/MCP can consume it by pointing POCKETPING_API_URL at the instance.
//
// Query params: period=7d|30d (default 7d), or explicit from/to (RFC3339),
// which override the period window.
func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	to := time.Now()
	from := to.Add(-7 * 24 * time.Hour)

	if r.URL.Query().Get("period") == "30d" {
		from = to.Add(-30 * 24 * time.Hour)
	}
	if v := r.URL.Query().Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			from = t
		}
	}
	if v := r.URL.Query().Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			to = t
		}
	}

	stats := pocketping.ComputeStats(s.stats.entries(), from, to)
	writeJSON(w, stats)
}

package pocketping

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// notifyCall records a Notify invocation on the test bridge.
type notifyCall struct {
	session *Session
	message string
}

// NotifyBridge implements Bridge + BridgeWithNotify, capturing Notify calls.
type NotifyBridge struct {
	BaseBridge
	mu          sync.Mutex
	notifyCalls []notifyCall
	notifyErr   error
}

func newNotifyBridge() *NotifyBridge {
	return &NotifyBridge{BaseBridge: BaseBridge{BridgeName: "telegram"}}
}

func (b *NotifyBridge) Notify(ctx context.Context, session *Session, message string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.notifyCalls = append(b.notifyCalls, notifyCall{session: session, message: message})
	return b.notifyErr
}

func (b *NotifyBridge) lastNotify() (notifyCall, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.notifyCalls) == 0 {
		return notifyCall{}, false
	}
	return b.notifyCalls[len(b.notifyCalls)-1], true
}

func newCsatSession(t *testing.T, pp *PocketPing) string {
	t.Helper()
	resp, err := pp.HandleConnect(context.Background(), ConnectRequest{VisitorID: "v1"})
	if err != nil {
		t.Fatalf("HandleConnect failed: %v", err)
	}
	return resp.SessionID
}

func TestRequestCsat_SetsPendingAndBroadcasts(t *testing.T) {
	ctx := context.Background()
	bridge := newNotifyBridge()
	pp := New(Config{Bridges: []Bridge{bridge}})
	sessionID := newCsatSession(t, pp)

	conn := &MockWebSocketConn{}
	pp.RegisterWebSocket(sessionID, conn)

	if err := pp.RequestCsat(ctx, sessionID); err != nil {
		t.Fatalf("RequestCsat failed: %v", err)
	}

	session, _ := pp.GetSession(ctx, sessionID)
	if session.Csat == nil || !session.Csat.Pending {
		t.Fatalf("expected csat.pending true, got %+v", session.Csat)
	}
	if session.Csat.RequestedAt == nil {
		t.Errorf("expected csat.requestedAt to be set")
	}

	msgs := conn.GetMessages()
	if len(msgs) != 1 {
		t.Fatalf("expected 1 broadcast, got %d", len(msgs))
	}
	event, ok := msgs[0].(WebSocketEvent)
	if !ok || event.Type != "csat_request" {
		t.Errorf("expected csat_request event, got %+v", msgs[0])
	}
}

func TestHandleCsat_StoresScoreClearsPendingNotifiesRunsCallback(t *testing.T) {
	ctx := context.Background()
	bridge := newNotifyBridge()

	var (
		callbackMu      sync.Mutex
		callbackSession *Session
		callbackRating  CsatRating
	)
	pp := New(Config{
		Bridges: []Bridge{bridge},
		OnCsat: func(session *Session, rating CsatRating) {
			callbackMu.Lock()
			defer callbackMu.Unlock()
			callbackSession = session
			callbackRating = rating
		},
	})

	sessionID := newCsatSession(t, pp)
	if err := pp.RequestCsat(ctx, sessionID); err != nil {
		t.Fatalf("RequestCsat failed: %v", err)
	}

	res, err := pp.HandleCsat(ctx, CsatRequest{SessionID: sessionID, Score: 5, Comment: "  great  "})
	if err != nil {
		t.Fatalf("HandleCsat failed: %v", err)
	}
	if !res.OK || res.AlreadyRated {
		t.Errorf("expected {OK:true}, got %+v", res)
	}

	session, _ := pp.GetSession(ctx, sessionID)
	if session.Csat == nil {
		t.Fatal("expected csat state")
	}
	if session.Csat.Score == nil || *session.Csat.Score != 5 {
		t.Errorf("expected score 5, got %v", session.Csat.Score)
	}
	if session.Csat.Comment == nil || *session.Csat.Comment != "great" {
		t.Errorf("expected trimmed comment 'great', got %v", session.Csat.Comment)
	}
	if session.Csat.Pending {
		t.Errorf("expected pending false")
	}
	if session.Csat.RespondedAt == nil {
		t.Errorf("expected respondedAt to be set")
	}

	last, ok := bridge.lastNotify()
	if !ok {
		t.Fatal("expected a bridge notify call")
	}
	want := `⭐ 😍 5/5 — "great"`
	if last.message != want {
		t.Errorf("expected notify message %q, got %q", want, last.message)
	}

	callbackMu.Lock()
	defer callbackMu.Unlock()
	if callbackSession == nil {
		t.Fatal("expected OnCsat callback to run")
	}
	if callbackRating.Score != 5 || callbackRating.Comment != "great" {
		t.Errorf("expected rating {5, great}, got %+v", callbackRating)
	}
}

func TestHandleCsat_RejectsOutOfRangeScore(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{})
	sessionID := newCsatSession(t, pp)

	for _, score := range []int{0, 6} {
		_, err := pp.HandleCsat(ctx, CsatRequest{SessionID: sessionID, Score: score})
		if err == nil {
			t.Fatalf("expected error for score %d", score)
		}
		if !strings.Contains(err.Error(), "1-5") {
			t.Errorf("expected error to mention 1-5, got %v", err)
		}
	}
}

func TestHandleCsat_IdempotentOnceRated(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{})
	sessionID := newCsatSession(t, pp)

	if _, err := pp.HandleCsat(ctx, CsatRequest{SessionID: sessionID, Score: 4}); err != nil {
		t.Fatalf("first HandleCsat failed: %v", err)
	}

	second, err := pp.HandleCsat(ctx, CsatRequest{SessionID: sessionID, Score: 1})
	if err != nil {
		t.Fatalf("second HandleCsat failed: %v", err)
	}
	if !second.OK || !second.AlreadyRated {
		t.Errorf("expected {OK:true, AlreadyRated:true}, got %+v", second)
	}

	session, _ := pp.GetSession(ctx, sessionID)
	if session.Csat.Score == nil || *session.Csat.Score != 4 {
		t.Errorf("expected score unchanged at 4, got %v", session.Csat.Score)
	}
}

func TestCsat_SessionNotFound(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{})

	if _, err := pp.HandleCsat(ctx, CsatRequest{SessionID: "nope", Score: 3}); !errors.Is(err, ErrSessionNotFound) {
		t.Errorf("expected ErrSessionNotFound from HandleCsat, got %v", err)
	}
	if err := pp.RequestCsat(ctx, "nope"); !errors.Is(err, ErrSessionNotFound) {
		t.Errorf("expected ErrSessionNotFound from RequestCsat, got %v", err)
	}
}

func TestGetStats_ComputesOverStorage(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{})

	a, err := pp.HandleConnect(ctx, ConnectRequest{VisitorID: "va"})
	if err != nil {
		t.Fatalf("connect a failed: %v", err)
	}
	b, err := pp.HandleConnect(ctx, ConnectRequest{VisitorID: "vb"})
	if err != nil {
		t.Fatalf("connect b failed: %v", err)
	}

	// Session A: visitor msg + operator reply + 5-star rating.
	if _, err := pp.HandleMessage(ctx, SendMessageRequest{SessionID: a.SessionID, Content: "hi", Sender: SenderVisitor}); err != nil {
		t.Fatalf("message a/visitor failed: %v", err)
	}
	if _, err := pp.SendOperatorMessage(ctx, a.SessionID, "hello!", "", ""); err != nil {
		t.Fatalf("operator message failed: %v", err)
	}
	if _, err := pp.HandleCsat(ctx, CsatRequest{SessionID: a.SessionID, Score: 5}); err != nil {
		t.Fatalf("csat a failed: %v", err)
	}

	// Session B: visitor msg only (unanswered).
	if _, err := pp.HandleMessage(ctx, SendMessageRequest{SessionID: b.SessionID, Content: "anyone?", Sender: SenderVisitor}); err != nil {
		t.Fatalf("message b/visitor failed: %v", err)
	}

	stats, err := pp.GetStats(ctx, nil)
	if err != nil {
		t.Fatalf("GetStats failed: %v", err)
	}

	if stats.Conversations != 2 {
		t.Errorf("expected 2 conversations, got %d", stats.Conversations)
	}
	if stats.ResponseRate != 0.5 {
		t.Errorf("expected response rate 0.5, got %v", stats.ResponseRate)
	}
	if stats.UnansweredNow != 1 {
		t.Errorf("expected 1 unanswered, got %d", stats.UnansweredNow)
	}
	if stats.Csat.Responses != 1 {
		t.Errorf("expected 1 csat response, got %d", stats.Csat.Responses)
	}
	if stats.Csat.Percent == nil || *stats.Csat.Percent != 1 {
		t.Errorf("expected csat percent 1, got %v", stats.Csat.Percent)
	}
	if stats.Csat.Average == nil || *stats.Csat.Average != 5 {
		t.Errorf("expected csat average 5, got %v", stats.Csat.Average)
	}
	if len(stats.ConversationsSparkline) != 7 {
		t.Errorf("expected sparkline length 7, got %d", len(stats.ConversationsSparkline))
	}
}

// statsLessStorage is a Storage that does NOT implement StorageWithListSessions.
type statsLessStorage struct{}

func (statsLessStorage) CreateSession(ctx context.Context, session *Session) error { return nil }
func (statsLessStorage) GetSession(ctx context.Context, sessionID string) (*Session, error) {
	return nil, nil
}
func (statsLessStorage) GetSessionByVisitorID(ctx context.Context, visitorID string) (*Session, error) {
	return nil, nil
}
func (statsLessStorage) UpdateSession(ctx context.Context, session *Session) error { return nil }
func (statsLessStorage) DeleteSession(ctx context.Context, sessionID string) error { return nil }
func (statsLessStorage) SaveMessage(ctx context.Context, message *Message) error   { return nil }
func (statsLessStorage) GetMessages(ctx context.Context, sessionID, after string, limit int) ([]Message, error) {
	return nil, nil
}
func (statsLessStorage) GetMessage(ctx context.Context, messageID string) (*Message, error) {
	return nil, nil
}
func (statsLessStorage) CleanupOldSessions(ctx context.Context, olderThan time.Time) (int, error) {
	return 0, nil
}

func TestGetStats_UnsupportedStorage(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{Storage: statsLessStorage{}})

	_, err := pp.GetStats(ctx, nil)
	if err == nil {
		t.Fatal("expected error for storage without ListSessions")
	}
	if !strings.Contains(err.Error(), "listSessions") {
		t.Errorf("expected error to mention listSessions, got %v", err)
	}
}

package pocketping

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// mockWSConn captures broadcast events.
type mockWSConn struct {
	mu     sync.Mutex
	events []WebSocketEvent
	fail   bool
}

func (m *mockWSConn) WriteJSON(v interface{}) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail {
		return errors.New("write failed")
	}
	if e, ok := v.(WebSocketEvent); ok {
		m.events = append(m.events, e)
	}
	return nil
}

func (m *mockWSConn) Close() error { return nil }

func (m *mockWSConn) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.events)
}

func (m *mockWSConn) types() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.events))
	for i, e := range m.events {
		out[i] = e.Type
	}
	return out
}

// sendVisitorMessage creates a visitor message and returns its ID.
func sendVisitorMessage(t *testing.T, pp *PocketPing, sessionID, content string) string {
	t.Helper()
	resp, err := pp.HandleMessage(context.Background(), SendMessageRequest{
		SessionID: sessionID,
		Content:   content,
		Sender:    SenderVisitor,
	})
	if err != nil {
		t.Fatalf("HandleMessage: %v", err)
	}
	return resp.MessageID
}

// ─────────────────────────────────────────────────────────────────
// Start / Stop with bridges
// ─────────────────────────────────────────────────────────────────

func TestStartInitsBridges(t *testing.T) {
	ctx := context.Background()
	spy := &spyBridge{BaseBridge: BaseBridge{BridgeName: "spy"}}
	pp := New(Config{Bridges: []Bridge{spy}})
	if err := pp.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if spy.mu.initd != 1 {
		t.Errorf("init count = %d, want 1", spy.mu.initd)
	}
	if err := pp.Stop(ctx); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if spy.mu.destroy != 1 {
		t.Errorf("destroy count = %d, want 1", spy.mu.destroy)
	}
}

func TestStartReturnsBridgeInitError(t *testing.T) {
	ctx := context.Background()
	spy := &spyBridge{BaseBridge: BaseBridge{BridgeName: "spy"}, failOn: "init"}
	pp := New(Config{Bridges: []Bridge{spy}})
	if err := pp.Start(ctx); err == nil {
		t.Error("expected Start to return init error")
	}
}

func TestStopContinuesOnDestroyError(t *testing.T) {
	ctx := context.Background()
	spy := &spyBridge{BaseBridge: BaseBridge{BridgeName: "spy"}, failOn: "destroy"}
	pp := New(Config{Bridges: []Bridge{spy}})
	if err := pp.Stop(ctx); err != nil {
		t.Errorf("Stop should swallow destroy errors, got %v", err)
	}
}

// ─────────────────────────────────────────────────────────────────
// HandleEditMessage
// ─────────────────────────────────────────────────────────────────

func TestHandleEditMessageSuccess(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{})
	sessionID := newSessionFixture(t, pp)
	msgID := sendVisitorMessage(t, pp, sessionID, "original")

	ws := &mockWSConn{}
	pp.RegisterWebSocket(sessionID, ws)

	resp, err := pp.HandleEditMessage(ctx, EditMessageRequest{
		SessionID: sessionID,
		MessageID: msgID,
		Content:   "edited content",
	})
	if err != nil {
		t.Fatalf("HandleEditMessage: %v", err)
	}
	if resp.Message.Content != "edited content" {
		t.Errorf("content = %q", resp.Message.Content)
	}
	if resp.Message.EditedAt.IsZero() {
		t.Error("expected EditedAt to be set")
	}

	// WebSocket should have received a message_edited event.
	found := false
	for _, ty := range ws.types() {
		if ty == "message_edited" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected message_edited event, got %v", ws.types())
	}
}

func TestHandleEditMessageErrors(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{})
	sessionID := newSessionFixture(t, pp)
	msgID := sendVisitorMessage(t, pp, sessionID, "original")

	t.Run("empty content", func(t *testing.T) {
		_, err := pp.HandleEditMessage(ctx, EditMessageRequest{SessionID: sessionID, MessageID: msgID, Content: "   "})
		if err != ErrNoContent {
			t.Errorf("err = %v, want ErrNoContent", err)
		}
	})

	t.Run("content too long", func(t *testing.T) {
		_, err := pp.HandleEditMessage(ctx, EditMessageRequest{SessionID: sessionID, MessageID: msgID, Content: strings.Repeat("x", MaxMessageContentLength+1)})
		if err != ErrContentTooLong {
			t.Errorf("err = %v, want ErrContentTooLong", err)
		}
	})

	t.Run("session not found", func(t *testing.T) {
		_, err := pp.HandleEditMessage(ctx, EditMessageRequest{SessionID: "nope", MessageID: msgID, Content: "x"})
		if err != ErrSessionNotFound {
			t.Errorf("err = %v, want ErrSessionNotFound", err)
		}
	})

	t.Run("message not found", func(t *testing.T) {
		_, err := pp.HandleEditMessage(ctx, EditMessageRequest{SessionID: sessionID, MessageID: "missing", Content: "x"})
		if err != ErrMessageNotFound {
			t.Errorf("err = %v, want ErrMessageNotFound", err)
		}
	})

	t.Run("operator message unauthorized", func(t *testing.T) {
		opResp, err := pp.HandleMessage(ctx, SendMessageRequest{SessionID: sessionID, Content: "op msg", Sender: SenderOperator})
		if err != nil {
			t.Fatalf("send operator: %v", err)
		}
		_, err = pp.HandleEditMessage(ctx, EditMessageRequest{SessionID: sessionID, MessageID: opResp.MessageID, Content: "x"})
		if err != ErrUnauthorized {
			t.Errorf("err = %v, want ErrUnauthorized", err)
		}
	})

	t.Run("cannot edit deleted", func(t *testing.T) {
		delMsgID := sendVisitorMessage(t, pp, sessionID, "to delete")
		if _, err := pp.HandleDeleteMessage(ctx, DeleteMessageRequest{SessionID: sessionID, MessageID: delMsgID}); err != nil {
			t.Fatalf("delete: %v", err)
		}
		_, err := pp.HandleEditMessage(ctx, EditMessageRequest{SessionID: sessionID, MessageID: delMsgID, Content: "x"})
		if err != ErrMessageDeleted {
			t.Errorf("err = %v, want ErrMessageDeleted", err)
		}
	})

	t.Run("message belongs to other session", func(t *testing.T) {
		other, err := pp.HandleConnect(ctx, ConnectRequest{VisitorID: "visitor-2"})
		if err != nil {
			t.Fatalf("connect other: %v", err)
		}
		_, err = pp.HandleEditMessage(ctx, EditMessageRequest{SessionID: other.SessionID, MessageID: msgID, Content: "x"})
		if err != ErrMessageNotFound {
			t.Errorf("err = %v, want ErrMessageNotFound (cross-session)", err)
		}
	})
}

// ─────────────────────────────────────────────────────────────────
// HandleDeleteMessage
// ─────────────────────────────────────────────────────────────────

func TestHandleDeleteMessageSuccess(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{})
	sessionID := newSessionFixture(t, pp)
	msgID := sendVisitorMessage(t, pp, sessionID, "to delete")

	ws := &mockWSConn{}
	pp.RegisterWebSocket(sessionID, ws)

	resp, err := pp.HandleDeleteMessage(ctx, DeleteMessageRequest{SessionID: sessionID, MessageID: msgID})
	if err != nil {
		t.Fatalf("HandleDeleteMessage: %v", err)
	}
	if !resp.Deleted {
		t.Error("expected Deleted = true")
	}

	msg, _ := pp.storage.GetMessage(ctx, msgID)
	if msg.DeletedAt == nil {
		t.Error("expected DeletedAt to be set")
	}
}

func TestHandleDeleteMessageErrors(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{})
	sessionID := newSessionFixture(t, pp)
	msgID := sendVisitorMessage(t, pp, sessionID, "msg")

	if _, err := pp.HandleDeleteMessage(ctx, DeleteMessageRequest{SessionID: "nope", MessageID: msgID}); err != ErrSessionNotFound {
		t.Errorf("err = %v, want ErrSessionNotFound", err)
	}
	if _, err := pp.HandleDeleteMessage(ctx, DeleteMessageRequest{SessionID: sessionID, MessageID: "missing"}); err != ErrMessageNotFound {
		t.Errorf("err = %v, want ErrMessageNotFound", err)
	}

	opResp, err := pp.HandleMessage(ctx, SendMessageRequest{SessionID: sessionID, Content: "op", Sender: SenderOperator})
	if err != nil {
		t.Fatalf("send operator: %v", err)
	}
	if _, err := pp.HandleDeleteMessage(ctx, DeleteMessageRequest{SessionID: sessionID, MessageID: opResp.MessageID}); err != ErrUnauthorized {
		t.Errorf("err = %v, want ErrUnauthorized", err)
	}

	// Cross-session.
	other, _ := pp.HandleConnect(ctx, ConnectRequest{VisitorID: "visitor-x"})
	if _, err := pp.HandleDeleteMessage(ctx, DeleteMessageRequest{SessionID: other.SessionID, MessageID: msgID}); err != ErrMessageNotFound {
		t.Errorf("err = %v, want ErrMessageNotFound (cross-session)", err)
	}
}

// ─────────────────────────────────────────────────────────────────
// Edit/Delete sync to bridges
// ─────────────────────────────────────────────────────────────────

func TestEditDeleteSyncToBridges(t *testing.T) {
	ctx := context.Background()
	editDelBridge := &editDeleteSpyBridge{
		BaseBridge: BaseBridge{BridgeName: "ed"},
		editCh:     make(chan struct{}, 8),
		deleteCh:   make(chan struct{}, 8),
	}
	pp := New(Config{Bridges: []Bridge{editDelBridge}})
	sessionID := newSessionFixture(t, pp)
	msgID := sendVisitorMessage(t, pp, sessionID, "hi")

	if _, err := pp.HandleEditMessage(ctx, EditMessageRequest{SessionID: sessionID, MessageID: msgID, Content: "edited"}); err != nil {
		t.Fatalf("edit: %v", err)
	}
	if _, err := pp.HandleDeleteMessage(ctx, DeleteMessageRequest{SessionID: sessionID, MessageID: msgID}); err != nil {
		t.Fatalf("delete: %v", err)
	}

	// Sync runs in goroutines; wait for both signals (with a timeout).
	select {
	case <-editDelBridge.editCh:
	case <-time.After(2 * time.Second):
		t.Error("expected OnMessageEdit to be invoked on bridge")
	}
	select {
	case <-editDelBridge.deleteCh:
	case <-time.After(2 * time.Second):
		t.Error("expected OnMessageDelete to be invoked on bridge")
	}
}

type editDeleteSpyBridge struct {
	BaseBridge
	editCh   chan struct{}
	deleteCh chan struct{}
}

func (e *editDeleteSpyBridge) OnMessageEdit(ctx context.Context, sessionID, messageID, content string, editedAt time.Time) (*BridgeMessageResult, error) {
	e.editCh <- struct{}{}
	return nil, nil
}

func (e *editDeleteSpyBridge) OnMessageDelete(ctx context.Context, sessionID, messageID string, deletedAt time.Time) error {
	e.deleteCh <- struct{}{}
	return nil
}

// ─────────────────────────────────────────────────────────────────
// TriggerEvent
// ─────────────────────────────────────────────────────────────────

func TestTriggerEvent(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{})
	sessionID := newSessionFixture(t, pp)

	var received CustomEvent
	pp.OnEvent("clicked_pricing", func(e CustomEvent, s *Session) {
		received = e
	})

	if err := pp.TriggerEvent(ctx, sessionID, "clicked_pricing", map[string]interface{}{"plan": "pro"}); err != nil {
		t.Fatalf("TriggerEvent: %v", err)
	}
	if received.Name != "clicked_pricing" {
		t.Errorf("event name = %q", received.Name)
	}
	if received.Data["plan"] != "pro" {
		t.Errorf("event data = %v", received.Data)
	}
}

// ─────────────────────────────────────────────────────────────────
// SendVersionWarning
// ─────────────────────────────────────────────────────────────────

func TestSendVersionWarning(t *testing.T) {
	pp := New(Config{})
	sessionID := "v-sess"
	ws := &mockWSConn{}
	pp.RegisterWebSocket(sessionID, ws)

	// OK status -> no broadcast.
	pp.SendVersionWarning(sessionID, VersionCheckResult{Status: VersionStatusOK}, "1.0.0")
	if ws.count() != 0 {
		t.Errorf("expected no event for OK status, got %d", ws.count())
	}

	// Deprecated -> broadcast a version_warning.
	pp.SendVersionWarning(sessionID, VersionCheckResult{Status: VersionStatusDeprecated, Message: "old", CanContinue: true}, "1.0.0")
	if ws.count() != 1 {
		t.Fatalf("expected 1 event, got %d", ws.count())
	}
	if ws.types()[0] != "version_warning" {
		t.Errorf("event type = %q", ws.types()[0])
	}
}

// ─────────────────────────────────────────────────────────────────
// BroadcastToSession dead-connection cleanup
// ─────────────────────────────────────────────────────────────────

func TestBroadcastRemovesDeadConnections(t *testing.T) {
	pp := New(Config{})
	sessionID := "dead-sess"
	good := &mockWSConn{}
	bad := &mockWSConn{fail: true}
	pp.RegisterWebSocket(sessionID, good)
	pp.RegisterWebSocket(sessionID, bad)

	pp.BroadcastToSession(sessionID, WebSocketEvent{Type: "ping"})

	if good.count() != 1 {
		t.Errorf("good conn events = %d, want 1", good.count())
	}

	// Broadcasting to a session with no sockets is a no-op.
	pp.BroadcastToSession("no-such-session", WebSocketEvent{Type: "x"})

	// Unregister both, ensure no panic on empty.
	pp.UnregisterWebSocket(sessionID, good)
}

// ─────────────────────────────────────────────────────────────────
// AddBridge dynamic
// ─────────────────────────────────────────────────────────────────

func TestAddBridgeDynamic(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{})
	spy := &spyBridge{BaseBridge: BaseBridge{BridgeName: "dyn"}}
	if err := pp.AddBridge(ctx, spy); err != nil {
		t.Fatalf("AddBridge: %v", err)
	}
	if spy.mu.initd != 1 {
		t.Errorf("expected bridge to be initialized on add, init=%d", spy.mu.initd)
	}

	// AddBridge propagates init error.
	bad := &spyBridge{BaseBridge: BaseBridge{BridgeName: "bad"}, failOn: "init"}
	if err := pp.AddBridge(ctx, bad); err == nil {
		t.Error("expected AddBridge to propagate init error")
	}
}

// ─────────────────────────────────────────────────────────────────
// notifyBridges* via real handlers (goroutine fan-out)
// ─────────────────────────────────────────────────────────────────

// chanBridge signals on channels when its hooks fire so tests can synchronize
// with the goroutines spawned by the notify helpers.
type chanBridge struct {
	BaseBridge
	operator chan struct{}
	read     chan struct{}
	event    chan struct{}
	identity chan struct{}
}

func newChanBridge() *chanBridge {
	return &chanBridge{
		BaseBridge: BaseBridge{BridgeName: "chan"},
		operator:   make(chan struct{}, 8),
		read:       make(chan struct{}, 8),
		event:      make(chan struct{}, 8),
		identity:   make(chan struct{}, 8),
	}
}

func (c *chanBridge) OnOperatorMessage(ctx context.Context, m *Message, s *Session, sb, on string) error {
	c.operator <- struct{}{}
	return nil
}
func (c *chanBridge) OnMessageRead(ctx context.Context, sid string, ids []string, st MessageStatus) error {
	c.read <- struct{}{}
	return nil
}
func (c *chanBridge) OnCustomEvent(ctx context.Context, e CustomEvent, s *Session) error {
	c.event <- struct{}{}
	return nil
}
func (c *chanBridge) OnIdentityUpdate(ctx context.Context, s *Session) error {
	c.identity <- struct{}{}
	return nil
}

func waitSignal(t *testing.T, ch chan struct{}, name string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Errorf("timed out waiting for %s bridge hook", name)
	}
}

func TestNotifyBridgesFanOut(t *testing.T) {
	ctx := context.Background()
	cb := newChanBridge()
	pp := New(Config{Bridges: []Bridge{cb}})
	sessionID := newSessionFixture(t, pp)

	// Operator message via SendOperatorMessage -> notifyBridgesOperatorMessage.
	if _, err := pp.SendOperatorMessage(ctx, sessionID, "op here", "telegram", "Op"); err != nil {
		t.Fatalf("operator message: %v", err)
	}
	waitSignal(t, cb.operator, "operator")

	// Read receipt -> notifyBridgesRead.
	visMsg := sendVisitorMessage(t, pp, sessionID, "hi")
	if _, err := pp.HandleRead(ctx, ReadRequest{SessionID: sessionID, MessageIDs: []string{visMsg}, Status: MessageStatusRead}); err != nil {
		t.Fatalf("read: %v", err)
	}
	waitSignal(t, cb.read, "read")

	// Custom event -> notifyBridgesEvent.
	if err := pp.TriggerEvent(ctx, sessionID, "evt", nil); err != nil {
		t.Fatalf("event: %v", err)
	}
	waitSignal(t, cb.event, "event")

	// Identify -> notifyBridgesIdentity.
	if _, err := pp.HandleIdentify(ctx, IdentifyRequest{SessionID: sessionID, Identity: &UserIdentity{ID: "u9", Name: "Zoe"}}); err != nil {
		t.Fatalf("identify: %v", err)
	}
	waitSignal(t, cb.identity, "identity")
}

// ─────────────────────────────────────────────────────────────────
// Slack reply-quote with a real reply target
// ─────────────────────────────────────────────────────────────────

func TestSlackBuildReplyQuoteWithTarget(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{})
	sessionID := newSessionFixture(t, pp)
	targetID := sendVisitorMessage(t, pp, sessionID, "original question")

	wb := &SlackWebhookBridge{pp: pp}
	quote := wb.buildReplyQuote(ctx, &Message{ReplyTo: targetID})
	if !strings.Contains(quote, "original question") {
		t.Errorf("webhook quote = %q", quote)
	}

	bb := &SlackBotBridge{pp: pp}
	quote2 := bb.buildReplyQuote(ctx, &Message{ReplyTo: targetID})
	if !strings.Contains(quote2, "original question") {
		t.Errorf("bot quote = %q", quote2)
	}

	// Reply target not found -> empty quote.
	if wb.buildReplyQuote(ctx, &Message{ReplyTo: "missing"}) != "" {
		t.Error("expected empty quote for missing reply target")
	}
}

// ─────────────────────────────────────────────────────────────────
// SaveBridgeMessageIDs merge path
// ─────────────────────────────────────────────────────────────────

func TestSaveBridgeMessageIDsMerge(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStorage()

	// First save sets the Telegram ID.
	if err := store.SaveBridgeMessageIDs(ctx, "m1", BridgeMessageIds{TelegramMessageID: 100}); err != nil {
		t.Fatalf("save 1: %v", err)
	}
	// Second save merges Discord + Slack into the existing record.
	if err := store.SaveBridgeMessageIDs(ctx, "m1", BridgeMessageIds{DiscordMessageID: "d1", SlackMessageTS: "ts1"}); err != nil {
		t.Fatalf("save 2: %v", err)
	}

	ids, err := store.GetBridgeMessageIDs(ctx, "m1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if ids.TelegramMessageID != 100 || ids.DiscordMessageID != "d1" || ids.SlackMessageTS != "ts1" {
		t.Errorf("merged ids = %+v", ids)
	}
}

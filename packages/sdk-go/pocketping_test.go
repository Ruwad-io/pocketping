package pocketping

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// MockWebSocketConn implements WebSocketConn for testing
type MockWebSocketConn struct {
	mu       sync.Mutex
	messages []interface{}
	closed   bool
}

func (m *MockWebSocketConn) WriteJSON(v interface{}) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages = append(m.messages, v)
	return nil
}

func (m *MockWebSocketConn) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	return nil
}

func (m *MockWebSocketConn) GetMessages() []interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.messages
}

// MockBridge implements Bridge for testing
type MockBridge struct {
	BaseBridge
	NewSessionCalls  []*Session
	VisitorMsgCalls  []*Message
	OperatorMsgCalls []*Message
	IdentityCalls    []*Session
	EventCalls       []CustomEvent
	ReadCalls        []string
	mu               sync.Mutex
}

func NewMockBridge(name string) *MockBridge {
	return &MockBridge{
		BaseBridge: BaseBridge{BridgeName: name},
	}
}

func (m *MockBridge) OnNewSession(ctx context.Context, session *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.NewSessionCalls = append(m.NewSessionCalls, session)
	return nil
}

func (m *MockBridge) OnVisitorMessage(ctx context.Context, message *Message, session *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.VisitorMsgCalls = append(m.VisitorMsgCalls, message)
	return nil
}

func (m *MockBridge) OnOperatorMessage(ctx context.Context, message *Message, session *Session, sourceBridge, operatorName string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.OperatorMsgCalls = append(m.OperatorMsgCalls, message)
	return nil
}

func (m *MockBridge) OnIdentityUpdate(ctx context.Context, session *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.IdentityCalls = append(m.IdentityCalls, session)
	return nil
}

func (m *MockBridge) OnCustomEvent(ctx context.Context, event CustomEvent, session *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.EventCalls = append(m.EventCalls, event)
	return nil
}

func (m *MockBridge) OnMessageRead(ctx context.Context, sessionID string, messageIDs []string, status MessageStatus) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ReadCalls = append(m.ReadCalls, messageIDs...)
	return nil
}

func TestNewPocketPing(t *testing.T) {
	pp := New(Config{})

	if pp == nil {
		t.Fatal("expected non-nil PocketPing")
	}

	if pp.storage == nil {
		t.Error("expected default storage to be set")
	}
}

func TestNewPocketPingWithConfig(t *testing.T) {
	storage := NewMemoryStorage()
	bridge := NewMockBridge("test")

	pp := New(Config{
		Storage:        storage,
		Bridges:        []Bridge{bridge},
		WelcomeMessage: "Hello!",
	})

	if pp.GetStorage() != storage {
		t.Error("expected custom storage to be used")
	}

	if pp.config.WelcomeMessage != "Hello!" {
		t.Error("expected welcome message to be set")
	}
}

func TestHandleConnectCreatesNewSession(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	response, err := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})
	if err != nil {
		t.Fatalf("failed to connect: %v", err)
	}

	if response.SessionID == "" {
		t.Error("expected session ID to be generated")
	}

	if response.VisitorID != "visitor-123" {
		t.Errorf("expected visitorId=visitor-123, got %v", response.VisitorID)
	}
}

func TestHandleConnectReusesExistingSession(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	// First connect
	response1, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	// Second connect with session ID
	response2, err := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
		SessionID: response1.SessionID,
	})
	if err != nil {
		t.Fatalf("failed to reconnect: %v", err)
	}

	if response2.SessionID != response1.SessionID {
		t.Error("expected same session ID on reconnect")
	}
}

func TestHandleConnectReusesSessionByVisitorID(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	// First connect
	response1, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	// Second connect without session ID
	response2, err := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})
	if err != nil {
		t.Fatalf("failed to reconnect: %v", err)
	}

	if response2.SessionID != response1.SessionID {
		t.Error("expected same session when using same visitor ID")
	}
}

func TestHandleConnectReturnsExistingMessages(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	// Connect and send a message
	response1, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: response1.SessionID,
		Content:   "Hello!",
		Sender:    SenderVisitor,
	})

	// Reconnect
	response2, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
		SessionID: response1.SessionID,
	})

	if len(response2.Messages) != 1 {
		t.Errorf("expected 1 message, got %d", len(response2.Messages))
	}
}

func TestHandleConnectUpdatesMetadata(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	// First connect
	response1, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
		Metadata: &SessionMetadata{
			URL: "https://example.com/page1",
		},
	})

	// Reconnect with new metadata
	pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
		SessionID: response1.SessionID,
		Metadata: &SessionMetadata{
			URL: "https://example.com/page2",
		},
	})

	// Verify metadata was updated
	session, _ := pp.GetSession(ctx, response1.SessionID)
	if session.Metadata.URL != "https://example.com/page2" {
		t.Errorf("expected updated URL, got %v", session.Metadata.URL)
	}
}

func TestHandleConnectReturnsTrackedElements(t *testing.T) {
	pp := New(Config{
		TrackedElements: []TrackedElement{
			{Selector: ".pricing-btn", Name: "clicked_pricing"},
		},
	})
	ctx := context.Background()

	response, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	if len(response.TrackedElements) != 1 {
		t.Errorf("expected 1 tracked element, got %d", len(response.TrackedElements))
	}
}

func TestHandleMessageVisitor(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	// Create session
	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	// Send message
	msgResp, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: connectResp.SessionID,
		Content:   "Hello!",
		Sender:    SenderVisitor,
	})
	if err != nil {
		t.Fatalf("failed to send message: %v", err)
	}

	if msgResp.MessageID == "" {
		t.Error("expected message ID")
	}
}

func TestHandleMessageOperator(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	// Create session
	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	// Send operator message
	msgResp, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: connectResp.SessionID,
		Content:   "How can I help?",
		Sender:    SenderOperator,
	})
	if err != nil {
		t.Fatalf("failed to send operator message: %v", err)
	}

	if msgResp.MessageID == "" {
		t.Error("expected message ID")
	}
}

func TestHandleMessageUpdatesSessionActivity(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	session, _ := pp.GetSession(ctx, connectResp.SessionID)
	oldActivity := session.LastActivity

	time.Sleep(10 * time.Millisecond)

	pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: connectResp.SessionID,
		Content:   "Test",
		Sender:    SenderVisitor,
	})

	session, _ = pp.GetSession(ctx, connectResp.SessionID)
	if !session.LastActivity.After(oldActivity) {
		t.Error("expected last activity to be updated")
	}
}

func TestHandleMessageRejectsInvalidSession(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	_, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: "nonexistent",
		Content:   "Test",
		Sender:    SenderVisitor,
	})

	if err != ErrSessionNotFound {
		t.Errorf("expected ErrSessionNotFound, got %v", err)
	}
}

func TestHandleMessageOperatorDisablesAI(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	// Manually set AI active
	session, _ := pp.GetSession(ctx, connectResp.SessionID)
	session.AIActive = true
	pp.storage.UpdateSession(ctx, session)

	// Operator responds
	pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: connectResp.SessionID,
		Content:   "I'm here to help",
		Sender:    SenderOperator,
	})

	// Verify AI is disabled
	session, _ = pp.GetSession(ctx, connectResp.SessionID)
	if session.AIActive {
		t.Error("expected AI to be disabled after operator message")
	}
}

func TestHandleGetMessages(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	// Add messages
	for i := 0; i < 5; i++ {
		pp.HandleMessage(ctx, SendMessageRequest{
			SessionID: connectResp.SessionID,
			Content:   "Message",
			Sender:    SenderVisitor,
		})
	}

	response, err := pp.HandleGetMessages(ctx, GetMessagesRequest{
		SessionID: connectResp.SessionID,
		Limit:     3,
	})
	if err != nil {
		t.Fatalf("failed to get messages: %v", err)
	}

	if len(response.Messages) != 3 {
		t.Errorf("expected 3 messages, got %d", len(response.Messages))
	}

	if !response.HasMore {
		t.Error("expected hasMore=true")
	}
}

func TestHandleTyping(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	err := pp.HandleTyping(ctx, TypingRequest{
		SessionID: "sess-123",
		Sender:    SenderVisitor,
		IsTyping:  true,
	})

	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestHandlePresence(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	pp.SetOperatorOnline(true)

	response := pp.HandlePresence(ctx)

	if !response.Online {
		t.Error("expected online=true")
	}
}

func TestHandleReadUpdatesMessageStatus(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	msgResp, _ := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: connectResp.SessionID,
		Content:   "Hello",
		Sender:    SenderVisitor,
	})

	readResp, err := pp.HandleRead(ctx, ReadRequest{
		SessionID:  connectResp.SessionID,
		MessageIDs: []string{msgResp.MessageID},
		Status:     MessageStatusRead,
	})
	if err != nil {
		t.Fatalf("failed to handle read: %v", err)
	}

	if readResp.Updated != 1 {
		t.Errorf("expected 1 updated, got %d", readResp.Updated)
	}

	// Verify message status
	msg, _ := pp.storage.GetMessage(ctx, msgResp.MessageID)
	if msg.Status != MessageStatusRead {
		t.Errorf("expected status=read, got %v", msg.Status)
	}
}

func TestHandleReadSetsDeliveredAt(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	msgResp, _ := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: connectResp.SessionID,
		Content:   "Hello",
		Sender:    SenderVisitor,
	})

	pp.HandleRead(ctx, ReadRequest{
		SessionID:  connectResp.SessionID,
		MessageIDs: []string{msgResp.MessageID},
		Status:     MessageStatusDelivered,
	})

	msg, _ := pp.storage.GetMessage(ctx, msgResp.MessageID)
	if msg.DeliveredAt == nil {
		t.Error("expected deliveredAt to be set")
	}
}

func TestHandleReadSetsReadAt(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	msgResp, _ := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: connectResp.SessionID,
		Content:   "Hello",
		Sender:    SenderVisitor,
	})

	pp.HandleRead(ctx, ReadRequest{
		SessionID:  connectResp.SessionID,
		MessageIDs: []string{msgResp.MessageID},
		Status:     MessageStatusRead,
	})

	msg, _ := pp.storage.GetMessage(ctx, msgResp.MessageID)
	if msg.ReadAt == nil {
		t.Error("expected readAt to be set")
	}
	if msg.DeliveredAt == nil {
		t.Error("expected deliveredAt to also be set when marking as read")
	}
}

func TestHandleIdentify(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	response, err := pp.HandleIdentify(ctx, IdentifyRequest{
		SessionID: connectResp.SessionID,
		Identity: &UserIdentity{
			ID:    "user-456",
			Email: "test@example.com",
		},
	})
	if err != nil {
		t.Fatalf("failed to identify: %v", err)
	}

	if !response.OK {
		t.Error("expected ok=true")
	}

	// Verify identity is stored
	session, _ := pp.GetSession(ctx, connectResp.SessionID)
	if session.Identity.ID != "user-456" {
		t.Errorf("expected identity.id=user-456, got %v", session.Identity.ID)
	}
}

func TestHandleIdentifyRequiresID(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	_, err := pp.HandleIdentify(ctx, IdentifyRequest{
		SessionID: connectResp.SessionID,
		Identity: &UserIdentity{
			Email: "test@example.com",
		},
	})

	if err != ErrIdentityIDRequired {
		t.Errorf("expected ErrIdentityIDRequired, got %v", err)
	}
}

func TestHandleIdentifyRejectsInvalidSession(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	_, err := pp.HandleIdentify(ctx, IdentifyRequest{
		SessionID: "nonexistent",
		Identity: &UserIdentity{
			ID: "user-123",
		},
	})

	if err != ErrSessionNotFound {
		t.Errorf("expected ErrSessionNotFound, got %v", err)
	}
}

func TestOnEventSubscription(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	called := false
	unsubscribe := pp.OnEvent("test_event", func(event CustomEvent, session *Session) {
		called = true
	})

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	pp.HandleCustomEvent(ctx, connectResp.SessionID, CustomEvent{
		Name: "test_event",
	})

	// Give goroutine time to execute
	time.Sleep(10 * time.Millisecond)

	if !called {
		t.Error("expected event handler to be called")
	}

	// Test unsubscribe
	called = false
	unsubscribe()

	pp.HandleCustomEvent(ctx, connectResp.SessionID, CustomEvent{
		Name: "test_event",
	})

	time.Sleep(10 * time.Millisecond)

	if called {
		t.Error("expected handler to not be called after unsubscribe")
	}
}

func TestOnEventWildcard(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	events := []string{}
	var mu sync.Mutex

	pp.OnEvent("*", func(event CustomEvent, session *Session) {
		mu.Lock()
		events = append(events, event.Name)
		mu.Unlock()
	})

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	pp.HandleCustomEvent(ctx, connectResp.SessionID, CustomEvent{Name: "event1"})
	pp.HandleCustomEvent(ctx, connectResp.SessionID, CustomEvent{Name: "event2"})

	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	if len(events) != 2 {
		t.Errorf("expected 2 events, got %d", len(events))
	}
}

func TestWebSocketBroadcast(t *testing.T) {
	pp := New(Config{})

	conn := &MockWebSocketConn{}
	pp.RegisterWebSocket("sess-123", conn)

	pp.BroadcastToSession("sess-123", WebSocketEvent{
		Type: "test",
		Data: map[string]string{"key": "value"},
	})

	messages := conn.GetMessages()
	if len(messages) != 1 {
		t.Errorf("expected 1 message, got %d", len(messages))
	}
}

func TestWebSocketUnregister(t *testing.T) {
	pp := New(Config{})

	conn := &MockWebSocketConn{}
	pp.RegisterWebSocket("sess-123", conn)
	pp.UnregisterWebSocket("sess-123", conn)

	pp.BroadcastToSession("sess-123", WebSocketEvent{
		Type: "test",
		Data: "data",
	})

	messages := conn.GetMessages()
	if len(messages) != 0 {
		t.Error("expected no messages after unregister")
	}
}

func TestSetOperatorOnline(t *testing.T) {
	pp := New(Config{})

	if pp.IsOperatorOnline() {
		t.Error("expected operator to be offline initially")
	}

	pp.SetOperatorOnline(true)

	if !pp.IsOperatorOnline() {
		t.Error("expected operator to be online")
	}
}

func TestSendOperatorMessage(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	msg, err := pp.SendOperatorMessage(ctx, connectResp.SessionID, "Hello from operator", "api", "")
	if err != nil {
		t.Fatalf("failed to send operator message: %v", err)
	}

	if msg.Content != "Hello from operator" {
		t.Errorf("expected content='Hello from operator', got %v", msg.Content)
	}
}

func TestEmitEvent(t *testing.T) {
	pp := New(Config{})

	conn := &MockWebSocketConn{}
	pp.RegisterWebSocket("sess-123", conn)

	pp.EmitEvent("sess-123", "test_event", map[string]interface{}{"key": "value"})

	messages := conn.GetMessages()
	if len(messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(messages))
	}

	// Check event type
	event, ok := messages[0].(WebSocketEvent)
	if !ok {
		t.Fatal("expected WebSocketEvent")
	}

	if event.Type != "event" {
		t.Errorf("expected type=event, got %v", event.Type)
	}
}

func TestBroadcastEvent(t *testing.T) {
	pp := New(Config{})

	conn1 := &MockWebSocketConn{}
	conn2 := &MockWebSocketConn{}

	pp.RegisterWebSocket("sess-1", conn1)
	pp.RegisterWebSocket("sess-2", conn2)

	pp.BroadcastEvent("announcement", map[string]interface{}{"message": "Hello all"})

	if len(conn1.GetMessages()) != 1 {
		t.Error("expected message on conn1")
	}
	if len(conn2.GetMessages()) != 1 {
		t.Error("expected message on conn2")
	}
}

func TestBridgeNotifications(t *testing.T) {
	bridge := NewMockBridge("test")
	pp := New(Config{
		Bridges: []Bridge{bridge},
	})
	ctx := context.Background()

	// New session
	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	time.Sleep(50 * time.Millisecond)

	bridge.mu.Lock()
	if len(bridge.NewSessionCalls) != 1 {
		t.Errorf("expected 1 new session call, got %d", len(bridge.NewSessionCalls))
	}
	bridge.mu.Unlock()

	// Visitor message
	pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: connectResp.SessionID,
		Content:   "Hello",
		Sender:    SenderVisitor,
	})

	time.Sleep(50 * time.Millisecond)

	bridge.mu.Lock()
	if len(bridge.VisitorMsgCalls) != 1 {
		t.Errorf("expected 1 visitor message call, got %d", len(bridge.VisitorMsgCalls))
	}
	bridge.mu.Unlock()
}

func TestVersionCheck(t *testing.T) {
	pp := New(Config{
		MinWidgetVersion:    "0.2.0",
		LatestWidgetVersion: "0.3.0",
	})

	// OK version
	result := pp.CheckWidgetVersion("0.3.0")
	if result.Status != VersionStatusOK {
		t.Errorf("expected OK for current version, got %v", result.Status)
	}

	// Outdated version
	result = pp.CheckWidgetVersion("0.2.5")
	if result.Status != VersionStatusOutdated {
		t.Errorf("expected outdated, got %v", result.Status)
	}

	// Unsupported version
	result = pp.CheckWidgetVersion("0.1.0")
	if result.Status != VersionStatusUnsupported {
		t.Errorf("expected unsupported, got %v", result.Status)
	}
	if result.CanContinue {
		t.Error("expected canContinue=false for unsupported version")
	}
}

func TestParseUserAgent(t *testing.T) {
	tests := []struct {
		ua         string
		deviceType string
		browser    string
		os         string
	}{
		{
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0",
			"desktop", "Chrome", "Windows",
		},
		{
			"Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) Safari/604.1",
			"mobile", "Safari", "iOS",
		},
		{
			"Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) Safari/604.1",
			"tablet", "Safari", "iOS",
		},
	}

	for _, tt := range tests {
		deviceType, browser, os := ParseUserAgent(tt.ua)
		if deviceType != tt.deviceType {
			t.Errorf("UA %s: expected deviceType=%s, got %s", tt.ua, tt.deviceType, deviceType)
		}
		if browser != tt.browser {
			t.Errorf("UA %s: expected browser=%s, got %s", tt.ua, tt.browser, browser)
		}
		if os != tt.os {
			t.Errorf("UA %s: expected os=%s, got %s", tt.ua, tt.os, os)
		}
	}
}

func TestAddBridge(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	bridge := NewMockBridge("dynamic")
	err := pp.AddBridge(ctx, bridge)
	if err != nil {
		t.Fatalf("failed to add bridge: %v", err)
	}

	// Verify bridge is active
	pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	time.Sleep(50 * time.Millisecond)

	bridge.mu.Lock()
	if len(bridge.NewSessionCalls) != 1 {
		t.Error("expected dynamic bridge to receive new session")
	}
	bridge.mu.Unlock()
}

func TestCallbackOnNewSession(t *testing.T) {
	called := false
	pp := New(Config{
		OnNewSession: func(session *Session) {
			called = true
		},
	})
	ctx := context.Background()

	pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	if !called {
		t.Error("expected OnNewSession callback to be called")
	}
}

func TestCallbackOnMessage(t *testing.T) {
	called := false
	pp := New(Config{
		OnMessage: func(message *Message, session *Session) {
			called = true
		},
	})
	ctx := context.Background()

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: connectResp.SessionID,
		Content:   "Hello",
		Sender:    SenderVisitor,
	})

	if !called {
		t.Error("expected OnMessage callback to be called")
	}
}

func TestCallbackOnIdentify(t *testing.T) {
	called := false
	pp := New(Config{
		OnIdentify: func(session *Session) {
			called = true
		},
	})
	ctx := context.Background()

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	pp.HandleIdentify(ctx, IdentifyRequest{
		SessionID: connectResp.SessionID,
		Identity: &UserIdentity{
			ID: "user-123",
		},
	})

	if !called {
		t.Error("expected OnIdentify callback to be called")
	}
}

func TestCallbackOnEvent(t *testing.T) {
	called := false
	pp := New(Config{
		OnEvent: func(event CustomEvent, session *Session) {
			called = true
		},
	})
	ctx := context.Background()

	connectResp, _ := pp.HandleConnect(ctx, ConnectRequest{
		VisitorID: "visitor-123",
	})

	pp.HandleCustomEvent(ctx, connectResp.SessionID, CustomEvent{
		Name: "test_event",
	})

	if !called {
		t.Error("expected OnEvent callback to be called")
	}
}

func TestForwardToWebhook(t *testing.T) {
	requestCh := make(chan *http.Request, 1)
	bodyCh := make(chan []byte, 1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodyCh <- body
		requestCh <- r
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	pp := New(Config{
		WebhookURL:    server.URL,
		WebhookSecret: "test-secret",
	})

	session := &Session{
		ID:        "sess-1",
		VisitorID: "visitor-1",
		Metadata: &SessionMetadata{
			URL: "https://example.com",
		},
	}

	event := CustomEvent{
		Name:      "test_event",
		Data:      map[string]interface{}{"foo": "bar"},
		Timestamp: time.Now(),
		SessionID: session.ID,
	}

	pp.forwardToWebhook(context.Background(), event, session)

	var req *http.Request
	select {
	case req = <-requestCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for webhook request")
	}

	var body []byte
	select {
	case body = <-bodyCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for webhook body")
	}

	if req.Method != http.MethodPost {
		t.Fatalf("expected POST, got %s", req.Method)
	}

	var payload WebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("failed to decode webhook payload: %v", err)
	}

	if payload.Event.Name != "test_event" {
		t.Fatalf("expected event name test_event, got %s", payload.Event.Name)
	}
	if payload.Session.ID != "sess-1" {
		t.Fatalf("expected session id sess-1, got %s", payload.Session.ID)
	}

	signature := req.Header.Get("X-PocketPing-Signature")
	if signature == "" {
		t.Fatal("expected signature header to be set")
	}

	h := hmac.New(sha256.New, []byte("test-secret"))
	h.Write(body)
	expected := "sha256=" + hex.EncodeToString(h.Sum(nil))
	if signature != expected {
		t.Fatalf("expected signature %s, got %s", expected, signature)
	}
}

func TestForwardIdentityToWebhook(t *testing.T) {
	requestCh := make(chan *http.Request, 1)
	bodyCh := make(chan []byte, 1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodyCh <- body
		requestCh <- r
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	pp := New(Config{
		WebhookURL: server.URL,
	})

	session := &Session{
		ID:        "sess-2",
		VisitorID: "visitor-2",
		Identity: &UserIdentity{
			ID:    "user-1",
			Email: "test@example.com",
		},
	}

	pp.forwardIdentityToWebhook(context.Background(), session)

	select {
	case <-requestCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for webhook request")
	}

	var body []byte
	select {
	case body = <-bodyCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for webhook body")
	}

	var payload WebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("failed to decode webhook payload: %v", err)
	}

	if payload.Event.Name != "identify" {
		t.Fatalf("expected identify event, got %s", payload.Event.Name)
	}
	if payload.Event.SessionID != "sess-2" {
		t.Fatalf("expected sessionId sess-2, got %s", payload.Event.SessionID)
	}
	if payload.Session.Identity == nil || payload.Session.Identity.ID != "user-1" {
		t.Fatal("expected identity to be included in webhook payload")
	}
}

func TestWebSocketEventJSON(t *testing.T) {
	event := WebSocketEvent{
		Type: "message",
		Data: Message{
			ID:      "msg-123",
			Content: "Hello",
			Sender:  SenderVisitor,
		},
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if result["type"] != "message" {
		t.Errorf("expected type=message, got %v", result["type"])
	}
}

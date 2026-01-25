package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pocketping/bridge-server/internal/bridges"
	"github.com/pocketping/bridge-server/internal/config"
	"github.com/pocketping/bridge-server/internal/types"
)

// mockBridge implements bridges.Bridge for testing
type mockBridge struct {
	name               string
	newSessionCalled   int
	visitorMsgCalled   int
	operatorMsgCalled  int
	typingCalled       int
	messageReadCalled  int
	customEventCalled  int
	identityUpCalled   int
	aiTakeoverCalled   int
	msgEditedCalled    int
	msgDeletedCalled   int
	lastSession        *types.Session
	lastMessage        *types.Message
	eventCallback      bridges.EventCallback
	returnBridgeIDs    *types.BridgeMessageIDs
	mu                 sync.Mutex
}

func newMockBridge(name string) *mockBridge {
	return &mockBridge{name: name}
}

func (m *mockBridge) Name() string { return m.name }

func (m *mockBridge) SetEventCallback(cb bridges.EventCallback) {
	m.eventCallback = cb
}

func (m *mockBridge) OnNewSession(session *types.Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.newSessionCalled++
	m.lastSession = session
	return nil
}

func (m *mockBridge) OnVisitorMessage(msg *types.Message, session *types.Session, reply *bridges.ReplyContext) (*types.BridgeMessageIDs, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.visitorMsgCalled++
	m.lastMessage = msg
	m.lastSession = session
	return m.returnBridgeIDs, nil
}

func (m *mockBridge) OnOperatorMessage(msg *types.Message, session *types.Session, sourceBridge, operatorName string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.operatorMsgCalled++
	return nil
}

func (m *mockBridge) OnTyping(sessionID string, isTyping bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.typingCalled++
	return nil
}

func (m *mockBridge) OnMessageRead(sessionID string, messageIDs []string, status types.MessageStatus) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messageReadCalled++
	return nil
}

func (m *mockBridge) OnCustomEvent(event *types.CustomEvent, session *types.Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.customEventCalled++
	return nil
}

func (m *mockBridge) OnIdentityUpdate(session *types.Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.identityUpCalled++
	return nil
}

func (m *mockBridge) OnAITakeover(session *types.Session, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.aiTakeoverCalled++
	return nil
}

func (m *mockBridge) OnVisitorMessageEdited(sessionID, messageID, content string, bridgeIDs *types.BridgeMessageIDs) (*types.BridgeMessageIDs, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.msgEditedCalled++
	return m.returnBridgeIDs, nil
}

func (m *mockBridge) OnVisitorMessageDeleted(sessionID, messageID string, bridgeIDs *types.BridgeMessageIDs) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.msgDeletedCalled++
	return nil
}

func setupTestServer(bridgeList []bridges.Bridge, cfg *config.Config) (*Server, *http.ServeMux) {
	if cfg == nil {
		cfg = &config.Config{}
	}
	server := NewServer(bridgeList, cfg)
	mux := http.NewServeMux()
	server.SetupRoutes(mux)
	return server, mux
}

func TestNewServer(t *testing.T) {
	bridge := newMockBridge("test")
	cfg := &config.Config{Port: 3001}

	server := NewServer([]bridges.Bridge{bridge}, cfg)

	if server == nil {
		t.Fatal("expected server to be created")
	}
	if len(server.bridges) != 1 {
		t.Errorf("expected 1 bridge, got %d", len(server.bridges))
	}
}

func TestServer_handleHealth(t *testing.T) {
	bridge1 := newMockBridge("telegram")
	bridge2 := newMockBridge("discord")
	_, mux := setupTestServer([]bridges.Bridge{bridge1, bridge2}, nil)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	json.NewDecoder(w.Body).Decode(&response)

	if response["status"] != "ok" {
		t.Errorf("expected status 'ok', got %v", response["status"])
	}

	bridges := response["bridges"].([]interface{})
	if len(bridges) != 2 {
		t.Errorf("expected 2 bridges, got %d", len(bridges))
	}
}

func TestServer_authMiddleware(t *testing.T) {
	bridge := newMockBridge("test")
	cfg := &config.Config{APIKey: "secret123"}
	_, mux := setupTestServer([]bridges.Bridge{bridge}, cfg)

	t.Run("rejects missing auth", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/sessions", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		mux.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Errorf("expected 401, got %d", w.Code)
		}
	})

	t.Run("rejects wrong auth", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/sessions", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer wrong")
		w := httptest.NewRecorder()

		mux.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Errorf("expected 401, got %d", w.Code)
		}
	})

	t.Run("accepts correct auth", func(t *testing.T) {
		body := `{"id":"s1","visitorId":"v1"}`
		req := httptest.NewRequest("POST", "/api/sessions", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer secret123")
		w := httptest.NewRecorder()

		mux.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", w.Code)
		}
	})
}

func TestServer_handleNewSession(t *testing.T) {
	bridge := newMockBridge("test")
	_, mux := setupTestServer([]bridges.Bridge{bridge}, nil)

	body := `{"id":"session123","visitorId":"visitor456"}`
	req := httptest.NewRequest("POST", "/api/sessions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	if bridge.newSessionCalled != 1 {
		t.Errorf("expected OnNewSession to be called once, called %d times", bridge.newSessionCalled)
	}
}

func TestServer_handleMessage(t *testing.T) {
	bridge := newMockBridge("test")
	bridge.returnBridgeIDs = &types.BridgeMessageIDs{TelegramMessageID: 123}
	_, mux := setupTestServer([]bridges.Bridge{bridge}, nil)

	body := `{
		"message": {"id":"msg1","content":"Hello","sessionId":"s1"},
		"session": {"id":"s1","visitorId":"v1"}
	}`
	req := httptest.NewRequest("POST", "/api/messages", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	if bridge.visitorMsgCalled != 1 {
		t.Errorf("expected OnVisitorMessage to be called once")
	}
	if bridge.lastMessage.Content != "Hello" {
		t.Errorf("message content mismatch")
	}
}

func TestServer_handleOperatorStatus(t *testing.T) {
	bridge := newMockBridge("test")
	_, mux := setupTestServer([]bridges.Bridge{bridge}, nil)

	body := `{"online":true}`
	req := httptest.NewRequest("POST", "/api/operator/status", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestServer_handleCustomEvent(t *testing.T) {
	bridge := newMockBridge("test")
	_, mux := setupTestServer([]bridges.Bridge{bridge}, nil)

	body := `{
		"event": {"name":"button_click","data":{"buttonId":"submit"}},
		"session": {"id":"s1","visitorId":"v1"}
	}`
	req := httptest.NewRequest("POST", "/api/custom-events", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	if bridge.customEventCalled != 1 {
		t.Errorf("expected OnCustomEvent to be called once")
	}
}

func TestServer_handleEvents(t *testing.T) {
	bridge := newMockBridge("test")
	_, mux := setupTestServer([]bridges.Bridge{bridge}, nil)

	tests := []struct {
		name          string
		body          string
		expectedCalls func() int
	}{
		{
			name: "new_session",
			body: `{"type":"new_session","session":{"id":"s1","visitorId":"v1"}}`,
			expectedCalls: func() int {
				return bridge.newSessionCalled
			},
		},
		{
			name: "visitor_message",
			body: `{"type":"visitor_message","message":{"id":"m1","content":"Hi"},"session":{"id":"s1"}}`,
			expectedCalls: func() int {
				return bridge.visitorMsgCalled
			},
		},
		{
			name: "ai_takeover",
			body: `{"type":"ai_takeover","session":{"id":"s1"},"reason":"timeout"}`,
			expectedCalls: func() int {
				return bridge.aiTakeoverCalled
			},
		},
		{
			name: "message_read",
			body: `{"type":"message_read","sessionId":"s1","messageIds":["m1","m2"],"status":"read"}`,
			expectedCalls: func() int {
				return bridge.messageReadCalled
			},
		},
		{
			name: "custom_event",
			body: `{"type":"custom_event","event":{"name":"test"},"session":{"id":"s1"}}`,
			expectedCalls: func() int {
				return bridge.customEventCalled
			},
		},
		{
			name: "identity_update",
			body: `{"type":"identity_update","session":{"id":"s1","identity":{"id":"u1"}}}`,
			expectedCalls: func() int {
				return bridge.identityUpCalled
			},
		},
		{
			name: "visitor_message_edited",
			body: `{"type":"visitor_message_edited","sessionId":"s1","messageId":"m1","content":"edited"}`,
			expectedCalls: func() int {
				return bridge.msgEditedCalled
			},
		},
		{
			name: "visitor_message_deleted",
			body: `{"type":"visitor_message_deleted","sessionId":"s1","messageId":"m1"}`,
			expectedCalls: func() int {
				return bridge.msgDeletedCalled
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/events", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			mux.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("expected 200, got %d", w.Code)
			}
		})
	}
}

func TestServer_handleEvents_UnknownType(t *testing.T) {
	bridge := newMockBridge("test")
	_, mux := setupTestServer([]bridges.Bridge{bridge}, nil)

	body := `{"type":"unknown_event"}`
	req := httptest.NewRequest("POST", "/api/events", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for unknown event type, got %d", w.Code)
	}
}

func TestServer_handleEvents_InvalidJSON(t *testing.T) {
	bridge := newMockBridge("test")
	_, mux := setupTestServer([]bridges.Bridge{bridge}, nil)

	body := `{invalid json}`
	req := httptest.NewRequest("POST", "/api/events", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid JSON, got %d", w.Code)
	}
}

func TestServer_handleSSEStream(t *testing.T) {
	bridge := newMockBridge("test")
	server, mux := setupTestServer([]bridges.Bridge{bridge}, nil)

	// Create SSE request with cancel context
	req := httptest.NewRequest("GET", "/api/events/stream", nil)
	w := httptest.NewRecorder()

	// Run SSE handler in goroutine
	done := make(chan struct{})
	go func() {
		mux.ServeHTTP(w, req)
		close(done)
	}()

	// Give time for SSE to initialize
	time.Sleep(50 * time.Millisecond)

	// Emit an event
	event := &types.OperatorMessageEvent{
		Type:      "operator_message",
		SessionID: "s1",
		Content:   "Hello from operator",
	}
	server.EmitEvent(event)

	// Wait a bit and check headers
	time.Sleep(50 * time.Millisecond)

	// Headers should be set
	contentType := w.Header().Get("Content-Type")
	if contentType != "text/event-stream" {
		t.Errorf("expected Content-Type 'text/event-stream', got %q", contentType)
	}
}

func TestServer_EmitEvent(t *testing.T) {
	bridge := newMockBridge("test")
	server, _ := setupTestServer([]bridges.Bridge{bridge}, nil)

	// Create an event listener
	eventChan := make(chan types.OutgoingEvent, 10)
	server.eventListeners.Store(eventChan, struct{}{})
	defer server.eventListeners.Delete(eventChan)

	// Emit event
	event := &types.OperatorMessageEvent{
		Type:      "operator_message",
		SessionID: "s1",
		Content:   "Test",
	}
	server.EmitEvent(event)

	// Should receive the event
	select {
	case received := <-eventChan:
		if received.EventType() != "operator_message" {
			t.Errorf("expected operator_message event")
		}
	case <-time.After(time.Second):
		t.Error("timeout waiting for event")
	}
}

func TestServer_EmitEvent_WithWebhook(t *testing.T) {
	var webhookCalled sync.WaitGroup
	webhookCalled.Add(1)
	webhookServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		webhookCalled.Done()
		w.WriteHeader(http.StatusOK)
	}))
	defer webhookServer.Close()

	bridge := newMockBridge("test")
	cfg := &config.Config{
		BackendWebhookURL: webhookServer.URL,
	}
	server, _ := setupTestServer([]bridges.Bridge{bridge}, cfg)

	event := &types.OperatorMessageEvent{
		Type:      "operator_message",
		SessionID: "s1",
	}
	server.EmitEvent(event)

	// Wait for async webhook call with timeout
	done := make(chan struct{})
	go func() {
		webhookCalled.Wait()
		close(done)
	}()

	select {
	case <-done:
		// Webhook was called
	case <-time.After(time.Second):
		t.Error("expected webhook to be called")
	}
}

func TestServer_BridgeIDs(t *testing.T) {
	bridge := newMockBridge("test")
	server, _ := setupTestServer([]bridges.Bridge{bridge}, nil)

	t.Run("save and get bridge IDs", func(t *testing.T) {
		ids := &types.BridgeMessageIDs{
			TelegramMessageID: 123,
			DiscordMessageID:  "discord123",
		}
		server.saveBridgeIDs("msg1", ids)

		retrieved := server.getBridgeIDs("msg1")
		if retrieved == nil {
			t.Fatal("expected bridge IDs to be retrieved")
		}
		if retrieved.TelegramMessageID != 123 {
			t.Errorf("TelegramMessageID mismatch")
		}
		if retrieved.DiscordMessageID != "discord123" {
			t.Errorf("DiscordMessageID mismatch")
		}
	})

	t.Run("merge bridge IDs", func(t *testing.T) {
		ids1 := &types.BridgeMessageIDs{TelegramMessageID: 100}
		server.saveBridgeIDs("msg2", ids1)

		ids2 := &types.BridgeMessageIDs{SlackMessageTS: "slack.ts"}
		server.saveBridgeIDs("msg2", ids2)

		retrieved := server.getBridgeIDs("msg2")
		if retrieved.TelegramMessageID != 100 {
			t.Errorf("TelegramMessageID should be preserved")
		}
		if retrieved.SlackMessageTS != "slack.ts" {
			t.Errorf("SlackMessageTS should be merged")
		}
	})

	t.Run("get non-existent returns nil", func(t *testing.T) {
		retrieved := server.getBridgeIDs("nonexistent")
		if retrieved != nil {
			t.Errorf("expected nil for non-existent ID")
		}
	})
}

func TestServer_Messages(t *testing.T) {
	bridge := newMockBridge("test")
	server, _ := setupTestServer([]bridges.Bridge{bridge}, nil)

	t.Run("save and get message", func(t *testing.T) {
		msg := &types.Message{
			ID:      "msg1",
			Content: "Hello",
			Sender:  types.SenderVisitor,
		}
		server.saveMessage(msg)

		retrieved := server.getMessage("msg1")
		if retrieved == nil {
			t.Fatal("expected message to be retrieved")
		}
		if retrieved.Content != "Hello" {
			t.Errorf("content mismatch")
		}
	})

	t.Run("update message", func(t *testing.T) {
		msg := &types.Message{
			ID:      "msg2",
			Content: "Original",
		}
		server.saveMessage(msg)

		now := time.Now()
		server.updateMessage("msg2", func(m *types.Message) {
			m.Content = "Updated"
			m.EditedAt = &now
		})

		retrieved := server.getMessage("msg2")
		if retrieved.Content != "Updated" {
			t.Errorf("content should be updated")
		}
		if retrieved.EditedAt == nil {
			t.Errorf("EditedAt should be set")
		}
	})

	t.Run("save nil message is no-op", func(t *testing.T) {
		server.saveMessage(nil)
		// Should not panic
	})

	t.Run("update nil callback is no-op", func(t *testing.T) {
		server.updateMessage("msg1", nil)
		// Should not panic
	})
}

func TestServer_buildReplyQuote(t *testing.T) {
	bridge := newMockBridge("test")
	server, _ := setupTestServer([]bridges.Bridge{bridge}, nil)

	t.Run("builds quote for visitor message", func(t *testing.T) {
		msg := &types.Message{
			ID:      "msg1",
			Content: "Hello from visitor",
			Sender:  types.SenderVisitor,
		}
		server.saveMessage(msg)

		quote := server.buildReplyQuote("msg1")
		if quote != "> *Visitor* — Hello from visitor" {
			t.Errorf("quote mismatch: %q", quote)
		}
	})

	t.Run("builds quote for operator message", func(t *testing.T) {
		msg := &types.Message{
			ID:      "msg2",
			Content: "Hello from support",
			Sender:  types.SenderOperator,
		}
		server.saveMessage(msg)

		quote := server.buildReplyQuote("msg2")
		if quote != "> *Support* — Hello from support" {
			t.Errorf("quote mismatch: %q", quote)
		}
	})

	t.Run("builds quote for AI message", func(t *testing.T) {
		msg := &types.Message{
			ID:      "msg3",
			Content: "Hello from AI",
			Sender:  types.SenderAI,
		}
		server.saveMessage(msg)

		quote := server.buildReplyQuote("msg3")
		if quote != "> *AI* — Hello from AI" {
			t.Errorf("quote mismatch: %q", quote)
		}
	})

	t.Run("truncates long messages", func(t *testing.T) {
		longContent := strings.Repeat("a", 200)
		msg := &types.Message{
			ID:      "msg4",
			Content: longContent,
			Sender:  types.SenderVisitor,
		}
		server.saveMessage(msg)

		quote := server.buildReplyQuote("msg4")
		if len(quote) > 160 {
			t.Errorf("quote should be truncated")
		}
		if !strings.HasSuffix(quote, "...") {
			t.Errorf("truncated quote should end with ...")
		}
	})

	t.Run("shows deleted message", func(t *testing.T) {
		now := time.Now()
		msg := &types.Message{
			ID:        "msg5",
			Content:   "Original content",
			Sender:    types.SenderVisitor,
			DeletedAt: &now,
		}
		server.saveMessage(msg)

		quote := server.buildReplyQuote("msg5")
		if !strings.Contains(quote, "Message deleted") {
			t.Errorf("should show 'Message deleted' for deleted messages")
		}
	})

	t.Run("returns empty for non-existent", func(t *testing.T) {
		quote := server.buildReplyQuote("nonexistent")
		if quote != "" {
			t.Errorf("expected empty quote for non-existent message")
		}
	})
}

func TestServer_ProcessorsWithReply(t *testing.T) {
	bridge := newMockBridge("test")
	bridge.returnBridgeIDs = &types.BridgeMessageIDs{TelegramMessageID: 100}
	server, _ := setupTestServer([]bridges.Bridge{bridge}, nil)

	// Save original message
	originalMsg := &types.Message{
		ID:      "original",
		Content: "Original message",
		Sender:  types.SenderVisitor,
	}
	server.saveMessage(originalMsg)
	server.saveBridgeIDs("original", &types.BridgeMessageIDs{TelegramMessageID: 50})

	// Process reply message
	event := &types.VisitorMessageEvent{
		Type: "visitor_message",
		Message: &types.Message{
			ID:      "reply",
			Content: "This is a reply",
			ReplyTo: "original",
		},
		Session: &types.Session{ID: "s1"},
	}

	server.processVisitorMessage(event)

	if bridge.visitorMsgCalled != 1 {
		t.Errorf("expected OnVisitorMessage to be called")
	}
}

func TestWriteJSON(t *testing.T) {
	w := httptest.NewRecorder()
	data := map[string]string{"key": "value"}

	writeJSON(w, data)

	if w.Header().Get("Content-Type") != "application/json" {
		t.Errorf("expected Content-Type application/json")
	}

	var result map[string]string
	json.NewDecoder(w.Body).Decode(&result)
	if result["key"] != "value" {
		t.Errorf("data mismatch")
	}
}

func TestWriteOK(t *testing.T) {
	w := httptest.NewRecorder()

	writeOK(w)

	if w.Header().Get("Content-Type") != "application/json" {
		t.Errorf("expected Content-Type application/json")
	}

	body, _ := io.ReadAll(w.Body)
	if string(body) != `{"ok":true}` {
		t.Errorf("expected ok response, got %q", string(body))
	}
}

func TestServer_InvalidJSONHandlers(t *testing.T) {
	bridge := newMockBridge("test")
	_, mux := setupTestServer([]bridges.Bridge{bridge}, nil)

	endpoints := []struct {
		method string
		path   string
	}{
		{"POST", "/api/sessions"},
		{"POST", "/api/messages"},
		{"POST", "/api/operator/status"},
		{"POST", "/api/custom-events"},
	}

	for _, ep := range endpoints {
		t.Run(ep.path, func(t *testing.T) {
			req := httptest.NewRequest(ep.method, ep.path, strings.NewReader(`{invalid}`))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			mux.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("expected 400 for invalid JSON at %s, got %d", ep.path, w.Code)
			}
		})
	}
}

func TestServer_MultipleBridges(t *testing.T) {
	bridge1 := newMockBridge("telegram")
	bridge2 := newMockBridge("discord")
	bridge3 := newMockBridge("slack")
	_, mux := setupTestServer([]bridges.Bridge{bridge1, bridge2, bridge3}, nil)

	body := `{"id":"s1","visitorId":"v1"}`
	req := httptest.NewRequest("POST", "/api/sessions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	// All bridges should be notified
	if bridge1.newSessionCalled != 1 {
		t.Errorf("telegram bridge not called")
	}
	if bridge2.newSessionCalled != 1 {
		t.Errorf("discord bridge not called")
	}
	if bridge3.newSessionCalled != 1 {
		t.Errorf("slack bridge not called")
	}
}

func TestServer_EventsWebhook(t *testing.T) {
	var receivedBody map[string]interface{}
	var mu sync.Mutex
	var webhookCalled sync.WaitGroup
	webhookCalled.Add(1)

	webhookServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		json.NewDecoder(r.Body).Decode(&receivedBody)
		mu.Unlock()

		// Check signature header if secret is set
		sig := r.Header.Get("X-PocketPing-Signature")
		if sig != "" && !strings.HasPrefix(sig, "sha256=") {
			t.Errorf("expected sha256 prefix in signature")
		}

		w.WriteHeader(http.StatusOK)
		webhookCalled.Done()
	}))
	defer webhookServer.Close()

	bridge := newMockBridge("test")
	cfg := &config.Config{
		EventsWebhookURL:    webhookServer.URL,
		EventsWebhookSecret: "secret123",
	}
	server, mux := setupTestServer([]bridges.Bridge{bridge}, cfg)
	_ = server

	body := `{
		"type":"custom_event",
		"event":{"name":"purchase","data":{"amount":99}},
		"session":{"id":"s1","visitorId":"v1"}
	}`
	req := httptest.NewRequest("POST", "/api/events", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	// Wait for async webhook with timeout
	done := make(chan struct{})
	go func() {
		webhookCalled.Wait()
		close(done)
	}()

	select {
	case <-done:
		// Webhook was called
	case <-time.After(2 * time.Second):
		t.Error("timeout waiting for webhook")
		return
	}

	mu.Lock()
	defer mu.Unlock()
	if receivedBody == nil {
		t.Error("webhook should have received the event")
	}
}

func TestServer_ConcurrentRequests(t *testing.T) {
	bridge := newMockBridge("test")
	_, mux := setupTestServer([]bridges.Bridge{bridge}, nil)

	var wg sync.WaitGroup
	numRequests := 100

	for i := 0; i < numRequests; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()

			body := bytes.NewReader([]byte(`{"id":"s1","visitorId":"v1"}`))
			req := httptest.NewRequest("POST", "/api/sessions", body)
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			mux.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("request %d failed with status %d", n, w.Code)
			}
		}(i)
	}

	wg.Wait()

	if bridge.newSessionCalled != numRequests {
		t.Errorf("expected %d calls, got %d", numRequests, bridge.newSessionCalled)
	}
}

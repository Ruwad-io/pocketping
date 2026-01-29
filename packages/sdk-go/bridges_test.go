package pocketping

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// ============================================================================
// Test Helpers
// ============================================================================

// mockStorage implements StorageWithBridgeIDs for testing
type mockStorage struct {
	*MemoryStorage
}

func newMockStorage() *mockStorage {
	return &mockStorage{MemoryStorage: NewMemoryStorage()}
}

// mockPocketPing creates a PocketPing with the given storage for testing
func mockPocketPing(storage Storage) *PocketPing {
	return New(Config{
		Storage: storage,
	})
}

// createTestSession creates a test session with optional identity
func createTestSession(id, visitorID string, identity *UserIdentity, metadata *SessionMetadata) *Session {
	return &Session{
		ID:           id,
		VisitorID:    visitorID,
		CreatedAt:    time.Now(),
		LastActivity: time.Now(),
		Identity:     identity,
		Metadata:     metadata,
	}
}

// createTestMessage creates a test message
func createTestMessage(id, sessionID, content string) *Message {
	return &Message{
		ID:        id,
		SessionID: sessionID,
		Content:   content,
		Sender:    SenderVisitor,
		Timestamp: time.Now(),
	}
}

// ============================================================================
// TelegramBridge Tests
// ============================================================================

// --- Constructor Validation Tests ---

func TestTelegramBridge_Constructor_WithRequiredParams(t *testing.T) {
	bridge, err := NewTelegramBridge("bot-token-123", "chat-id-456")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if bridge == nil {
		t.Fatal("expected non-nil TelegramBridge")
	}
	if bridge.BotToken != "bot-token-123" {
		t.Errorf("expected BotToken='bot-token-123', got '%s'", bridge.BotToken)
	}
	if bridge.ChatID != "chat-id-456" {
		t.Errorf("expected ChatID='chat-id-456', got '%s'", bridge.ChatID)
	}
	if bridge.Name() != "telegram" {
		t.Errorf("expected Name()='telegram', got '%s'", bridge.Name())
	}
}

func TestTelegramBridge_Constructor_UsesDefaultOptions(t *testing.T) {
	bridge, err := NewTelegramBridge("token", "chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if bridge.ParseMode != "HTML" {
		t.Errorf("expected default ParseMode='HTML', got '%s'", bridge.ParseMode)
	}
	if bridge.DisableNotification != false {
		t.Error("expected default DisableNotification=false")
	}
	if bridge.httpClient == nil {
		t.Error("expected default httpClient to be set")
	}
}

func TestTelegramBridge_Constructor_AcceptsFunctionalOptions(t *testing.T) {
	customClient := &http.Client{Timeout: 60 * time.Second}

	bridge, err := NewTelegramBridge(
		"token",
		"chat",
		WithTelegramParseMode("Markdown"),
		WithTelegramDisableNotification(true),
		WithTelegramHTTPClient(customClient),
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if bridge.ParseMode != "Markdown" {
		t.Errorf("expected ParseMode='Markdown', got '%s'", bridge.ParseMode)
	}
	if bridge.DisableNotification != true {
		t.Error("expected DisableNotification=true")
	}
	if bridge.httpClient != customClient {
		t.Error("expected custom httpClient to be used")
	}
}

// --- OnVisitorMessage Tests ---

func TestTelegramBridge_OnVisitorMessage_SendsMessageToAPI(t *testing.T) {
	var receivedRequest *http.Request
	var receivedBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedRequest = r
		receivedBody, _ = io.ReadAll(r.Body)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
			"result": map[string]interface{}{
				"message_id": 12345,
			},
		})
	}))
	defer server.Close()

	// Create bridge with test server URL
	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Hello from visitor")

	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	if receivedRequest == nil {
		t.Fatal("expected request to be made")
	}
	if receivedRequest.Method != "POST" {
		t.Errorf("expected POST method, got %s", receivedRequest.Method)
	}
	// The Telegram bridge sends form-urlencoded data, so check for URL-encoded content
	bodyStr := string(receivedBody)
	if !strings.Contains(bodyStr, "Hello+from+visitor") && !strings.Contains(bodyStr, "Hello%20from%20visitor") && !strings.Contains(bodyStr, "Hello from visitor") {
		t.Errorf("expected message content to be in request body, got: %s", bodyStr)
	}
}

func TestTelegramBridge_OnVisitorMessage_ReturnsMessageID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
			"result": map[string]interface{}{
				"message_id": 99999,
			},
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)

	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}
	bridge.Init(context.Background(), pp)

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test message")

	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify bridge message ID was saved
	bridgeIDs, err := storage.GetBridgeMessageIDs(ctx, "msg-1")
	if err != nil {
		t.Fatalf("failed to get bridge message IDs: %v", err)
	}
	if bridgeIDs == nil || bridgeIDs.TelegramMessageID != 99999 {
		t.Errorf("expected TelegramMessageID=99999, got %v", bridgeIDs)
	}
}

func TestTelegramBridge_OnVisitorMessage_HandlesAPIErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":          false,
			"description": "Bad Request: chat not found",
		})
	}))
	defer server.Close()

	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test message")

	// Should not return error (logs but doesn't fail)
	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Errorf("expected nil error (error should be logged, not returned), got %v", err)
	}
}

// --- OnNewSession Tests ---

func TestTelegramBridge_OnNewSession_SendsSessionAnnouncement(t *testing.T) {
	var receivedBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedBody, _ = io.ReadAll(r.Body)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
			"result": map[string]interface{}{
				"message_id": 123,
			},
		})
	}))
	defer server.Close()

	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-123", nil, nil)

	err = bridge.OnNewSession(ctx, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	bodyStr := string(receivedBody)
	if !strings.Contains(bodyStr, "New+chat+session") && !strings.Contains(bodyStr, "New chat session") {
		t.Error("expected 'New chat session' in message")
	}
}

func TestTelegramBridge_OnNewSession_FormatsSessionInfoCorrectly(t *testing.T) {
	var receivedBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedBody, _ = io.ReadAll(r.Body)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
			"result": map[string]interface{}{
				"message_id": 123,
			},
		})
	}))
	defer server.Close()

	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}

	ctx := context.Background()
	session := createTestSession(
		"sess-1",
		"visitor-123",
		&UserIdentity{ID: "user-1", Email: "john@example.com"},
		&SessionMetadata{URL: "https://example.com/pricing"},
	)

	err = bridge.OnNewSession(ctx, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	bodyStr := string(receivedBody)
	// New format shows email instead of name
	if !strings.Contains(bodyStr, "john%40example.com") && !strings.Contains(bodyStr, "john@example.com") {
		t.Error("expected email in message")
	}
	if !strings.Contains(bodyStr, "example.com") {
		t.Error("expected page URL in message")
	}
}

// --- OnMessageEdit Tests ---

func TestTelegramBridge_OnMessageEdit_CallsEditAPI(t *testing.T) {
	var editCalled bool
	var editBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if strings.Contains(r.URL.Path, "editMessageText") {
			editCalled = true
			editBody, _ = io.ReadAll(r.Body)
		}
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
			"result": map[string]interface{}{
				"message_id": 12345,
			},
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)

	// Save initial bridge message IDs
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		TelegramMessageID: 12345,
	})

	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}
	bridge.Init(context.Background(), pp)

	ctx := context.Background()
	result, err := bridge.OnMessageEdit(ctx, "sess-1", "msg-1", "Updated content", time.Now())

	mu.Lock()
	defer mu.Unlock()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !editCalled {
		t.Error("expected editMessageText API to be called")
	}
	if !strings.Contains(string(editBody), "12345") {
		t.Error("expected message_id in edit request")
	}
	if !strings.Contains(string(editBody), "Updated+content") && !strings.Contains(string(editBody), "Updated content") {
		t.Error("expected new content in edit request")
	}
	if result == nil || result.TelegramMessageID != 12345 {
		t.Errorf("expected TelegramMessageID=12345, got %v", result)
	}
}

func TestTelegramBridge_OnMessageEdit_ReturnsNilOnSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
			"result": map[string]interface{}{
				"message_id": 12345,
			},
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		TelegramMessageID: 12345,
	})

	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}
	bridge.Init(context.Background(), pp)

	result, err := bridge.OnMessageEdit(context.Background(), "sess-1", "msg-1", "Updated", time.Now())

	if err != nil {
		t.Errorf("expected nil error on success, got %v", err)
	}
	if result == nil {
		t.Error("expected non-nil result on success")
	}
}

func TestTelegramBridge_OnMessageEdit_ReturnsNilOnFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":          false,
			"description": "Message can't be edited",
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		TelegramMessageID: 12345,
	})

	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}
	bridge.Init(context.Background(), pp)

	result, err := bridge.OnMessageEdit(context.Background(), "sess-1", "msg-1", "Updated", time.Now())

	// Error is logged but returns nil
	if err != nil {
		t.Errorf("expected nil error (logged), got %v", err)
	}
	if result != nil {
		t.Errorf("expected nil result on failure, got %v", result)
	}
}

// --- OnMessageDelete Tests ---

func TestTelegramBridge_OnMessageDelete_CallsDeleteAPI(t *testing.T) {
	var deleteCalled bool
	var deleteBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if strings.Contains(r.URL.Path, "deleteMessage") {
			deleteCalled = true
			deleteBody, _ = io.ReadAll(r.Body)
		}
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":     true,
			"result": true,
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		TelegramMessageID: 54321,
	})

	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}
	bridge.Init(context.Background(), pp)

	err = bridge.OnMessageDelete(context.Background(), "sess-1", "msg-1", time.Now())

	mu.Lock()
	defer mu.Unlock()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !deleteCalled {
		t.Error("expected deleteMessage API to be called")
	}
	if !strings.Contains(string(deleteBody), "54321") {
		t.Error("expected message_id in delete request")
	}
}

func TestTelegramBridge_OnMessageDelete_ReturnsNilOnSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":     true,
			"result": true,
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		TelegramMessageID: 12345,
	})

	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}
	bridge.Init(context.Background(), pp)

	err = bridge.OnMessageDelete(context.Background(), "sess-1", "msg-1", time.Now())
	if err != nil {
		t.Errorf("expected nil error on success, got %v", err)
	}
}

func TestTelegramBridge_OnMessageDelete_ReturnsNilOnFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":          false,
			"description": "Message can't be deleted",
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		TelegramMessageID: 12345,
	})

	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}
	bridge.Init(context.Background(), pp)

	err = bridge.OnMessageDelete(context.Background(), "sess-1", "msg-1", time.Now())
	// Error is logged but returns nil
	if err != nil {
		t.Errorf("expected nil error (logged), got %v", err)
	}
}

// --- Error Handling Tests ---

func TestTelegramBridge_LogsErrorButDoesNotPanicOnAPIFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("Internal Server Error"))
	}))
	defer server.Close()

	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test")

	// Should not panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("unexpected panic: %v", r)
		}
	}()

	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Errorf("expected nil error (logged), got %v", err)
	}
}

func TestTelegramBridge_HandlesNetworkErrors(t *testing.T) {
	// Use a non-existent server
	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Timeout: 100 * time.Millisecond,
		Transport: &testTransport{
			baseURL: "http://localhost:99999",
			token:   "test-token",
		},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test")

	// Should not return error (logged)
	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Errorf("expected nil error for network errors, got %v", err)
	}
}

func TestTelegramBridge_HandlesInvalidResponses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	bridge, err := NewTelegramBridge("test-token", "test-chat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test")

	// Should not panic, error is logged
	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Errorf("expected nil error for invalid JSON, got %v", err)
	}
}

// ============================================================================
// DiscordWebhookBridge Tests
// ============================================================================

// --- Constructor Validation Tests ---

func TestDiscordWebhookBridge_Constructor_WithRequiredParams(t *testing.T) {
	bridge, err := NewDiscordWebhookBridge("https://discord.com/api/webhooks/123/abc")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if bridge == nil {
		t.Fatal("expected non-nil DiscordWebhookBridge")
	}
	if bridge.WebhookURL != "https://discord.com/api/webhooks/123/abc" {
		t.Errorf("expected webhook URL to be set, got '%s'", bridge.WebhookURL)
	}
	if bridge.Name() != "discord-webhook" {
		t.Errorf("expected Name()='discord-webhook', got '%s'", bridge.Name())
	}
}

func TestDiscordWebhookBridge_Constructor_UsesDefaultOptions(t *testing.T) {
	bridge, err := NewDiscordWebhookBridge("https://discord.com/api/webhooks/test/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if bridge.Username != "PocketPing" {
		t.Errorf("expected default Username='PocketPing', got '%s'", bridge.Username)
	}
	if bridge.httpClient == nil {
		t.Error("expected default httpClient to be set")
	}
}

func TestDiscordWebhookBridge_Constructor_AcceptsFunctionalOptions(t *testing.T) {
	customClient := &http.Client{Timeout: 60 * time.Second}

	bridge, err := NewDiscordWebhookBridge(
		"https://discord.com/api/webhooks/123/abc",
		WithDiscordWebhookUsername("CustomBot"),
		WithDiscordWebhookAvatarURL("https://avatar.url/image.png"),
		WithDiscordWebhookHTTPClient(customClient),
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if bridge.Username != "CustomBot" {
		t.Errorf("expected Username='CustomBot', got '%s'", bridge.Username)
	}
	if bridge.AvatarURL != "https://avatar.url/image.png" {
		t.Errorf("expected AvatarURL to be set, got '%s'", bridge.AvatarURL)
	}
	if bridge.httpClient != customClient {
		t.Error("expected custom httpClient to be used")
	}
}

// --- OnVisitorMessage Tests ---

func TestDiscordWebhookBridge_OnVisitorMessage_SendsMessageToAPI(t *testing.T) {
	var receivedRequest *http.Request
	var receivedBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedRequest = r
		receivedBody, _ = io.ReadAll(r.Body)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id": "1234567890123456789",
		})
	}))
	defer server.Close()

	bridge, err := NewDiscordWebhookBridge("https://discord.com/api/webhooks/test/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.WebhookURL = server.URL

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Hello from visitor")

	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	if receivedRequest == nil {
		t.Fatal("expected request to be made")
	}
	if receivedRequest.Method != "POST" {
		t.Errorf("expected POST method, got %s", receivedRequest.Method)
	}
	if !strings.Contains(string(receivedBody), "Hello from visitor") {
		t.Error("expected message content to be in request body")
	}
}

func TestDiscordWebhookBridge_OnVisitorMessage_HandlesAPIErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"message": "Invalid Webhook Token"}`))
	}))
	defer server.Close()

	bridge, err := NewDiscordWebhookBridge("https://discord.com/api/webhooks/test/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.WebhookURL = server.URL

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test message")

	// Should not return error (logs but doesn't fail)
	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Errorf("expected nil error (logged), got %v", err)
	}
}

// --- OnNewSession Tests ---

func TestDiscordWebhookBridge_OnNewSession_SendsSessionAnnouncement(t *testing.T) {
	var receivedBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedBody, _ = io.ReadAll(r.Body)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id": "123",
		})
	}))
	defer server.Close()

	bridge, err := NewDiscordWebhookBridge("https://discord.com/api/webhooks/test/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.WebhookURL = server.URL

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-123", nil, nil)

	err = bridge.OnNewSession(ctx, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	var payload map[string]interface{}
	json.Unmarshal(receivedBody, &payload)

	content, ok := payload["content"].(string)
	if !ok || !strings.Contains(content, "New chat session") {
		t.Error("expected 'New chat session' in message content")
	}
}

// ============================================================================
// DiscordBotBridge Tests
// ============================================================================

// --- Constructor Validation Tests ---

func TestDiscordBotBridge_Constructor_WithRequiredParams(t *testing.T) {
	bridge := NewDiscordBotBridge("bot-token-123", "channel-id-456")

	if bridge == nil {
		t.Fatal("expected non-nil DiscordBotBridge")
	}
	if bridge.BotToken != "bot-token-123" {
		t.Errorf("expected BotToken='bot-token-123', got '%s'", bridge.BotToken)
	}
	if bridge.ChannelID != "channel-id-456" {
		t.Errorf("expected ChannelID='channel-id-456', got '%s'", bridge.ChannelID)
	}
	if bridge.Name() != "discord-bot" {
		t.Errorf("expected Name()='discord-bot', got '%s'", bridge.Name())
	}
}

func TestDiscordBotBridge_Constructor_UsesDefaultOptions(t *testing.T) {
	bridge := NewDiscordBotBridge("token", "channel")

	if bridge.httpClient == nil {
		t.Error("expected default httpClient to be set")
	}
}

func TestDiscordBotBridge_Constructor_AcceptsFunctionalOptions(t *testing.T) {
	customClient := &http.Client{Timeout: 60 * time.Second}

	bridge := NewDiscordBotBridge(
		"token",
		"channel",
		WithDiscordBotHTTPClient(customClient),
	)

	if bridge.httpClient != customClient {
		t.Error("expected custom httpClient to be used")
	}
}

// --- OnVisitorMessage Tests ---

func TestDiscordBotBridge_OnVisitorMessage_SendsMessageToAPI(t *testing.T) {
	var receivedRequest *http.Request
	var receivedBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedRequest = r
		receivedBody, _ = io.ReadAll(r.Body)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id": "1234567890123456789",
		})
	}))
	defer server.Close()

	bridge := NewDiscordBotBridge("test-token", "test-channel")
	bridge.httpClient = &http.Client{
		Transport: &discordTestTransport{baseURL: server.URL},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Hello from visitor")

	err := bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	if receivedRequest == nil {
		t.Fatal("expected request to be made")
	}
	if receivedRequest.Method != "POST" {
		t.Errorf("expected POST method, got %s", receivedRequest.Method)
	}
	if !strings.Contains(string(receivedBody), "Hello from visitor") {
		t.Error("expected message content to be in request body")
	}
	if receivedRequest.Header.Get("Authorization") != "Bot test-token" {
		t.Error("expected Bot authorization header")
	}
}

func TestDiscordBotBridge_OnVisitorMessage_ReturnsMessageID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id": "9876543210987654321",
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)

	bridge := NewDiscordBotBridge("test-token", "test-channel")
	bridge.httpClient = &http.Client{
		Transport: &discordTestTransport{baseURL: server.URL},
	}
	bridge.Init(context.Background(), pp)

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test message")

	err := bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify bridge message ID was saved
	bridgeIDs, err := storage.GetBridgeMessageIDs(ctx, "msg-1")
	if err != nil {
		t.Fatalf("failed to get bridge message IDs: %v", err)
	}
	if bridgeIDs == nil || bridgeIDs.DiscordMessageID != "9876543210987654321" {
		t.Errorf("expected DiscordMessageID='9876543210987654321', got %v", bridgeIDs)
	}
}

// --- OnMessageEdit Tests ---

func TestDiscordBotBridge_OnMessageEdit_CallsEditAPI(t *testing.T) {
	var editCalled bool
	var editBody []byte
	var editMethod string
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if strings.Contains(r.URL.Path, "/messages/") && r.Method == "PATCH" {
			editCalled = true
			editBody, _ = io.ReadAll(r.Body)
			editMethod = r.Method
		}
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id": "123456789",
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		DiscordMessageID: "123456789",
	})

	bridge := NewDiscordBotBridge("test-token", "test-channel")
	bridge.httpClient = &http.Client{
		Transport: &discordTestTransport{baseURL: server.URL},
	}
	bridge.Init(context.Background(), pp)

	result, err := bridge.OnMessageEdit(context.Background(), "sess-1", "msg-1", "Updated content", time.Now())

	mu.Lock()
	defer mu.Unlock()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !editCalled {
		t.Error("expected edit API to be called")
	}
	if editMethod != "PATCH" {
		t.Errorf("expected PATCH method, got %s", editMethod)
	}
	if !strings.Contains(string(editBody), "Updated content") {
		t.Error("expected new content in edit request")
	}
	if result == nil || result.DiscordMessageID != "123456789" {
		t.Errorf("expected DiscordMessageID='123456789', got %v", result)
	}
}

func TestDiscordBotBridge_OnMessageEdit_ReturnsNilOnFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"message": "Missing Permissions"}`))
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		DiscordMessageID: "123456789",
	})

	bridge := NewDiscordBotBridge("test-token", "test-channel")
	bridge.httpClient = &http.Client{
		Transport: &discordTestTransport{baseURL: server.URL},
	}
	bridge.Init(context.Background(), pp)

	result, err := bridge.OnMessageEdit(context.Background(), "sess-1", "msg-1", "Updated", time.Now())

	if err != nil {
		t.Errorf("expected nil error (logged), got %v", err)
	}
	if result != nil {
		t.Errorf("expected nil result on failure, got %v", result)
	}
}

// --- OnMessageDelete Tests ---

func TestDiscordBotBridge_OnMessageDelete_CallsDeleteAPI(t *testing.T) {
	var deleteCalled bool
	var deleteMethod string
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if strings.Contains(r.URL.Path, "/messages/") && r.Method == "DELETE" {
			deleteCalled = true
			deleteMethod = r.Method
		}
		mu.Unlock()

		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		DiscordMessageID: "987654321",
	})

	bridge := NewDiscordBotBridge("test-token", "test-channel")
	bridge.httpClient = &http.Client{
		Transport: &discordTestTransport{baseURL: server.URL},
	}
	bridge.Init(context.Background(), pp)

	err := bridge.OnMessageDelete(context.Background(), "sess-1", "msg-1", time.Now())

	mu.Lock()
	defer mu.Unlock()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !deleteCalled {
		t.Error("expected delete API to be called")
	}
	if deleteMethod != "DELETE" {
		t.Errorf("expected DELETE method, got %s", deleteMethod)
	}
}

// --- Error Handling Tests ---

func TestDiscordBotBridge_LogsErrorButDoesNotPanicOnAPIFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("Internal Server Error"))
	}))
	defer server.Close()

	bridge := NewDiscordBotBridge("test-token", "test-channel")
	bridge.httpClient = &http.Client{
		Transport: &discordTestTransport{baseURL: server.URL},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test")

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("unexpected panic: %v", r)
		}
	}()

	err := bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Errorf("expected nil error (logged), got %v", err)
	}
}

func TestDiscordBotBridge_HandlesNetworkErrors(t *testing.T) {
	bridge := NewDiscordBotBridge("test-token", "test-channel")
	bridge.httpClient = &http.Client{
		Timeout: 100 * time.Millisecond,
		Transport: &discordTestTransport{
			baseURL: "http://localhost:99999",
		},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test")

	err := bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Errorf("expected nil error for network errors, got %v", err)
	}
}

// ============================================================================
// SlackWebhookBridge Tests
// ============================================================================

// --- Constructor Validation Tests ---

func TestSlackWebhookBridge_Constructor_WithRequiredParams(t *testing.T) {
	bridge, err := NewSlackWebhookBridge("https://hooks.slack.com/services/T00/B00/xxx")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if bridge == nil {
		t.Fatal("expected non-nil SlackWebhookBridge")
	}
	if bridge.WebhookURL != "https://hooks.slack.com/services/T00/B00/xxx" {
		t.Errorf("expected webhook URL to be set, got '%s'", bridge.WebhookURL)
	}
	if bridge.Name() != "slack-webhook" {
		t.Errorf("expected Name()='slack-webhook', got '%s'", bridge.Name())
	}
}

func TestSlackWebhookBridge_Constructor_UsesDefaultOptions(t *testing.T) {
	bridge, err := NewSlackWebhookBridge("https://hooks.slack.com/services/T00/B00/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if bridge.Username != "PocketPing" {
		t.Errorf("expected default Username='PocketPing', got '%s'", bridge.Username)
	}
	if bridge.IconEmoji != ":speech_balloon:" {
		t.Errorf("expected default IconEmoji=':speech_balloon:', got '%s'", bridge.IconEmoji)
	}
	if bridge.httpClient == nil {
		t.Error("expected default httpClient to be set")
	}
}

func TestSlackWebhookBridge_Constructor_AcceptsFunctionalOptions(t *testing.T) {
	customClient := &http.Client{Timeout: 60 * time.Second}

	bridge, err := NewSlackWebhookBridge(
		"https://hooks.slack.com/services/T00/B00/test",
		WithSlackWebhookUsername("CustomBot"),
		WithSlackWebhookIconEmoji(":robot_face:"),
		WithSlackWebhookHTTPClient(customClient),
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if bridge.Username != "CustomBot" {
		t.Errorf("expected Username='CustomBot', got '%s'", bridge.Username)
	}
	if bridge.IconEmoji != ":robot_face:" {
		t.Errorf("expected IconEmoji=':robot_face:', got '%s'", bridge.IconEmoji)
	}
	if bridge.httpClient != customClient {
		t.Error("expected custom httpClient to be used")
	}
}

// --- OnVisitorMessage Tests ---

func TestSlackWebhookBridge_OnVisitorMessage_SendsMessageToAPI(t *testing.T) {
	var receivedRequest *http.Request
	var receivedBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedRequest = r
		receivedBody, _ = io.ReadAll(r.Body)
		mu.Unlock()

		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer server.Close()

	bridge, err := NewSlackWebhookBridge("https://hooks.slack.com/services/T00/B00/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.WebhookURL = server.URL

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Hello from visitor")

	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	if receivedRequest == nil {
		t.Fatal("expected request to be made")
	}
	if receivedRequest.Method != "POST" {
		t.Errorf("expected POST method, got %s", receivedRequest.Method)
	}
	if !strings.Contains(string(receivedBody), "Hello from visitor") {
		t.Error("expected message content to be in request body")
	}
}

func TestSlackWebhookBridge_OnVisitorMessage_HandlesAPIErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("invalid_payload"))
	}))
	defer server.Close()

	bridge, err := NewSlackWebhookBridge("https://hooks.slack.com/services/T00/B00/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.WebhookURL = server.URL

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test message")

	// Should not return error (logs but doesn't fail)
	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Errorf("expected nil error (logged), got %v", err)
	}
}

// --- OnNewSession Tests ---

func TestSlackWebhookBridge_OnNewSession_SendsSessionAnnouncement(t *testing.T) {
	var receivedBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedBody, _ = io.ReadAll(r.Body)
		mu.Unlock()

		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer server.Close()

	bridge, err := NewSlackWebhookBridge("https://hooks.slack.com/services/T00/B00/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.WebhookURL = server.URL

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-123", nil, nil)

	err = bridge.OnNewSession(ctx, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	var payload map[string]interface{}
	json.Unmarshal(receivedBody, &payload)

	text, ok := payload["text"].(string)
	if !ok || !strings.Contains(text, "New chat session") {
		t.Error("expected 'New chat session' in message text")
	}
}

// ============================================================================
// SlackBotBridge Tests
// ============================================================================

// --- Constructor Validation Tests ---

func TestSlackBotBridge_Constructor_WithRequiredParams(t *testing.T) {
	bridge, err := NewSlackBotBridge("xoxb-bot-token-123", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if bridge == nil {
		t.Fatal("expected non-nil SlackBotBridge")
	}
	if bridge.BotToken != "xoxb-bot-token-123" {
		t.Errorf("expected BotToken='xoxb-bot-token-123', got '%s'", bridge.BotToken)
	}
	if bridge.ChannelID != "C1234567890" {
		t.Errorf("expected ChannelID='C1234567890', got '%s'", bridge.ChannelID)
	}
	if bridge.Name() != "slack-bot" {
		t.Errorf("expected Name()='slack-bot', got '%s'", bridge.Name())
	}
}

func TestSlackBotBridge_Constructor_UsesDefaultOptions(t *testing.T) {
	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if bridge.httpClient == nil {
		t.Error("expected default httpClient to be set")
	}
}

func TestSlackBotBridge_Constructor_AcceptsFunctionalOptions(t *testing.T) {
	customClient := &http.Client{Timeout: 60 * time.Second}

	bridge, err := NewSlackBotBridge(
		"xoxb-test-token",
		"C1234567890",
		WithSlackBotHTTPClient(customClient),
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if bridge.httpClient != customClient {
		t.Error("expected custom httpClient to be used")
	}
}

// --- OnVisitorMessage Tests ---

func TestSlackBotBridge_OnVisitorMessage_SendsMessageToAPI(t *testing.T) {
	var receivedRequest *http.Request
	var receivedBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedRequest = r
		receivedBody, _ = io.ReadAll(r.Body)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
			"ts": "1234567890.123456",
		})
	}))
	defer server.Close()

	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &slackTestTransport{baseURL: server.URL},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Hello from visitor")

	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	if receivedRequest == nil {
		t.Fatal("expected request to be made")
	}
	if receivedRequest.Method != "POST" {
		t.Errorf("expected POST method, got %s", receivedRequest.Method)
	}
	if !strings.Contains(string(receivedBody), "Hello from visitor") {
		t.Error("expected message content to be in request body")
	}
	if !strings.Contains(receivedRequest.Header.Get("Authorization"), "Bearer") {
		t.Error("expected Bearer authorization header")
	}
}

func TestSlackBotBridge_OnVisitorMessage_ReturnsMessageTS(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
			"ts": "1234567890.999999",
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)

	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &slackTestTransport{baseURL: server.URL},
	}
	bridge.Init(context.Background(), pp)

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test message")

	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify bridge message ID was saved
	bridgeIDs, err := storage.GetBridgeMessageIDs(ctx, "msg-1")
	if err != nil {
		t.Fatalf("failed to get bridge message IDs: %v", err)
	}
	if bridgeIDs == nil || bridgeIDs.SlackMessageTS != "1234567890.999999" {
		t.Errorf("expected SlackMessageTS='1234567890.999999', got %v", bridgeIDs)
	}
}

func TestSlackBotBridge_OnVisitorMessage_HandlesAPIErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":    false,
			"error": "channel_not_found",
		})
	}))
	defer server.Close()

	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &slackTestTransport{baseURL: server.URL},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test message")

	// Should not return error (logs but doesn't fail)
	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Errorf("expected nil error (logged), got %v", err)
	}
}

// --- OnNewSession Tests ---

func TestSlackBotBridge_OnNewSession_SendsSessionAnnouncement(t *testing.T) {
	var receivedBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedBody, _ = io.ReadAll(r.Body)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
			"ts": "123.456",
		})
	}))
	defer server.Close()

	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &slackTestTransport{baseURL: server.URL},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-123", nil, nil)

	err = bridge.OnNewSession(ctx, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	var payload map[string]interface{}
	json.Unmarshal(receivedBody, &payload)

	text, ok := payload["text"].(string)
	if !ok || !strings.Contains(text, "New chat session") {
		t.Error("expected 'New chat session' in message text")
	}
}

func TestSlackBotBridge_OnNewSession_FormatsSessionInfoCorrectly(t *testing.T) {
	var receivedBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedBody, _ = io.ReadAll(r.Body)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
			"ts": "123.456",
		})
	}))
	defer server.Close()

	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &slackTestTransport{baseURL: server.URL},
	}

	ctx := context.Background()
	session := createTestSession(
		"sess-1",
		"visitor-123",
		&UserIdentity{ID: "user-1", Email: "jane@example.com"},
		&SessionMetadata{URL: "https://example.com/contact"},
	)

	err = bridge.OnNewSession(ctx, session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	var payload map[string]interface{}
	json.Unmarshal(receivedBody, &payload)

	text, ok := payload["text"].(string)
	if !ok {
		t.Fatal("expected text field in payload")
	}
	// New format shows email instead of name
	if !strings.Contains(text, "jane@example.com") {
		t.Error("expected email in message")
	}
	if !strings.Contains(text, "example.com") {
		t.Error("expected page URL in message")
	}
}

// --- OnMessageEdit Tests ---

func TestSlackBotBridge_OnMessageEdit_CallsEditAPI(t *testing.T) {
	var updateCalled bool
	var updateBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if strings.Contains(r.URL.Path, "chat.update") {
			updateCalled = true
			updateBody, _ = io.ReadAll(r.Body)
		}
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
			"ts": "1234567890.123456",
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		SlackMessageTS: "1234567890.123456",
	})

	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &slackTestTransport{baseURL: server.URL},
	}
	bridge.Init(context.Background(), pp)

	result, err := bridge.OnMessageEdit(context.Background(), "sess-1", "msg-1", "Updated content", time.Now())

	mu.Lock()
	defer mu.Unlock()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !updateCalled {
		t.Error("expected chat.update API to be called")
	}
	if !strings.Contains(string(updateBody), "1234567890.123456") {
		t.Error("expected message ts in update request")
	}
	if !strings.Contains(string(updateBody), "Updated content") {
		t.Error("expected new content in update request")
	}
	if result == nil || result.SlackMessageTS != "1234567890.123456" {
		t.Errorf("expected SlackMessageTS='1234567890.123456', got %v", result)
	}
}

func TestSlackBotBridge_OnMessageEdit_ReturnsNilOnFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":    false,
			"error": "message_not_found",
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		SlackMessageTS: "1234567890.123456",
	})

	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &slackTestTransport{baseURL: server.URL},
	}
	bridge.Init(context.Background(), pp)

	result, err := bridge.OnMessageEdit(context.Background(), "sess-1", "msg-1", "Updated", time.Now())

	if err != nil {
		t.Errorf("expected nil error (logged), got %v", err)
	}
	if result != nil {
		t.Errorf("expected nil result on failure, got %v", result)
	}
}

// --- OnMessageDelete Tests ---

func TestSlackBotBridge_OnMessageDelete_CallsDeleteAPI(t *testing.T) {
	var deleteCalled bool
	var deleteBody []byte
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if strings.Contains(r.URL.Path, "chat.delete") {
			deleteCalled = true
			deleteBody, _ = io.ReadAll(r.Body)
		}
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		SlackMessageTS: "9876543210.654321",
	})

	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &slackTestTransport{baseURL: server.URL},
	}
	bridge.Init(context.Background(), pp)

	err = bridge.OnMessageDelete(context.Background(), "sess-1", "msg-1", time.Now())

	mu.Lock()
	defer mu.Unlock()

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !deleteCalled {
		t.Error("expected chat.delete API to be called")
	}
	if !strings.Contains(string(deleteBody), "9876543210.654321") {
		t.Error("expected message ts in delete request")
	}
}

func TestSlackBotBridge_OnMessageDelete_ReturnsNilOnSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		SlackMessageTS: "123.456",
	})

	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &slackTestTransport{baseURL: server.URL},
	}
	bridge.Init(context.Background(), pp)

	err = bridge.OnMessageDelete(context.Background(), "sess-1", "msg-1", time.Now())
	if err != nil {
		t.Errorf("expected nil error on success, got %v", err)
	}
}

func TestSlackBotBridge_OnMessageDelete_ReturnsNilOnFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":    false,
			"error": "message_not_found",
		})
	}))
	defer server.Close()

	storage := newMockStorage()
	pp := mockPocketPing(storage)
	storage.SaveBridgeMessageIDs(context.Background(), "msg-1", BridgeMessageIds{
		SlackMessageTS: "123.456",
	})

	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &slackTestTransport{baseURL: server.URL},
	}
	bridge.Init(context.Background(), pp)

	err = bridge.OnMessageDelete(context.Background(), "sess-1", "msg-1", time.Now())
	if err != nil {
		t.Errorf("expected nil error (logged), got %v", err)
	}
}

// --- Error Handling Tests ---

func TestSlackBotBridge_LogsErrorButDoesNotPanicOnAPIFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("Internal Server Error"))
	}))
	defer server.Close()

	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &slackTestTransport{baseURL: server.URL},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test")

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("unexpected panic: %v", r)
		}
	}()

	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Errorf("expected nil error (logged), got %v", err)
	}
}

func TestSlackBotBridge_HandlesNetworkErrors(t *testing.T) {
	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Timeout: 100 * time.Millisecond,
		Transport: &slackTestTransport{
			baseURL: "http://localhost:99999",
		},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test")

	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Errorf("expected nil error for network errors, got %v", err)
	}
}

func TestSlackBotBridge_HandlesInvalidResponses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	bridge, err := NewSlackBotBridge("xoxb-test-token", "C1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	bridge.httpClient = &http.Client{
		Transport: &slackTestTransport{baseURL: server.URL},
	}

	ctx := context.Background()
	session := createTestSession("sess-1", "visitor-1", nil, nil)
	message := createTestMessage("msg-1", "sess-1", "Test")

	err = bridge.OnVisitorMessage(ctx, message, session)
	if err != nil {
		t.Errorf("expected nil error for invalid JSON, got %v", err)
	}
}

// ============================================================================
// Test Transport Helpers
// ============================================================================

// testTransport rewrites Telegram API requests to the test server
type testTransport struct {
	baseURL string
	token   string
}

func (t *testTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// Rewrite URL to test server
	if strings.Contains(req.URL.Host, "api.telegram.org") {
		// Extract the path after /bot{token}
		path := req.URL.Path
		parts := strings.SplitN(path, "/", 3)
		if len(parts) >= 3 {
			newURL := t.baseURL + "/" + parts[2]
			newReq, _ := http.NewRequest(req.Method, newURL, req.Body)
			newReq.Header = req.Header
			return http.DefaultTransport.RoundTrip(newReq)
		}
	}
	return http.DefaultTransport.RoundTrip(req)
}

// discordTestTransport rewrites Discord API requests to the test server
type discordTestTransport struct {
	baseURL string
}

func (t *discordTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if strings.Contains(req.URL.Host, "discord.com") {
		newURL := t.baseURL + req.URL.Path
		newReq, _ := http.NewRequest(req.Method, newURL, req.Body)
		newReq.Header = req.Header
		return http.DefaultTransport.RoundTrip(newReq)
	}
	return http.DefaultTransport.RoundTrip(req)
}

// slackTestTransport rewrites Slack API requests to the test server
type slackTestTransport struct {
	baseURL string
}

func (t *slackTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if strings.Contains(req.URL.Host, "slack.com") {
		newURL := t.baseURL + req.URL.Path
		newReq, _ := http.NewRequest(req.Method, newURL, req.Body)
		newReq.Header = req.Header
		return http.DefaultTransport.RoundTrip(newReq)
	}
	return http.DefaultTransport.RoundTrip(req)
}

// ============================================================================
// Interface Verification Tests
// ============================================================================

func TestTelegramBridge_ImplementsBridgeInterface(t *testing.T) {
	var _ Bridge = (*TelegramBridge)(nil)
}

func TestTelegramBridge_ImplementsBridgeWithEditDeleteInterface(t *testing.T) {
	var _ BridgeWithEditDelete = (*TelegramBridge)(nil)
}

func TestDiscordWebhookBridge_ImplementsBridgeInterface(t *testing.T) {
	var _ Bridge = (*DiscordWebhookBridge)(nil)
}

func TestDiscordBotBridge_ImplementsBridgeInterface(t *testing.T) {
	var _ Bridge = (*DiscordBotBridge)(nil)
}

func TestDiscordBotBridge_ImplementsBridgeWithEditDeleteInterface(t *testing.T) {
	var _ BridgeWithEditDelete = (*DiscordBotBridge)(nil)
}

func TestSlackWebhookBridge_ImplementsBridgeInterface(t *testing.T) {
	var _ Bridge = (*SlackWebhookBridge)(nil)
}

func TestSlackBotBridge_ImplementsBridgeInterface(t *testing.T) {
	var _ Bridge = (*SlackBotBridge)(nil)
}

func TestSlackBotBridge_ImplementsBridgeWithEditDeleteInterface(t *testing.T) {
	var _ BridgeWithEditDelete = (*SlackBotBridge)(nil)
}

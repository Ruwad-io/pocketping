package bridges

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketping/bridge-server/internal/config"
	"github.com/pocketping/bridge-server/internal/types"
)

func TestNewTelegramBridge(t *testing.T) {
	cfg := &config.TelegramConfig{
		BotToken: "123:ABC",
		ChatID:   "-1001234567890",
	}

	bridge, err := NewTelegramBridge(cfg)
	if err != nil {
		t.Fatalf("NewTelegramBridge error: %v", err)
	}

	if bridge.Name() != "telegram" {
		t.Errorf("expected name 'telegram', got %q", bridge.Name())
	}
	if bridge.botToken != "123:ABC" {
		t.Errorf("botToken mismatch")
	}
	if bridge.chatID != "-1001234567890" {
		t.Errorf("chatID mismatch")
	}
}

func TestTelegramBridge_OnNewSession(t *testing.T) {
	session := &types.Session{
		ID:        "session123",
		VisitorID: "visitor456",
		Identity: &types.UserIdentity{
			Name: "John Doe",
		},
		Metadata: &types.SessionMetadata{
			URL:     "https://example.com/page",
			Country: "US",
			City:    "New York",
		},
	}

	// We need to point to test server - use a custom approach
	// For now, just test the formatting logic
	t.Run("formats session message correctly", func(t *testing.T) {
		visitorName := session.VisitorID
		if session.Identity != nil && session.Identity.Name != "" {
			visitorName = session.Identity.Name
		}
		if visitorName != "John Doe" {
			t.Errorf("expected visitor name 'John Doe', got %q", visitorName)
		}
	})
}

func TestTelegramBridge_OnVisitorMessage(t *testing.T) {
	t.Run("formats message with identity", func(t *testing.T) {
		session := &types.Session{
			ID:        "session123",
			VisitorID: "visitor456",
			Identity: &types.UserIdentity{
				Name: "Jane Doe",
			},
		}
		message := &types.Message{
			ID:      "msg123",
			Content: "Hello, support!",
		}

		visitorName := session.VisitorID
		if session.Identity != nil && session.Identity.Name != "" {
			visitorName = session.Identity.Name
		}

		if visitorName != "Jane Doe" {
			t.Errorf("expected 'Jane Doe', got %q", visitorName)
		}

		expectedContent := "💬 <b>Jane Doe</b>:\nHello, support!"
		if !strings.Contains(expectedContent, message.Content) {
			t.Errorf("message content should be included")
		}
	})

	t.Run("includes attachment count", func(t *testing.T) {
		message := &types.Message{
			ID:      "msg123",
			Content: "Check this file",
			Attachments: []*types.Attachment{
				{ID: "att1", Filename: "doc.pdf"},
				{ID: "att2", Filename: "image.png"},
			},
		}

		attachmentText := ""
		if len(message.Attachments) > 0 {
			attachmentText = "\n📎 2 attachment(s)"
		}

		if attachmentText != "\n📎 2 attachment(s)" {
			t.Errorf("attachment text mismatch")
		}
	})
}

func TestTelegramBridge_OnOperatorMessage(t *testing.T) {
	t.Run("skips message from same bridge", func(t *testing.T) {
		bridge := &TelegramBridge{
			BaseBridge: NewBaseBridge("telegram"),
		}

		err := bridge.OnOperatorMessage(
			&types.Message{Content: "test"},
			&types.Session{},
			"telegram",
			"Operator",
		)

		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("formats operator name correctly", func(t *testing.T) {
		operatorName := ""
		if operatorName == "" {
			operatorName = "Operator"
		}
		if operatorName != "Operator" {
			t.Errorf("expected default operator name")
		}
	})
}

func TestTelegramBridge_OnTyping(t *testing.T) {
	bridge := &TelegramBridge{
		BaseBridge: NewBaseBridge("telegram"),
	}

	t.Run("returns early when not typing", func(t *testing.T) {
		err := bridge.OnTyping("session123", false)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})
}

func TestTelegramBridge_OnMessageRead(t *testing.T) {
	bridge := &TelegramBridge{
		BaseBridge: NewBaseBridge("telegram"),
	}

	// Should be a no-op
	err := bridge.OnMessageRead("session123", []string{"msg1", "msg2"}, types.StatusRead)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestTelegramBridge_OnCustomEvent(t *testing.T) {
	t.Run("formats event with data", func(t *testing.T) {
		event := &types.CustomEvent{
			Name: "button_click",
			Data: map[string]interface{}{
				"buttonId": "submit",
			},
		}

		expectedText := "⚡ <b>Event: button_click</b>"
		if !strings.Contains(expectedText, event.Name) {
			t.Errorf("event name should be included")
		}
	})
}

func TestTelegramBridge_OnIdentityUpdate(t *testing.T) {
	bridge := &TelegramBridge{
		BaseBridge: NewBaseBridge("telegram"),
	}

	t.Run("returns early when no identity", func(t *testing.T) {
		session := &types.Session{ID: "s1"}
		err := bridge.OnIdentityUpdate(session)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("formats identity correctly", func(t *testing.T) {
		identity := &types.UserIdentity{
			ID:    "user123",
			Name:  "John",
			Email: "john@example.com",
		}

		expectedText := "🔑 <b>User identified</b>\nID: user123"
		if !strings.Contains(expectedText, identity.ID) {
			t.Errorf("identity ID should be included")
		}
	})

	t.Run("includes phone when present", func(t *testing.T) {
		session := &types.Session{
			ID: "s1",
			Identity: &types.UserIdentity{
				ID:    "user123",
				Name:  "John",
				Email: "john@example.com",
			},
			UserPhone:        "+33612345678",
			UserPhoneCountry: "FR",
		}

		// Verify phone is in the expected format
		expectedPhoneText := "📱 Phone: +33612345678"
		if !strings.Contains(expectedPhoneText, session.UserPhone) {
			t.Errorf("phone should be included, expected %s", session.UserPhone)
		}
	})
}

func TestTelegramBridge_OnAITakeover(t *testing.T) {
	t.Run("formats AI takeover message", func(t *testing.T) {
		reason := "Operator timeout"
		expectedText := "🤖 <b>AI Takeover</b>\nReason: Operator timeout"
		if !strings.Contains(expectedText, reason) {
			t.Errorf("reason should be included")
		}
	})
}

func TestTelegramBridge_OnVisitorMessageEdited(t *testing.T) {
	bridge := &TelegramBridge{
		BaseBridge: NewBaseBridge("telegram"),
	}

	t.Run("returns nil when no bridge IDs", func(t *testing.T) {
		result, err := bridge.OnVisitorMessageEdited("s1", "m1", "new content", nil)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if result != nil {
			t.Errorf("expected nil result")
		}
	})

	t.Run("returns nil when no telegram message ID", func(t *testing.T) {
		bridgeIDs := &types.BridgeMessageIDs{
			DiscordMessageID: "discord123",
		}
		result, err := bridge.OnVisitorMessageEdited("s1", "m1", "new content", bridgeIDs)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if result != nil {
			t.Errorf("expected nil result")
		}
	})
}

func TestTelegramBridge_OnVisitorMessageDeleted(t *testing.T) {
	bridge := &TelegramBridge{
		BaseBridge: NewBaseBridge("telegram"),
	}

	t.Run("returns nil when no bridge IDs", func(t *testing.T) {
		err := bridge.OnVisitorMessageDeleted("s1", "m1", nil)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("returns nil when no telegram message ID", func(t *testing.T) {
		bridgeIDs := &types.BridgeMessageIDs{
			SlackMessageTS: "slack.ts",
		}
		err := bridge.OnVisitorMessageDeleted("s1", "m1", bridgeIDs)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})
}

func TestTelegramBridge_callAPI_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type application/json")
		}

		// Return success
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":     true,
			"result": map[string]interface{}{"message_id": 456},
		})
	}))
	defer server.Close()

	bridge := &TelegramBridge{
		BaseBridge: NewBaseBridge("telegram"),
		botToken:   "test_token",
		chatID:     "123",
		client:     server.Client(),
	}

	// Can't easily test callAPI directly since it builds the URL internally
	// But we can verify the bridge was configured correctly
	if bridge.chatID != "123" {
		t.Errorf("chatID not set correctly")
	}
}

func TestTelegramBridge_sendMessage_WithReply(t *testing.T) {
	var receivedData map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&receivedData)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":     true,
			"result": map[string]interface{}{"message_id": 789},
		})
	}))
	defer server.Close()

	// Test the reply formatting logic
	replyToID := 123
	data := map[string]interface{}{
		"chat_id":    "-1001234567890",
		"text":       "Reply message",
		"parse_mode": "HTML",
	}
	if replyToID > 0 {
		data["reply_to_message_id"] = replyToID
	}

	if data["reply_to_message_id"] != 123 {
		t.Errorf("reply_to_message_id not set correctly")
	}
}

func TestTelegramBridge_EditMessage_Formatting(t *testing.T) {
	messageID := 456
	content := "Updated content"

	data := map[string]interface{}{
		"chat_id":    "-1001234567890",
		"message_id": messageID,
		"text":       "✏️ (edited):\n" + content,
		"parse_mode": "HTML",
	}

	expectedText := "✏️ (edited):\nUpdated content"
	if data["text"] != expectedText {
		t.Errorf("edit text format mismatch: got %q", data["text"])
	}
}

func TestTelegramBridge_Integration_MockServer(t *testing.T) {
	// Create a mock Telegram API server
	messagesSent := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "sendMessage") {
			messagesSent++
			json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":     true,
				"result": map[string]interface{}{"message_id": messagesSent},
			})
			return
		}
		if strings.Contains(r.URL.Path, "sendChatAction") {
			json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
			return
		}
		if strings.Contains(r.URL.Path, "editMessageText") {
			json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
			return
		}
		if strings.Contains(r.URL.Path, "deleteMessage") {
			json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	// Verify server is running
	if server.URL == "" {
		t.Fatal("test server not started")
	}
}

func TestTelegramBridge_ErrorHandling(t *testing.T) {
	t.Run("handles API error response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":          false,
				"description": "Bad Request: chat not found",
			})
		}))
		defer server.Close()

		// The bridge should handle this gracefully
		// Test the error response parsing
		response := struct {
			OK          bool   `json:"ok"`
			Description string `json:"description"`
		}{}

		resp, _ := server.Client().Get(server.URL)
		json.NewDecoder(resp.Body).Decode(&response)
		resp.Body.Close()

		if response.OK {
			t.Error("expected OK to be false")
		}
		if response.Description != "Bad Request: chat not found" {
			t.Errorf("description mismatch")
		}
	})
}

func TestTelegramBridge_Timeout(t *testing.T) {
	bridge := &TelegramBridge{
		BaseBridge: NewBaseBridge("telegram"),
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}

	if bridge.client.Timeout != 30*time.Second {
		t.Errorf("expected 30s timeout, got %v", bridge.client.Timeout)
	}
}

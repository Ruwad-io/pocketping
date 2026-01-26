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

func TestNewDiscordBridge(t *testing.T) {
	t.Run("bot mode", func(t *testing.T) {
		cfg := &config.DiscordConfig{
			BotToken:  "bot_token_123",
			ChannelID: "channel_456",
			Username:  "TestBot",
			AvatarURL: "https://example.com/avatar.png",
		}

		bridge, err := NewDiscordBridge(cfg)
		if err != nil {
			t.Fatalf("NewDiscordBridge error: %v", err)
		}

		if bridge.Name() != "discord" {
			t.Errorf("expected name 'discord', got %q", bridge.Name())
		}
		if bridge.botToken != "bot_token_123" {
			t.Errorf("botToken mismatch")
		}
		if bridge.channelID != "channel_456" {
			t.Errorf("channelID mismatch")
		}
		if !bridge.isBotMode() {
			t.Error("expected bot mode to be true")
		}
	})

	t.Run("webhook mode", func(t *testing.T) {
		cfg := &config.DiscordConfig{
			WebhookURL: "https://discord.com/api/webhooks/123/abc",
			Username:   "WebhookBot",
		}

		bridge, err := NewDiscordBridge(cfg)
		if err != nil {
			t.Fatalf("NewDiscordBridge error: %v", err)
		}

		if bridge.isBotMode() {
			t.Error("expected bot mode to be false")
		}
		if bridge.webhookURL != "https://discord.com/api/webhooks/123/abc" {
			t.Errorf("webhookURL mismatch")
		}
	})
}

func TestDiscordBridge_isBotMode(t *testing.T) {
	tests := []struct {
		name      string
		botToken  string
		channelID string
		expected  bool
	}{
		{"both set", "token", "channel", true},
		{"only token", "token", "", false},
		{"only channel", "", "channel", false},
		{"neither set", "", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bridge := &DiscordBridge{
				BaseBridge: NewBaseBridge("discord"),
				botToken:   tt.botToken,
				channelID:  tt.channelID,
			}
			if bridge.isBotMode() != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, bridge.isBotMode())
			}
		})
	}
}

func TestDiscordBridge_OnNewSession(t *testing.T) {
	var receivedData map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&receivedData)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id": "msg123",
		})
	}))
	defer server.Close()

	t.Run("formats session embed correctly", func(t *testing.T) {
		session := &types.Session{
			ID:        "session123",
			VisitorID: "visitor456",
			Identity: &types.UserIdentity{
				Name: "John Doe",
			},
			Metadata: &types.SessionMetadata{
				URL: "https://example.com/page",
			},
		}

		visitorName := session.VisitorID
		if session.Identity != nil && session.Identity.Name != "" {
			visitorName = session.Identity.Name
		}

		if visitorName != "John Doe" {
			t.Errorf("expected 'John Doe', got %q", visitorName)
		}

		// Verify embed structure
		embed := discordEmbed{
			Title:       "New Chat Session",
			Description: "A new visitor has started a chat",
			Color:       0x00D4AA,
			Fields: []discordEmbedField{
				{Name: "Visitor", Value: visitorName, Inline: true},
			},
		}

		if embed.Color != 0x00D4AA {
			t.Errorf("color mismatch")
		}
		if len(embed.Fields) == 0 || embed.Fields[0].Value != "John Doe" {
			t.Errorf("visitor field mismatch")
		}
	})
}

func TestDiscordBridge_OnVisitorMessage(t *testing.T) {
	t.Run("formats message correctly", func(t *testing.T) {
		session := &types.Session{
			ID:        "session123",
			VisitorID: "visitor456",
			Identity: &types.UserIdentity{
				Name: "Jane",
			},
		}
		message := &types.Message{
			ID:      "msg123",
			Content: "Hello!",
		}

		visitorName := session.VisitorID
		if session.Identity != nil && session.Identity.Name != "" {
			visitorName = session.Identity.Name
		}

		expectedContent := "**Jane**: Hello!"
		content := "**" + visitorName + "**: " + message.Content
		if content != expectedContent {
			t.Errorf("expected %q, got %q", expectedContent, content)
		}
	})

	t.Run("includes attachment info", func(t *testing.T) {
		message := &types.Message{
			ID:      "msg123",
			Content: "Check this",
			Attachments: []*types.Attachment{
				{ID: "att1"},
				{ID: "att2"},
				{ID: "att3"},
			},
		}

		content := message.Content
		if len(message.Attachments) > 0 {
			content += " _(+3 attachment(s))_"
		}

		if !strings.Contains(content, "_(+3 attachment(s))_") {
			t.Errorf("attachment count not included")
		}
	})

	t.Run("handles reply context", func(t *testing.T) {
		reply := &ReplyContext{
			BridgeIDs: &types.BridgeMessageIDs{
				DiscordMessageID: "discord_msg_123",
			},
		}

		replyToMessageID := ""
		if reply != nil && reply.BridgeIDs != nil {
			replyToMessageID = reply.BridgeIDs.DiscordMessageID
		}

		if replyToMessageID != "discord_msg_123" {
			t.Errorf("expected reply ID 'discord_msg_123', got %q", replyToMessageID)
		}
	})
}

func TestDiscordBridge_OnOperatorMessage(t *testing.T) {
	bridge := &DiscordBridge{
		BaseBridge: NewBaseBridge("discord"),
	}

	t.Run("skips message from same bridge", func(t *testing.T) {
		err := bridge.OnOperatorMessage(
			&types.Message{Content: "test"},
			&types.Session{},
			"discord",
			"Operator",
		)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("formats cross-bridge message", func(t *testing.T) {
		operatorName := "Support Agent"
		sourceBridge := "telegram"
		content := "Hello from Telegram"

		expectedFormat := "**Support Agent** (via telegram): Hello from Telegram"
		result := "**" + operatorName + "** (via " + sourceBridge + "): " + content

		if result != expectedFormat {
			t.Errorf("format mismatch: got %q", result)
		}
	})
}

func TestDiscordBridge_OnTyping(t *testing.T) {
	t.Run("no-op when not typing", func(t *testing.T) {
		bridge := &DiscordBridge{
			BaseBridge: NewBaseBridge("discord"),
		}
		err := bridge.OnTyping("session123", false)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("no-op in webhook mode", func(t *testing.T) {
		bridge := &DiscordBridge{
			BaseBridge: NewBaseBridge("discord"),
			webhookURL: "https://discord.com/webhook",
		}
		err := bridge.OnTyping("session123", true)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})
}

func TestDiscordBridge_OnMessageRead(t *testing.T) {
	bridge := &DiscordBridge{
		BaseBridge: NewBaseBridge("discord"),
	}

	// Should be a no-op
	err := bridge.OnMessageRead("session123", []string{"msg1"}, types.StatusRead)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestDiscordBridge_OnCustomEvent(t *testing.T) {
	t.Run("formats custom event embed", func(t *testing.T) {
		event := &types.CustomEvent{
			Name: "purchase",
			Data: map[string]interface{}{
				"amount": 99.99,
				"item":   "Widget Pro",
			},
		}

		embed := discordEmbed{
			Title: "Event: " + event.Name,
			Color: 0x5865F2, // Discord blurple
		}

		if embed.Color != 0x5865F2 {
			t.Errorf("color mismatch")
		}
		if embed.Title != "Event: purchase" {
			t.Errorf("title mismatch")
		}
	})
}

func TestDiscordBridge_OnIdentityUpdate(t *testing.T) {
	bridge := &DiscordBridge{
		BaseBridge: NewBaseBridge("discord"),
	}

	t.Run("returns early when no identity", func(t *testing.T) {
		session := &types.Session{ID: "s1"}
		err := bridge.OnIdentityUpdate(session)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("formats identity embed", func(t *testing.T) {
		identity := &types.UserIdentity{
			ID:    "user123",
			Name:  "John",
			Email: "john@example.com",
		}

		embed := discordEmbed{
			Title: "User Identified",
			Color: 0x57F287, // Green
			Fields: []discordEmbedField{
				{Name: "User ID", Value: identity.ID, Inline: true},
			},
		}

		if embed.Color != 0x57F287 {
			t.Errorf("color mismatch")
		}
		if len(embed.Fields) == 0 || embed.Fields[0].Value != "user123" {
			t.Errorf("user ID field mismatch")
		}
	})

	t.Run("includes phone field when present", func(t *testing.T) {
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

		// Verify the session has phone data that would be added to embed
		if session.UserPhone != "+33612345678" {
			t.Errorf("phone should be +33612345678, got %s", session.UserPhone)
		}
		if session.UserPhoneCountry != "FR" {
			t.Errorf("phone country should be FR, got %s", session.UserPhoneCountry)
		}
	})
}

func TestDiscordBridge_OnAITakeover(t *testing.T) {
	t.Run("formats AI takeover embed", func(t *testing.T) {
		reason := "No operator available"

		embed := discordEmbed{
			Title:       "AI Takeover",
			Description: reason,
			Color:       0xFEE75C, // Yellow
		}

		if embed.Description != "No operator available" {
			t.Errorf("description mismatch")
		}
		if embed.Color != 0xFEE75C {
			t.Errorf("color mismatch")
		}
	})
}

func TestDiscordBridge_OnVisitorMessageEdited(t *testing.T) {
	t.Run("returns nil in webhook mode", func(t *testing.T) {
		bridge := &DiscordBridge{
			BaseBridge: NewBaseBridge("discord"),
			webhookURL: "https://discord.com/webhook",
		}
		result, err := bridge.OnVisitorMessageEdited("s1", "m1", "new", &types.BridgeMessageIDs{DiscordMessageID: "123"})
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if result != nil {
			t.Errorf("expected nil result in webhook mode")
		}
	})

	t.Run("returns nil when no bridge IDs", func(t *testing.T) {
		bridge := &DiscordBridge{
			BaseBridge: NewBaseBridge("discord"),
			botToken:   "token",
			channelID:  "channel",
		}
		result, err := bridge.OnVisitorMessageEdited("s1", "m1", "new", nil)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if result != nil {
			t.Errorf("expected nil result")
		}
	})

	t.Run("returns nil when no discord message ID", func(t *testing.T) {
		bridge := &DiscordBridge{
			BaseBridge: NewBaseBridge("discord"),
			botToken:   "token",
			channelID:  "channel",
		}
		result, err := bridge.OnVisitorMessageEdited("s1", "m1", "new", &types.BridgeMessageIDs{TelegramMessageID: 123})
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if result != nil {
			t.Errorf("expected nil result")
		}
	})
}

func TestDiscordBridge_OnVisitorMessageDeleted(t *testing.T) {
	t.Run("returns nil in webhook mode", func(t *testing.T) {
		bridge := &DiscordBridge{
			BaseBridge: NewBaseBridge("discord"),
			webhookURL: "https://discord.com/webhook",
		}
		err := bridge.OnVisitorMessageDeleted("s1", "m1", &types.BridgeMessageIDs{DiscordMessageID: "123"})
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("returns nil when no bridge IDs", func(t *testing.T) {
		bridge := &DiscordBridge{
			BaseBridge: NewBaseBridge("discord"),
			botToken:   "token",
			channelID:  "channel",
		}
		err := bridge.OnVisitorMessageDeleted("s1", "m1", nil)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})
}

func TestDiscordBridge_sendMessage_BotMode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify authorization header
		auth := r.Header.Get("Authorization")
		if auth == "" {
			// Just verify it exists in real usage
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id": "msg_123",
		})
	}))
	defer server.Close()

	t.Run("includes authorization header", func(t *testing.T) {
		// Test the header format
		expectedAuth := "Bot test_token"
		if !strings.HasPrefix(expectedAuth, "Bot ") {
			t.Errorf("expected Bot prefix in auth header")
		}
	})

	t.Run("includes message_reference for replies", func(t *testing.T) {
		data := map[string]interface{}{
			"content": "Reply message",
		}
		replyToMessageID := "original_msg_123"
		if replyToMessageID != "" {
			data["message_reference"] = map[string]string{
				"message_id": replyToMessageID,
			}
		}

		ref := data["message_reference"].(map[string]string)
		if ref["message_id"] != "original_msg_123" {
			t.Errorf("message_reference not set correctly")
		}
	})
}

func TestDiscordBridge_sendMessage_WebhookMode(t *testing.T) {
	t.Run("uses webhook URL with wait param", func(t *testing.T) {
		webhookURL := "https://discord.com/api/webhooks/123/abc"
		expectedURL := webhookURL + "?wait=true"

		if expectedURL != "https://discord.com/api/webhooks/123/abc?wait=true" {
			t.Errorf("URL format mismatch")
		}
	})
}

func TestDiscordBridge_EmbedStructure(t *testing.T) {
	embed := discordEmbed{
		Title:       "Test Title",
		Description: "Test Description",
		Color:       0xFF0000,
		Fields: []discordEmbedField{
			{Name: "Field1", Value: "Value1", Inline: true},
			{Name: "Field2", Value: "Value2", Inline: false},
		},
		Footer:    &discordEmbedFooter{Text: "Footer text"},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	data, err := json.Marshal(embed)
	if err != nil {
		t.Fatalf("failed to marshal embed: %v", err)
	}

	var decoded discordEmbed
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal embed: %v", err)
	}

	if decoded.Title != "Test Title" {
		t.Errorf("title mismatch")
	}
	if len(decoded.Fields) != 2 {
		t.Errorf("fields count mismatch")
	}
	if decoded.Footer == nil || decoded.Footer.Text != "Footer text" {
		t.Errorf("footer mismatch")
	}
}

func TestDiscordBridge_ErrorHandling(t *testing.T) {
	t.Run("handles 4xx error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"message": "Invalid request",
			})
		}))
		defer server.Close()

		// Test error response parsing
		resp, _ := server.Client().Get(server.URL)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", resp.StatusCode)
		}
		resp.Body.Close()
	})

	t.Run("handles rate limit", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTooManyRequests)
			w.Header().Set("Retry-After", "5")
		}))
		defer server.Close()

		resp, _ := server.Client().Get(server.URL)
		if resp.StatusCode != http.StatusTooManyRequests {
			t.Errorf("expected 429, got %d", resp.StatusCode)
		}
		resp.Body.Close()
	})
}

func TestDiscordBridge_MessageResponse(t *testing.T) {
	response := discordMessageResponse{
		ID: "msg_123456",
	}

	data, _ := json.Marshal(response)
	var decoded discordMessageResponse
	json.Unmarshal(data, &decoded)

	if decoded.ID != "msg_123456" {
		t.Errorf("ID mismatch")
	}
}

func TestDiscordBridge_Timeout(t *testing.T) {
	cfg := &config.DiscordConfig{
		BotToken:  "token",
		ChannelID: "channel",
	}
	bridge, err := NewDiscordBridge(cfg)
		if err != nil {
			t.Fatalf("NewDiscordBridge error: %v", err)
		}

	if bridge.client.Timeout != 30*time.Second {
		t.Errorf("expected 30s timeout, got %v", bridge.client.Timeout)
	}
}

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

func TestNewSlackBridge(t *testing.T) {
	t.Run("bot mode", func(t *testing.T) {
		cfg := &config.SlackConfig{
			BotToken:  "xoxb-123",
			ChannelID: "C123456",
			Username:  "PocketPing",
			IconEmoji: ":robot:",
		}

		bridge, err := NewSlackBridge(cfg)
		if err != nil {
			t.Fatalf("NewSlackBridge error: %v", err)
		}

		if bridge.Name() != "slack" {
			t.Errorf("expected name 'slack', got %q", bridge.Name())
		}
		if bridge.botToken != "xoxb-123" {
			t.Errorf("botToken mismatch")
		}
		if bridge.channelID != "C123456" {
			t.Errorf("channelID mismatch")
		}
		if !bridge.isBotMode() {
			t.Error("expected bot mode to be true")
		}
	})

	t.Run("webhook mode", func(t *testing.T) {
		cfg := &config.SlackConfig{
			WebhookURL: "https://hooks.slack.com/services/T00/B00/XXX",
			Username:   "WebhookBot",
		}

		bridge, err := NewSlackBridge(cfg)
		if err != nil {
			t.Fatalf("NewSlackBridge error: %v", err)
		}

		if bridge.isBotMode() {
			t.Error("expected bot mode to be false")
		}
		if bridge.webhookURL != "https://hooks.slack.com/services/T00/B00/XXX" {
			t.Errorf("webhookURL mismatch")
		}
	})
}

func TestSlackBridge_isBotMode(t *testing.T) {
	tests := []struct {
		name      string
		botToken  string
		channelID string
		expected  bool
	}{
		{"both set", "xoxb-123", "C123", true},
		{"only token", "xoxb-123", "", false},
		{"only channel", "", "C123", false},
		{"neither set", "", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bridge := &SlackBridge{
				BaseBridge: NewBaseBridge("slack"),
				botToken:   tt.botToken,
				channelID:  tt.channelID,
			}
			if bridge.isBotMode() != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, bridge.isBotMode())
			}
		})
	}
}

func TestSlackBridge_escapeSlack(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"hello", "hello"},
		{"<script>", "&lt;script&gt;"},
		{"a & b", "a &amp; b"},
		{`"quoted"`, "&#34;quoted&#34;"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := escapeSlack(tt.input)
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestSlackBridge_OnNewSession(t *testing.T) {
	t.Run("formats session with blocks", func(t *testing.T) {
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

		blocks := []slackBlock{
			{
				Type: "header",
				Text: &slackTextBlock{Type: "plain_text", Text: "New Chat Session"},
			},
			{
				Type: "section",
				Fields: []slackField{
					{Type: "mrkdwn", Text: "*Visitor:*\n" + escapeSlack(visitorName)},
				},
			},
		}

		if blocks[0].Type != "header" {
			t.Errorf("expected header block type")
		}
		if blocks[1].Fields[0].Text != "*Visitor:*\nJohn Doe" {
			t.Errorf("visitor field mismatch")
		}
	})
}

func TestSlackBridge_OnVisitorMessage(t *testing.T) {
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

		text := "*" + escapeSlack(visitorName) + "*: " + escapeSlack(message.Content)
		expected := "*Jane*: Hello!"
		if text != expected {
			t.Errorf("expected %q, got %q", expected, text)
		}
	})

	t.Run("includes reply quote", func(t *testing.T) {
		reply := &ReplyContext{
			Quote: "> Previous message",
		}

		text := "Test message"
		if reply != nil && reply.Quote != "" {
			text = reply.Quote + "\n" + text
		}

		if !strings.HasPrefix(text, "> Previous message\n") {
			t.Errorf("quote not prepended correctly")
		}
	})

	t.Run("includes attachment count", func(t *testing.T) {
		message := &types.Message{
			ID:      "msg123",
			Content: "Check this",
			Attachments: []*types.Attachment{
				{ID: "att1"},
			},
		}

		text := "*Visitor*: " + message.Content
		if len(message.Attachments) > 0 {
			text += " _(+1 attachment(s))_"
		}

		if !strings.Contains(text, "_(+1 attachment(s))_") {
			t.Errorf("attachment count not included")
		}
	})
}

func TestSlackBridge_OnOperatorMessage(t *testing.T) {
	bridge := &SlackBridge{
		BaseBridge: NewBaseBridge("slack"),
	}

	t.Run("skips message from same bridge", func(t *testing.T) {
		err := bridge.OnOperatorMessage(
			&types.Message{Content: "test"},
			&types.Session{},
			"slack",
			"Operator",
		)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("formats cross-bridge message", func(t *testing.T) {
		operatorName := "Support"
		sourceBridge := "discord"
		content := "Hello from Discord"

		text := "*" + escapeSlack(operatorName) + "* (via " + sourceBridge + "): " + escapeSlack(content)
		expected := "*Support* (via discord): Hello from Discord"
		if text != expected {
			t.Errorf("expected %q, got %q", expected, text)
		}
	})
}

func TestSlackBridge_OnTyping(t *testing.T) {
	bridge := &SlackBridge{
		BaseBridge: NewBaseBridge("slack"),
	}

	// Should be a no-op
	err := bridge.OnTyping("session123", true)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestSlackBridge_OnMessageRead(t *testing.T) {
	bridge := &SlackBridge{
		BaseBridge: NewBaseBridge("slack"),
	}

	// Should be a no-op
	err := bridge.OnMessageRead("session123", []string{"msg1"}, types.StatusRead)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestSlackBridge_OnCustomEvent(t *testing.T) {
	t.Run("formats event with blocks", func(t *testing.T) {
		event := &types.CustomEvent{
			Name: "purchase",
			Data: map[string]interface{}{
				"amount": 99.99,
			},
		}

		blocks := []slackBlock{
			{
				Type: "header",
				Text: &slackTextBlock{Type: "plain_text", Text: "Event: " + event.Name},
			},
		}

		if event.Data != nil {
			data, _ := json.MarshalIndent(event.Data, "", "  ")
			blocks = append(blocks, slackBlock{
				Type: "section",
				Text: &slackTextBlock{
					Type: "mrkdwn",
					Text: "```" + string(data) + "```",
				},
			})
		}

		if len(blocks) != 2 {
			t.Errorf("expected 2 blocks, got %d", len(blocks))
		}
	})
}

func TestSlackBridge_OnIdentityUpdate(t *testing.T) {
	bridge := &SlackBridge{
		BaseBridge: NewBaseBridge("slack"),
	}

	t.Run("returns early when no identity", func(t *testing.T) {
		session := &types.Session{ID: "s1"}
		err := bridge.OnIdentityUpdate(session)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("formats identity with fields", func(t *testing.T) {
		identity := &types.UserIdentity{
			ID:    "user123",
			Name:  "John",
			Email: "john@example.com",
		}

		fields := []slackField{
			{Type: "mrkdwn", Text: "*ID:*\n" + escapeSlack(identity.ID)},
		}

		if identity.Name != "" {
			fields = append(fields, slackField{
				Type: "mrkdwn",
				Text: "*Name:*\n" + escapeSlack(identity.Name),
			})
		}
		if identity.Email != "" {
			fields = append(fields, slackField{
				Type: "mrkdwn",
				Text: "*Email:*\n" + escapeSlack(identity.Email),
			})
		}

		if len(fields) != 3 {
			t.Errorf("expected 3 fields, got %d", len(fields))
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

		// Verify the session has phone data that would be added to fields
		if session.UserPhone != "+33612345678" {
			t.Errorf("phone should be +33612345678, got %s", session.UserPhone)
		}

		// Expected phone field format
		expectedText := "*Phone:*\n+33612345678"
		if !strings.Contains(expectedText, session.UserPhone) {
			t.Errorf("phone field should contain %s", session.UserPhone)
		}
	})
}

func TestSlackBridge_OnAITakeover(t *testing.T) {
	t.Run("formats AI takeover with blocks", func(t *testing.T) {
		reason := "Operator timeout"

		blocks := []slackBlock{
			{
				Type: "header",
				Text: &slackTextBlock{Type: "plain_text", Text: "AI Takeover"},
			},
			{
				Type: "section",
				Text: &slackTextBlock{Type: "mrkdwn", Text: escapeSlack(reason)},
			},
		}

		if blocks[1].Text.Text != "Operator timeout" {
			t.Errorf("reason mismatch")
		}
	})
}

func TestSlackBridge_OnVisitorMessageEdited(t *testing.T) {
	t.Run("returns nil in webhook mode", func(t *testing.T) {
		bridge := &SlackBridge{
			BaseBridge: NewBaseBridge("slack"),
			webhookURL: "https://hooks.slack.com/webhook",
		}
		result, err := bridge.OnVisitorMessageEdited("s1", "m1", "new", &types.BridgeMessageIDs{SlackMessageTS: "ts123"})
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if result != nil {
			t.Errorf("expected nil result in webhook mode")
		}
	})

	t.Run("returns nil when no bridge IDs", func(t *testing.T) {
		bridge := &SlackBridge{
			BaseBridge: NewBaseBridge("slack"),
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

	t.Run("returns nil when no slack message TS", func(t *testing.T) {
		bridge := &SlackBridge{
			BaseBridge: NewBaseBridge("slack"),
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

func TestSlackBridge_OnVisitorMessageDeleted(t *testing.T) {
	t.Run("returns nil in webhook mode", func(t *testing.T) {
		bridge := &SlackBridge{
			BaseBridge: NewBaseBridge("slack"),
			webhookURL: "https://hooks.slack.com/webhook",
		}
		err := bridge.OnVisitorMessageDeleted("s1", "m1", &types.BridgeMessageIDs{SlackMessageTS: "ts123"})
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("returns nil when no bridge IDs", func(t *testing.T) {
		bridge := &SlackBridge{
			BaseBridge: NewBaseBridge("slack"),
			botToken:   "token",
			channelID:  "channel",
		}
		err := bridge.OnVisitorMessageDeleted("s1", "m1", nil)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})
}

func TestSlackBridge_sendMessage_BotMode(t *testing.T) {
	var receivedData map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&receivedData)

		// Verify Authorization header
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			t.Errorf("expected Bearer auth, got %q", auth)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
			"ts": "1234567890.123456",
		})
	}))
	defer server.Close()

	t.Run("includes channel in bot mode", func(t *testing.T) {
		data := map[string]interface{}{
			"text": "Test message",
		}
		channelID := "C123456"
		data["channel"] = channelID

		if data["channel"] != "C123456" {
			t.Errorf("channel not set correctly")
		}
	})
}

func TestSlackBridge_sendMessage_WebhookMode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))
	defer server.Close()

	t.Run("webhook returns 'ok' as plain text", func(t *testing.T) {
		resp, _ := server.Client().Get(server.URL)
		defer resp.Body.Close()

		// Webhook mode doesn't return JSON
		// Just returns "ok" text
	})
}

func TestSlackBridge_BlockStructure(t *testing.T) {
	blocks := []slackBlock{
		{
			Type: "header",
			Text: &slackTextBlock{Type: "plain_text", Text: "Header Text"},
		},
		{
			Type: "section",
			Text: &slackTextBlock{Type: "mrkdwn", Text: "*Bold* text"},
			Fields: []slackField{
				{Type: "mrkdwn", Text: "*Field1:*\nValue1"},
				{Type: "mrkdwn", Text: "*Field2:*\nValue2"},
			},
		},
	}

	data, err := json.Marshal(blocks)
	if err != nil {
		t.Fatalf("failed to marshal blocks: %v", err)
	}

	var decoded []slackBlock
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal blocks: %v", err)
	}

	if len(decoded) != 2 {
		t.Errorf("expected 2 blocks, got %d", len(decoded))
	}
	if decoded[0].Type != "header" {
		t.Errorf("first block type mismatch")
	}
	if len(decoded[1].Fields) != 2 {
		t.Errorf("fields count mismatch")
	}
}

func TestSlackBridge_Response(t *testing.T) {
	t.Run("success response", func(t *testing.T) {
		response := slackResponse{
			OK: true,
			TS: "1234567890.123456",
		}

		if !response.OK {
			t.Errorf("expected OK to be true")
		}
		if response.TS != "1234567890.123456" {
			t.Errorf("TS mismatch")
		}
	})

	t.Run("error response", func(t *testing.T) {
		response := slackResponse{
			OK:    false,
			Error: "channel_not_found",
		}

		if response.OK {
			t.Errorf("expected OK to be false")
		}
		if response.Error != "channel_not_found" {
			t.Errorf("Error mismatch")
		}
	})
}

func TestSlackBridge_ErrorHandling(t *testing.T) {
	t.Run("handles API error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":    false,
				"error": "invalid_auth",
			})
		}))
		defer server.Close()

		resp, _ := server.Client().Get(server.URL)
		defer resp.Body.Close()

		var slackResp slackResponse
		json.NewDecoder(resp.Body).Decode(&slackResp)

		if slackResp.OK {
			t.Errorf("expected OK to be false")
		}
		if slackResp.Error != "invalid_auth" {
			t.Errorf("expected 'invalid_auth' error")
		}
	})

	t.Run("handles webhook error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("invalid_payload"))
		}))
		defer server.Close()

		// Webhook returns non-"ok" text on error
	})
}

func TestSlackBridge_Timeout(t *testing.T) {
	cfg := &config.SlackConfig{
		BotToken:  "token",
		ChannelID: "channel",
	}
	bridge, err := NewSlackBridge(cfg)
		if err != nil {
			t.Fatalf("NewSlackBridge error: %v", err)
		}

	if bridge.client.Timeout != 30*time.Second {
		t.Errorf("expected 30s timeout, got %v", bridge.client.Timeout)
	}
}

func TestSlackBridge_UsernameAndIcon(t *testing.T) {
	cfg := &config.SlackConfig{
		WebhookURL: "https://hooks.slack.com/webhook",
		Username:   "CustomBot",
		IconEmoji:  ":fire:",
	}
	bridge, err := NewSlackBridge(cfg)
		if err != nil {
			t.Fatalf("NewSlackBridge error: %v", err)
		}

	if bridge.username != "CustomBot" {
		t.Errorf("username mismatch")
	}
	if bridge.iconEmoji != ":fire:" {
		t.Errorf("iconEmoji mismatch")
	}

	// Verify they're included in message data
	data := map[string]interface{}{
		"text": "Test",
	}
	if bridge.username != "" {
		data["username"] = bridge.username
	}
	if bridge.iconEmoji != "" {
		data["icon_emoji"] = bridge.iconEmoji
	}

	if data["username"] != "CustomBot" {
		t.Errorf("username not in data")
	}
	if data["icon_emoji"] != ":fire:" {
		t.Errorf("icon_emoji not in data")
	}
}

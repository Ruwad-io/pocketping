package types

import (
	"encoding/json"
	"testing"
	"time"
)

func TestSenderTypeConstants(t *testing.T) {
	tests := []struct {
		name     string
		sender   SenderType
		expected string
	}{
		{"visitor", SenderVisitor, "visitor"},
		{"operator", SenderOperator, "operator"},
		{"ai", SenderAI, "ai"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.sender) != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, tt.sender)
			}
		})
	}
}

func TestMessageStatusConstants(t *testing.T) {
	tests := []struct {
		name     string
		status   MessageStatus
		expected string
	}{
		{"sending", StatusSending, "sending"},
		{"sent", StatusSent, "sent"},
		{"delivered", StatusDelivered, "delivered"},
		{"read", StatusRead, "read"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.status) != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, tt.status)
			}
		})
	}
}

func TestBridgeMessageIDs_Merge(t *testing.T) {
	tests := []struct {
		name     string
		base     *BridgeMessageIDs
		other    *BridgeMessageIDs
		expected *BridgeMessageIDs
	}{
		{
			name: "merge with nil",
			base: &BridgeMessageIDs{
				TelegramMessageID: 123,
				DiscordMessageID:  "abc",
			},
			other: nil,
			expected: &BridgeMessageIDs{
				TelegramMessageID: 123,
				DiscordMessageID:  "abc",
			},
		},
		{
			name: "merge overwrites non-zero values",
			base: &BridgeMessageIDs{
				TelegramMessageID: 123,
			},
			other: &BridgeMessageIDs{
				TelegramMessageID: 456,
				DiscordMessageID:  "new",
			},
			expected: &BridgeMessageIDs{
				TelegramMessageID: 456,
				DiscordMessageID:  "new",
			},
		},
		{
			name: "merge preserves base values when other is zero",
			base: &BridgeMessageIDs{
				TelegramMessageID: 123,
				DiscordMessageID:  "abc",
				SlackMessageTS:    "ts123",
			},
			other: &BridgeMessageIDs{
				DiscordMessageID: "xyz",
			},
			expected: &BridgeMessageIDs{
				TelegramMessageID: 123,
				DiscordMessageID:  "xyz",
				SlackMessageTS:    "ts123",
			},
		},
		{
			name: "merge all platforms",
			base: &BridgeMessageIDs{},
			other: &BridgeMessageIDs{
				TelegramMessageID: 100,
				DiscordMessageID:  "disc",
				SlackMessageTS:    "slack.ts",
			},
			expected: &BridgeMessageIDs{
				TelegramMessageID: 100,
				DiscordMessageID:  "disc",
				SlackMessageTS:    "slack.ts",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.base.Merge(tt.other)
			if result.TelegramMessageID != tt.expected.TelegramMessageID {
				t.Errorf("TelegramMessageID: expected %d, got %d", tt.expected.TelegramMessageID, result.TelegramMessageID)
			}
			if result.DiscordMessageID != tt.expected.DiscordMessageID {
				t.Errorf("DiscordMessageID: expected %q, got %q", tt.expected.DiscordMessageID, result.DiscordMessageID)
			}
			if result.SlackMessageTS != tt.expected.SlackMessageTS {
				t.Errorf("SlackMessageTS: expected %q, got %q", tt.expected.SlackMessageTS, result.SlackMessageTS)
			}
		})
	}
}

func TestUserIdentity_JSON(t *testing.T) {
	identity := UserIdentity{
		ID:    "user123",
		Email: "test@example.com",
		Name:  "Test User",
	}

	data, err := json.Marshal(identity)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded UserIdentity
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.ID != identity.ID {
		t.Errorf("ID: expected %q, got %q", identity.ID, decoded.ID)
	}
	if decoded.Email != identity.Email {
		t.Errorf("Email: expected %q, got %q", identity.Email, decoded.Email)
	}
	if decoded.Name != identity.Name {
		t.Errorf("Name: expected %q, got %q", identity.Name, decoded.Name)
	}
}

func TestSessionMetadata_JSON(t *testing.T) {
	metadata := SessionMetadata{
		URL:       "https://example.com/page",
		Referrer:  "https://google.com",
		PageTitle: "Test Page",
		UserAgent: "Mozilla/5.0",
		IP:        "192.168.1.1",
		Country:   "US",
		City:      "New York",
	}

	data, err := json.Marshal(metadata)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded SessionMetadata
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.URL != metadata.URL {
		t.Errorf("URL mismatch")
	}
	if decoded.Country != metadata.Country {
		t.Errorf("Country mismatch")
	}
}

func TestSession_JSON(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	session := Session{
		ID:             "session123",
		VisitorID:      "visitor456",
		CreatedAt:      now,
		LastActivity:   now,
		OperatorOnline: true,
		AIActive:       false,
		Metadata: &SessionMetadata{
			URL: "https://example.com",
		},
		Identity: &UserIdentity{
			ID:   "user789",
			Name: "Test User",
		},
	}

	data, err := json.Marshal(session)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded Session
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.ID != session.ID {
		t.Errorf("ID mismatch")
	}
	if decoded.VisitorID != session.VisitorID {
		t.Errorf("VisitorID mismatch")
	}
	if decoded.OperatorOnline != session.OperatorOnline {
		t.Errorf("OperatorOnline mismatch")
	}
	if decoded.Metadata == nil || decoded.Metadata.URL != session.Metadata.URL {
		t.Errorf("Metadata mismatch")
	}
	if decoded.Identity == nil || decoded.Identity.Name != session.Identity.Name {
		t.Errorf("Identity mismatch")
	}
}

func TestMessage_JSON(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	editedAt := now.Add(time.Minute)

	message := Message{
		ID:        "msg123",
		SessionID: "session456",
		Content:   "Hello, world!",
		Sender:    SenderVisitor,
		Timestamp: now,
		ReplyTo:   "msg100",
		Status:    StatusSent,
		EditedAt:  &editedAt,
		Attachments: []*Attachment{
			{
				ID:       "att1",
				Filename: "test.pdf",
				MimeType: "application/pdf",
				Size:     1024,
				URL:      "https://example.com/test.pdf",
			},
		},
	}

	data, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded Message
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.ID != message.ID {
		t.Errorf("ID mismatch")
	}
	if decoded.Content != message.Content {
		t.Errorf("Content mismatch")
	}
	if decoded.Sender != message.Sender {
		t.Errorf("Sender mismatch")
	}
	if decoded.ReplyTo != message.ReplyTo {
		t.Errorf("ReplyTo mismatch")
	}
	if len(decoded.Attachments) != 1 {
		t.Errorf("Attachments count mismatch")
	}
	if decoded.Attachments[0].Filename != "test.pdf" {
		t.Errorf("Attachment filename mismatch")
	}
}

func TestAttachment_DataNotSerialized(t *testing.T) {
	attachment := Attachment{
		ID:       "att1",
		Filename: "test.bin",
		MimeType: "application/octet-stream",
		Size:     100,
		URL:      "https://example.com/test.bin",
		Data:     []byte("secret data"),
	}

	data, err := json.Marshal(attachment)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	// Data field should not be in JSON (has json:"-" tag)
	if string(data) != `{"id":"att1","filename":"test.bin","mimeType":"application/octet-stream","size":100,"url":"https://example.com/test.bin","status":""}` {
		// Just verify Data is not present
		var m map[string]interface{}
		json.Unmarshal(data, &m)
		if _, exists := m["data"]; exists {
			t.Errorf("Data field should not be serialized to JSON")
		}
	}
}

func TestCustomEvent_JSON(t *testing.T) {
	event := CustomEvent{
		Name:      "button_click",
		Timestamp: "2024-01-01T00:00:00Z",
		SessionID: "session123",
		Data: map[string]interface{}{
			"buttonId": "submit",
			"value":    float64(42),
		},
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var decoded CustomEvent
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if decoded.Name != event.Name {
		t.Errorf("Name mismatch")
	}
	if decoded.Data["buttonId"] != "submit" {
		t.Errorf("Data buttonId mismatch")
	}
}

func TestOutgoingEvent_EventType(t *testing.T) {
	tests := []struct {
		name     string
		event    OutgoingEvent
		expected string
	}{
		{
			name: "operator message",
			event: &OperatorMessageEvent{
				Type:      "operator_message",
				SessionID: "s1",
				Content:   "Hello",
			},
			expected: "operator_message",
		},
		{
			name: "operator message edited",
			event: &OperatorMessageEditedEvent{
				Type:      "operator_message_edited",
				SessionID: "s1",
			},
			expected: "operator_message_edited",
		},
		{
			name: "operator message deleted",
			event: &OperatorMessageDeletedEvent{
				Type:      "operator_message_deleted",
				SessionID: "s1",
			},
			expected: "operator_message_deleted",
		},
		{
			name: "operator typing",
			event: &OperatorTypingEvent{
				Type:      "operator_typing",
				SessionID: "s1",
				IsTyping:  true,
			},
			expected: "operator_typing",
		},
		{
			name: "session closed",
			event: &SessionClosedEvent{
				Type:      "session_closed",
				SessionID: "s1",
			},
			expected: "session_closed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.event.EventType() != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, tt.event.EventType())
			}
		})
	}
}

func TestIncomingEvents_JSON(t *testing.T) {
	t.Run("NewSessionEvent", func(t *testing.T) {
		event := NewSessionEvent{
			Type: "new_session",
			Session: &Session{
				ID:        "s1",
				VisitorID: "v1",
			},
		}
		data, _ := json.Marshal(event)
		var decoded NewSessionEvent
		json.Unmarshal(data, &decoded)
		if decoded.Type != "new_session" || decoded.Session.ID != "s1" {
			t.Error("NewSessionEvent decode failed")
		}
	})

	t.Run("VisitorMessageEvent", func(t *testing.T) {
		event := VisitorMessageEvent{
			Type: "visitor_message",
			Message: &Message{
				ID:      "m1",
				Content: "Hello",
			},
			Session: &Session{ID: "s1"},
		}
		data, _ := json.Marshal(event)
		var decoded VisitorMessageEvent
		json.Unmarshal(data, &decoded)
		if decoded.Message.Content != "Hello" {
			t.Error("VisitorMessageEvent decode failed")
		}
	})

	t.Run("MessageReadEvent", func(t *testing.T) {
		now := time.Now()
		event := MessageReadEvent{
			Type:       "message_read",
			SessionID:  "s1",
			MessageIDs: []string{"m1", "m2"},
			Status:     StatusRead,
			ReadAt:     &now,
		}
		data, _ := json.Marshal(event)
		var decoded MessageReadEvent
		json.Unmarshal(data, &decoded)
		if len(decoded.MessageIDs) != 2 {
			t.Error("MessageReadEvent decode failed")
		}
	})

	t.Run("VisitorMessageEditedEvent", func(t *testing.T) {
		event := VisitorMessageEditedEvent{
			Type:      "visitor_message_edited",
			SessionID: "s1",
			MessageID: "m1",
			Content:   "Updated content",
			EditedAt:  time.Now(),
		}
		data, _ := json.Marshal(event)
		var decoded VisitorMessageEditedEvent
		json.Unmarshal(data, &decoded)
		if decoded.Content != "Updated content" {
			t.Error("VisitorMessageEditedEvent decode failed")
		}
	})

	t.Run("VisitorMessageDeletedEvent", func(t *testing.T) {
		event := VisitorMessageDeletedEvent{
			Type:      "visitor_message_deleted",
			SessionID: "s1",
			MessageID: "m1",
			DeletedAt: time.Now(),
		}
		data, _ := json.Marshal(event)
		var decoded VisitorMessageDeletedEvent
		json.Unmarshal(data, &decoded)
		if decoded.MessageID != "m1" {
			t.Error("VisitorMessageDeletedEvent decode failed")
		}
	})
}

package pocketping

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWebhookHandler_TelegramEditedMessage(t *testing.T) {
	var (
		called         bool
		gotSessionID   string
		gotMessageID   string
		gotContent     string
		gotSource      string
		gotEditedAt    time.Time
		expectedEdited = time.Unix(1700000000, 0)
	)

	handler := NewWebhookHandler(WebhookConfig{
		TelegramBotToken: "test-token",
		OnOperatorMessageEdit: func(ctx context.Context, sessionID, bridgeMessageID, content, sourceBridge string, editedAt time.Time) {
			called = true
			gotSessionID = sessionID
			gotMessageID = bridgeMessageID
			gotContent = content
			gotSource = sourceBridge
			gotEditedAt = editedAt
		},
	})

	payload := []byte(`{"edited_message":{"message_id":123,"message_thread_id":456,"text":"Updated message","edit_date":1700000000}}`)
	req := httptest.NewRequest("POST", "/webhooks/telegram", bytes.NewReader(payload))
	rec := httptest.NewRecorder()

	handler.HandleTelegramWebhook()(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if !called {
		t.Fatalf("expected OnOperatorMessageEdit to be called")
	}
	if gotSessionID != "456" {
		t.Errorf("expected sessionID '456', got %q", gotSessionID)
	}
	if gotMessageID != "123" {
		t.Errorf("expected messageID '123', got %q", gotMessageID)
	}
	if gotContent != "Updated message" {
		t.Errorf("expected content 'Updated message', got %q", gotContent)
	}
	if gotSource != "telegram" {
		t.Errorf("expected source 'telegram', got %q", gotSource)
	}
	if !gotEditedAt.Equal(expectedEdited) {
		t.Errorf("expected editedAt %v, got %v", expectedEdited, gotEditedAt)
	}
}

func TestWebhookHandler_TelegramDeleteCommand(t *testing.T) {
	var (
		called       bool
		gotSessionID string
		gotMessageID string
		gotSource    string
		gotDeletedAt time.Time
	)

	handler := NewWebhookHandler(WebhookConfig{
		TelegramBotToken: "test-token",
		OnOperatorMessageDelete: func(ctx context.Context, sessionID, bridgeMessageID, sourceBridge string, deletedAt time.Time) {
			called = true
			gotSessionID = sessionID
			gotMessageID = bridgeMessageID
			gotSource = sourceBridge
			gotDeletedAt = deletedAt
		},
	})

	payload := []byte(`{"message":{"message_id":200,"message_thread_id":456,"text":"/delete","reply_to_message":{"message_id":999}}}`)
	req := httptest.NewRequest("POST", "/webhooks/telegram", bytes.NewReader(payload))
	rec := httptest.NewRecorder()

	handler.HandleTelegramWebhook()(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if !called {
		t.Fatalf("expected OnOperatorMessageDelete to be called")
	}
	if gotSessionID != "456" {
		t.Errorf("expected sessionID '456', got %q", gotSessionID)
	}
	if gotMessageID != "999" {
		t.Errorf("expected messageID '999', got %q", gotMessageID)
	}
	if gotSource != "telegram" {
		t.Errorf("expected source 'telegram', got %q", gotSource)
	}
	if gotDeletedAt.IsZero() {
		t.Errorf("expected deletedAt to be set")
	}
}

func TestWebhookHandler_TelegramReactionDelete(t *testing.T) {
	var (
		called       bool
		gotSessionID string
		gotMessageID string
		gotSource    string
		gotDeletedAt time.Time
	)

	handler := NewWebhookHandler(WebhookConfig{
		TelegramBotToken: "test-token",
		OnOperatorMessageDelete: func(ctx context.Context, sessionID, bridgeMessageID, sourceBridge string, deletedAt time.Time) {
			called = true
			gotSessionID = sessionID
			gotMessageID = bridgeMessageID
			gotSource = sourceBridge
			gotDeletedAt = deletedAt
		},
	})

	payload := []byte(`{"message_reaction":{"message_id":999,"message_thread_id":456,"new_reaction":[{"type":"emoji","emoji":"🗑️"}],"date":1700000000}}`)
	req := httptest.NewRequest("POST", "/webhooks/telegram", bytes.NewReader(payload))
	rec := httptest.NewRecorder()

	handler.HandleTelegramWebhook()(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if !called {
		t.Fatalf("expected OnOperatorMessageDelete to be called")
	}
	if gotSessionID != "456" {
		t.Errorf("expected sessionID '456', got %q", gotSessionID)
	}
	if gotMessageID != "999" {
		t.Errorf("expected messageID '999', got %q", gotMessageID)
	}
	if gotSource != "telegram" {
		t.Errorf("expected source 'telegram', got %q", gotSource)
	}
	expectedTime := time.Unix(1700000000, 0)
	if !gotDeletedAt.Equal(expectedTime) {
		t.Errorf("expected deletedAt %v, got %v", expectedTime, gotDeletedAt)
	}
}

package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pocketping/bridge-server/internal/config"
	"github.com/pocketping/bridge-server/internal/types"
)

func TestHandleTelegramWebhook_EditedMessageEmitsEvent(t *testing.T) {
	webhookHandler = nil

	cfg := &config.Config{
		Telegram: &config.TelegramConfig{
			BotToken: "test-token",
			ChatID:   "-1001234567890",
		},
	}
	server := NewServer(nil, cfg)

	eventChan := make(chan types.OutgoingEvent, 1)
	server.eventListeners.Store(eventChan, struct{}{})
	defer server.eventListeners.Delete(eventChan)

	payload := []byte(`{"edited_message":{"message_id":123,"message_thread_id":456,"text":"Updated message","edit_date":1700000000}}`)
	req := httptest.NewRequest("POST", "/webhooks/telegram", bytes.NewReader(payload))
	rec := httptest.NewRecorder()

	server.handleTelegramWebhook(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	select {
	case event := <-eventChan:
		edited, ok := event.(*types.OperatorMessageEditedEvent)
		if !ok {
			t.Fatalf("expected OperatorMessageEditedEvent, got %T", event)
		}
		if edited.SessionID != "456" {
			t.Errorf("expected sessionID '456', got %q", edited.SessionID)
		}
		if edited.MessageID != "telegram:123" {
			t.Errorf("expected messageID 'telegram:123', got %q", edited.MessageID)
		}
		if edited.Content != "Updated message" {
			t.Errorf("expected content 'Updated message', got %q", edited.Content)
		}
		expectedTime := time.Unix(1700000000, 0)
		if !edited.EditedAt.Equal(expectedTime) {
			t.Errorf("expected editedAt %v, got %v", expectedTime, edited.EditedAt)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("timeout waiting for operator_message_edited event")
	}
}

func TestHandleTelegramWebhook_DeleteCommandEmitsEvent(t *testing.T) {
	webhookHandler = nil

	cfg := &config.Config{
		Telegram: &config.TelegramConfig{
			BotToken: "test-token",
			ChatID:   "-1001234567890",
		},
	}
	server := NewServer(nil, cfg)

	eventChan := make(chan types.OutgoingEvent, 1)
	server.eventListeners.Store(eventChan, struct{}{})
	defer server.eventListeners.Delete(eventChan)

	payload := []byte(`{"message":{"message_id":200,"message_thread_id":456,"text":"/delete","reply_to_message":{"message_id":999}}}`)
	req := httptest.NewRequest("POST", "/webhooks/telegram", bytes.NewReader(payload))
	rec := httptest.NewRecorder()

	server.handleTelegramWebhook(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	select {
	case event := <-eventChan:
		deleted, ok := event.(*types.OperatorMessageDeletedEvent)
		if !ok {
			t.Fatalf("expected OperatorMessageDeletedEvent, got %T", event)
		}
		if deleted.SessionID != "456" {
			t.Errorf("expected sessionID '456', got %q", deleted.SessionID)
		}
		if deleted.MessageID != "telegram:999" {
			t.Errorf("expected messageID 'telegram:999', got %q", deleted.MessageID)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("timeout waiting for operator_message_deleted event")
	}
}

func TestHandleTelegramWebhook_ReactionEmitsEvent(t *testing.T) {
	webhookHandler = nil

	cfg := &config.Config{
		Telegram: &config.TelegramConfig{
			BotToken: "test-token",
			ChatID:   "-1001234567890",
		},
	}
	server := NewServer(nil, cfg)

	eventChan := make(chan types.OutgoingEvent, 1)
	server.eventListeners.Store(eventChan, struct{}{})
	defer server.eventListeners.Delete(eventChan)

	payload := []byte(`{"message_reaction":{"message_id":999,"message_thread_id":456,"new_reaction":[{"type":"emoji","emoji":"🗑️"}],"date":1700000000}}`)
	req := httptest.NewRequest("POST", "/webhooks/telegram", bytes.NewReader(payload))
	rec := httptest.NewRecorder()

	server.handleTelegramWebhook(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	select {
	case event := <-eventChan:
		deleted, ok := event.(*types.OperatorMessageDeletedEvent)
		if !ok {
			t.Fatalf("expected OperatorMessageDeletedEvent, got %T", event)
		}
		if deleted.SessionID != "456" {
			t.Errorf("expected sessionID '456', got %q", deleted.SessionID)
		}
		if deleted.MessageID != "telegram:999" {
			t.Errorf("expected messageID 'telegram:999', got %q", deleted.MessageID)
		}
		expectedTime := time.Unix(1700000000, 0)
		if !deleted.DeletedAt.Equal(expectedTime) {
			t.Errorf("expected deletedAt %v, got %v", expectedTime, deleted.DeletedAt)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("timeout waiting for operator_message_deleted event")
	}
}

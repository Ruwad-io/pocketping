package pocketping

import (
	"context"
	"testing"
	"time"
)

func TestMemoryStorageCreateSession(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	session := &Session{
		ID:           "sess-123",
		VisitorID:    "visitor-456",
		CreatedAt:    time.Now(),
		LastActivity: time.Now(),
	}

	err := storage.CreateSession(ctx, session)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Verify session was stored
	retrieved, err := storage.GetSession(ctx, "sess-123")
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}

	if retrieved.ID != "sess-123" {
		t.Errorf("expected session id=sess-123, got %v", retrieved.ID)
	}
}

func TestMemoryStorageGetSessionNotFound(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	session, err := storage.GetSession(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if session != nil {
		t.Error("expected nil session for nonexistent ID")
	}
}

func TestMemoryStorageGetSessionByVisitorID(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	// Create older session
	olderSession := &Session{
		ID:           "sess-old",
		VisitorID:    "visitor-123",
		CreatedAt:    time.Now().Add(-time.Hour),
		LastActivity: time.Now().Add(-time.Hour),
	}
	storage.CreateSession(ctx, olderSession)

	// Create newer session
	newerSession := &Session{
		ID:           "sess-new",
		VisitorID:    "visitor-123",
		CreatedAt:    time.Now(),
		LastActivity: time.Now(),
	}
	storage.CreateSession(ctx, newerSession)

	// Should return the newer session
	retrieved, err := storage.GetSessionByVisitorID(ctx, "visitor-123")
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}

	if retrieved.ID != "sess-new" {
		t.Errorf("expected most recent session sess-new, got %v", retrieved.ID)
	}
}

func TestMemoryStorageUpdateSession(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	session := &Session{
		ID:             "sess-123",
		VisitorID:      "visitor-456",
		CreatedAt:      time.Now(),
		LastActivity:   time.Now(),
		OperatorOnline: false,
	}
	storage.CreateSession(ctx, session)

	// Update session
	session.OperatorOnline = true
	err := storage.UpdateSession(ctx, session)
	if err != nil {
		t.Fatalf("failed to update session: %v", err)
	}

	// Verify update
	retrieved, _ := storage.GetSession(ctx, "sess-123")
	if !retrieved.OperatorOnline {
		t.Error("expected operatorOnline=true after update")
	}
}

func TestMemoryStorageDeleteSession(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	session := &Session{
		ID:        "sess-123",
		VisitorID: "visitor-456",
	}
	storage.CreateSession(ctx, session)

	// Add a message
	msg := &Message{
		ID:        "msg-123",
		SessionID: "sess-123",
		Content:   "Hello",
		Sender:    SenderVisitor,
	}
	storage.SaveMessage(ctx, msg)

	// Delete session
	err := storage.DeleteSession(ctx, "sess-123")
	if err != nil {
		t.Fatalf("failed to delete session: %v", err)
	}

	// Verify session is deleted
	retrieved, _ := storage.GetSession(ctx, "sess-123")
	if retrieved != nil {
		t.Error("expected session to be deleted")
	}

	// Verify messages are deleted too
	messages, _ := storage.GetMessages(ctx, "sess-123", "", 50)
	if len(messages) != 0 {
		t.Error("expected messages to be deleted with session")
	}
}

func TestMemoryStorageSaveMessage(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	session := &Session{
		ID:        "sess-123",
		VisitorID: "visitor-456",
	}
	storage.CreateSession(ctx, session)

	msg := &Message{
		ID:        "msg-123",
		SessionID: "sess-123",
		Content:   "Hello, world!",
		Sender:    SenderVisitor,
		Timestamp: time.Now(),
	}

	err := storage.SaveMessage(ctx, msg)
	if err != nil {
		t.Fatalf("failed to save message: %v", err)
	}

	// Retrieve by ID
	retrieved, err := storage.GetMessage(ctx, "msg-123")
	if err != nil {
		t.Fatalf("failed to get message: %v", err)
	}

	if retrieved.Content != "Hello, world!" {
		t.Errorf("expected content='Hello, world!', got %v", retrieved.Content)
	}
}

func TestMemoryStorageGetMessages(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	session := &Session{
		ID:        "sess-123",
		VisitorID: "visitor-456",
	}
	storage.CreateSession(ctx, session)

	// Add multiple messages
	for i := 0; i < 5; i++ {
		msg := &Message{
			ID:        "msg-" + string(rune('a'+i)),
			SessionID: "sess-123",
			Content:   "Message " + string(rune('A'+i)),
			Sender:    SenderVisitor,
			Timestamp: time.Now(),
		}
		storage.SaveMessage(ctx, msg)
	}

	// Get all messages
	messages, err := storage.GetMessages(ctx, "sess-123", "", 50)
	if err != nil {
		t.Fatalf("failed to get messages: %v", err)
	}

	if len(messages) != 5 {
		t.Errorf("expected 5 messages, got %d", len(messages))
	}
}

func TestMemoryStorageGetMessagesWithAfter(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	session := &Session{
		ID:        "sess-123",
		VisitorID: "visitor-456",
	}
	storage.CreateSession(ctx, session)

	// Add multiple messages
	msgIDs := []string{"msg-1", "msg-2", "msg-3", "msg-4", "msg-5"}
	for _, id := range msgIDs {
		msg := &Message{
			ID:        id,
			SessionID: "sess-123",
			Content:   "Content for " + id,
			Sender:    SenderVisitor,
			Timestamp: time.Now(),
		}
		storage.SaveMessage(ctx, msg)
	}

	// Get messages after msg-2
	messages, err := storage.GetMessages(ctx, "sess-123", "msg-2", 50)
	if err != nil {
		t.Fatalf("failed to get messages: %v", err)
	}

	if len(messages) != 3 {
		t.Errorf("expected 3 messages after msg-2, got %d", len(messages))
	}

	if messages[0].ID != "msg-3" {
		t.Errorf("expected first message to be msg-3, got %v", messages[0].ID)
	}
}

func TestMemoryStorageGetMessagesWithLimit(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	session := &Session{
		ID:        "sess-123",
		VisitorID: "visitor-456",
	}
	storage.CreateSession(ctx, session)

	// Add 10 messages
	for i := 0; i < 10; i++ {
		msg := &Message{
			ID:        "msg-" + string(rune('0'+i)),
			SessionID: "sess-123",
			Content:   "Message",
			Sender:    SenderVisitor,
		}
		storage.SaveMessage(ctx, msg)
	}

	// Get with limit
	messages, err := storage.GetMessages(ctx, "sess-123", "", 3)
	if err != nil {
		t.Fatalf("failed to get messages: %v", err)
	}

	if len(messages) != 3 {
		t.Errorf("expected 3 messages with limit, got %d", len(messages))
	}
}

func TestMemoryStorageCleanupOldSessions(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	// Create old session
	oldSession := &Session{
		ID:           "sess-old",
		VisitorID:    "visitor-old",
		CreatedAt:    time.Now().Add(-48 * time.Hour),
		LastActivity: time.Now().Add(-48 * time.Hour),
	}
	storage.CreateSession(ctx, oldSession)

	// Create recent session
	recentSession := &Session{
		ID:           "sess-recent",
		VisitorID:    "visitor-recent",
		CreatedAt:    time.Now(),
		LastActivity: time.Now(),
	}
	storage.CreateSession(ctx, recentSession)

	// Cleanup sessions older than 24 hours
	cutoff := time.Now().Add(-24 * time.Hour)
	count, err := storage.CleanupOldSessions(ctx, cutoff)
	if err != nil {
		t.Fatalf("failed to cleanup: %v", err)
	}

	if count != 1 {
		t.Errorf("expected 1 session cleaned up, got %d", count)
	}

	// Verify old session is gone
	old, _ := storage.GetSession(ctx, "sess-old")
	if old != nil {
		t.Error("expected old session to be deleted")
	}

	// Verify recent session still exists
	recent, _ := storage.GetSession(ctx, "sess-recent")
	if recent == nil {
		t.Error("expected recent session to still exist")
	}
}

func TestMemoryStorageGetAllSessions(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	// Create multiple sessions
	for i := 0; i < 3; i++ {
		session := &Session{
			ID:        "sess-" + string(rune('a'+i)),
			VisitorID: "visitor-" + string(rune('a'+i)),
		}
		storage.CreateSession(ctx, session)
	}

	sessions, err := storage.GetAllSessions(ctx)
	if err != nil {
		t.Fatalf("failed to get all sessions: %v", err)
	}

	if len(sessions) != 3 {
		t.Errorf("expected 3 sessions, got %d", len(sessions))
	}
}

func TestMemoryStorageUpdateMessage(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	session := &Session{
		ID:        "sess-123",
		VisitorID: "visitor-456",
	}
	storage.CreateSession(ctx, session)

	// Create message
	msg := &Message{
		ID:        "msg-123",
		SessionID: "sess-123",
		Content:   "Hello",
		Sender:    SenderVisitor,
		Status:    MessageStatusSent,
	}
	storage.SaveMessage(ctx, msg)

	// Update message status
	now := time.Now()
	msg.Status = MessageStatusRead
	msg.ReadAt = &now
	storage.SaveMessage(ctx, msg)

	// Verify update
	retrieved, _ := storage.GetMessage(ctx, "msg-123")
	if retrieved.Status != MessageStatusRead {
		t.Errorf("expected status=read, got %v", retrieved.Status)
	}
	if retrieved.ReadAt == nil {
		t.Error("expected readAt to be set")
	}
}

func TestMemoryStorageGetSessionCount(t *testing.T) {
	storage := NewMemoryStorage()
	ctx := context.Background()

	// Initially empty
	count, err := storage.GetSessionCount(ctx)
	if err != nil {
		t.Fatalf("failed to get count: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 sessions initially, got %d", count)
	}

	// Add sessions
	for i := 0; i < 5; i++ {
		session := &Session{
			ID:        "sess-" + string(rune('0'+i)),
			VisitorID: "visitor-" + string(rune('0'+i)),
		}
		storage.CreateSession(ctx, session)
	}

	count, _ = storage.GetSessionCount(ctx)
	if count != 5 {
		t.Errorf("expected 5 sessions, got %d", count)
	}
}

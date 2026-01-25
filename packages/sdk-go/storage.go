package pocketping

import (
	"context"
	"sync"
	"time"
)

// Storage is the interface for storage adapters.
// Implement this interface to use any database with PocketPing.
type Storage interface {
	// Session operations
	CreateSession(ctx context.Context, session *Session) error
	GetSession(ctx context.Context, sessionID string) (*Session, error)
	GetSessionByVisitorID(ctx context.Context, visitorID string) (*Session, error)
	UpdateSession(ctx context.Context, session *Session) error
	DeleteSession(ctx context.Context, sessionID string) error

	// Message operations
	SaveMessage(ctx context.Context, message *Message) error
	GetMessages(ctx context.Context, sessionID string, after string, limit int) ([]Message, error)
	GetMessage(ctx context.Context, messageID string) (*Message, error)

	// Optional cleanup
	CleanupOldSessions(ctx context.Context, olderThan time.Time) (int, error)
}

// StorageWithBridgeIDs extends Storage with bridge message ID operations.
// Implement this interface to support edit/delete synchronization with bridges.
type StorageWithBridgeIDs interface {
	Storage

	// UpdateMessage updates an existing message (for edit/delete).
	UpdateMessage(ctx context.Context, message *Message) error

	// SaveBridgeMessageIDs saves platform-specific message IDs for a message.
	SaveBridgeMessageIDs(ctx context.Context, messageID string, bridgeIDs BridgeMessageIds) error

	// GetBridgeMessageIDs retrieves platform-specific message IDs for a message.
	GetBridgeMessageIDs(ctx context.Context, messageID string) (*BridgeMessageIds, error)
}

// MemoryStorage is an in-memory storage adapter.
// Useful for development and testing. Data is lost on restart.
type MemoryStorage struct {
	mu              sync.RWMutex
	sessions        map[string]*Session
	messages        map[string][]Message  // sessionID -> messages
	messageByID     map[string]*Message   // messageID -> message
	bridgeMessageIDs map[string]*BridgeMessageIds // messageID -> bridge IDs
}

// NewMemoryStorage creates a new in-memory storage adapter.
func NewMemoryStorage() *MemoryStorage {
	return &MemoryStorage{
		sessions:         make(map[string]*Session),
		messages:         make(map[string][]Message),
		messageByID:      make(map[string]*Message),
		bridgeMessageIDs: make(map[string]*BridgeMessageIds),
	}
}

// CreateSession creates a new session.
func (m *MemoryStorage) CreateSession(ctx context.Context, session *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.sessions[session.ID] = session
	m.messages[session.ID] = []Message{}
	return nil
}

// GetSession retrieves a session by ID.
func (m *MemoryStorage) GetSession(ctx context.Context, sessionID string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return nil, nil
	}
	return session, nil
}

// GetSessionByVisitorID retrieves the most recent session for a visitor.
func (m *MemoryStorage) GetSessionByVisitorID(ctx context.Context, visitorID string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var latest *Session
	for _, session := range m.sessions {
		if session.VisitorID == visitorID {
			if latest == nil || session.LastActivity.After(latest.LastActivity) {
				latest = session
			}
		}
	}
	return latest, nil
}

// UpdateSession updates an existing session.
func (m *MemoryStorage) UpdateSession(ctx context.Context, session *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.sessions[session.ID] = session
	return nil
}

// DeleteSession deletes a session and its messages.
func (m *MemoryStorage) DeleteSession(ctx context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Remove messages for this session from messageByID
	if msgs, ok := m.messages[sessionID]; ok {
		for _, msg := range msgs {
			delete(m.messageByID, msg.ID)
		}
	}

	delete(m.sessions, sessionID)
	delete(m.messages, sessionID)
	return nil
}

// SaveMessage saves a message.
func (m *MemoryStorage) SaveMessage(ctx context.Context, message *Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if message already exists (update case)
	if existing, ok := m.messageByID[message.ID]; ok {
		// Update existing message
		*existing = *message
		// Update in the slice too
		msgs := m.messages[message.SessionID]
		for i := range msgs {
			if msgs[i].ID == message.ID {
				msgs[i] = *message
				break
			}
		}
		return nil
	}

	// New message
	if _, ok := m.messages[message.SessionID]; !ok {
		m.messages[message.SessionID] = []Message{}
	}
	m.messages[message.SessionID] = append(m.messages[message.SessionID], *message)
	m.messageByID[message.ID] = message
	return nil
}

// GetMessages retrieves messages for a session.
func (m *MemoryStorage) GetMessages(ctx context.Context, sessionID string, after string, limit int) ([]Message, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}

	msgs, ok := m.messages[sessionID]
	if !ok {
		return []Message{}, nil
	}

	startIndex := 0
	if after != "" {
		for i, msg := range msgs {
			if msg.ID == after {
				startIndex = i + 1
				break
			}
		}
	}

	endIndex := startIndex + limit
	if endIndex > len(msgs) {
		endIndex = len(msgs)
	}

	result := make([]Message, endIndex-startIndex)
	copy(result, msgs[startIndex:endIndex])
	return result, nil
}

// GetMessage retrieves a message by ID.
func (m *MemoryStorage) GetMessage(ctx context.Context, messageID string) (*Message, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	msg, ok := m.messageByID[messageID]
	if !ok {
		return nil, nil
	}
	return msg, nil
}

// CleanupOldSessions removes sessions older than the given time.
func (m *MemoryStorage) CleanupOldSessions(ctx context.Context, olderThan time.Time) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	count := 0
	toDelete := []string{}

	for id, session := range m.sessions {
		if session.LastActivity.Before(olderThan) {
			toDelete = append(toDelete, id)
			count++
		}
	}

	for _, id := range toDelete {
		// Remove messages for this session from messageByID
		if msgs, ok := m.messages[id]; ok {
			for _, msg := range msgs {
				delete(m.messageByID, msg.ID)
			}
		}
		delete(m.sessions, id)
		delete(m.messages, id)
	}

	return count, nil
}

// GetAllSessions returns all sessions. Useful for admin/debug.
func (m *MemoryStorage) GetAllSessions(ctx context.Context) ([]*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	sessions := make([]*Session, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	return sessions, nil
}

// GetSessionCount returns the total number of sessions.
func (m *MemoryStorage) GetSessionCount(ctx context.Context) (int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return len(m.sessions), nil
}

// UpdateMessage updates an existing message (for edit/delete).
func (m *MemoryStorage) UpdateMessage(ctx context.Context, message *Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.messageByID[message.ID]; !ok {
		return nil // Message doesn't exist
	}

	// Update in messageByID
	m.messageByID[message.ID] = message

	// Update in the slice too
	msgs := m.messages[message.SessionID]
	for i := range msgs {
		if msgs[i].ID == message.ID {
			msgs[i] = *message
			break
		}
	}

	return nil
}

// SaveBridgeMessageIDs saves platform-specific message IDs for a message.
func (m *MemoryStorage) SaveBridgeMessageIDs(ctx context.Context, messageID string, bridgeIDs BridgeMessageIds) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing := m.bridgeMessageIDs[messageID]
	if existing != nil {
		// Merge with existing
		if bridgeIDs.TelegramMessageID != 0 {
			existing.TelegramMessageID = bridgeIDs.TelegramMessageID
		}
		if bridgeIDs.DiscordMessageID != "" {
			existing.DiscordMessageID = bridgeIDs.DiscordMessageID
		}
		if bridgeIDs.SlackMessageTS != "" {
			existing.SlackMessageTS = bridgeIDs.SlackMessageTS
		}
	} else {
		m.bridgeMessageIDs[messageID] = &bridgeIDs
	}

	return nil
}

// GetBridgeMessageIDs retrieves platform-specific message IDs for a message.
func (m *MemoryStorage) GetBridgeMessageIDs(ctx context.Context, messageID string) (*BridgeMessageIds, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.bridgeMessageIDs[messageID], nil
}

// Ensure MemoryStorage implements Storage interface
var _ Storage = (*MemoryStorage)(nil)

// Ensure MemoryStorage implements StorageWithBridgeIDs interface
var _ StorageWithBridgeIDs = (*MemoryStorage)(nil)

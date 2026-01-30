// Package types defines the core types for PocketPing Bridge Server
package types

import "time"

// UserIdentity represents user identity data from PocketPing.identify()
type UserIdentity struct {
	ID           string                 `json:"id"`
	Email        string                 `json:"email,omitempty"`
	Name         string                 `json:"name,omitempty"`
	CustomFields map[string]interface{} `json:"-"`
}

// SessionMetadata contains metadata about a chat session
type SessionMetadata struct {
	URL              string `json:"url,omitempty"`
	Referrer         string `json:"referrer,omitempty"`
	PageTitle        string `json:"pageTitle,omitempty"`
	UserAgent        string `json:"userAgent,omitempty"`
	Timezone         string `json:"timezone,omitempty"`
	Language         string `json:"language,omitempty"`
	ScreenResolution string `json:"screenResolution,omitempty"`
	IP               string `json:"ip,omitempty"`
	Country          string `json:"country,omitempty"`
	City             string `json:"city,omitempty"`
	DeviceType       string `json:"deviceType,omitempty"`
	Browser          string `json:"browser,omitempty"`
	OS               string `json:"os,omitempty"`
}

// Session represents a chat session
type Session struct {
	ID               string           `json:"id"`
	VisitorID        string           `json:"visitorId"`
	CreatedAt        time.Time        `json:"createdAt"`
	LastActivity     time.Time        `json:"lastActivity"`
	OperatorOnline   bool             `json:"operatorOnline"`
	AIActive         bool             `json:"aiActive"`
	Metadata         *SessionMetadata `json:"metadata,omitempty"`
	Identity         *UserIdentity    `json:"identity,omitempty"`
	UserPhone        string           `json:"userPhone,omitempty"`        // E.164 format: +33612345678
	UserPhoneCountry string           `json:"userPhoneCountry,omitempty"` // ISO: FR, US, etc.
}

// SenderType represents who sent a message
type SenderType string

const (
	SenderVisitor  SenderType = "visitor"
	SenderOperator SenderType = "operator"
	SenderAI       SenderType = "ai"
)

// MessageStatus represents the delivery status of a message
type MessageStatus string

const (
	StatusSending   MessageStatus = "sending"
	StatusSent      MessageStatus = "sent"
	StatusDelivered MessageStatus = "delivered"
	StatusRead      MessageStatus = "read"
)

// Attachment represents a file attachment
type Attachment struct {
	ID           string `json:"id"`
	Filename     string `json:"filename"`
	MimeType     string `json:"mimeType"`
	Size         int64  `json:"size"`
	URL          string `json:"url"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
	Status       string `json:"status"`
	UploadedFrom string `json:"uploadedFrom,omitempty"`
	BridgeFileID string `json:"bridgeFileId,omitempty"`
	Data         []byte `json:"-"` // Raw file data (not serialized to JSON)
}

// Message represents a chat message
type Message struct {
	ID          string        `json:"id"`
	SessionID   string        `json:"sessionId"`
	Content     string        `json:"content"`
	Sender      SenderType    `json:"sender"`
	Timestamp   time.Time     `json:"timestamp"`
	ReplyTo     string        `json:"replyTo,omitempty"`
	Attachments []*Attachment `json:"attachments,omitempty"`
	Status      MessageStatus `json:"status,omitempty"`
	DeliveredAt *time.Time    `json:"deliveredAt,omitempty"`
	ReadAt      *time.Time    `json:"readAt,omitempty"`
	EditedAt    *time.Time    `json:"editedAt,omitempty"`
	DeletedAt   *time.Time    `json:"deletedAt,omitempty"`
}

// CustomEvent represents a custom event from the widget
type CustomEvent struct {
	Name      string                 `json:"name"`
	Data      map[string]interface{} `json:"data,omitempty"`
	Timestamp string                 `json:"timestamp"`
	SessionID string                 `json:"sessionId,omitempty"`
}

// ─────────────────────────────────────────────────────────────────
// Incoming Events (from backends to bridge-server)
// ─────────────────────────────────────────────────────────────────

// IncomingEvent is the base type for events received from backends
type IncomingEvent struct {
	Type string `json:"type"`
}

// NewSessionEvent is sent when a new chat session starts
type NewSessionEvent struct {
	Type    string   `json:"type"`
	Session *Session `json:"session"`
}

// VisitorMessageEvent is sent when a visitor sends a message
type VisitorMessageEvent struct {
	Type    string   `json:"type"`
	Message *Message `json:"message"`
	Session *Session `json:"session"`
}

// AITakeoverEvent is sent when AI takes over the conversation
type AITakeoverEvent struct {
	Type    string   `json:"type"`
	Session *Session `json:"session"`
	Reason  string   `json:"reason"`
}

// OperatorStatusEvent is sent when operator status changes
type OperatorStatusEvent struct {
	Type   string `json:"type"`
	Online bool   `json:"online"`
}

// MessageReadEvent is sent when messages are marked as read
type MessageReadEvent struct {
	Type        string        `json:"type"`
	SessionID   string        `json:"sessionId"`
	MessageIDs  []string      `json:"messageIds"`
	Status      MessageStatus `json:"status"`
	ReadAt      *time.Time    `json:"readAt,omitempty"`
	DeliveredAt *time.Time    `json:"deliveredAt,omitempty"`
}

// CustomEventEvent wraps a custom event with session context
type CustomEventEvent struct {
	Type    string       `json:"type"`
	Event   *CustomEvent `json:"event"`
	Session *Session     `json:"session"`
}

// IdentityUpdateEvent is sent when a user's identity is updated
type IdentityUpdateEvent struct {
	Type    string   `json:"type"`
	Session *Session `json:"session"`
}

// VisitorMessageEditedEvent is sent when a visitor edits a message
type VisitorMessageEditedEvent struct {
	Type      string    `json:"type"`
	SessionID string    `json:"sessionId"`
	MessageID string    `json:"messageId"`
	Content   string    `json:"content"`
	EditedAt  time.Time `json:"editedAt"`
}

// VisitorMessageDeletedEvent is sent when a visitor deletes a message
type VisitorMessageDeletedEvent struct {
	Type      string    `json:"type"`
	SessionID string    `json:"sessionId"`
	MessageID string    `json:"messageId"`
	DeletedAt time.Time `json:"deletedAt"`
}

// VisitorDisconnectEvent is sent when a visitor leaves the page
type VisitorDisconnectEvent struct {
	Type     string `json:"type"`
	Session  *Session `json:"session"`
	Duration int    `json:"duration"` // seconds visitor was on the page
	Reason   string `json:"reason"`   // page_unload, inactivity, manual
}

// ─────────────────────────────────────────────────────────────────
// Outgoing Events (from bridge-server to backends)
// ─────────────────────────────────────────────────────────────────

// OutgoingEvent is an event sent from bridges to backends
type OutgoingEvent interface {
	EventType() string
}

// OperatorMessageEvent is sent when an operator sends a message from a bridge
type OperatorMessageEvent struct {
	Type                   string        `json:"type"`
	SessionID              string        `json:"sessionId"`
	MessageID              string        `json:"messageId"`
	Content                string        `json:"content"`
	SourceBridge           string        `json:"sourceBridge"`
	OperatorName           string        `json:"operatorName,omitempty"`
	Attachments            []*Attachment `json:"attachments,omitempty"`
	ReplyToBridgeMessageID *int          `json:"replyToBridgeMessageId,omitempty"` // Telegram message_id being replied to
}

func (e *OperatorMessageEvent) EventType() string { return "operator_message" }

// OperatorMessageEditedEvent is sent when an operator edits a message from a bridge
type OperatorMessageEditedEvent struct {
	Type      string    `json:"type"`
	SessionID string    `json:"sessionId"`
	MessageID string    `json:"messageId"`
	Content   string    `json:"content"`
	EditedAt  time.Time `json:"editedAt"`
}

func (e *OperatorMessageEditedEvent) EventType() string { return "operator_message_edited" }

// OperatorMessageDeletedEvent is sent when an operator deletes a message from a bridge
type OperatorMessageDeletedEvent struct {
	Type      string    `json:"type"`
	SessionID string    `json:"sessionId"`
	MessageID string    `json:"messageId"`
	DeletedAt time.Time `json:"deletedAt"`
}

func (e *OperatorMessageDeletedEvent) EventType() string { return "operator_message_deleted" }

// OperatorTypingEvent is sent when an operator starts/stops typing
type OperatorTypingEvent struct {
	Type         string `json:"type"`
	SessionID    string `json:"sessionId"`
	IsTyping     bool   `json:"isTyping"`
	SourceBridge string `json:"sourceBridge"`
}

func (e *OperatorTypingEvent) EventType() string { return "operator_typing" }

// SessionClosedEvent is sent when a session is closed from a bridge
type SessionClosedEvent struct {
	Type         string `json:"type"`
	SessionID    string `json:"sessionId"`
	SourceBridge string `json:"sourceBridge"`
}

func (e *SessionClosedEvent) EventType() string { return "session_closed" }

// ─────────────────────────────────────────────────────────────────
// Bridge Message IDs (for edit/delete sync)
// ─────────────────────────────────────────────────────────────────

// BridgeMessageIDs stores platform-specific message IDs
type BridgeMessageIDs struct {
	TelegramMessageID int    `json:"telegramMessageId,omitempty"`
	DiscordMessageID  string `json:"discordMessageId,omitempty"`
	SlackMessageTS    string `json:"slackMessageTs,omitempty"`
}

// Merge combines two BridgeMessageIDs, preferring non-zero values from other
func (b *BridgeMessageIDs) Merge(other *BridgeMessageIDs) *BridgeMessageIDs {
	if other == nil {
		return b
	}
	result := &BridgeMessageIDs{
		TelegramMessageID: b.TelegramMessageID,
		DiscordMessageID:  b.DiscordMessageID,
		SlackMessageTS:    b.SlackMessageTS,
	}
	if other.TelegramMessageID != 0 {
		result.TelegramMessageID = other.TelegramMessageID
	}
	if other.DiscordMessageID != "" {
		result.DiscordMessageID = other.DiscordMessageID
	}
	if other.SlackMessageTS != "" {
		result.SlackMessageTS = other.SlackMessageTS
	}
	return result
}

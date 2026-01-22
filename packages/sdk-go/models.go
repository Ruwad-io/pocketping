// Package pocketping provides a Go SDK for PocketPing chat widget backend.
package pocketping

import (
	"encoding/json"
	"time"
)

// Sender represents who sent a message.
type Sender string

const (
	SenderVisitor  Sender = "visitor"
	SenderOperator Sender = "operator"
	SenderAI       Sender = "ai"
)

// MessageStatus represents the delivery status of a message.
type MessageStatus string

const (
	MessageStatusSending   MessageStatus = "sending"
	MessageStatusSent      MessageStatus = "sent"
	MessageStatusDelivered MessageStatus = "delivered"
	MessageStatusRead      MessageStatus = "read"
)

// VersionStatus represents the result of a version check.
type VersionStatus string

const (
	VersionStatusOK          VersionStatus = "ok"
	VersionStatusOutdated    VersionStatus = "outdated"
	VersionStatusDeprecated  VersionStatus = "deprecated"
	VersionStatusUnsupported VersionStatus = "unsupported"
)

// UserIdentity represents user identity data from PocketPing.identify().
type UserIdentity struct {
	// ID is the required unique user identifier.
	ID string `json:"id"`
	// Email is the user's email address.
	Email string `json:"email,omitempty"`
	// Name is the user's display name.
	Name string `json:"name,omitempty"`
	// Extra holds any custom fields (plan, company, etc.).
	Extra map[string]interface{} `json:"-"`
}

// MarshalJSON implements custom JSON marshaling for UserIdentity.
func (u UserIdentity) MarshalJSON() ([]byte, error) {
	type Alias UserIdentity
	base := map[string]interface{}{}

	// Add base fields
	if u.ID != "" {
		base["id"] = u.ID
	}
	if u.Email != "" {
		base["email"] = u.Email
	}
	if u.Name != "" {
		base["name"] = u.Name
	}

	// Add extra fields
	for k, v := range u.Extra {
		if k != "id" && k != "email" && k != "name" {
			base[k] = v
		}
	}

	return json.Marshal(base)
}

// UnmarshalJSON implements custom JSON unmarshaling for UserIdentity.
func (u *UserIdentity) UnmarshalJSON(data []byte) error {
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	if id, ok := raw["id"].(string); ok {
		u.ID = id
	}
	if email, ok := raw["email"].(string); ok {
		u.Email = email
	}
	if name, ok := raw["name"].(string); ok {
		u.Name = name
	}

	// Store extra fields
	u.Extra = make(map[string]interface{})
	for k, v := range raw {
		if k != "id" && k != "email" && k != "name" {
			u.Extra[k] = v
		}
	}

	return nil
}

// SessionMetadata contains metadata about a visitor's session.
type SessionMetadata struct {
	// Page info
	URL       string `json:"url,omitempty"`
	Referrer  string `json:"referrer,omitempty"`
	PageTitle string `json:"pageTitle,omitempty"`

	// Client info
	UserAgent        string `json:"userAgent,omitempty"`
	Timezone         string `json:"timezone,omitempty"`
	Language         string `json:"language,omitempty"`
	ScreenResolution string `json:"screenResolution,omitempty"`

	// Geo info (populated server-side from IP)
	IP      string `json:"ip,omitempty"`
	Country string `json:"country,omitempty"`
	City    string `json:"city,omitempty"`

	// Device info (parsed from user agent)
	DeviceType string `json:"deviceType,omitempty"` // "desktop", "mobile", "tablet"
	Browser    string `json:"browser,omitempty"`
	OS         string `json:"os,omitempty"`
}

// Session represents a chat session with a visitor.
type Session struct {
	ID             string           `json:"id"`
	VisitorID      string           `json:"visitorId"`
	CreatedAt      time.Time        `json:"createdAt"`
	LastActivity   time.Time        `json:"lastActivity"`
	OperatorOnline bool             `json:"operatorOnline"`
	AIActive       bool             `json:"aiActive"`
	Metadata       *SessionMetadata `json:"metadata,omitempty"`
	Identity       *UserIdentity    `json:"identity,omitempty"`
}

// Message represents a chat message.
type Message struct {
	ID        string                 `json:"id"`
	SessionID string                 `json:"sessionId"`
	Content   string                 `json:"content"`
	Sender    Sender                 `json:"sender"`
	Timestamp time.Time              `json:"timestamp"`
	ReplyTo   string                 `json:"replyTo,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`

	// Read receipt fields
	Status      MessageStatus `json:"status,omitempty"`
	DeliveredAt *time.Time    `json:"deliveredAt,omitempty"`
	ReadAt      *time.Time    `json:"readAt,omitempty"`
}

// TrackedElement represents a tracked element configuration for SaaS auto-tracking.
type TrackedElement struct {
	// Selector is the CSS selector for the element(s) to track.
	Selector string `json:"selector"`
	// Event is the DOM event to listen for (default: 'click').
	Event string `json:"event,omitempty"`
	// Name is the event name sent to backend.
	Name string `json:"name"`
	// WidgetMessage, if provided, opens widget with this message when triggered.
	WidgetMessage string `json:"widgetMessage,omitempty"`
	// Data contains additional data to send with the event.
	Data map[string]interface{} `json:"data,omitempty"`
}

// TriggerOptions contains options for the trigger() method.
type TriggerOptions struct {
	// WidgetMessage, if provided, opens the widget and shows this message.
	WidgetMessage string `json:"widgetMessage,omitempty"`
}

// ConnectRequest is the request to connect/create a session.
type ConnectRequest struct {
	VisitorID string           `json:"visitorId"`
	SessionID string           `json:"sessionId,omitempty"`
	Metadata  *SessionMetadata `json:"metadata,omitempty"`
	Identity  *UserIdentity    `json:"identity,omitempty"`
}

// ConnectResponse is the response after connecting.
type ConnectResponse struct {
	SessionID       string            `json:"sessionId"`
	VisitorID       string            `json:"visitorId"`
	OperatorOnline  bool              `json:"operatorOnline"`
	WelcomeMessage  string            `json:"welcomeMessage,omitempty"`
	Messages        []Message         `json:"messages"`
	TrackedElements []TrackedElement  `json:"trackedElements,omitempty"`
}

// SendMessageRequest is the request to send a message.
type SendMessageRequest struct {
	SessionID string `json:"sessionId"`
	Content   string `json:"content"`
	Sender    Sender `json:"sender"`
	ReplyTo   string `json:"replyTo,omitempty"`
}

// SendMessageResponse is the response after sending a message.
type SendMessageResponse struct {
	MessageID string    `json:"messageId"`
	Timestamp time.Time `json:"timestamp"`
}

// GetMessagesRequest is the request to get messages.
type GetMessagesRequest struct {
	SessionID string `json:"sessionId"`
	After     string `json:"after,omitempty"`
	Limit     int    `json:"limit,omitempty"`
}

// GetMessagesResponse is the response containing messages.
type GetMessagesResponse struct {
	Messages []Message `json:"messages"`
	HasMore  bool      `json:"hasMore"`
}

// TypingRequest is the request to send typing indicator.
type TypingRequest struct {
	SessionID string `json:"sessionId"`
	Sender    Sender `json:"sender"`
	IsTyping  bool   `json:"isTyping"`
}

// ReadRequest is the request to mark messages as read/delivered.
type ReadRequest struct {
	SessionID  string        `json:"sessionId"`
	MessageIDs []string      `json:"messageIds"`
	Status     MessageStatus `json:"status,omitempty"`
}

// ReadResponse is the response after marking messages as read.
type ReadResponse struct {
	Updated int `json:"updated"`
}

// IdentifyRequest is the request to identify a user.
type IdentifyRequest struct {
	SessionID string        `json:"sessionId"`
	Identity  *UserIdentity `json:"identity"`
}

// IdentifyResponse is the response after identifying a user.
type IdentifyResponse struct {
	OK bool `json:"ok"`
}

// PresenceResponse is the response for presence check.
type PresenceResponse struct {
	Online        bool   `json:"online"`
	AIEnabled     bool   `json:"aiEnabled"`
	AIActiveAfter int    `json:"aiActiveAfter,omitempty"`
}

// CustomEvent represents a custom event for bidirectional communication.
type CustomEvent struct {
	// Name is the event name (e.g., 'clicked_pricing', 'show_offer').
	Name string `json:"name"`
	// Data is the event payload.
	Data map[string]interface{} `json:"data,omitempty"`
	// Timestamp is when the event occurred.
	Timestamp time.Time `json:"timestamp"`
	// SessionID is populated by SDK when event comes from widget.
	SessionID string `json:"sessionId,omitempty"`
}

// WebSocketEvent represents a WebSocket event structure.
type WebSocketEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// VersionCheckResult is the result of checking widget version.
type VersionCheckResult struct {
	Status        VersionStatus `json:"status"`
	Message       string        `json:"message,omitempty"`
	MinVersion    string        `json:"minVersion,omitempty"`
	LatestVersion string        `json:"latestVersion,omitempty"`
	CanContinue   bool          `json:"canContinue"`
}

// VersionWarning is a version warning sent to widget.
type VersionWarning struct {
	Severity       string `json:"severity"` // "info", "warning", "error"
	Message        string `json:"message"`
	CurrentVersion string `json:"currentVersion"`
	MinVersion     string `json:"minVersion,omitempty"`
	LatestVersion  string `json:"latestVersion,omitempty"`
	CanContinue    bool   `json:"canContinue"`
	UpgradeURL     string `json:"upgradeUrl,omitempty"`
}

// WebhookPayload is the payload sent to webhook URL.
type WebhookPayload struct {
	Event   CustomEvent    `json:"event"`
	Session WebhookSession `json:"session"`
	SentAt  time.Time      `json:"sentAt"`
}

// WebhookSession is the session info included in webhook payloads.
type WebhookSession struct {
	ID        string           `json:"id"`
	VisitorID string           `json:"visitorId"`
	Metadata  *SessionMetadata `json:"metadata,omitempty"`
	Identity  *UserIdentity    `json:"identity,omitempty"`
}

// CustomEventHandler is a function that handles custom events.
type CustomEventHandler func(event CustomEvent, session *Session)

// MessageHandler is a function that handles messages.
type MessageHandler func(message *Message, session *Session)

// SessionHandler is a function that handles session events.
type SessionHandler func(session *Session)

// MaxMessageContentLength is the maximum allowed message content length.
const MaxMessageContentLength = 4000

// ValidateContent validates message content length.
func ValidateContent(content string) error {
	if len(content) > MaxMessageContentLength {
		return ErrContentTooLong
	}
	return nil
}

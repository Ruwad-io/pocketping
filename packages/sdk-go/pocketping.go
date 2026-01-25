package pocketping

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Common errors
var (
	ErrSessionNotFound     = errors.New("session not found")
	ErrIdentityIDRequired  = errors.New("identity.id is required")
	ErrContentTooLong      = errors.New("message content exceeds maximum length")
	ErrMessageNotFound     = errors.New("message not found")
	ErrUnauthorized        = errors.New("unauthorized: can only edit/delete own messages")
	ErrMessageDeleted      = errors.New("cannot edit deleted message")
	ErrNoContent           = errors.New("content cannot be empty")
)

// Config holds the configuration for PocketPing.
type Config struct {
	// Storage adapter for sessions and messages
	Storage Storage

	// Notification bridges (Telegram, Discord, etc.)
	Bridges []Bridge

	// Welcome message shown to new visitors
	WelcomeMessage string

	// Callback when a new session is created
	OnNewSession SessionHandler

	// Callback when a message is received
	OnMessage MessageHandler

	// Callback when a custom event is received from widget
	OnEvent CustomEventHandler

	// Callback when a user identifies themselves
	OnIdentify SessionHandler

	// Webhook URL to forward custom events (Zapier, Make, n8n, etc.)
	WebhookURL string

	// Secret key for HMAC-SHA256 signature (X-PocketPing-Signature header)
	WebhookSecret string

	// Webhook request timeout (default: 5 seconds)
	WebhookTimeout time.Duration

	// Minimum supported widget version (e.g., "0.2.0")
	MinWidgetVersion string

	// Latest available widget version (e.g., "0.3.0")
	LatestWidgetVersion string

	// Custom message for version warnings
	VersionWarningMessage string

	// URL to upgrade instructions
	VersionUpgradeURL string

	// TrackedElements to return in connect response
	TrackedElements []TrackedElement

	// IpFilter configuration for IP filtering
	IpFilter *IpFilterConfig
}

// PocketPing is the main struct for handling chat sessions.
type PocketPing struct {
	config         Config
	storage        Storage
	bridges        []Bridge
	operatorOnline bool

	// WebSocket connections (sessionID -> set of connections)
	socketsMu      sync.RWMutex
	sessionSockets map[string]map[WebSocketConn]struct{}

	// Custom event handlers
	handlersMu    sync.RWMutex
	eventHandlers map[string][]CustomEventHandler

	// HTTP client for webhooks
	httpClient *http.Client
}

// WebSocketConn is an interface for WebSocket connections.
type WebSocketConn interface {
	WriteJSON(v interface{}) error
	Close() error
}

// New creates a new PocketPing instance.
func New(config Config) *PocketPing {
	storage := config.Storage
	if storage == nil {
		storage = NewMemoryStorage()
	}

	timeout := config.WebhookTimeout
	if timeout == 0 {
		timeout = 5 * time.Second
	}

	pp := &PocketPing{
		config:         config,
		storage:        storage,
		bridges:        config.Bridges,
		sessionSockets: make(map[string]map[WebSocketConn]struct{}),
		eventHandlers:  make(map[string][]CustomEventHandler),
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}

	return pp
}

// Start initializes PocketPing and all bridges.
func (pp *PocketPing) Start(ctx context.Context) error {
	for _, bridge := range pp.bridges {
		if err := bridge.Init(ctx, pp); err != nil {
			return fmt.Errorf("failed to init bridge %s: %w", bridge.Name(), err)
		}
	}
	return nil
}

// Stop gracefully shuts down PocketPing.
func (pp *PocketPing) Stop(ctx context.Context) error {
	for _, bridge := range pp.bridges {
		if err := bridge.Destroy(ctx); err != nil {
			// Log but continue
			continue
		}
	}
	return nil
}

// generateID generates a unique ID.
func (pp *PocketPing) generateID() string {
	timestamp := fmt.Sprintf("%x", time.Now().UnixMilli())
	random := fmt.Sprintf("%x", time.Now().UnixNano()%1000000)
	return fmt.Sprintf("%s-%s", timestamp, random)
}

// HandleConnect handles a connection request from the widget.
func (pp *PocketPing) HandleConnect(ctx context.Context, request ConnectRequest) (*ConnectResponse, error) {
	var session *Session

	// Try to resume existing session by sessionID
	if request.SessionID != "" {
		s, err := pp.storage.GetSession(ctx, request.SessionID)
		if err != nil {
			return nil, err
		}
		session = s
	}

	// Try to find existing session by visitorID
	if session == nil {
		s, err := pp.storage.GetSessionByVisitorID(ctx, request.VisitorID)
		if err != nil {
			return nil, err
		}
		session = s
	}

	// Create new session if needed
	if session == nil {
		session = &Session{
			ID:             pp.generateID(),
			VisitorID:      request.VisitorID,
			CreatedAt:      time.Now(),
			LastActivity:   time.Now(),
			OperatorOnline: pp.operatorOnline,
			AIActive:       false,
			Metadata:       request.Metadata,
			Identity:       request.Identity,
		}

		if err := pp.storage.CreateSession(ctx, session); err != nil {
			return nil, err
		}

		// Notify bridges about new session
		pp.notifyBridgesNewSession(ctx, session)

		// Callback
		if pp.config.OnNewSession != nil {
			pp.config.OnNewSession(session)
		}
	} else {
		needsUpdate := false

		// Update metadata for returning visitor
		if request.Metadata != nil {
			if session.Metadata != nil {
				// Preserve server-side fields
				if session.Metadata.IP != "" {
					request.Metadata.IP = session.Metadata.IP
				}
				if session.Metadata.Country != "" {
					request.Metadata.Country = session.Metadata.Country
				}
				if session.Metadata.City != "" {
					request.Metadata.City = session.Metadata.City
				}
			}
			session.Metadata = request.Metadata
			needsUpdate = true
		}

		// Update identity if provided
		if request.Identity != nil {
			session.Identity = request.Identity
			needsUpdate = true
		}

		if needsUpdate {
			session.LastActivity = time.Now()
			if err := pp.storage.UpdateSession(ctx, session); err != nil {
				return nil, err
			}
		}
	}

	// Get existing messages
	messages, err := pp.storage.GetMessages(ctx, session.ID, "", 50)
	if err != nil {
		return nil, err
	}

	return &ConnectResponse{
		SessionID:       session.ID,
		VisitorID:       session.VisitorID,
		OperatorOnline:  pp.operatorOnline,
		WelcomeMessage:  pp.config.WelcomeMessage,
		Messages:        messages,
		TrackedElements: pp.config.TrackedElements,
	}, nil
}

// HandleMessage handles a message from visitor or operator.
func (pp *PocketPing) HandleMessage(ctx context.Context, request SendMessageRequest) (*SendMessageResponse, error) {
	// Validate content length
	if err := ValidateContent(request.Content); err != nil {
		return nil, err
	}

	session, err := pp.storage.GetSession(ctx, request.SessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, ErrSessionNotFound
	}

	now := time.Now()
	message := &Message{
		ID:        pp.generateID(),
		SessionID: request.SessionID,
		Content:   request.Content,
		Sender:    request.Sender,
		Timestamp: now,
		ReplyTo:   request.ReplyTo,
		Status:    MessageStatusSent,
	}

	if err := pp.storage.SaveMessage(ctx, message); err != nil {
		return nil, err
	}

	// Update session activity
	session.LastActivity = now

	// If operator responds, disable AI for this session
	if request.Sender == SenderOperator && session.AIActive {
		session.AIActive = false
	}

	if err := pp.storage.UpdateSession(ctx, session); err != nil {
		return nil, err
	}

	// Notify bridges (only for visitor messages)
	if request.Sender == SenderVisitor {
		pp.notifyBridgesMessage(ctx, message, session)
	}

	// Broadcast to WebSocket clients
	pp.BroadcastToSession(request.SessionID, WebSocketEvent{
		Type: "message",
		Data: message,
	})

	// Callback
	if pp.config.OnMessage != nil {
		pp.config.OnMessage(message, session)
	}

	return &SendMessageResponse{
		MessageID: message.ID,
		Timestamp: now,
	}, nil
}

// HandleGetMessages retrieves messages for a session.
func (pp *PocketPing) HandleGetMessages(ctx context.Context, request GetMessagesRequest) (*GetMessagesResponse, error) {
	limit := request.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	messages, err := pp.storage.GetMessages(ctx, request.SessionID, request.After, limit+1)
	if err != nil {
		return nil, err
	}

	hasMore := len(messages) > limit
	if hasMore {
		messages = messages[:limit]
	}

	return &GetMessagesResponse{
		Messages: messages,
		HasMore:  hasMore,
	}, nil
}

// HandleTyping handles typing indicator.
func (pp *PocketPing) HandleTyping(ctx context.Context, request TypingRequest) error {
	pp.BroadcastToSession(request.SessionID, WebSocketEvent{
		Type: "typing",
		Data: map[string]interface{}{
			"sessionId": request.SessionID,
			"sender":    request.Sender,
			"isTyping":  request.IsTyping,
		},
	})
	return nil
}

// HandlePresence returns operator presence status.
func (pp *PocketPing) HandlePresence(ctx context.Context) *PresenceResponse {
	return &PresenceResponse{
		Online:    pp.operatorOnline,
		AIEnabled: false, // AI not implemented in Go SDK yet
	}
}

// HandleEditMessage handles editing a visitor's message.
func (pp *PocketPing) HandleEditMessage(ctx context.Context, request EditMessageRequest) (*EditMessageResponse, error) {
	if strings.TrimSpace(request.Content) == "" {
		return nil, ErrNoContent
	}

	// Validate content length
	if err := ValidateContent(request.Content); err != nil {
		return nil, err
	}

	session, err := pp.storage.GetSession(ctx, request.SessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, ErrSessionNotFound
	}

	message, err := pp.storage.GetMessage(ctx, request.MessageID)
	if err != nil {
		return nil, err
	}
	if message == nil {
		return nil, ErrMessageNotFound
	}

	// Verify message belongs to this session
	if message.SessionID != request.SessionID {
		return nil, ErrMessageNotFound
	}

	// Only visitors can edit their own messages
	if message.Sender != SenderVisitor {
		return nil, ErrUnauthorized
	}

	// Cannot edit deleted messages
	if message.DeletedAt != nil {
		return nil, ErrMessageDeleted
	}

	now := time.Now()
	message.Content = request.Content
	message.EditedAt = &now

	// Try to use StorageWithBridgeIDs if available
	if storageWithBridge, ok := pp.storage.(StorageWithBridgeIDs); ok {
		if err := storageWithBridge.UpdateMessage(ctx, message); err != nil {
			return nil, err
		}
	} else {
		if err := pp.storage.SaveMessage(ctx, message); err != nil {
			return nil, err
		}
	}

	// Sync edit to bridges
	pp.syncEditToBridges(ctx, request.SessionID, request.MessageID, request.Content, now)

	// Broadcast to WebSocket
	pp.BroadcastToSession(request.SessionID, WebSocketEvent{
		Type: "message_edited",
		Data: map[string]interface{}{
			"messageId": request.MessageID,
			"content":   request.Content,
			"editedAt":  now.Format(time.RFC3339),
		},
	})

	return &EditMessageResponse{
		Message: struct {
			ID       string    `json:"id"`
			Content  string    `json:"content"`
			EditedAt time.Time `json:"editedAt"`
		}{
			ID:       message.ID,
			Content:  message.Content,
			EditedAt: now,
		},
	}, nil
}

// HandleDeleteMessage handles deleting a visitor's message.
func (pp *PocketPing) HandleDeleteMessage(ctx context.Context, request DeleteMessageRequest) (*DeleteMessageResponse, error) {
	session, err := pp.storage.GetSession(ctx, request.SessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, ErrSessionNotFound
	}

	message, err := pp.storage.GetMessage(ctx, request.MessageID)
	if err != nil {
		return nil, err
	}
	if message == nil {
		return nil, ErrMessageNotFound
	}

	// Verify message belongs to this session
	if message.SessionID != request.SessionID {
		return nil, ErrMessageNotFound
	}

	// Only visitors can delete their own messages
	if message.Sender != SenderVisitor {
		return nil, ErrUnauthorized
	}

	// Sync delete to bridges BEFORE soft delete (we need bridge IDs)
	now := time.Now()
	pp.syncDeleteToBridges(ctx, request.SessionID, request.MessageID, now)

	// Soft delete the message
	message.DeletedAt = &now

	// Try to use StorageWithBridgeIDs if available
	if storageWithBridge, ok := pp.storage.(StorageWithBridgeIDs); ok {
		if err := storageWithBridge.UpdateMessage(ctx, message); err != nil {
			return nil, err
		}
	} else {
		if err := pp.storage.SaveMessage(ctx, message); err != nil {
			return nil, err
		}
	}

	// Broadcast to WebSocket
	pp.BroadcastToSession(request.SessionID, WebSocketEvent{
		Type: "message_deleted",
		Data: map[string]interface{}{
			"messageId": request.MessageID,
			"deletedAt": now.Format(time.RFC3339),
		},
	})

	return &DeleteMessageResponse{Deleted: true}, nil
}

// HandleRead handles message read/delivered status update.
func (pp *PocketPing) HandleRead(ctx context.Context, request ReadRequest) (*ReadResponse, error) {
	session, err := pp.storage.GetSession(ctx, request.SessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, ErrSessionNotFound
	}

	status := request.Status
	if status == "" {
		status = MessageStatusRead
	}

	now := time.Now()
	updated := 0

	for _, messageID := range request.MessageIDs {
		msg, err := pp.storage.GetMessage(ctx, messageID)
		if err != nil || msg == nil {
			continue
		}

		if msg.SessionID != request.SessionID {
			continue
		}

		msg.Status = status
		if status == MessageStatusDelivered {
			msg.DeliveredAt = &now
		} else if status == MessageStatusRead {
			if msg.DeliveredAt == nil {
				msg.DeliveredAt = &now
			}
			msg.ReadAt = &now
		}

		if err := pp.storage.SaveMessage(ctx, msg); err != nil {
			continue
		}
		updated++
	}

	// Broadcast read event
	if updated > 0 {
		broadcastData := map[string]interface{}{
			"sessionId":  request.SessionID,
			"messageIds": request.MessageIDs,
			"status":     status,
		}
		if status == MessageStatusDelivered {
			broadcastData["deliveredAt"] = now.Format(time.RFC3339)
		} else if status == MessageStatusRead {
			broadcastData["readAt"] = now.Format(time.RFC3339)
			broadcastData["deliveredAt"] = now.Format(time.RFC3339)
		}

		pp.BroadcastToSession(request.SessionID, WebSocketEvent{
			Type: "read",
			Data: broadcastData,
		})

		// Notify bridges
		pp.notifyBridgesRead(ctx, request.SessionID, request.MessageIDs, status)
	}

	return &ReadResponse{Updated: updated}, nil
}

// HandleIdentify handles user identification from widget.
func (pp *PocketPing) HandleIdentify(ctx context.Context, request IdentifyRequest) (*IdentifyResponse, error) {
	if request.Identity == nil || request.Identity.ID == "" {
		return nil, ErrIdentityIDRequired
	}

	session, err := pp.storage.GetSession(ctx, request.SessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, ErrSessionNotFound
	}

	// Update session with identity
	session.Identity = request.Identity
	session.LastActivity = time.Now()

	if err := pp.storage.UpdateSession(ctx, session); err != nil {
		return nil, err
	}

	// Notify bridges about identity update
	pp.notifyBridgesIdentity(ctx, session)

	// Callback
	if pp.config.OnIdentify != nil {
		pp.config.OnIdentify(session)
	}

	// Forward identity event to webhook
	if pp.config.WebhookURL != "" {
		go pp.forwardIdentityToWebhook(ctx, session)
	}

	return &IdentifyResponse{OK: true}, nil
}

// GetSession retrieves a session by ID.
func (pp *PocketPing) GetSession(ctx context.Context, sessionID string) (*Session, error) {
	return pp.storage.GetSession(ctx, sessionID)
}

// GetStorage returns the storage adapter.
func (pp *PocketPing) GetStorage() Storage {
	return pp.storage
}

// SendOperatorMessage sends a message as the operator.
func (pp *PocketPing) SendOperatorMessage(ctx context.Context, sessionID, content string, sourceBridge, operatorName string) (*Message, error) {
	response, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: sessionID,
		Content:   content,
		Sender:    SenderOperator,
	})
	if err != nil {
		return nil, err
	}

	message := &Message{
		ID:        response.MessageID,
		SessionID: sessionID,
		Content:   content,
		Sender:    SenderOperator,
		Timestamp: response.Timestamp,
	}

	// Notify bridges for cross-bridge sync
	session, err := pp.storage.GetSession(ctx, sessionID)
	if err == nil && session != nil {
		pp.notifyBridgesOperatorMessage(ctx, message, session, sourceBridge, operatorName)
	}

	return message, nil
}

// SetOperatorOnline sets operator online/offline status.
func (pp *PocketPing) SetOperatorOnline(online bool) {
	pp.operatorOnline = online

	// Broadcast to all sessions
	pp.socketsMu.RLock()
	sessionIDs := make([]string, 0, len(pp.sessionSockets))
	for sessionID := range pp.sessionSockets {
		sessionIDs = append(sessionIDs, sessionID)
	}
	pp.socketsMu.RUnlock()

	for _, sessionID := range sessionIDs {
		pp.BroadcastToSession(sessionID, WebSocketEvent{
			Type: "presence",
			Data: map[string]interface{}{"online": online},
		})
	}
}

// IsOperatorOnline returns whether an operator is online.
func (pp *PocketPing) IsOperatorOnline() bool {
	return pp.operatorOnline
}

// OnEvent subscribes to a custom event.
// Returns an unsubscribe function.
func (pp *PocketPing) OnEvent(eventName string, handler CustomEventHandler) func() {
	pp.handlersMu.Lock()
	pp.eventHandlers[eventName] = append(pp.eventHandlers[eventName], handler)
	pp.handlersMu.Unlock()

	return func() {
		pp.OffEvent(eventName, handler)
	}
}

// OffEvent unsubscribes from a custom event.
func (pp *PocketPing) OffEvent(eventName string, handler CustomEventHandler) {
	pp.handlersMu.Lock()
	defer pp.handlersMu.Unlock()

	handlers := pp.eventHandlers[eventName]
	for i, h := range handlers {
		// Compare function pointers - this is a limitation in Go
		if fmt.Sprintf("%p", h) == fmt.Sprintf("%p", handler) {
			pp.eventHandlers[eventName] = append(handlers[:i], handlers[i+1:]...)
			break
		}
	}
}

// EmitEvent sends a custom event to a specific session.
func (pp *PocketPing) EmitEvent(sessionID, eventName string, data map[string]interface{}) {
	event := CustomEvent{
		Name:      eventName,
		Data:      data,
		Timestamp: time.Now(),
		SessionID: sessionID,
	}

	pp.BroadcastToSession(sessionID, WebSocketEvent{
		Type: "event",
		Data: event,
	})
}

// BroadcastEvent broadcasts a custom event to all connected sessions.
func (pp *PocketPing) BroadcastEvent(eventName string, data map[string]interface{}) {
	pp.socketsMu.RLock()
	sessionIDs := make([]string, 0, len(pp.sessionSockets))
	for sessionID := range pp.sessionSockets {
		sessionIDs = append(sessionIDs, sessionID)
	}
	pp.socketsMu.RUnlock()

	for _, sessionID := range sessionIDs {
		pp.EmitEvent(sessionID, eventName, data)
	}
}

// HandleCustomEvent processes an incoming custom event from the widget.
func (pp *PocketPing) HandleCustomEvent(ctx context.Context, sessionID string, event CustomEvent) error {
	session, err := pp.storage.GetSession(ctx, sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		return ErrSessionNotFound
	}

	event.SessionID = sessionID

	// Call specific event handlers
	pp.handlersMu.RLock()
	handlers := append([]CustomEventHandler{}, pp.eventHandlers[event.Name]...)
	wildcardHandlers := append([]CustomEventHandler{}, pp.eventHandlers["*"]...)
	pp.handlersMu.RUnlock()

	for _, handler := range handlers {
		handler(event, session)
	}

	for _, handler := range wildcardHandlers {
		handler(event, session)
	}

	// Call config callback
	if pp.config.OnEvent != nil {
		pp.config.OnEvent(event, session)
	}

	// Notify bridges
	pp.notifyBridgesEvent(ctx, event, session)

	// Forward to webhook
	if pp.config.WebhookURL != "" {
		go pp.forwardToWebhook(ctx, event, session)
	}

	return nil
}

// TriggerEvent processes a custom event server-side.
func (pp *PocketPing) TriggerEvent(ctx context.Context, sessionID, eventName string, data map[string]interface{}) error {
	event := CustomEvent{
		Name:      eventName,
		Data:      data,
		Timestamp: time.Now(),
		SessionID: sessionID,
	}
	return pp.HandleCustomEvent(ctx, sessionID, event)
}

// RegisterWebSocket registers a WebSocket connection for a session.
func (pp *PocketPing) RegisterWebSocket(sessionID string, conn WebSocketConn) {
	pp.socketsMu.Lock()
	defer pp.socketsMu.Unlock()

	if pp.sessionSockets[sessionID] == nil {
		pp.sessionSockets[sessionID] = make(map[WebSocketConn]struct{})
	}
	pp.sessionSockets[sessionID][conn] = struct{}{}
}

// UnregisterWebSocket unregisters a WebSocket connection.
func (pp *PocketPing) UnregisterWebSocket(sessionID string, conn WebSocketConn) {
	pp.socketsMu.Lock()
	defer pp.socketsMu.Unlock()

	if sockets, ok := pp.sessionSockets[sessionID]; ok {
		delete(sockets, conn)
		if len(sockets) == 0 {
			delete(pp.sessionSockets, sessionID)
		}
	}
}

// BroadcastToSession broadcasts an event to all WebSocket connections for a session.
func (pp *PocketPing) BroadcastToSession(sessionID string, event WebSocketEvent) {
	pp.socketsMu.RLock()
	sockets := pp.sessionSockets[sessionID]
	if sockets == nil {
		pp.socketsMu.RUnlock()
		return
	}

	// Copy to avoid holding lock during write
	conns := make([]WebSocketConn, 0, len(sockets))
	for conn := range sockets {
		conns = append(conns, conn)
	}
	pp.socketsMu.RUnlock()

	deadConns := []WebSocketConn{}
	for _, conn := range conns {
		if err := conn.WriteJSON(event); err != nil {
			deadConns = append(deadConns, conn)
		}
	}

	// Clean up dead connections
	for _, conn := range deadConns {
		pp.UnregisterWebSocket(sessionID, conn)
	}
}

// AddBridge adds a bridge dynamically.
func (pp *PocketPing) AddBridge(ctx context.Context, bridge Bridge) error {
	if err := bridge.Init(ctx, pp); err != nil {
		return err
	}
	pp.bridges = append(pp.bridges, bridge)
	return nil
}

// CheckWidgetVersion checks widget version compatibility.
func (pp *PocketPing) CheckWidgetVersion(widgetVersion string) VersionCheckResult {
	return CheckWidgetVersion(
		widgetVersion,
		pp.config.MinWidgetVersion,
		pp.config.LatestWidgetVersion,
		pp.config.VersionWarningMessage,
	)
}

// SendVersionWarning sends a version warning via WebSocket.
func (pp *PocketPing) SendVersionWarning(sessionID string, result VersionCheckResult, currentVersion string) {
	if result.Status == VersionStatusOK {
		return
	}

	warning := CreateVersionWarning(result, currentVersion, pp.config.VersionUpgradeURL)

	pp.BroadcastToSession(sessionID, WebSocketEvent{
		Type: "version_warning",
		Data: warning,
	})
}

// Bridge notification helpers

func (pp *PocketPing) notifyBridgesNewSession(ctx context.Context, session *Session) {
	for _, bridge := range pp.bridges {
		go func(b Bridge) {
			_ = b.OnNewSession(ctx, session)
		}(bridge)
	}
}

func (pp *PocketPing) notifyBridgesMessage(ctx context.Context, message *Message, session *Session) {
	for _, bridge := range pp.bridges {
		go func(b Bridge) {
			_ = b.OnVisitorMessage(ctx, message, session)
		}(bridge)
	}
}

func (pp *PocketPing) notifyBridgesOperatorMessage(ctx context.Context, message *Message, session *Session, sourceBridge, operatorName string) {
	for _, bridge := range pp.bridges {
		go func(b Bridge) {
			_ = b.OnOperatorMessage(ctx, message, session, sourceBridge, operatorName)
		}(bridge)
	}
}

func (pp *PocketPing) notifyBridgesRead(ctx context.Context, sessionID string, messageIDs []string, status MessageStatus) {
	for _, bridge := range pp.bridges {
		go func(b Bridge) {
			_ = b.OnMessageRead(ctx, sessionID, messageIDs, status)
		}(bridge)
	}
}

func (pp *PocketPing) notifyBridgesEvent(ctx context.Context, event CustomEvent, session *Session) {
	for _, bridge := range pp.bridges {
		go func(b Bridge) {
			_ = b.OnCustomEvent(ctx, event, session)
		}(bridge)
	}
}

func (pp *PocketPing) notifyBridgesIdentity(ctx context.Context, session *Session) {
	for _, bridge := range pp.bridges {
		go func(b Bridge) {
			_ = b.OnIdentityUpdate(ctx, session)
		}(bridge)
	}
}

func (pp *PocketPing) syncEditToBridges(ctx context.Context, sessionID, messageID, content string, editedAt time.Time) {
	for _, bridge := range pp.bridges {
		go func(b Bridge) {
			if bridgeWithEdit, ok := b.(BridgeWithEditDelete); ok {
				_, _ = bridgeWithEdit.OnMessageEdit(ctx, sessionID, messageID, content, editedAt)
			}
		}(bridge)
	}
}

func (pp *PocketPing) syncDeleteToBridges(ctx context.Context, sessionID, messageID string, deletedAt time.Time) {
	for _, bridge := range pp.bridges {
		go func(b Bridge) {
			if bridgeWithDelete, ok := b.(BridgeWithEditDelete); ok {
				_ = bridgeWithDelete.OnMessageDelete(ctx, sessionID, messageID, deletedAt)
			}
		}(bridge)
	}
}

// Webhook forwarding

func (pp *PocketPing) forwardToWebhook(ctx context.Context, event CustomEvent, session *Session) {
	if pp.config.WebhookURL == "" {
		return
	}

	payload := WebhookPayload{
		Event: event,
		Session: WebhookSession{
			ID:        session.ID,
			VisitorID: session.VisitorID,
			Metadata:  session.Metadata,
			Identity:  session.Identity,
		},
		SentAt: time.Now(),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return
	}

	req, err := http.NewRequestWithContext(ctx, "POST", pp.config.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return
	}

	req.Header.Set("Content-Type", "application/json")

	// Add HMAC signature if secret is configured
	if pp.config.WebhookSecret != "" {
		h := hmac.New(sha256.New, []byte(pp.config.WebhookSecret))
		h.Write(body)
		signature := hex.EncodeToString(h.Sum(nil))
		req.Header.Set("X-PocketPing-Signature", "sha256="+signature)
	}

	resp, err := pp.httpClient.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
}

func (pp *PocketPing) forwardIdentityToWebhook(ctx context.Context, session *Session) {
	if pp.config.WebhookURL == "" || session.Identity == nil {
		return
	}

	event := CustomEvent{
		Name:      "identify",
		Data:      identityToMap(session.Identity),
		Timestamp: time.Now(),
		SessionID: session.ID,
	}

	pp.forwardToWebhook(ctx, event, session)
}

func identityToMap(identity *UserIdentity) map[string]interface{} {
	if identity == nil {
		return nil
	}
	result := map[string]interface{}{
		"id": identity.ID,
	}
	if identity.Email != "" {
		result["email"] = identity.Email
	}
	if identity.Name != "" {
		result["name"] = identity.Name
	}
	for k, v := range identity.Extra {
		result[k] = v
	}
	return result
}

// Helper functions for user agent parsing

// ParseUserAgent extracts device info from a user agent string.
func ParseUserAgent(userAgent string) (deviceType, browser, os string) {
	if userAgent == "" {
		return "", "", ""
	}

	ua := strings.ToLower(userAgent)

	// Device type
	if strings.Contains(ua, "mobile") || strings.Contains(ua, "android") ||
		strings.Contains(ua, "iphone") || strings.Contains(ua, "ipod") {
		deviceType = "mobile"
	} else if strings.Contains(ua, "ipad") || strings.Contains(ua, "tablet") {
		deviceType = "tablet"
	} else {
		deviceType = "desktop"
	}

	// Browser detection
	switch {
	case strings.Contains(ua, "firefox"):
		browser = "Firefox"
	case strings.Contains(ua, "edg"):
		browser = "Edge"
	case strings.Contains(ua, "chrome"):
		browser = "Chrome"
	case strings.Contains(ua, "safari"):
		browser = "Safari"
	case strings.Contains(ua, "opera") || strings.Contains(ua, "opr"):
		browser = "Opera"
	}

	// OS detection (order matters: iOS before macOS since iOS UA contains "Mac OS X")
	switch {
	case strings.Contains(ua, "iphone") || strings.Contains(ua, "ipad") || strings.Contains(ua, "ipod"):
		os = "iOS"
	case strings.Contains(ua, "android"):
		os = "Android"
	case strings.Contains(ua, "windows"):
		os = "Windows"
	case strings.Contains(ua, "mac os") || strings.Contains(ua, "macos"):
		os = "macOS"
	case strings.Contains(ua, "linux"):
		os = "Linux"
	}

	return deviceType, browser, os
}

// GetClientIPSimple extracts client IP from HTTP request headers.
// For more options (custom headers, trust proxy), use GetClientIP with IpFilterConfig.
func GetClientIPSimple(r *http.Request) string {
	return GetClientIP(r, nil)
}

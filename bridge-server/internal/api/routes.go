// Package api provides HTTP API routes for the bridge server
package api

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	pocketping "github.com/Ruwad-io/pocketping/sdk-go"
	"github.com/pocketping/bridge-server/internal/bridges"
	"github.com/pocketping/bridge-server/internal/config"
	"github.com/pocketping/bridge-server/internal/types"
)

// Server handles HTTP requests for the bridge server
type Server struct {
	bridges        []bridges.Bridge
	config         *config.Config
	eventListeners sync.Map // map[chan types.OutgoingEvent]struct{}
	bridgeIDs      sync.Map // map[string]*types.BridgeMessageIDs (messageID -> bridgeIDs)
	messages       sync.Map // map[string]*types.Message (messageID -> message)
}

// NewServer creates a new API server
func NewServer(bridgeList []bridges.Bridge, cfg *config.Config) *Server {
	return &Server{
		bridges: bridgeList,
		config:  cfg,
	}
}

// SetupRoutes configures all HTTP routes
func (s *Server) SetupRoutes(mux *http.ServeMux) {
	// Health check
	mux.HandleFunc("GET /health", s.handleHealth)

	// Main event endpoint (incoming from app/SDK)
	// UA filter is applied to block bot traffic before processing
	mux.HandleFunc("POST /api/events", s.uaFilterMiddleware(s.authMiddleware(s.handleEvents)))

	// Convenience endpoints
	mux.HandleFunc("POST /api/sessions", s.uaFilterMiddleware(s.authMiddleware(s.handleNewSession)))
	mux.HandleFunc("POST /api/messages", s.uaFilterMiddleware(s.authMiddleware(s.handleMessage)))
	mux.HandleFunc("POST /api/operator/status", s.authMiddleware(s.handleOperatorStatus))
	mux.HandleFunc("POST /api/custom-events", s.uaFilterMiddleware(s.authMiddleware(s.handleCustomEvent)))
	mux.HandleFunc("POST /api/disconnect", s.uaFilterMiddleware(s.authMiddleware(s.handleDisconnect)))

	// SSE stream (outgoing to app/SDK)
	mux.HandleFunc("GET /api/events/stream", s.authMiddleware(s.handleSSEStream))

	// Bridge webhooks (incoming from Telegram/Slack/Discord)
	// These receive operator messages and forward them via SSE/webhook
	// Note: These are not UA-filtered as they come from trusted bridge platforms
	mux.HandleFunc("POST /webhooks/telegram", s.handleTelegramWebhook)
	mux.HandleFunc("POST /webhooks/slack", s.handleSlackWebhook)
	mux.HandleFunc("POST /webhooks/discord", s.handleDiscordWebhook)
}

// authMiddleware checks API key if configured
func (s *Server) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.config.APIKey != "" {
			auth := r.Header.Get("Authorization")
			if auth != "Bearer "+s.config.APIKey {
				http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
				return
			}
		}
		next(w, r)
	}
}

// uaFilterMiddleware checks User-Agent against configured filters
func (s *Server) uaFilterMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.config.UaFilter == nil || !s.config.UaFilter.Enabled {
			next(w, r)
			return
		}

		userAgent := r.UserAgent()
		result := pocketping.CheckUAFilter(context.Background(), userAgent, s.config.UaFilter, map[string]interface{}{
			"path":   r.URL.Path,
			"method": r.Method,
		})

		if !result.Allowed {
			if s.config.UaFilter.LogBlocked {
				log.Printf("[UA Filter] Blocked: %s (reason: %s, pattern: %s, path: %s)",
					userAgent, result.Reason, result.MatchedPattern, r.URL.Path)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(`{"error":"Forbidden"}`))
			return
		}

		next(w, r)
	}
}

// writeJSON writes a JSON response
func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(data)
}

// writeOK writes a success response
func writeOK(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

// handleHealth returns server health status
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	bridgeNames := make([]string, len(s.bridges))
	for i, b := range s.bridges {
		bridgeNames[i] = b.Name()
	}

	writeJSON(w, map[string]interface{}{
		"status":  "ok",
		"bridges": bridgeNames,
	})
}

// handleEvents processes incoming events
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"error":"Bad request"}`, http.StatusBadRequest)
		return
	}

	// First, decode just the type
	var base struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(body, &base); err != nil {
		http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
		return
	}

	var handleErr error
	switch base.Type {
	case "new_session":
		var event types.NewSessionEvent
		if err := json.Unmarshal(body, &event); err == nil {
			handleErr = s.processNewSession(&event)
		}
	case "visitor_message":
		var event types.VisitorMessageEvent
		if err := json.Unmarshal(body, &event); err == nil {
			handleErr = s.processVisitorMessage(&event)
		}
	case "ai_takeover":
		var event types.AITakeoverEvent
		if err := json.Unmarshal(body, &event); err == nil {
			handleErr = s.processAITakeover(&event)
		}
	case "operator_status":
		var event types.OperatorStatusEvent
		if err := json.Unmarshal(body, &event); err == nil {
			handleErr = s.processOperatorStatus(&event)
		}
	case "message_read":
		var event types.MessageReadEvent
		if err := json.Unmarshal(body, &event); err == nil {
			handleErr = s.processMessageRead(&event)
		}
	case "custom_event":
		var event types.CustomEventEvent
		if err := json.Unmarshal(body, &event); err == nil {
			handleErr = s.processCustomEvent(&event)
		}
	case "identity_update":
		var event types.IdentityUpdateEvent
		if err := json.Unmarshal(body, &event); err == nil {
			handleErr = s.processIdentityUpdate(&event)
		}
	case "visitor_message_edited":
		var event types.VisitorMessageEditedEvent
		if err := json.Unmarshal(body, &event); err == nil {
			handleErr = s.processVisitorMessageEdited(&event)
		}
	case "visitor_message_deleted":
		var event types.VisitorMessageDeletedEvent
		if err := json.Unmarshal(body, &event); err == nil {
			handleErr = s.processVisitorMessageDeleted(&event)
		}
	default:
		http.Error(w, `{"error":"Unknown event type"}`, http.StatusBadRequest)
		return
	}

	if handleErr != nil {
		log.Printf("[API] Error handling %s: %v", base.Type, handleErr)
	}

	writeOK(w)
}

// handleNewSession handles POST /api/sessions
func (s *Server) handleNewSession(w http.ResponseWriter, r *http.Request) {
	var session types.Session
	if err := json.NewDecoder(r.Body).Decode(&session); err != nil {
		http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
		return
	}

	event := &types.NewSessionEvent{Type: "new_session", Session: &session}
	if err := s.processNewSession(event); err != nil {
		log.Printf("[API] Error handling new session: %v", err)
	}

	writeOK(w)
}

// handleMessage handles POST /api/messages
func (s *Server) handleMessage(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Message *types.Message `json:"message"`
		Session *types.Session `json:"session"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
		return
	}

	event := &types.VisitorMessageEvent{
		Type:    "visitor_message",
		Message: payload.Message,
		Session: payload.Session,
	}
	if err := s.processVisitorMessage(event); err != nil {
		log.Printf("[API] Error handling message: %v", err)
	}

	writeOK(w)
}

// handleOperatorStatus handles POST /api/operator/status
func (s *Server) handleOperatorStatus(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Online bool `json:"online"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
		return
	}

	event := &types.OperatorStatusEvent{Type: "operator_status", Online: payload.Online}
	if err := s.processOperatorStatus(event); err != nil {
		log.Printf("[API] Error handling operator status: %v", err)
	}

	writeOK(w)
}

// handleCustomEvent handles POST /api/custom-events
func (s *Server) handleCustomEvent(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Event   *types.CustomEvent `json:"event"`
		Session *types.Session     `json:"session"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
		return
	}

	event := &types.CustomEventEvent{
		Type:    "custom_event",
		Event:   payload.Event,
		Session: payload.Session,
	}
	if err := s.processCustomEvent(event); err != nil {
		log.Printf("[API] Error handling custom event: %v", err)
	}

	writeOK(w)
}

// handleDisconnect handles POST /api/disconnect
// Notifies bridges when a visitor leaves the page
func (s *Server) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Session  *types.Session `json:"session"`
		Duration int            `json:"duration"` // seconds
		Reason   string         `json:"reason"`   // page_unload, inactivity, manual
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
		return
	}

	if payload.Session == nil {
		http.Error(w, `{"error":"session is required"}`, http.StatusBadRequest)
		return
	}

	event := &types.VisitorDisconnectEvent{
		Type:     "visitor_disconnect",
		Session:  payload.Session,
		Duration: payload.Duration,
		Reason:   payload.Reason,
	}
	if err := s.processDisconnect(event); err != nil {
		log.Printf("[API] Error handling disconnect: %v", err)
	}

	writeOK(w)
}

// handleSSEStream handles GET /api/events/stream
func (s *Server) handleSSEStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	eventChan := make(chan types.OutgoingEvent, 10)
	s.eventListeners.Store(eventChan, struct{}{})
	defer func() {
		s.eventListeners.Delete(eventChan)
		close(eventChan)
	}()

	// Heartbeat ticker
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case event := <-eventChan:
			data, _ := json.Marshal(event)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// EmitEvent broadcasts an event to all SSE listeners (exported for bridges)
func (s *Server) EmitEvent(event types.OutgoingEvent) {
	s.eventListeners.Range(func(key, _ interface{}) bool {
		if ch, ok := key.(chan types.OutgoingEvent); ok {
			select {
			case ch <- event:
			default:
				// Channel full, skip
			}
		}
		return true
	})

	// Send to backend webhook if configured
	if s.config.BackendWebhookURL != "" {
		go s.sendToWebhook(event)
	}
}

// sendToWebhook sends an event to the backend webhook
func (s *Server) sendToWebhook(event types.OutgoingEvent) {
	body, err := json.Marshal(event)
	if err != nil {
		return
	}

	req, err := http.NewRequest("POST", s.config.BackendWebhookURL, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if s.config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+s.config.APIKey)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[API] Webhook error: %v", err)
		return
	}
	defer resp.Body.Close()
}

// getBridgeIDs retrieves stored bridge message IDs
func (s *Server) getBridgeIDs(messageID string) *types.BridgeMessageIDs {
	if v, ok := s.bridgeIDs.Load(messageID); ok {
		return v.(*types.BridgeMessageIDs)
	}
	return nil
}

// saveBridgeIDs stores bridge message IDs
func (s *Server) saveBridgeIDs(messageID string, ids *types.BridgeMessageIDs) {
	existing := s.getBridgeIDs(messageID)
	if existing != nil {
		ids = existing.Merge(ids)
	}
	s.bridgeIDs.Store(messageID, ids)
}

func (s *Server) getMessage(messageID string) *types.Message {
	if v, ok := s.messages.Load(messageID); ok {
		return v.(*types.Message)
	}
	return nil
}

func (s *Server) saveMessage(message *types.Message) {
	if message == nil {
		return
	}
	s.messages.Store(message.ID, message)
}

func (s *Server) updateMessage(messageID string, update func(msg *types.Message)) {
	if update == nil {
		return
	}
	if msg := s.getMessage(messageID); msg != nil {
		update(msg)
		s.saveMessage(msg)
	}
}

func (s *Server) buildReplyQuote(messageID string) string {
	msg := s.getMessage(messageID)
	if msg == nil {
		return ""
	}

	senderLabel := "Visitor"
	switch msg.Sender {
	case "operator":
		senderLabel = "Support"
	case "ai":
		senderLabel = "AI"
	}

	// Build attachment summary
	attachmentSummary := ""
	if len(msg.Attachments) > 0 {
		imageCount := 0
		fileCount := 0
		for _, att := range msg.Attachments {
			if strings.HasPrefix(att.MimeType, "image/") {
				imageCount++
			} else {
				fileCount++
			}
		}
		var parts []string
		if imageCount > 0 {
			if imageCount == 1 {
				parts = append(parts, "🖼️ 1 image")
			} else {
				parts = append(parts, fmt.Sprintf("🖼️ %d images", imageCount))
			}
		}
		if fileCount > 0 {
			if fileCount == 1 {
				parts = append(parts, "📎 1 file")
			} else {
				parts = append(parts, fmt.Sprintf("📎 %d files", fileCount))
			}
		}
		if len(parts) > 0 {
			attachmentSummary = " [" + strings.Join(parts, ", ") + "]"
		}
	}

	preview := msg.Content
	if msg.DeletedAt != nil {
		preview = "Message deleted"
	} else if preview == "" && len(msg.Attachments) > 0 {
		// Empty content but has attachments
		preview = "(attachment)"
	}
	if len(preview) > 140 {
		preview = preview[:140] + "..."
	}

	return fmt.Sprintf("> *%s*%s — %s", senderLabel, attachmentSummary, preview)
}

// ─────────────────────────────────────────────────────────────────
// Event Processors
// ─────────────────────────────────────────────────────────────────

func (s *Server) processNewSession(event *types.NewSessionEvent) error {
	for _, bridge := range s.bridges {
		if err := bridge.OnNewSession(event.Session); err != nil {
			log.Printf("[%s] OnNewSession error: %v", bridge.Name(), err)
		}
	}
	return nil
}

func (s *Server) processVisitorMessage(event *types.VisitorMessageEvent) error {
	s.saveMessage(event.Message)

	var replyContext *bridges.ReplyContext
	if event.Message.ReplyTo != "" {
		replyIDs := s.getBridgeIDs(event.Message.ReplyTo)
		replyQuote := s.buildReplyQuote(event.Message.ReplyTo)
		if replyIDs != nil || replyQuote != "" {
			replyContext = &bridges.ReplyContext{
				BridgeIDs: replyIDs,
				Quote:     replyQuote,
			}
		}
	}

	for _, bridge := range s.bridges {
		ids, err := bridge.OnVisitorMessage(event.Message, event.Session, replyContext)
		if err != nil {
			log.Printf("[%s] OnVisitorMessage error: %v", bridge.Name(), err)
			continue
		}
		if ids != nil {
			s.saveBridgeIDs(event.Message.ID, ids)
		}
	}
	return nil
}

func (s *Server) processAITakeover(event *types.AITakeoverEvent) error {
	for _, bridge := range s.bridges {
		if err := bridge.OnAITakeover(event.Session, event.Reason); err != nil {
			log.Printf("[%s] OnAITakeover error: %v", bridge.Name(), err)
		}
	}
	return nil
}

func (s *Server) processOperatorStatus(event *types.OperatorStatusEvent) error {
	// Operator status is typically handled at the app level
	// Bridges can react to this if needed
	return nil
}

func (s *Server) processMessageRead(event *types.MessageReadEvent) error {
	for _, bridge := range s.bridges {
		if err := bridge.OnMessageRead(event.SessionID, event.MessageIDs, event.Status); err != nil {
			log.Printf("[%s] OnMessageRead error: %v", bridge.Name(), err)
		}
	}
	return nil
}

func (s *Server) processCustomEvent(event *types.CustomEventEvent) error {
	for _, bridge := range s.bridges {
		if err := bridge.OnCustomEvent(event.Event, event.Session); err != nil {
			log.Printf("[%s] OnCustomEvent error: %v", bridge.Name(), err)
		}
	}

	// Forward to events webhook if configured
	if s.config.EventsWebhookURL != "" {
		go s.forwardToEventsWebhook(event)
	}

	return nil
}

func (s *Server) processIdentityUpdate(event *types.IdentityUpdateEvent) error {
	for _, bridge := range s.bridges {
		if err := bridge.OnIdentityUpdate(event.Session); err != nil {
			log.Printf("[%s] OnIdentityUpdate error: %v", bridge.Name(), err)
		}
	}
	return nil
}

func (s *Server) processVisitorMessageEdited(event *types.VisitorMessageEditedEvent) error {
	bridgeIDs := s.getBridgeIDs(event.MessageID)
	now := time.Now()
	s.updateMessage(event.MessageID, func(msg *types.Message) {
		msg.Content = event.Content
		msg.EditedAt = &now
	})

	for _, bridge := range s.bridges {
		ids, err := bridge.OnVisitorMessageEdited(event.SessionID, event.MessageID, event.Content, bridgeIDs)
		if err != nil {
			log.Printf("[%s] OnVisitorMessageEdited error: %v", bridge.Name(), err)
			continue
		}
		if ids != nil {
			s.saveBridgeIDs(event.MessageID, ids)
		}
	}
	return nil
}

func (s *Server) processVisitorMessageDeleted(event *types.VisitorMessageDeletedEvent) error {
	bridgeIDs := s.getBridgeIDs(event.MessageID)
	now := time.Now()
	s.updateMessage(event.MessageID, func(msg *types.Message) {
		msg.DeletedAt = &now
	})

	for _, bridge := range s.bridges {
		if err := bridge.OnVisitorMessageDeleted(event.SessionID, event.MessageID, bridgeIDs); err != nil {
			log.Printf("[%s] OnVisitorMessageDeleted error: %v", bridge.Name(), err)
		}
	}
	return nil
}

func (s *Server) processDisconnect(event *types.VisitorDisconnectEvent) error {
	// Format duration for display
	formatDuration := func(seconds int) string {
		if seconds < 60 {
			return fmt.Sprintf("%ds", seconds)
		}
		if seconds < 3600 {
			return fmt.Sprintf("%d min", seconds/60)
		}
		hours := seconds / 3600
		mins := (seconds % 3600) / 60
		if mins > 0 {
			return fmt.Sprintf("%dh %dmin", hours, mins)
		}
		return fmt.Sprintf("%dh", hours)
	}

	// Build disconnect message
	visitorName := "Visitor"
	if event.Session.Metadata != nil {
		if name, ok := event.Session.Metadata["name"].(string); ok && name != "" {
			visitorName = name
		} else if email, ok := event.Session.Metadata["email"].(string); ok && email != "" {
			// Use part before @ as name
			if idx := len(email); idx > 0 {
				for i, c := range email {
					if c == '@' {
						visitorName = email[:i]
						break
					}
				}
			}
		}
	}

	message := fmt.Sprintf("👋 %s left (was here for %s)", visitorName, formatDuration(event.Duration))

	// Notify all bridges
	for _, bridge := range s.bridges {
		if err := bridge.OnVisitorDisconnect(event.Session, message); err != nil {
			log.Printf("[%s] OnVisitorDisconnect error: %v", bridge.Name(), err)
		}
	}
	return nil
}

// forwardToEventsWebhook forwards custom events to the events webhook
func (s *Server) forwardToEventsWebhook(event *types.CustomEventEvent) {
	payload := map[string]interface{}{
		"event": map[string]interface{}{
			"name":      event.Event.Name,
			"data":      event.Event.Data,
			"timestamp": event.Event.Timestamp,
			"sessionId": event.Event.SessionID,
		},
		"session": map[string]interface{}{
			"id":        event.Session.ID,
			"visitorId": event.Session.VisitorID,
			"metadata":  event.Session.Metadata,
		},
		"sentAt": time.Now().UTC().Format(time.RFC3339),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return
	}

	req, err := http.NewRequest("POST", s.config.EventsWebhookURL, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	// Add HMAC signature if secret is configured
	if s.config.EventsWebhookSecret != "" {
		mac := hmac.New(sha256.New, []byte(s.config.EventsWebhookSecret))
		mac.Write(body)
		signature := hex.EncodeToString(mac.Sum(nil))
		req.Header.Set("X-PocketPing-Signature", "sha256="+signature)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[API] Events webhook error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("[API] Events webhook returned %d", resp.StatusCode)
	}
}

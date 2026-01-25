package pocketping

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Discord Gateway opcodes
const (
	gatewayOpcodeDispatch        = 0
	gatewayOpcodeHeartbeat       = 1
	gatewayOpcodeIdentify        = 2
	gatewayOpcodeResume          = 6
	gatewayOpcodeReconnect       = 7
	gatewayOpcodeInvalidSession  = 9
	gatewayOpcodeHello           = 10
	gatewayOpcodeHeartbeatAck    = 11
)

// Discord Gateway intents
const (
	IntentGuilds                 = 1 << 0
	IntentGuildMessages          = 1 << 9
	IntentMessageContent         = 1 << 15
)

// DiscordGatewayConfig holds configuration for the Discord Gateway
type DiscordGatewayConfig struct {
	BotToken           string
	ChannelID          string // Forum channel ID for threads
	AllowedBotIDs      []string
	OnOperatorMessage  func(ctx context.Context, sessionID, content, operatorName string, attachments []Attachment, replyToBridgeMessageID *int)
	OnOperatorMessageWithIDs func(ctx context.Context, sessionID, content, operatorName string, attachments []Attachment, replyToBridgeMessageID *int, bridgeMessageID string)
	OnOperatorMessageEdit    func(ctx context.Context, sessionID, bridgeMessageID, content string, editedAt time.Time)
	OnOperatorMessageDelete  func(ctx context.Context, sessionID, bridgeMessageID string, deletedAt time.Time)
}

// DiscordGateway manages a persistent WebSocket connection to Discord Gateway
type DiscordGateway struct {
	config     DiscordGatewayConfig
	conn       *websocket.Conn
	sessionID  string
	resumeURL  string
	sequence   *int
	httpClient *http.Client

	heartbeatInterval time.Duration
	heartbeatTicker   *time.Ticker
	lastHeartbeatAck  time.Time

	mu        sync.Mutex
	connected bool
	ctx       context.Context
	cancel    context.CancelFunc
}

// gatewayPayload represents a Gateway payload
type gatewayPayload struct {
	Op int             `json:"op"`
	D  json.RawMessage `json:"d,omitempty"`
	S  *int            `json:"s,omitempty"`
	T  string          `json:"t,omitempty"`
}

// helloPayload represents the HELLO event data
type helloPayload struct {
	HeartbeatInterval int `json:"heartbeat_interval"`
}

// identifyPayload represents the IDENTIFY payload
type identifyPayload struct {
	Token      string            `json:"token"`
	Intents    int               `json:"intents"`
	Properties identifyProperties `json:"properties"`
}

type identifyProperties struct {
	OS      string `json:"os"`
	Browser string `json:"browser"`
	Device  string `json:"device"`
}

// readyPayload represents the READY event data
type readyPayload struct {
	SessionID string `json:"session_id"`
	ResumeGatewayURL string `json:"resume_gateway_url"`
}

// messageCreatePayload represents a MESSAGE_CREATE event
type messageCreatePayload struct {
	ID              string            `json:"id"`
	ChannelID       string            `json:"channel_id"`
	Content         string            `json:"content"`
	Author          discordUser       `json:"author"`
	Attachments     []discordAttachment `json:"attachments"`
	MessageReference *messageReference `json:"message_reference,omitempty"`
}

type messageUpdatePayload struct {
	ID             string       `json:"id"`
	ChannelID      string       `json:"channel_id"`
	Content        string       `json:"content,omitempty"`
	EditedTimestamp string      `json:"edited_timestamp,omitempty"`
	Author         *discordUser `json:"author,omitempty"`
}

type messageDeletePayload struct {
	ID        string `json:"id"`
	ChannelID string `json:"channel_id"`
	GuildID   string `json:"guild_id,omitempty"`
}

type discordUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Bot      bool   `json:"bot"`
}

type discordAttachment struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Size        int    `json:"size"`
	URL         string `json:"url"`
}

type messageReference struct {
	MessageID string `json:"message_id,omitempty"`
	ChannelID string `json:"channel_id,omitempty"`
	GuildID   string `json:"guild_id,omitempty"`
}

// NewDiscordGateway creates a new Discord Gateway instance
func NewDiscordGateway(config DiscordGatewayConfig) *DiscordGateway {
	return &DiscordGateway{
		config:     config,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// Connect establishes a connection to the Discord Gateway
func (g *DiscordGateway) Connect(ctx context.Context) error {
	g.ctx, g.cancel = context.WithCancel(ctx)

	// Get Gateway URL
	gatewayURL, err := g.getGatewayURL()
	if err != nil {
		return fmt.Errorf("get gateway URL: %w", err)
	}

	// Connect to WebSocket
	conn, _, err := websocket.DefaultDialer.DialContext(g.ctx, gatewayURL+"?v=10&encoding=json", nil)
	if err != nil {
		return fmt.Errorf("connect to gateway: %w", err)
	}
	g.conn = conn
	g.connected = true

	// Start listening for messages
	go g.listen()

	return nil
}

// Close closes the Gateway connection
func (g *DiscordGateway) Close() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.cancel != nil {
		g.cancel()
	}

	if g.heartbeatTicker != nil {
		g.heartbeatTicker.Stop()
	}

	if g.conn != nil {
		g.connected = false
		return g.conn.Close()
	}

	return nil
}

func (g *DiscordGateway) getGatewayURL() (string, error) {
	if g.resumeURL != "" {
		return g.resumeURL, nil
	}

	req, err := http.NewRequestWithContext(g.ctx, "GET", "https://discord.com/api/v10/gateway/bot", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bot "+g.config.BotToken)

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	return result.URL, nil
}

func (g *DiscordGateway) listen() {
	for {
		select {
		case <-g.ctx.Done():
			return
		default:
		}

		_, message, err := g.conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return
			}
			log.Printf("[DiscordGateway] Read error: %v", err)
			g.reconnect()
			return
		}

		var payload gatewayPayload
		if err := json.Unmarshal(message, &payload); err != nil {
			log.Printf("[DiscordGateway] Parse error: %v", err)
			continue
		}

		// Update sequence number
		if payload.S != nil {
			g.sequence = payload.S
		}

		g.handlePayload(payload)
	}
}

func (g *DiscordGateway) handlePayload(payload gatewayPayload) {
	switch payload.Op {
	case gatewayOpcodeHello:
		var hello helloPayload
		if err := json.Unmarshal(payload.D, &hello); err != nil {
			log.Printf("[DiscordGateway] Parse HELLO error: %v", err)
			return
		}
		g.heartbeatInterval = time.Duration(hello.HeartbeatInterval) * time.Millisecond
		g.startHeartbeat()
		g.identify()

	case gatewayOpcodeHeartbeatAck:
		g.lastHeartbeatAck = time.Now()

	case gatewayOpcodeHeartbeat:
		g.sendHeartbeat()

	case gatewayOpcodeReconnect:
		g.reconnect()

	case gatewayOpcodeInvalidSession:
		// Wait and re-identify
		time.Sleep(5 * time.Second)
		g.sessionID = ""
		g.sequence = nil
		g.identify()

	case gatewayOpcodeDispatch:
		g.handleDispatch(payload.T, payload.D)
	}
}

func (g *DiscordGateway) handleDispatch(eventType string, data json.RawMessage) {
	switch eventType {
	case "READY":
		var ready readyPayload
		if err := json.Unmarshal(data, &ready); err != nil {
			log.Printf("[DiscordGateway] Parse READY error: %v", err)
			return
		}
		g.sessionID = ready.SessionID
		g.resumeURL = ready.ResumeGatewayURL
		log.Printf("[DiscordGateway] Connected, session: %s", g.sessionID)

	case "MESSAGE_CREATE":
		var msg messageCreatePayload
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Printf("[DiscordGateway] Parse MESSAGE_CREATE error: %v", err)
			return
		}
		g.handleMessage(msg)
	case "MESSAGE_UPDATE":
		var msg messageUpdatePayload
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Printf("[DiscordGateway] Parse MESSAGE_UPDATE error: %v", err)
			return
		}
		g.handleMessageUpdate(msg)
	case "MESSAGE_DELETE":
		var msg messageDeletePayload
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Printf("[DiscordGateway] Parse MESSAGE_DELETE error: %v", err)
			return
		}
		g.handleMessageDelete(msg)
	}
}

func (g *DiscordGateway) handleMessage(msg messageCreatePayload) {
	// Skip bot messages
	if msg.Author.Bot && !g.isAllowedBot(msg.Author.ID) {
		return
	}

	// Only process messages in threads under our channel
	// The channelID in the message is the thread ID
	// We should check if the parent is our forum channel
	// For now, we process all non-bot messages

	if g.config.OnOperatorMessage == nil && g.config.OnOperatorMessageWithIDs == nil {
		return
	}

	// Download attachments
	var attachments []Attachment
	for _, att := range msg.Attachments {
		data, err := g.downloadFile(att.URL)
		if err != nil {
			log.Printf("[DiscordGateway] Failed to download attachment: %v", err)
			continue
		}
		attachments = append(attachments, Attachment{
			Filename: att.Filename,
			MimeType: att.ContentType,
			Size:     int64(att.Size),
			Data:     data,
		})
	}

	// Get reply reference if present
	var replyToBridgeMessageID *int
	// Discord uses string IDs, but we need to convert for consistency
	// For Discord, we'll pass nil since the ID is a string snowflake, not int
	// The backend will need to handle this differently

	// Call the callback
	if g.config.OnOperatorMessage != nil {
		g.config.OnOperatorMessage(
			context.Background(),
			msg.ChannelID, // Thread/channel ID as session ID
			msg.Content,
			msg.Author.Username,
			attachments,
			replyToBridgeMessageID,
		)
	}
	if g.config.OnOperatorMessageWithIDs != nil {
		g.config.OnOperatorMessageWithIDs(
			context.Background(),
			msg.ChannelID,
			msg.Content,
			msg.Author.Username,
			attachments,
			replyToBridgeMessageID,
			msg.ID,
		)
	}
}

func (g *DiscordGateway) handleMessageUpdate(msg messageUpdatePayload) {
	if msg.Author != nil && msg.Author.Bot && !g.isAllowedBot(msg.Author.ID) {
		return
	}

	if g.config.OnOperatorMessageEdit == nil {
		return
	}

	if msg.Content == "" {
		return
	}

	editedAt := time.Now()
	if msg.EditedTimestamp != "" {
		if parsed, err := time.Parse(time.RFC3339, msg.EditedTimestamp); err == nil {
			editedAt = parsed
		}
	}

	g.config.OnOperatorMessageEdit(context.Background(), msg.ChannelID, msg.ID, msg.Content, editedAt)
}

func (g *DiscordGateway) handleMessageDelete(msg messageDeletePayload) {
	if g.config.OnOperatorMessageDelete == nil {
		return
	}

	g.config.OnOperatorMessageDelete(context.Background(), msg.ChannelID, msg.ID, time.Now())
}

func (g *DiscordGateway) isAllowedBot(botID string) bool {
	if botID == "" {
		return false
	}
	for _, allowed := range g.config.AllowedBotIDs {
		if allowed == botID {
			return true
		}
	}
	return false
}

func (g *DiscordGateway) downloadFile(url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(g.ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	var data []byte
	buf := make([]byte, 1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			data = append(data, buf[:n]...)
		}
		if err != nil {
			break
		}
	}

	return data, nil
}

func (g *DiscordGateway) identify() {
	identify := identifyPayload{
		Token:   g.config.BotToken,
		Intents: IntentGuilds | IntentGuildMessages | IntentMessageContent,
		Properties: identifyProperties{
			OS:      "linux",
			Browser: "pocketping",
			Device:  "pocketping",
		},
	}

	data, _ := json.Marshal(identify)
	payload := gatewayPayload{
		Op: gatewayOpcodeIdentify,
		D:  data,
	}

	g.send(payload)
}

func (g *DiscordGateway) startHeartbeat() {
	if g.heartbeatTicker != nil {
		g.heartbeatTicker.Stop()
	}

	g.heartbeatTicker = time.NewTicker(g.heartbeatInterval)
	g.lastHeartbeatAck = time.Now()

	go func() {
		for {
			select {
			case <-g.ctx.Done():
				return
			case <-g.heartbeatTicker.C:
				// Check if we received a heartbeat ACK
				if time.Since(g.lastHeartbeatAck) > g.heartbeatInterval*2 {
					log.Printf("[DiscordGateway] Heartbeat timeout, reconnecting...")
					g.reconnect()
					return
				}
				g.sendHeartbeat()
			}
		}
	}()
}

func (g *DiscordGateway) sendHeartbeat() {
	var data json.RawMessage
	if g.sequence != nil {
		data, _ = json.Marshal(*g.sequence)
	} else {
		data = json.RawMessage("null")
	}

	payload := gatewayPayload{
		Op: gatewayOpcodeHeartbeat,
		D:  data,
	}

	g.send(payload)
}

func (g *DiscordGateway) send(payload gatewayPayload) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.conn == nil {
		return fmt.Errorf("not connected")
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	return g.conn.WriteMessage(websocket.TextMessage, data)
}

func (g *DiscordGateway) reconnect() {
	g.mu.Lock()
	if g.conn != nil {
		g.conn.Close()
		g.conn = nil
	}
	g.connected = false
	g.mu.Unlock()

	// Wait before reconnecting
	time.Sleep(5 * time.Second)

	// Try to reconnect
	for i := 0; i < 5; i++ {
		select {
		case <-g.ctx.Done():
			return
		default:
		}

		gatewayURL := g.resumeURL
		if gatewayURL == "" {
			var err error
			gatewayURL, err = g.getGatewayURL()
			if err != nil {
				log.Printf("[DiscordGateway] Failed to get gateway URL: %v", err)
				time.Sleep(time.Duration(i+1) * 5 * time.Second)
				continue
			}
		}

		conn, _, err := websocket.DefaultDialer.DialContext(g.ctx, gatewayURL+"?v=10&encoding=json", nil)
		if err != nil {
			log.Printf("[DiscordGateway] Reconnect attempt %d failed: %v", i+1, err)
			time.Sleep(time.Duration(i+1) * 5 * time.Second)
			continue
		}

		g.mu.Lock()
		g.conn = conn
		g.connected = true
		g.mu.Unlock()

		// Start listening again
		go g.listen()
		return
	}

	log.Printf("[DiscordGateway] Failed to reconnect after 5 attempts")
}

package pocketping

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// DiscordWebhookBridge sends notifications to Discord via webhook.
type DiscordWebhookBridge struct {
	BaseBridge
	WebhookURL string
	Username   string
	AvatarURL  string

	httpClient *http.Client
	pp         *PocketPing
}

// DiscordWebhookOption is a functional option for DiscordWebhookBridge.
type DiscordWebhookOption func(*DiscordWebhookBridge)

// WithDiscordWebhookUsername sets the webhook username.
func WithDiscordWebhookUsername(username string) DiscordWebhookOption {
	return func(d *DiscordWebhookBridge) {
		d.Username = username
	}
}

// WithDiscordWebhookAvatarURL sets the webhook avatar URL.
func WithDiscordWebhookAvatarURL(avatarURL string) DiscordWebhookOption {
	return func(d *DiscordWebhookBridge) {
		d.AvatarURL = avatarURL
	}
}

// WithDiscordWebhookHTTPClient sets a custom HTTP client.
func WithDiscordWebhookHTTPClient(client *http.Client) DiscordWebhookOption {
	return func(d *DiscordWebhookBridge) {
		d.httpClient = client
	}
}

// NewDiscordWebhookBridge creates a new Discord webhook bridge.
func NewDiscordWebhookBridge(webhookURL string, opts ...DiscordWebhookOption) *DiscordWebhookBridge {
	d := &DiscordWebhookBridge{
		BaseBridge: BaseBridge{BridgeName: "discord-webhook"},
		WebhookURL: webhookURL,
		Username:   "PocketPing",
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}

	for _, opt := range opts {
		opt(d)
	}

	return d
}

// Init initializes the Discord webhook bridge.
func (d *DiscordWebhookBridge) Init(ctx context.Context, pp *PocketPing) error {
	d.pp = pp
	return nil
}

// OnNewSession sends a notification when a new session is created.
func (d *DiscordWebhookBridge) OnNewSession(ctx context.Context, session *Session) error {
	visitorName := d.getVisitorName(session)
	pageURL := ""
	if session.Metadata != nil && session.Metadata.URL != "" {
		pageURL = session.Metadata.URL
	}

	content := fmt.Sprintf("🆕 New chat session\n👤 Visitor: %s", visitorName)
	if pageURL != "" {
		content += fmt.Sprintf("\n📍 %s", pageURL)
	}

	_, err := d.sendWebhookMessage(ctx, content, "")
	if err != nil {
		log.Printf("[DiscordWebhookBridge] OnNewSession error: %v", err)
	}
	return nil
}

// OnVisitorMessage sends a notification when a visitor sends a message.
func (d *DiscordWebhookBridge) OnVisitorMessage(ctx context.Context, message *Message, session *Session) error {
	visitorName := d.getVisitorName(session)
	content := fmt.Sprintf("💬 %s:\n%s", visitorName, message.Content)

	// Note: Discord webhooks don't return message IDs in a way that allows editing
	// For full edit/delete support, use DiscordBotBridge instead
	var replyToMessageID string
	if message.ReplyTo != "" && d.pp != nil {
		if storage, ok := d.pp.GetStorage().(StorageWithBridgeIDs); ok {
			bridgeIDs, err := storage.GetBridgeMessageIDs(ctx, message.ReplyTo)
			if err == nil && bridgeIDs != nil && bridgeIDs.DiscordMessageID != "" {
				replyToMessageID = bridgeIDs.DiscordMessageID
			}
		}
	}

	result, err := d.sendWebhookMessage(ctx, content, replyToMessageID)
	if err != nil {
		log.Printf("[DiscordWebhookBridge] OnVisitorMessage error: %v", err)
		return nil
	}

	if result != nil && result.DiscordMessageID != "" && d.pp != nil {
		if storage, ok := d.pp.GetStorage().(StorageWithBridgeIDs); ok {
			_ = storage.SaveBridgeMessageIDs(ctx, message.ID, BridgeMessageIds{
				DiscordMessageID: result.DiscordMessageID,
			})
		}
	}
	return nil
}

// OnOperatorMessage is called when an operator sends a message.
func (d *DiscordWebhookBridge) OnOperatorMessage(ctx context.Context, message *Message, session *Session, sourceBridge string, operatorName string) error {
	if sourceBridge == d.Name() {
		return nil
	}

	name := operatorName
	if name == "" {
		name = "Operator"
	}

	content := fmt.Sprintf("👨‍💼 %s:\n%s", name, message.Content)

	_, err := d.sendWebhookMessage(ctx, content, "")
	if err != nil {
		log.Printf("[DiscordWebhookBridge] OnOperatorMessage error: %v", err)
	}
	return nil
}

// OnTyping is called when visitor starts/stops typing.
func (d *DiscordWebhookBridge) OnTyping(ctx context.Context, sessionID string, isTyping bool) error {
	// Discord webhooks don't support typing indicators
	return nil
}

// OnMessageRead is called when messages are marked as read.
func (d *DiscordWebhookBridge) OnMessageRead(ctx context.Context, sessionID string, messageIDs []string, status MessageStatus) error {
	return nil
}

// OnCustomEvent is called when a custom event is triggered.
func (d *DiscordWebhookBridge) OnCustomEvent(ctx context.Context, event CustomEvent, session *Session) error {
	visitorName := d.getVisitorName(session)
	content := fmt.Sprintf("📌 Event from %s: %s", visitorName, event.Name)

	if len(event.Data) > 0 {
		dataJSON, err := json.Marshal(event.Data)
		if err == nil {
			content += fmt.Sprintf("\n📦 %s", string(dataJSON))
		}
	}

	_, err := d.sendWebhookMessage(ctx, content, "")
	if err != nil {
		log.Printf("[DiscordWebhookBridge] OnCustomEvent error: %v", err)
	}
	return nil
}

// OnIdentityUpdate is called when a user identifies themselves.
func (d *DiscordWebhookBridge) OnIdentityUpdate(ctx context.Context, session *Session) error {
	if session.Identity == nil {
		return nil
	}

	content := fmt.Sprintf("🔐 User identified\n👤 ID: %s", session.Identity.ID)
	if session.Identity.Name != "" {
		content += fmt.Sprintf("\n📛 Name: %s", session.Identity.Name)
	}
	if session.Identity.Email != "" {
		content += fmt.Sprintf("\n📧 Email: %s", session.Identity.Email)
	}

	_, err := d.sendWebhookMessage(ctx, content, "")
	if err != nil {
		log.Printf("[DiscordWebhookBridge] OnIdentityUpdate error: %v", err)
	}
	return nil
}

type discordWebhookPayload struct {
	Content          string                   `json:"content"`
	Username         string                   `json:"username,omitempty"`
	AvatarURL        string                   `json:"avatar_url,omitempty"`
	MessageReference *discordMessageReference `json:"message_reference,omitempty"`
}

type discordMessageReference struct {
	MessageID string `json:"message_id"`
}

func (d *DiscordWebhookBridge) sendWebhookMessage(ctx context.Context, content string, replyToMessageID string) (*BridgeMessageResult, error) {
	payload := discordWebhookPayload{
		Content:   content,
		Username:  d.Username,
		AvatarURL: d.AvatarURL,
	}
	if replyToMessageID != "" {
		payload.MessageReference = &discordMessageReference{MessageID: replyToMessageID}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}

	// Add ?wait=true to get the message ID back
	webhookURL := d.WebhookURL
	if !strings.Contains(webhookURL, "?") {
		webhookURL += "?wait=true"
	} else {
		webhookURL += "&wait=true"
	}

	req, err := http.NewRequestWithContext(ctx, "POST", webhookURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("discord error: %s (status %d)", string(respBody), resp.StatusCode)
	}

	// Parse response to get message ID
	var discordResp struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&discordResp); err == nil && discordResp.ID != "" {
		return &BridgeMessageResult{
			DiscordMessageID: discordResp.ID,
		}, nil
	}

	return nil, nil
}

func (d *DiscordWebhookBridge) getVisitorName(session *Session) string {
	if session.Identity != nil && session.Identity.Name != "" {
		return session.Identity.Name
	}
	if session.Identity != nil && session.Identity.Email != "" {
		return session.Identity.Email
	}
	return session.VisitorID
}

// Ensure DiscordWebhookBridge implements Bridge interface
var _ Bridge = (*DiscordWebhookBridge)(nil)

// DiscordBotBridge sends notifications to Discord using a bot token.
// This supports full edit/delete functionality.
type DiscordBotBridge struct {
	BaseBridge
	BotToken  string
	ChannelID string

	httpClient *http.Client
	pp         *PocketPing
}

// DiscordBotOption is a functional option for DiscordBotBridge.
type DiscordBotOption func(*DiscordBotBridge)

// WithDiscordBotHTTPClient sets a custom HTTP client.
func WithDiscordBotHTTPClient(client *http.Client) DiscordBotOption {
	return func(d *DiscordBotBridge) {
		d.httpClient = client
	}
}

// NewDiscordBotBridge creates a new Discord bot bridge.
func NewDiscordBotBridge(botToken, channelID string, opts ...DiscordBotOption) *DiscordBotBridge {
	d := &DiscordBotBridge{
		BaseBridge: BaseBridge{BridgeName: "discord-bot"},
		BotToken:   botToken,
		ChannelID:  channelID,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}

	for _, opt := range opts {
		opt(d)
	}

	return d
}

// Init initializes the Discord bot bridge.
func (d *DiscordBotBridge) Init(ctx context.Context, pp *PocketPing) error {
	d.pp = pp
	return nil
}

// OnNewSession sends a notification when a new session is created.
func (d *DiscordBotBridge) OnNewSession(ctx context.Context, session *Session) error {
	visitorName := d.getVisitorName(session)
	pageURL := ""
	if session.Metadata != nil && session.Metadata.URL != "" {
		pageURL = session.Metadata.URL
	}

	content := fmt.Sprintf("🆕 New chat session\n👤 Visitor: %s", visitorName)
	if pageURL != "" {
		content += fmt.Sprintf("\n📍 %s", pageURL)
	}

	_, err := d.sendMessage(ctx, content, "")
	if err != nil {
		log.Printf("[DiscordBotBridge] OnNewSession error: %v", err)
	}
	return nil
}

// OnVisitorMessage sends a notification when a visitor sends a message.
func (d *DiscordBotBridge) OnVisitorMessage(ctx context.Context, message *Message, session *Session) error {
	visitorName := d.getVisitorName(session)
	content := fmt.Sprintf("💬 %s:\n%s", visitorName, message.Content)

	var replyToMessageID string
	if message.ReplyTo != "" && d.pp != nil {
		if storage, ok := d.pp.GetStorage().(StorageWithBridgeIDs); ok {
			bridgeIDs, err := storage.GetBridgeMessageIDs(ctx, message.ReplyTo)
			if err == nil && bridgeIDs != nil && bridgeIDs.DiscordMessageID != "" {
				replyToMessageID = bridgeIDs.DiscordMessageID
			}
		}
	}

	result, err := d.sendMessage(ctx, content, replyToMessageID)
	if err != nil {
		log.Printf("[DiscordBotBridge] OnVisitorMessage error: %v", err)
		return nil
	}

	// Save bridge message ID for edit/delete support
	if result != nil && result.DiscordMessageID != "" && d.pp != nil {
		if storage, ok := d.pp.GetStorage().(StorageWithBridgeIDs); ok {
			_ = storage.SaveBridgeMessageIDs(ctx, message.ID, BridgeMessageIds{
				DiscordMessageID: result.DiscordMessageID,
			})
		}
	}

	return nil
}

// OnOperatorMessage is called when an operator sends a message.
func (d *DiscordBotBridge) OnOperatorMessage(ctx context.Context, message *Message, session *Session, sourceBridge string, operatorName string) error {
	if sourceBridge == d.Name() {
		return nil
	}

	name := operatorName
	if name == "" {
		name = "Operator"
	}

	content := fmt.Sprintf("👨‍💼 %s:\n%s", name, message.Content)

	_, err := d.sendMessage(ctx, content, "")
	if err != nil {
		log.Printf("[DiscordBotBridge] OnOperatorMessage error: %v", err)
	}
	return nil
}

// OnTyping sends a typing indicator.
func (d *DiscordBotBridge) OnTyping(ctx context.Context, sessionID string, isTyping bool) error {
	if !isTyping {
		return nil
	}

	err := d.triggerTyping(ctx)
	if err != nil {
		log.Printf("[DiscordBotBridge] OnTyping error: %v", err)
	}
	return nil
}

// OnMessageRead is called when messages are marked as read.
func (d *DiscordBotBridge) OnMessageRead(ctx context.Context, sessionID string, messageIDs []string, status MessageStatus) error {
	return nil
}

// OnCustomEvent is called when a custom event is triggered.
func (d *DiscordBotBridge) OnCustomEvent(ctx context.Context, event CustomEvent, session *Session) error {
	visitorName := d.getVisitorName(session)
	content := fmt.Sprintf("📌 Event from %s: %s", visitorName, event.Name)

	if len(event.Data) > 0 {
		dataJSON, err := json.Marshal(event.Data)
		if err == nil {
			content += fmt.Sprintf("\n📦 %s", string(dataJSON))
		}
	}

	_, err := d.sendMessage(ctx, content, "")
	if err != nil {
		log.Printf("[DiscordBotBridge] OnCustomEvent error: %v", err)
	}
	return nil
}

// OnIdentityUpdate is called when a user identifies themselves.
func (d *DiscordBotBridge) OnIdentityUpdate(ctx context.Context, session *Session) error {
	if session.Identity == nil {
		return nil
	}

	content := fmt.Sprintf("🔐 User identified\n👤 ID: %s", session.Identity.ID)
	if session.Identity.Name != "" {
		content += fmt.Sprintf("\n📛 Name: %s", session.Identity.Name)
	}
	if session.Identity.Email != "" {
		content += fmt.Sprintf("\n📧 Email: %s", session.Identity.Email)
	}

	_, err := d.sendMessage(ctx, content, "")
	if err != nil {
		log.Printf("[DiscordBotBridge] OnIdentityUpdate error: %v", err)
	}
	return nil
}

// OnMessageEdit handles message edits.
func (d *DiscordBotBridge) OnMessageEdit(ctx context.Context, sessionID, messageID, content string, editedAt time.Time) (*BridgeMessageResult, error) {
	if d.pp == nil {
		return nil, nil
	}

	storage, ok := d.pp.GetStorage().(StorageWithBridgeIDs)
	if !ok {
		return nil, nil
	}

	bridgeIDs, err := storage.GetBridgeMessageIDs(ctx, messageID)
	if err != nil || bridgeIDs == nil || bridgeIDs.DiscordMessageID == "" {
		return nil, nil
	}

	err = d.editMessage(ctx, bridgeIDs.DiscordMessageID, content+" (edited)")
	if err != nil {
		log.Printf("[DiscordBotBridge] OnMessageEdit error: %v", err)
		return nil, nil
	}

	return &BridgeMessageResult{
		DiscordMessageID: bridgeIDs.DiscordMessageID,
	}, nil
}

// OnMessageDelete handles message deletions.
func (d *DiscordBotBridge) OnMessageDelete(ctx context.Context, sessionID, messageID string, deletedAt time.Time) error {
	if d.pp == nil {
		return nil
	}

	storage, ok := d.pp.GetStorage().(StorageWithBridgeIDs)
	if !ok {
		return nil
	}

	bridgeIDs, err := storage.GetBridgeMessageIDs(ctx, messageID)
	if err != nil || bridgeIDs == nil || bridgeIDs.DiscordMessageID == "" {
		return nil
	}

	err = d.deleteMessage(ctx, bridgeIDs.DiscordMessageID)
	if err != nil {
		log.Printf("[DiscordBotBridge] OnMessageDelete error: %v", err)
	}
	return nil
}

// Discord API helpers

const discordAPIBase = "https://discord.com/api/v10"

type discordMessagePayload struct {
	Content          string                   `json:"content"`
	MessageReference *discordMessageReference `json:"message_reference,omitempty"`
}

type discordMessage struct {
	ID string `json:"id"`
}

func (d *DiscordBotBridge) sendMessage(ctx context.Context, content string, replyToMessageID string) (*BridgeMessageResult, error) {
	apiURL := fmt.Sprintf("%s/channels/%s/messages", discordAPIBase, d.ChannelID)

	payload := discordMessagePayload{Content: content}
	if replyToMessageID != "" {
		payload.MessageReference = &discordMessageReference{MessageID: replyToMessageID}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bot "+d.BotToken)

	resp, err := d.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("discord error: %s (status %d)", string(respBody), resp.StatusCode)
	}

	var msg discordMessage
	if err := json.Unmarshal(respBody, &msg); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	return &BridgeMessageResult{
		DiscordMessageID: msg.ID,
	}, nil
}

func (d *DiscordBotBridge) editMessage(ctx context.Context, messageID, content string) error {
	apiURL := fmt.Sprintf("%s/channels/%s/messages/%s", discordAPIBase, d.ChannelID, messageID)

	payload := discordMessagePayload{Content: content}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "PATCH", apiURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bot "+d.BotToken)

	resp, err := d.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("discord error: %s (status %d)", string(respBody), resp.StatusCode)
	}

	return nil
}

func (d *DiscordBotBridge) deleteMessage(ctx context.Context, messageID string) error {
	apiURL := fmt.Sprintf("%s/channels/%s/messages/%s", discordAPIBase, d.ChannelID, messageID)

	req, err := http.NewRequestWithContext(ctx, "DELETE", apiURL, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bot "+d.BotToken)

	resp, err := d.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("discord error: %s (status %d)", string(respBody), resp.StatusCode)
	}

	return nil
}

func (d *DiscordBotBridge) triggerTyping(ctx context.Context) error {
	apiURL := fmt.Sprintf("%s/channels/%s/typing", discordAPIBase, d.ChannelID)

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bot "+d.BotToken)

	resp, err := d.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	return nil
}

func (d *DiscordBotBridge) getVisitorName(session *Session) string {
	if session.Identity != nil && session.Identity.Name != "" {
		return session.Identity.Name
	}
	if session.Identity != nil && session.Identity.Email != "" {
		return session.Identity.Email
	}
	return session.VisitorID
}

// Ensure DiscordBotBridge implements Bridge interface
var _ Bridge = (*DiscordBotBridge)(nil)

// Ensure DiscordBotBridge implements BridgeWithEditDelete interface
var _ BridgeWithEditDelete = (*DiscordBotBridge)(nil)

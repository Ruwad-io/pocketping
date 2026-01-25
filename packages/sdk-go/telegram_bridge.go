package pocketping

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"
)

// TelegramBridge sends notifications to Telegram.
type TelegramBridge struct {
	BaseBridge
	BotToken            string
	ChatID              string
	ParseMode           string // "HTML" or "Markdown"
	DisableNotification bool

	httpClient *http.Client
	pp         *PocketPing
}

// TelegramOption is a functional option for TelegramBridge.
type TelegramOption func(*TelegramBridge)

// WithTelegramParseMode sets the parse mode for Telegram messages.
func WithTelegramParseMode(mode string) TelegramOption {
	return func(t *TelegramBridge) {
		t.ParseMode = mode
	}
}

// WithTelegramDisableNotification disables notification sounds.
func WithTelegramDisableNotification(disable bool) TelegramOption {
	return func(t *TelegramBridge) {
		t.DisableNotification = disable
	}
}

// WithTelegramHTTPClient sets a custom HTTP client.
func WithTelegramHTTPClient(client *http.Client) TelegramOption {
	return func(t *TelegramBridge) {
		t.httpClient = client
	}
}

// NewTelegramBridge creates a new Telegram bridge.
func NewTelegramBridge(botToken, chatID string, opts ...TelegramOption) *TelegramBridge {
	t := &TelegramBridge{
		BaseBridge: BaseBridge{BridgeName: "telegram"},
		BotToken:   botToken,
		ChatID:     chatID,
		ParseMode:  "HTML",
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}

	for _, opt := range opts {
		opt(t)
	}

	return t
}

// Init initializes the Telegram bridge.
func (t *TelegramBridge) Init(ctx context.Context, pp *PocketPing) error {
	t.pp = pp
	return nil
}

// OnNewSession sends a notification when a new session is created.
func (t *TelegramBridge) OnNewSession(ctx context.Context, session *Session) error {
	visitorName := t.getVisitorName(session)
	pageURL := ""
	if session.Metadata != nil && session.Metadata.URL != "" {
		pageURL = session.Metadata.URL
	}

	text := fmt.Sprintf("🆕 New chat session\n👤 Visitor: %s", visitorName)
	if pageURL != "" {
		text += fmt.Sprintf("\n📍 %s", pageURL)
	}

	_, err := t.sendMessage(ctx, text)
	if err != nil {
		log.Printf("[TelegramBridge] OnNewSession error: %v", err)
	}
	return nil
}

// OnVisitorMessage sends a notification when a visitor sends a message.
func (t *TelegramBridge) OnVisitorMessage(ctx context.Context, message *Message, session *Session) error {
	visitorName := t.getVisitorName(session)
	text := fmt.Sprintf("💬 %s:\n%s", visitorName, message.Content)

	result, err := t.sendMessage(ctx, text)
	if err != nil {
		log.Printf("[TelegramBridge] OnVisitorMessage error: %v", err)
		return nil
	}

	// Save bridge message ID for edit/delete support
	if result != nil && t.pp != nil {
		if storage, ok := t.pp.GetStorage().(StorageWithBridgeIDs); ok {
			_ = storage.SaveBridgeMessageIDs(ctx, message.ID, BridgeMessageIds{
				TelegramMessageID: result.TelegramMessageID,
			})
		}
	}

	return nil
}

// OnOperatorMessage is called when an operator sends a message.
func (t *TelegramBridge) OnOperatorMessage(ctx context.Context, message *Message, session *Session, sourceBridge string, operatorName string) error {
	// Don't echo messages that originated from this bridge
	if sourceBridge == t.Name() {
		return nil
	}

	name := operatorName
	if name == "" {
		name = "Operator"
	}

	text := fmt.Sprintf("👨‍💼 %s:\n%s", name, message.Content)

	_, err := t.sendMessage(ctx, text)
	if err != nil {
		log.Printf("[TelegramBridge] OnOperatorMessage error: %v", err)
	}
	return nil
}

// OnTyping sends a typing indicator.
func (t *TelegramBridge) OnTyping(ctx context.Context, sessionID string, isTyping bool) error {
	if !isTyping {
		return nil
	}

	err := t.sendChatAction(ctx, "typing")
	if err != nil {
		log.Printf("[TelegramBridge] OnTyping error: %v", err)
	}
	return nil
}

// OnMessageRead is called when messages are marked as read.
func (t *TelegramBridge) OnMessageRead(ctx context.Context, sessionID string, messageIDs []string, status MessageStatus) error {
	// Telegram doesn't have a direct read receipt API
	return nil
}

// OnCustomEvent is called when a custom event is triggered.
func (t *TelegramBridge) OnCustomEvent(ctx context.Context, event CustomEvent, session *Session) error {
	visitorName := t.getVisitorName(session)
	text := fmt.Sprintf("📌 Event from %s: %s", visitorName, event.Name)

	if len(event.Data) > 0 {
		dataJSON, err := json.Marshal(event.Data)
		if err == nil {
			text += fmt.Sprintf("\n📦 %s", string(dataJSON))
		}
	}

	_, err := t.sendMessage(ctx, text)
	if err != nil {
		log.Printf("[TelegramBridge] OnCustomEvent error: %v", err)
	}
	return nil
}

// OnIdentityUpdate is called when a user identifies themselves.
func (t *TelegramBridge) OnIdentityUpdate(ctx context.Context, session *Session) error {
	if session.Identity == nil {
		return nil
	}

	text := fmt.Sprintf("🔐 User identified\n👤 ID: %s", session.Identity.ID)
	if session.Identity.Name != "" {
		text += fmt.Sprintf("\n📛 Name: %s", session.Identity.Name)
	}
	if session.Identity.Email != "" {
		text += fmt.Sprintf("\n📧 Email: %s", session.Identity.Email)
	}

	_, err := t.sendMessage(ctx, text)
	if err != nil {
		log.Printf("[TelegramBridge] OnIdentityUpdate error: %v", err)
	}
	return nil
}

// OnMessageEdit handles message edits.
func (t *TelegramBridge) OnMessageEdit(ctx context.Context, sessionID, messageID, content string, editedAt time.Time) (*BridgeMessageResult, error) {
	if t.pp == nil {
		return nil, nil
	}

	// Get the Telegram message ID
	storage, ok := t.pp.GetStorage().(StorageWithBridgeIDs)
	if !ok {
		return nil, nil
	}

	bridgeIDs, err := storage.GetBridgeMessageIDs(ctx, messageID)
	if err != nil || bridgeIDs == nil || bridgeIDs.TelegramMessageID == 0 {
		return nil, nil
	}

	err = t.editMessageText(ctx, bridgeIDs.TelegramMessageID, content+" (edited)")
	if err != nil {
		log.Printf("[TelegramBridge] OnMessageEdit error: %v", err)
		return nil, nil
	}

	return &BridgeMessageResult{
		TelegramMessageID: bridgeIDs.TelegramMessageID,
	}, nil
}

// OnMessageDelete handles message deletions.
func (t *TelegramBridge) OnMessageDelete(ctx context.Context, sessionID, messageID string, deletedAt time.Time) error {
	if t.pp == nil {
		return nil
	}

	// Get the Telegram message ID
	storage, ok := t.pp.GetStorage().(StorageWithBridgeIDs)
	if !ok {
		return nil
	}

	bridgeIDs, err := storage.GetBridgeMessageIDs(ctx, messageID)
	if err != nil || bridgeIDs == nil || bridgeIDs.TelegramMessageID == 0 {
		return nil
	}

	err = t.deleteMessage(ctx, bridgeIDs.TelegramMessageID)
	if err != nil {
		log.Printf("[TelegramBridge] OnMessageDelete error: %v", err)
	}
	return nil
}

// Telegram API helpers

type telegramResponse struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result"`
	Error  string          `json:"description,omitempty"`
}

type telegramMessage struct {
	MessageID int64 `json:"message_id"`
}

func (t *TelegramBridge) sendMessage(ctx context.Context, text string) (*BridgeMessageResult, error) {
	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", t.BotToken)

	params := url.Values{}
	params.Set("chat_id", t.ChatID)
	params.Set("text", text)
	if t.ParseMode != "" {
		params.Set("parse_mode", t.ParseMode)
	}
	if t.DisableNotification {
		params.Set("disable_notification", "true")
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBufferString(params.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var tgResp telegramResponse
	if err := json.Unmarshal(body, &tgResp); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	if !tgResp.OK {
		return nil, fmt.Errorf("telegram error: %s", tgResp.Error)
	}

	var msg telegramMessage
	if err := json.Unmarshal(tgResp.Result, &msg); err != nil {
		return nil, fmt.Errorf("parse message: %w", err)
	}

	return &BridgeMessageResult{
		TelegramMessageID: msg.MessageID,
	}, nil
}

func (t *TelegramBridge) editMessageText(ctx context.Context, messageID int64, text string) error {
	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/editMessageText", t.BotToken)

	params := url.Values{}
	params.Set("chat_id", t.ChatID)
	params.Set("message_id", fmt.Sprintf("%d", messageID))
	params.Set("text", text)
	if t.ParseMode != "" {
		params.Set("parse_mode", t.ParseMode)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBufferString(params.Encode()))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	var tgResp telegramResponse
	if err := json.Unmarshal(body, &tgResp); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if !tgResp.OK {
		return fmt.Errorf("telegram error: %s", tgResp.Error)
	}

	return nil
}

func (t *TelegramBridge) deleteMessage(ctx context.Context, messageID int64) error {
	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/deleteMessage", t.BotToken)

	params := url.Values{}
	params.Set("chat_id", t.ChatID)
	params.Set("message_id", fmt.Sprintf("%d", messageID))

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBufferString(params.Encode()))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	var tgResp telegramResponse
	if err := json.Unmarshal(body, &tgResp); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if !tgResp.OK {
		return fmt.Errorf("telegram error: %s", tgResp.Error)
	}

	return nil
}

func (t *TelegramBridge) sendChatAction(ctx context.Context, action string) error {
	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendChatAction", t.BotToken)

	params := url.Values{}
	params.Set("chat_id", t.ChatID)
	params.Set("action", action)

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBufferString(params.Encode()))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	return nil
}

func (t *TelegramBridge) getVisitorName(session *Session) string {
	if session.Identity != nil && session.Identity.Name != "" {
		return session.Identity.Name
	}
	if session.Identity != nil && session.Identity.Email != "" {
		return session.Identity.Email
	}
	return session.VisitorID
}

// Ensure TelegramBridge implements Bridge interface
var _ Bridge = (*TelegramBridge)(nil)

// Ensure TelegramBridge implements BridgeWithEditDelete interface
var _ BridgeWithEditDelete = (*TelegramBridge)(nil)

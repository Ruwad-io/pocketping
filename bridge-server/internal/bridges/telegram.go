package bridges

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	pocketping "github.com/Ruwad-io/pocketping/sdk-go"
	"github.com/pocketping/bridge-server/internal/config"
	"github.com/pocketping/bridge-server/internal/types"
)

const telegramAPIBase = "https://api.telegram.org/bot"

// TelegramBridge sends notifications to Telegram
type TelegramBridge struct {
	*BaseBridge
	botToken string
	chatID   string
	client   *http.Client
}

// NewTelegramBridge creates a new Telegram bridge with validation
func NewTelegramBridge(cfg *config.TelegramConfig) (*TelegramBridge, error) {
	if err := pocketping.ValidateTelegramConfig(cfg.BotToken, cfg.ChatID); err != nil {
		return nil, err
	}

	return &TelegramBridge{
		BaseBridge: NewBaseBridge("telegram"),
		botToken:   cfg.BotToken,
		chatID:     cfg.ChatID,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

// telegramResponse is the standard Telegram API response
type telegramResponse struct {
	OK          bool            `json:"ok"`
	Result      json.RawMessage `json:"result,omitempty"`
	Description string          `json:"description,omitempty"`
}

// telegramMessageResult is the result of sending a message
type telegramMessageResult struct {
	MessageID int `json:"message_id"`
}

// callAPI makes a request to the Telegram Bot API
func (b *TelegramBridge) callAPI(method string, data map[string]interface{}) (*telegramResponse, error) {
	url := fmt.Sprintf("%s%s/%s", telegramAPIBase, b.botToken, method)

	body, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result telegramResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

// sendMessage sends a message to the configured chat
func (b *TelegramBridge) sendMessage(text string, replyToMessageID *int) (int, error) {
	data := map[string]interface{}{
		"chat_id":    b.chatID,
		"text":       text,
		"parse_mode": "HTML",
	}
	if replyToMessageID != nil && *replyToMessageID > 0 {
		data["reply_to_message_id"] = *replyToMessageID
	}

	resp, err := b.callAPI("sendMessage", data)
	if err != nil {
		return 0, err
	}

	if !resp.OK {
		log.Printf("[TelegramBridge] API error: %s", resp.Description)
		return 0, fmt.Errorf("telegram API error: %s", resp.Description)
	}

	var msgResult telegramMessageResult
	if err := json.Unmarshal(resp.Result, &msgResult); err != nil {
		return 0, err
	}

	return msgResult.MessageID, nil
}

// OnNewSession announces a new chat session
func (b *TelegramBridge) OnNewSession(session *types.Session) error {
	visitorName := session.VisitorID
	if session.Identity != nil && session.Identity.Name != "" {
		visitorName = session.Identity.Name
	}

	text := fmt.Sprintf("🆕 <b>New chat session</b>\n👤 Visitor: %s", visitorName)

	if session.Metadata != nil {
		if session.Metadata.Country != "" || session.Metadata.City != "" {
			text += fmt.Sprintf("\n🌍 %s, %s", session.Metadata.Country, session.Metadata.City)
		}
		if session.Metadata.URL != "" {
			text += fmt.Sprintf("\n📍 %s", session.Metadata.URL)
		}
	}

	_, err := b.sendMessage(text, nil)
	return err
}

// OnVisitorMessage sends a visitor message to the chat
func (b *TelegramBridge) OnVisitorMessage(message *types.Message, session *types.Session, reply *ReplyContext) (*types.BridgeMessageIDs, error) {
	visitorName := session.VisitorID
	if session.Identity != nil && session.Identity.Name != "" {
		visitorName = session.Identity.Name
	}

	text := fmt.Sprintf("💬 <b>%s</b>:\n%s", visitorName, message.Content)

	if len(message.Attachments) > 0 {
		text += fmt.Sprintf("\n📎 %d attachment(s)", len(message.Attachments))
	}

	var replyToMessageID *int
	if reply != nil && reply.BridgeIDs != nil && reply.BridgeIDs.TelegramMessageID != 0 {
		id := reply.BridgeIDs.TelegramMessageID
		replyToMessageID = &id
	}

	msgID, err := b.sendMessage(text, replyToMessageID)
	if err != nil {
		return nil, err
	}

	return &types.BridgeMessageIDs{TelegramMessageID: msgID}, nil
}

// OnOperatorMessage relays an operator message from another bridge
func (b *TelegramBridge) OnOperatorMessage(message *types.Message, session *types.Session, sourceBridge, operatorName string) error {
	// Don't echo messages from this bridge
	if sourceBridge == "telegram" {
		return nil
	}

	name := operatorName
	if name == "" {
		name = "Operator"
	}

	text := fmt.Sprintf("👤 <b>%s</b> (via %s):\n%s", name, sourceBridge, message.Content)
	_, err := b.sendMessage(text, nil)
	return err
}

// OnTyping sends a typing indicator
func (b *TelegramBridge) OnTyping(sessionID string, isTyping bool) error {
	if !isTyping {
		return nil
	}

	data := map[string]interface{}{
		"chat_id": b.chatID,
		"action":  "typing",
	}

	_, err := b.callAPI("sendChatAction", data)
	return err
}

// OnMessageRead handles read receipts (no-op for Telegram)
func (b *TelegramBridge) OnMessageRead(sessionID string, messageIDs []string, status types.MessageStatus) error {
	return nil
}

// OnCustomEvent sends a custom event notification
func (b *TelegramBridge) OnCustomEvent(event *types.CustomEvent, session *types.Session) error {
	text := fmt.Sprintf("⚡ <b>Event: %s</b>", event.Name)
	if event.Data != nil {
		data, _ := json.Marshal(event.Data)
		text += fmt.Sprintf("\n<code>%s</code>", string(data))
	}
	_, err := b.sendMessage(text, nil)
	return err
}

// OnIdentityUpdate sends an identity update notification
func (b *TelegramBridge) OnIdentityUpdate(session *types.Session) error {
	if session.Identity == nil {
		return nil
	}

	text := fmt.Sprintf("🔑 <b>User identified</b>\nID: %s", session.Identity.ID)
	if session.Identity.Name != "" {
		text += fmt.Sprintf("\nName: %s", session.Identity.Name)
	}
	if session.Identity.Email != "" {
		text += fmt.Sprintf("\nEmail: %s", session.Identity.Email)
	}
	if session.UserPhone != "" {
		text += fmt.Sprintf("\n📱 Phone: %s", session.UserPhone)
	}

	_, err := b.sendMessage(text, nil)
	return err
}

// OnAITakeover sends an AI takeover notification
func (b *TelegramBridge) OnAITakeover(session *types.Session, reason string) error {
	text := fmt.Sprintf("🤖 <b>AI Takeover</b>\nReason: %s", reason)
	_, err := b.sendMessage(text, nil)
	return err
}

// OnVisitorMessageEdited syncs a message edit to Telegram
func (b *TelegramBridge) OnVisitorMessageEdited(sessionID, messageID, content string, bridgeIDs *types.BridgeMessageIDs) (*types.BridgeMessageIDs, error) {
	if bridgeIDs == nil || bridgeIDs.TelegramMessageID == 0 {
		return nil, nil
	}

	data := map[string]interface{}{
		"chat_id":    b.chatID,
		"message_id": bridgeIDs.TelegramMessageID,
		"text":       fmt.Sprintf("✏️ (edited):\n%s", content),
		"parse_mode": "HTML",
	}

	resp, err := b.callAPI("editMessageText", data)
	if err != nil {
		return nil, err
	}

	if !resp.OK {
		log.Printf("[TelegramBridge] Edit failed: %s", resp.Description)
		return nil, nil
	}

	return &types.BridgeMessageIDs{TelegramMessageID: bridgeIDs.TelegramMessageID}, nil
}

// OnVisitorMessageDeleted syncs a message delete to Telegram
func (b *TelegramBridge) OnVisitorMessageDeleted(sessionID, messageID string, bridgeIDs *types.BridgeMessageIDs) error {
	if bridgeIDs == nil || bridgeIDs.TelegramMessageID == 0 {
		return nil
	}

	data := map[string]interface{}{
		"chat_id":    b.chatID,
		"message_id": bridgeIDs.TelegramMessageID,
	}

	resp, err := b.callAPI("deleteMessage", data)
	if err != nil {
		return err
	}

	if !resp.OK {
		log.Printf("[TelegramBridge] Delete failed: %s", resp.Description)
	}

	return nil
}

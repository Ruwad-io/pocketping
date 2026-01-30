package bridges

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"time"

	pocketping "github.com/Ruwad-io/pocketping/sdk-go"
	"github.com/pocketping/bridge-server/internal/config"
	"github.com/pocketping/bridge-server/internal/types"
)

const slackAPIBase = "https://slack.com/api"

// SlackBridge sends notifications to Slack
type SlackBridge struct {
	*BaseBridge
	botToken   string
	channelID  string
	webhookURL string
	username   string
	iconEmoji  string
	client     *http.Client
}

// NewSlackBridge creates a new Slack bridge with validation
func NewSlackBridge(cfg *config.SlackConfig) (*SlackBridge, error) {
	// Validate based on mode
	if cfg.BotToken != "" {
		// Bot mode
		if err := pocketping.ValidateSlackBotConfig(cfg.BotToken, cfg.ChannelID); err != nil {
			return nil, err
		}
	} else if cfg.WebhookURL != "" {
		// Webhook mode
		if err := pocketping.ValidateSlackWebhookConfig(cfg.WebhookURL); err != nil {
			return nil, err
		}
	} else {
		return nil, pocketping.NewSetupError("Slack", "bot_token or webhook_url")
	}

	return &SlackBridge{
		BaseBridge: NewBaseBridge("slack"),
		botToken:   cfg.BotToken,
		channelID:  cfg.ChannelID,
		webhookURL: cfg.WebhookURL,
		username:   cfg.Username,
		iconEmoji:  cfg.IconEmoji,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

// isBotMode returns true if using bot mode (vs webhook mode)
func (b *SlackBridge) isBotMode() bool {
	return b.botToken != "" && b.channelID != ""
}

// slackBlock represents a Slack block
type slackBlock struct {
	Type   string          `json:"type"`
	Text   *slackTextBlock `json:"text,omitempty"`
	Fields []slackField    `json:"fields,omitempty"`
}

type slackTextBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type slackField struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// slackResponse is the standard Slack API response
type slackResponse struct {
	OK    bool   `json:"ok"`
	TS    string `json:"ts,omitempty"`
	Error string `json:"error,omitempty"`
}

// escapeSlack escapes special characters for Slack
func escapeSlack(s string) string {
	s = html.EscapeString(s)
	return s
}

// sendMessage sends a message to Slack
func (b *SlackBridge) sendMessage(text string, blocks []slackBlock) (string, error) {
	data := map[string]interface{}{
		"text": text,
	}

	if len(blocks) > 0 {
		data["blocks"] = blocks
	}
	if b.username != "" {
		data["username"] = b.username
	}
	if b.iconEmoji != "" {
		data["icon_emoji"] = b.iconEmoji
	}

	var url string
	var headers map[string]string

	if b.isBotMode() {
		url = slackAPIBase + "/chat.postMessage"
		data["channel"] = b.channelID
		headers = map[string]string{
			"Authorization": fmt.Sprintf("Bearer %s", b.botToken),
		}
	} else {
		url = b.webhookURL
		headers = map[string]string{}
	}

	body, err := json.Marshal(data)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := b.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	// Webhook returns "ok" as plain text
	if !b.isBotMode() {
		if string(respBody) != "ok" {
			log.Printf("[SlackBridge] Webhook error: %s", string(respBody))
			return "", fmt.Errorf("slack webhook error: %s", string(respBody))
		}
		return "", nil
	}

	// Bot API returns JSON
	var slackResp slackResponse
	if err := json.Unmarshal(respBody, &slackResp); err != nil {
		return "", err
	}

	if !slackResp.OK {
		log.Printf("[SlackBridge] API error: %s", slackResp.Error)
		return "", fmt.Errorf("slack API error: %s", slackResp.Error)
	}

	return slackResp.TS, nil
}

// OnNewSession announces a new chat session
func (b *SlackBridge) OnNewSession(session *types.Session) error {
	visitorName := session.VisitorID
	if session.Identity != nil && session.Identity.Name != "" {
		visitorName = session.Identity.Name
	}

	text := fmt.Sprintf("New chat session from %s", visitorName)

	blocks := []slackBlock{
		{
			Type: "header",
			Text: &slackTextBlock{Type: "plain_text", Text: "New Chat Session"},
		},
		{
			Type: "section",
			Fields: []slackField{
				{Type: "mrkdwn", Text: fmt.Sprintf("*Visitor:*\n%s", escapeSlack(visitorName))},
			},
		},
	}

	if session.Metadata != nil && session.Metadata.URL != "" {
		blocks = append(blocks, slackBlock{
			Type: "section",
			Text: &slackTextBlock{
				Type: "mrkdwn",
				Text: fmt.Sprintf("*Page:* %s", escapeSlack(session.Metadata.URL)),
			},
		})
	}

	_, err := b.sendMessage(text, blocks)
	return err
}

// OnVisitorMessage sends a visitor message to Slack
func (b *SlackBridge) OnVisitorMessage(message *types.Message, session *types.Session, reply *ReplyContext) (*types.BridgeMessageIDs, error) {
	visitorName := session.VisitorID
	if session.Identity != nil && session.Identity.Name != "" {
		visitorName = session.Identity.Name
	}

	text := fmt.Sprintf("*%s*: %s", escapeSlack(visitorName), escapeSlack(message.Content))
	if reply != nil && reply.Quote != "" {
		text = reply.Quote + "\n" + text
	}

	if len(message.Attachments) > 0 {
		text += fmt.Sprintf(" _(+%d attachment(s))_", len(message.Attachments))
	}

	ts, err := b.sendMessage(text, nil)
	if err != nil {
		return nil, err
	}

	if ts != "" {
		return &types.BridgeMessageIDs{SlackMessageTS: ts}, nil
	}
	return nil, nil
}

// OnOperatorMessage relays an operator message from another bridge
func (b *SlackBridge) OnOperatorMessage(message *types.Message, session *types.Session, sourceBridge, operatorName string) error {
	if sourceBridge == "slack" {
		return nil
	}

	name := operatorName
	if name == "" {
		name = "Operator"
	}

	text := fmt.Sprintf("*%s* (via %s): %s", escapeSlack(name), sourceBridge, escapeSlack(message.Content))
	_, err := b.sendMessage(text, nil)
	return err
}

// OnTyping is a no-op for Slack (no typing indicator API for channels)
func (b *SlackBridge) OnTyping(sessionID string, isTyping bool) error {
	return nil
}

// OnMessageRead handles read receipts (no-op for Slack)
func (b *SlackBridge) OnMessageRead(sessionID string, messageIDs []string, status types.MessageStatus) error {
	return nil
}

// OnCustomEvent sends a custom event notification
func (b *SlackBridge) OnCustomEvent(event *types.CustomEvent, session *types.Session) error {
	text := fmt.Sprintf("Event: %s", event.Name)

	blocks := []slackBlock{
		{
			Type: "header",
			Text: &slackTextBlock{Type: "plain_text", Text: fmt.Sprintf("Event: %s", event.Name)},
		},
	}

	if event.Data != nil {
		data, _ := json.MarshalIndent(event.Data, "", "  ")
		blocks = append(blocks, slackBlock{
			Type: "section",
			Text: &slackTextBlock{
				Type: "mrkdwn",
				Text: fmt.Sprintf("```%s```", string(data)),
			},
		})
	}

	_, err := b.sendMessage(text, blocks)
	return err
}

// OnIdentityUpdate sends an identity update notification
func (b *SlackBridge) OnIdentityUpdate(session *types.Session) error {
	if session.Identity == nil {
		return nil
	}

	text := fmt.Sprintf("User identified: %s", session.Identity.ID)

	blocks := []slackBlock{
		{
			Type: "header",
			Text: &slackTextBlock{Type: "plain_text", Text: "User Identified"},
		},
		{
			Type: "section",
			Fields: []slackField{
				{Type: "mrkdwn", Text: fmt.Sprintf("*ID:*\n%s", escapeSlack(session.Identity.ID))},
			},
		},
	}

	if session.Identity.Name != "" {
		blocks[1].Fields = append(blocks[1].Fields, slackField{
			Type: "mrkdwn",
			Text: fmt.Sprintf("*Name:*\n%s", escapeSlack(session.Identity.Name)),
		})
	}
	if session.Identity.Email != "" {
		blocks[1].Fields = append(blocks[1].Fields, slackField{
			Type: "mrkdwn",
			Text: fmt.Sprintf("*Email:*\n%s", escapeSlack(session.Identity.Email)),
		})
	}
	if session.UserPhone != "" {
		blocks[1].Fields = append(blocks[1].Fields, slackField{
			Type: "mrkdwn",
			Text: fmt.Sprintf("*Phone:*\n%s", escapeSlack(session.UserPhone)),
		})
	}

	_, err := b.sendMessage(text, blocks)
	return err
}

// OnAITakeover sends an AI takeover notification
func (b *SlackBridge) OnAITakeover(session *types.Session, reason string) error {
	text := fmt.Sprintf("AI Takeover: %s", reason)

	blocks := []slackBlock{
		{
			Type: "header",
			Text: &slackTextBlock{Type: "plain_text", Text: "AI Takeover"},
		},
		{
			Type: "section",
			Text: &slackTextBlock{Type: "mrkdwn", Text: escapeSlack(reason)},
		},
	}

	_, err := b.sendMessage(text, blocks)
	return err
}

// OnVisitorMessageEdited syncs a message edit to Slack (bot mode only)
func (b *SlackBridge) OnVisitorMessageEdited(sessionID, messageID, content string, bridgeIDs *types.BridgeMessageIDs) (*types.BridgeMessageIDs, error) {
	if !b.isBotMode() || bridgeIDs == nil || bridgeIDs.SlackMessageTS == "" {
		return nil, nil
	}

	data := map[string]interface{}{
		"channel": b.channelID,
		"ts":      bridgeIDs.SlackMessageTS,
		"text":    fmt.Sprintf("_(edited)_ %s", escapeSlack(content)),
	}

	body, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", slackAPIBase+"/chat.update", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", b.botToken))

	resp, err := b.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var slackResp slackResponse
	if err := json.Unmarshal(respBody, &slackResp); err != nil {
		return nil, err
	}

	if !slackResp.OK {
		log.Printf("[SlackBridge] Edit failed: %s", slackResp.Error)
		return nil, nil
	}

	return &types.BridgeMessageIDs{SlackMessageTS: bridgeIDs.SlackMessageTS}, nil
}

// OnVisitorMessageDeleted syncs a message delete to Slack (bot mode only)
func (b *SlackBridge) OnVisitorMessageDeleted(sessionID, messageID string, bridgeIDs *types.BridgeMessageIDs) error {
	if !b.isBotMode() || bridgeIDs == nil || bridgeIDs.SlackMessageTS == "" {
		return nil
	}

	data := map[string]interface{}{
		"channel": b.channelID,
		"ts":      bridgeIDs.SlackMessageTS,
	}

	body, err := json.Marshal(data)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", slackAPIBase+"/chat.delete", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", b.botToken))

	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	var slackResp slackResponse
	if err := json.Unmarshal(respBody, &slackResp); err != nil {
		return err
	}

	if !slackResp.OK {
		log.Printf("[SlackBridge] Delete failed: %s", slackResp.Error)
	}

	return nil
}

// OnVisitorDisconnect sends a notification when visitor leaves the page
func (b *SlackBridge) OnVisitorDisconnect(session *types.Session, message string) error {
	if !b.isBotMode() || session.SlackThreadTS == "" {
		return nil
	}

	data := map[string]interface{}{
		"channel":   b.channelID,
		"thread_ts": session.SlackThreadTS,
		"text":      message,
	}

	body, err := json.Marshal(data)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", slackAPIBase+"/chat.postMessage", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", b.botToken))

	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	var slackResp slackResponse
	if err := json.Unmarshal(respBody, &slackResp); err != nil {
		return err
	}

	if !slackResp.OK {
		log.Printf("[SlackBridge] Disconnect notification failed: %s", slackResp.Error)
	}

	return nil
}

package bridges

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/pocketping/bridge-server/internal/config"
	"github.com/pocketping/bridge-server/internal/types"
)

const discordAPIBase = "https://discord.com/api/v10"

// DiscordBridge sends notifications to Discord
type DiscordBridge struct {
	*BaseBridge
	botToken   string
	channelID  string
	webhookURL string
	username   string
	avatarURL  string
	client     *http.Client
}

// NewDiscordBridge creates a new Discord bridge
func NewDiscordBridge(cfg *config.DiscordConfig) *DiscordBridge {
	return &DiscordBridge{
		BaseBridge: NewBaseBridge("discord"),
		botToken:   cfg.BotToken,
		channelID:  cfg.ChannelID,
		webhookURL: cfg.WebhookURL,
		username:   cfg.Username,
		avatarURL:  cfg.AvatarURL,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// isBotMode returns true if using bot mode (vs webhook mode)
func (b *DiscordBridge) isBotMode() bool {
	return b.botToken != "" && b.channelID != ""
}

// discordEmbed represents a Discord embed
type discordEmbed struct {
	Title       string                `json:"title,omitempty"`
	Description string                `json:"description,omitempty"`
	Color       int                   `json:"color,omitempty"`
	Fields      []discordEmbedField   `json:"fields,omitempty"`
	Footer      *discordEmbedFooter   `json:"footer,omitempty"`
	Timestamp   string                `json:"timestamp,omitempty"`
}

type discordEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

type discordEmbedFooter struct {
	Text string `json:"text"`
}

// discordMessageResponse is the response from sending a message
type discordMessageResponse struct {
	ID string `json:"id"`
}

// sendMessage sends a message to Discord
func (b *DiscordBridge) sendMessage(content string, embeds []discordEmbed, replyToMessageID string) (string, error) {
	data := map[string]interface{}{}

	if content != "" {
		data["content"] = content
	}
	if len(embeds) > 0 {
		data["embeds"] = embeds
	}
	if b.username != "" {
		data["username"] = b.username
	}
	if b.avatarURL != "" {
		data["avatar_url"] = b.avatarURL
	}
	if replyToMessageID != "" {
		data["message_reference"] = map[string]string{
			"message_id": replyToMessageID,
		}
	}

	var url string
	var headers map[string]string

	if b.isBotMode() {
		url = fmt.Sprintf("%s/channels/%s/messages", discordAPIBase, b.channelID)
		headers = map[string]string{
			"Authorization": fmt.Sprintf("Bot %s", b.botToken),
		}
	} else {
		url = b.webhookURL + "?wait=true"
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

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		log.Printf("[DiscordBridge] API error %d: %s", resp.StatusCode, string(respBody))
		return "", fmt.Errorf("discord API error: %d", resp.StatusCode)
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var msgResp discordMessageResponse
	if err := json.Unmarshal(respBody, &msgResp); err != nil {
		return "", nil // Webhooks may not return ID
	}

	return msgResp.ID, nil
}

// OnNewSession announces a new chat session
func (b *DiscordBridge) OnNewSession(session *types.Session) error {
	visitorName := session.VisitorID
	if session.Identity != nil && session.Identity.Name != "" {
		visitorName = session.Identity.Name
	}

	embed := discordEmbed{
		Title:       "New Chat Session",
		Description: "A new visitor has started a chat",
		Color:       0x00D4AA, // PocketPing teal
		Fields: []discordEmbedField{
			{Name: "Visitor", Value: visitorName, Inline: true},
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	if session.Metadata != nil && session.Metadata.URL != "" {
		embed.Fields = append(embed.Fields, discordEmbedField{
			Name:   "Page",
			Value:  session.Metadata.URL,
			Inline: false,
		})
	}

	_, err := b.sendMessage("", []discordEmbed{embed}, "")
	return err
}

// OnVisitorMessage sends a visitor message to Discord
func (b *DiscordBridge) OnVisitorMessage(message *types.Message, session *types.Session, reply *ReplyContext) (*types.BridgeMessageIDs, error) {
	visitorName := session.VisitorID
	if session.Identity != nil && session.Identity.Name != "" {
		visitorName = session.Identity.Name
	}

	content := fmt.Sprintf("**%s**: %s", visitorName, message.Content)

	if len(message.Attachments) > 0 {
		content += fmt.Sprintf(" _(+%d attachment(s))_", len(message.Attachments))
	}

	replyToMessageID := ""
	if reply != nil && reply.BridgeIDs != nil {
		replyToMessageID = reply.BridgeIDs.DiscordMessageID
	}

	msgID, err := b.sendMessage(content, nil, replyToMessageID)
	if err != nil {
		return nil, err
	}

	if msgID != "" {
		return &types.BridgeMessageIDs{DiscordMessageID: msgID}, nil
	}
	return nil, nil
}

// OnOperatorMessage relays an operator message from another bridge
func (b *DiscordBridge) OnOperatorMessage(message *types.Message, session *types.Session, sourceBridge, operatorName string) error {
	if sourceBridge == "discord" {
		return nil
	}

	name := operatorName
	if name == "" {
		name = "Operator"
	}

	content := fmt.Sprintf("**%s** (via %s): %s", name, sourceBridge, message.Content)
	_, err := b.sendMessage(content, nil, "")
	return err
}

// OnTyping sends a typing indicator
func (b *DiscordBridge) OnTyping(sessionID string, isTyping bool) error {
	if !isTyping || !b.isBotMode() {
		return nil
	}

	url := fmt.Sprintf("%s/channels/%s/typing", discordAPIBase, b.channelID)

	req, err := http.NewRequest("POST", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bot %s", b.botToken))

	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

// OnMessageRead handles read receipts (no-op for Discord)
func (b *DiscordBridge) OnMessageRead(sessionID string, messageIDs []string, status types.MessageStatus) error {
	return nil
}

// OnCustomEvent sends a custom event notification
func (b *DiscordBridge) OnCustomEvent(event *types.CustomEvent, session *types.Session) error {
	embed := discordEmbed{
		Title:     fmt.Sprintf("Event: %s", event.Name),
		Color:     0x5865F2, // Discord blurple
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	if event.Data != nil {
		data, _ := json.MarshalIndent(event.Data, "", "  ")
		embed.Description = fmt.Sprintf("```json\n%s\n```", string(data))
	}

	_, err := b.sendMessage("", []discordEmbed{embed}, "")
	return err
}

// OnIdentityUpdate sends an identity update notification
func (b *DiscordBridge) OnIdentityUpdate(session *types.Session) error {
	if session.Identity == nil {
		return nil
	}

	embed := discordEmbed{
		Title: "User Identified",
		Color: 0x57F287, // Green
		Fields: []discordEmbedField{
			{Name: "User ID", Value: session.Identity.ID, Inline: true},
		},
	}

	if session.Identity.Name != "" {
		embed.Fields = append(embed.Fields, discordEmbedField{
			Name:   "Name",
			Value:  session.Identity.Name,
			Inline: true,
		})
	}
	if session.Identity.Email != "" {
		embed.Fields = append(embed.Fields, discordEmbedField{
			Name:   "Email",
			Value:  session.Identity.Email,
			Inline: true,
		})
	}

	_, err := b.sendMessage("", []discordEmbed{embed}, "")
	return err
}

// OnAITakeover sends an AI takeover notification
func (b *DiscordBridge) OnAITakeover(session *types.Session, reason string) error {
	embed := discordEmbed{
		Title:       "AI Takeover",
		Description: reason,
		Color:       0xFEE75C, // Yellow
	}

	_, err := b.sendMessage("", []discordEmbed{embed}, "")
	return err
}

// OnVisitorMessageEdited syncs a message edit to Discord (bot mode only)
func (b *DiscordBridge) OnVisitorMessageEdited(sessionID, messageID, content string, bridgeIDs *types.BridgeMessageIDs) (*types.BridgeMessageIDs, error) {
	if !b.isBotMode() || bridgeIDs == nil || bridgeIDs.DiscordMessageID == "" {
		return nil, nil
	}

	url := fmt.Sprintf("%s/channels/%s/messages/%s", discordAPIBase, b.channelID, bridgeIDs.DiscordMessageID)

	data := map[string]interface{}{
		"content": fmt.Sprintf("_(edited)_ %s", content),
	}

	body, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("PATCH", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bot %s", b.botToken))

	resp, err := b.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("[DiscordBridge] Edit failed: %d", resp.StatusCode)
		return nil, nil
	}

	return &types.BridgeMessageIDs{DiscordMessageID: bridgeIDs.DiscordMessageID}, nil
}

// OnVisitorMessageDeleted syncs a message delete to Discord (bot mode only)
func (b *DiscordBridge) OnVisitorMessageDeleted(sessionID, messageID string, bridgeIDs *types.BridgeMessageIDs) error {
	if !b.isBotMode() || bridgeIDs == nil || bridgeIDs.DiscordMessageID == "" {
		return nil
	}

	url := fmt.Sprintf("%s/channels/%s/messages/%s", discordAPIBase, b.channelID, bridgeIDs.DiscordMessageID)

	req, err := http.NewRequest("DELETE", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bot %s", b.botToken))

	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("[DiscordBridge] Delete failed: %d", resp.StatusCode)
	}

	return nil
}

package pocketping

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// SlackWebhookBridge sends notifications to Slack via incoming webhook.
type SlackWebhookBridge struct {
	BaseBridge
	WebhookURL string
	Username   string
	IconEmoji  string

	httpClient *http.Client
	pp         *PocketPing
}

// SlackWebhookOption is a functional option for SlackWebhookBridge.
type SlackWebhookOption func(*SlackWebhookBridge)

// WithSlackWebhookUsername sets the webhook username.
func WithSlackWebhookUsername(username string) SlackWebhookOption {
	return func(s *SlackWebhookBridge) {
		s.Username = username
	}
}

// WithSlackWebhookIconEmoji sets the webhook icon emoji.
func WithSlackWebhookIconEmoji(emoji string) SlackWebhookOption {
	return func(s *SlackWebhookBridge) {
		s.IconEmoji = emoji
	}
}

// WithSlackWebhookHTTPClient sets a custom HTTP client.
func WithSlackWebhookHTTPClient(client *http.Client) SlackWebhookOption {
	return func(s *SlackWebhookBridge) {
		s.httpClient = client
	}
}

// NewSlackWebhookBridge creates a new Slack webhook bridge.
func NewSlackWebhookBridge(webhookURL string, opts ...SlackWebhookOption) *SlackWebhookBridge {
	s := &SlackWebhookBridge{
		BaseBridge: BaseBridge{BridgeName: "slack-webhook"},
		WebhookURL: webhookURL,
		Username:   "PocketPing",
		IconEmoji:  ":speech_balloon:",
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}

	for _, opt := range opts {
		opt(s)
	}

	return s
}

// Init initializes the Slack webhook bridge.
func (s *SlackWebhookBridge) Init(ctx context.Context, pp *PocketPing) error {
	s.pp = pp
	return nil
}

// OnNewSession sends a notification when a new session is created.
func (s *SlackWebhookBridge) OnNewSession(ctx context.Context, session *Session) error {
	visitorName := s.getVisitorName(session)
	pageURL := ""
	if session.Metadata != nil && session.Metadata.URL != "" {
		pageURL = session.Metadata.URL
	}

	text := fmt.Sprintf(":new: New chat session\n:bust_in_silhouette: Visitor: %s", visitorName)
	if pageURL != "" {
		text += fmt.Sprintf("\n:round_pushpin: %s", pageURL)
	}

	err := s.sendWebhookMessage(ctx, text)
	if err != nil {
		log.Printf("[SlackWebhookBridge] OnNewSession error: %v", err)
	}
	return nil
}

// OnVisitorMessage sends a notification when a visitor sends a message.
func (s *SlackWebhookBridge) OnVisitorMessage(ctx context.Context, message *Message, session *Session) error {
	visitorName := s.getVisitorName(session)
	text := fmt.Sprintf(":speech_balloon: %s:\n%s", visitorName, message.Content)
	if quote := s.buildReplyQuote(ctx, message); quote != "" {
		text = quote + "\n" + text
	}

	// Note: Slack webhooks don't return message timestamps for editing
	// For full edit/delete support, use SlackBotBridge instead
	err := s.sendWebhookMessage(ctx, text)
	if err != nil {
		log.Printf("[SlackWebhookBridge] OnVisitorMessage error: %v", err)
	}
	return nil
}

// OnOperatorMessage is called when an operator sends a message.
func (s *SlackWebhookBridge) OnOperatorMessage(ctx context.Context, message *Message, session *Session, sourceBridge string, operatorName string) error {
	if sourceBridge == s.Name() {
		return nil
	}

	name := operatorName
	if name == "" {
		name = "Operator"
	}

	text := fmt.Sprintf(":office_worker: %s:\n%s", name, message.Content)

	err := s.sendWebhookMessage(ctx, text)
	if err != nil {
		log.Printf("[SlackWebhookBridge] OnOperatorMessage error: %v", err)
	}
	return nil
}

// OnTyping is called when visitor starts/stops typing.
func (s *SlackWebhookBridge) OnTyping(ctx context.Context, sessionID string, isTyping bool) error {
	// Slack webhooks don't support typing indicators
	return nil
}

// OnMessageRead is called when messages are marked as read.
func (s *SlackWebhookBridge) OnMessageRead(ctx context.Context, sessionID string, messageIDs []string, status MessageStatus) error {
	return nil
}

// OnCustomEvent is called when a custom event is triggered.
func (s *SlackWebhookBridge) OnCustomEvent(ctx context.Context, event CustomEvent, session *Session) error {
	visitorName := s.getVisitorName(session)
	text := fmt.Sprintf(":pushpin: Event from %s: %s", visitorName, event.Name)

	if len(event.Data) > 0 {
		dataJSON, err := json.Marshal(event.Data)
		if err == nil {
			text += fmt.Sprintf("\n:package: %s", string(dataJSON))
		}
	}

	err := s.sendWebhookMessage(ctx, text)
	if err != nil {
		log.Printf("[SlackWebhookBridge] OnCustomEvent error: %v", err)
	}
	return nil
}

// OnIdentityUpdate is called when a user identifies themselves.
func (s *SlackWebhookBridge) OnIdentityUpdate(ctx context.Context, session *Session) error {
	if session.Identity == nil {
		return nil
	}

	text := fmt.Sprintf(":closed_lock_with_key: User identified\n:bust_in_silhouette: ID: %s", session.Identity.ID)
	if session.Identity.Name != "" {
		text += fmt.Sprintf("\n:name_badge: Name: %s", session.Identity.Name)
	}
	if session.Identity.Email != "" {
		text += fmt.Sprintf("\n:email: Email: %s", session.Identity.Email)
	}

	err := s.sendWebhookMessage(ctx, text)
	if err != nil {
		log.Printf("[SlackWebhookBridge] OnIdentityUpdate error: %v", err)
	}
	return nil
}

type slackWebhookPayload struct {
	Text      string `json:"text"`
	Username  string `json:"username,omitempty"`
	IconEmoji string `json:"icon_emoji,omitempty"`
}

func (s *SlackWebhookBridge) sendWebhookMessage(ctx context.Context, text string) error {
	payload := slackWebhookPayload{
		Text:      text,
		Username:  s.Username,
		IconEmoji: s.IconEmoji,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", s.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("slack error: %s (status %d)", string(respBody), resp.StatusCode)
	}

	return nil
}

func (s *SlackWebhookBridge) getVisitorName(session *Session) string {
	if session.Identity != nil && session.Identity.Name != "" {
		return session.Identity.Name
	}
	if session.Identity != nil && session.Identity.Email != "" {
		return session.Identity.Email
	}
	return session.VisitorID
}

// Ensure SlackWebhookBridge implements Bridge interface
var _ Bridge = (*SlackWebhookBridge)(nil)

// SlackBotBridge sends notifications to Slack using a bot token.
// This supports full edit/delete functionality.
type SlackBotBridge struct {
	BaseBridge
	BotToken  string
	ChannelID string

	httpClient *http.Client
	pp         *PocketPing
}

// SlackBotOption is a functional option for SlackBotBridge.
type SlackBotOption func(*SlackBotBridge)

// WithSlackBotHTTPClient sets a custom HTTP client.
func WithSlackBotHTTPClient(client *http.Client) SlackBotOption {
	return func(s *SlackBotBridge) {
		s.httpClient = client
	}
}

// NewSlackBotBridge creates a new Slack bot bridge.
func NewSlackBotBridge(botToken, channelID string, opts ...SlackBotOption) *SlackBotBridge {
	s := &SlackBotBridge{
		BaseBridge: BaseBridge{BridgeName: "slack-bot"},
		BotToken:   botToken,
		ChannelID:  channelID,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}

	for _, opt := range opts {
		opt(s)
	}

	return s
}

// Init initializes the Slack bot bridge.
func (s *SlackBotBridge) Init(ctx context.Context, pp *PocketPing) error {
	s.pp = pp
	return nil
}

// OnNewSession sends a notification when a new session is created.
func (s *SlackBotBridge) OnNewSession(ctx context.Context, session *Session) error {
	visitorName := s.getVisitorName(session)
	pageURL := ""
	if session.Metadata != nil && session.Metadata.URL != "" {
		pageURL = session.Metadata.URL
	}

	text := fmt.Sprintf(":new: New chat session\n:bust_in_silhouette: Visitor: %s", visitorName)
	if pageURL != "" {
		text += fmt.Sprintf("\n:round_pushpin: %s", pageURL)
	}

	_, err := s.postMessage(ctx, text)
	if err != nil {
		log.Printf("[SlackBotBridge] OnNewSession error: %v", err)
	}
	return nil
}

// OnVisitorMessage sends a notification when a visitor sends a message.
func (s *SlackBotBridge) OnVisitorMessage(ctx context.Context, message *Message, session *Session) error {
	visitorName := s.getVisitorName(session)
	text := fmt.Sprintf(":speech_balloon: %s:\n%s", visitorName, message.Content)
	if quote := s.buildReplyQuote(ctx, message); quote != "" {
		text = quote + "\n" + text
	}

	result, err := s.postMessage(ctx, text)
	if err != nil {
		log.Printf("[SlackBotBridge] OnVisitorMessage error: %v", err)
		return nil
	}

	// Save bridge message ID for edit/delete support
	if result != nil && result.SlackMessageTS != "" && s.pp != nil {
		if storage, ok := s.pp.GetStorage().(StorageWithBridgeIDs); ok {
			_ = storage.SaveBridgeMessageIDs(ctx, message.ID, BridgeMessageIds{
				SlackMessageTS: result.SlackMessageTS,
			})
		}
	}

	return nil
}

// OnOperatorMessage is called when an operator sends a message.
func (s *SlackBotBridge) OnOperatorMessage(ctx context.Context, message *Message, session *Session, sourceBridge string, operatorName string) error {
	if sourceBridge == s.Name() {
		return nil
	}

	name := operatorName
	if name == "" {
		name = "Operator"
	}

	text := fmt.Sprintf(":office_worker: %s:\n%s", name, message.Content)

	_, err := s.postMessage(ctx, text)
	if err != nil {
		log.Printf("[SlackBotBridge] OnOperatorMessage error: %v", err)
	}
	return nil
}

func (s *SlackWebhookBridge) buildReplyQuote(ctx context.Context, message *Message) string {
	if message.ReplyTo == "" || s.pp == nil {
		return ""
	}
	replyTarget, err := s.pp.GetStorage().GetMessage(ctx, message.ReplyTo)
	if err != nil || replyTarget == nil {
		return ""
	}
	return formatSlackReplyQuote(replyTarget)
}

func (s *SlackBotBridge) buildReplyQuote(ctx context.Context, message *Message) string {
	if message.ReplyTo == "" || s.pp == nil {
		return ""
	}
	replyTarget, err := s.pp.GetStorage().GetMessage(ctx, message.ReplyTo)
	if err != nil || replyTarget == nil {
		return ""
	}
	return formatSlackReplyQuote(replyTarget)
}

func formatSlackReplyQuote(replyTarget *Message) string {
	senderLabel := "Visitor"
	switch replyTarget.Sender {
	case SenderOperator:
		senderLabel = "Support"
	case SenderAI:
		senderLabel = "AI"
	}

	preview := replyTarget.Content
	if replyTarget.DeletedAt != nil {
		preview = "Message deleted"
	}
	if len(preview) > 140 {
		preview = preview[:140] + "..."
	}

	return fmt.Sprintf("> *%s* — %s", senderLabel, preview)
}

// OnTyping is called when visitor starts/stops typing.
func (s *SlackBotBridge) OnTyping(ctx context.Context, sessionID string, isTyping bool) error {
	// Slack doesn't have a typing indicator API for bots
	return nil
}

// OnMessageRead is called when messages are marked as read.
func (s *SlackBotBridge) OnMessageRead(ctx context.Context, sessionID string, messageIDs []string, status MessageStatus) error {
	return nil
}

// OnCustomEvent is called when a custom event is triggered.
func (s *SlackBotBridge) OnCustomEvent(ctx context.Context, event CustomEvent, session *Session) error {
	visitorName := s.getVisitorName(session)
	text := fmt.Sprintf(":pushpin: Event from %s: %s", visitorName, event.Name)

	if len(event.Data) > 0 {
		dataJSON, err := json.Marshal(event.Data)
		if err == nil {
			text += fmt.Sprintf("\n:package: %s", string(dataJSON))
		}
	}

	_, err := s.postMessage(ctx, text)
	if err != nil {
		log.Printf("[SlackBotBridge] OnCustomEvent error: %v", err)
	}
	return nil
}

// OnIdentityUpdate is called when a user identifies themselves.
func (s *SlackBotBridge) OnIdentityUpdate(ctx context.Context, session *Session) error {
	if session.Identity == nil {
		return nil
	}

	text := fmt.Sprintf(":closed_lock_with_key: User identified\n:bust_in_silhouette: ID: %s", session.Identity.ID)
	if session.Identity.Name != "" {
		text += fmt.Sprintf("\n:name_badge: Name: %s", session.Identity.Name)
	}
	if session.Identity.Email != "" {
		text += fmt.Sprintf("\n:email: Email: %s", session.Identity.Email)
	}

	_, err := s.postMessage(ctx, text)
	if err != nil {
		log.Printf("[SlackBotBridge] OnIdentityUpdate error: %v", err)
	}
	return nil
}

// OnMessageEdit handles message edits.
func (s *SlackBotBridge) OnMessageEdit(ctx context.Context, sessionID, messageID, content string, editedAt time.Time) (*BridgeMessageResult, error) {
	if s.pp == nil {
		return nil, nil
	}

	storage, ok := s.pp.GetStorage().(StorageWithBridgeIDs)
	if !ok {
		return nil, nil
	}

	bridgeIDs, err := storage.GetBridgeMessageIDs(ctx, messageID)
	if err != nil || bridgeIDs == nil || bridgeIDs.SlackMessageTS == "" {
		return nil, nil
	}

	err = s.updateMessage(ctx, bridgeIDs.SlackMessageTS, content+" (edited)")
	if err != nil {
		log.Printf("[SlackBotBridge] OnMessageEdit error: %v", err)
		return nil, nil
	}

	return &BridgeMessageResult{
		SlackMessageTS: bridgeIDs.SlackMessageTS,
	}, nil
}

// OnMessageDelete handles message deletions.
func (s *SlackBotBridge) OnMessageDelete(ctx context.Context, sessionID, messageID string, deletedAt time.Time) error {
	if s.pp == nil {
		return nil
	}

	storage, ok := s.pp.GetStorage().(StorageWithBridgeIDs)
	if !ok {
		return nil
	}

	bridgeIDs, err := storage.GetBridgeMessageIDs(ctx, messageID)
	if err != nil || bridgeIDs == nil || bridgeIDs.SlackMessageTS == "" {
		return nil
	}

	err = s.deleteMessage(ctx, bridgeIDs.SlackMessageTS)
	if err != nil {
		log.Printf("[SlackBotBridge] OnMessageDelete error: %v", err)
	}
	return nil
}

// Slack API helpers

const slackAPIBase = "https://slack.com/api"

type slackPostMessagePayload struct {
	Channel string `json:"channel"`
	Text    string `json:"text"`
}

type slackUpdateMessagePayload struct {
	Channel string `json:"channel"`
	TS      string `json:"ts"`
	Text    string `json:"text"`
}

type slackDeleteMessagePayload struct {
	Channel string `json:"channel"`
	TS      string `json:"ts"`
}

type slackResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	TS    string `json:"ts,omitempty"`
}

func (s *SlackBotBridge) postMessage(ctx context.Context, text string) (*BridgeMessageResult, error) {
	apiURL := slackAPIBase + "/chat.postMessage"

	payload := slackPostMessagePayload{
		Channel: s.ChannelID,
		Text:    text,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Authorization", "Bearer "+s.BotToken)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var slackResp slackResponse
	if err := json.Unmarshal(respBody, &slackResp); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	if !slackResp.OK {
		return nil, fmt.Errorf("slack error: %s", slackResp.Error)
	}

	return &BridgeMessageResult{
		SlackMessageTS: slackResp.TS,
	}, nil
}

func (s *SlackBotBridge) updateMessage(ctx context.Context, ts, text string) error {
	apiURL := slackAPIBase + "/chat.update"

	payload := slackUpdateMessagePayload{
		Channel: s.ChannelID,
		TS:      ts,
		Text:    text,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Authorization", "Bearer "+s.BotToken)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	var slackResp slackResponse
	if err := json.Unmarshal(respBody, &slackResp); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if !slackResp.OK {
		return fmt.Errorf("slack error: %s", slackResp.Error)
	}

	return nil
}

func (s *SlackBotBridge) deleteMessage(ctx context.Context, ts string) error {
	apiURL := slackAPIBase + "/chat.delete"

	payload := slackDeleteMessagePayload{
		Channel: s.ChannelID,
		TS:      ts,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Authorization", "Bearer "+s.BotToken)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	var slackResp slackResponse
	if err := json.Unmarshal(respBody, &slackResp); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if !slackResp.OK {
		return fmt.Errorf("slack error: %s", slackResp.Error)
	}

	return nil
}

func (s *SlackBotBridge) getVisitorName(session *Session) string {
	if session.Identity != nil && session.Identity.Name != "" {
		return session.Identity.Name
	}
	if session.Identity != nil && session.Identity.Email != "" {
		return session.Identity.Email
	}
	return session.VisitorID
}

// Ensure SlackBotBridge implements Bridge interface
var _ Bridge = (*SlackBotBridge)(nil)

// Ensure SlackBotBridge implements BridgeWithEditDelete interface
var _ BridgeWithEditDelete = (*SlackBotBridge)(nil)

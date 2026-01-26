// Package api provides HTTP API routes for the bridge server
package api

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	pocketping "github.com/Ruwad-io/pocketping/sdk-go"
	"github.com/pocketping/bridge-server/internal/types"
)

// webhookHandler is the shared WebhookHandler instance
var webhookHandler *pocketping.WebhookHandler

// InitWebhooks initializes the webhook handlers
func (s *Server) InitWebhooks() {
	webhookHandler = pocketping.NewWebhookHandler(pocketping.WebhookConfig{
		TelegramBotToken: s.getTelegramBotToken(),
		SlackBotToken:    s.getSlackBotToken(),
		DiscordBotToken:  s.getDiscordBotToken(),
		AllowedBotIDs:     s.getAllowedBotIDs(),
		OnOperatorMessageWithIDs: func(ctx context.Context, sessionID, content, operatorName, sourceBridge string, attachments []pocketping.Attachment, replyToBridgeMessageID *int, bridgeMessageID string) {
			s.RecordOperatorMessage(sessionID, content, operatorName, sourceBridge, attachments, replyToBridgeMessageID, bridgeMessageID)
		},
		OnOperatorMessageEdit: func(ctx context.Context, sessionID, bridgeMessageID, content, sourceBridge string, editedAt time.Time) {
			s.RecordOperatorMessageEdit(sessionID, bridgeMessageID, content, sourceBridge, editedAt)
		},
		OnOperatorMessageDelete: func(ctx context.Context, sessionID, bridgeMessageID, sourceBridge string, deletedAt time.Time) {
			s.RecordOperatorMessageDelete(sessionID, bridgeMessageID, sourceBridge, deletedAt)
		},
	})
}

func buildOperatorMessageID(sourceBridge, bridgeMessageID string) string {
	return fmt.Sprintf("%s:%s", sourceBridge, bridgeMessageID)
}

// getTelegramBotToken returns the Telegram bot token from config
func (s *Server) getTelegramBotToken() string {
	if s.config.Telegram != nil {
		return s.config.Telegram.BotToken
	}
	return ""
}

// getSlackBotToken returns the Slack bot token from config
func (s *Server) getSlackBotToken() string {
	if s.config.Slack != nil {
		return s.config.Slack.BotToken
	}
	return ""
}

// getDiscordBotToken returns the Discord bot token from config
func (s *Server) getDiscordBotToken() string {
	if s.config.Discord != nil {
		return s.config.Discord.BotToken
	}
	return ""
}

func (s *Server) getAllowedBotIDs() []string {
	if s.config.TestBotIDs != nil {
		return s.config.TestBotIDs
	}
	return nil
}

func (s *Server) RecordOperatorMessage(sessionID, content, operatorName, sourceBridge string, attachments []pocketping.Attachment, replyToBridgeMessageID *int, bridgeMessageID string) {
	// Convert attachments and collect URLs for cross-bridge sync
	var bridgeAttachments []*types.Attachment
	for _, att := range attachments {
		bridgeAttachments = append(bridgeAttachments, &types.Attachment{
			Filename: att.Filename,
			MimeType: att.MimeType,
			Size:     att.Size,
			URL:      att.URL,
			Data:     att.Data,
		})
	}

	messageID := buildOperatorMessageID(sourceBridge, bridgeMessageID)

	// Save operator message for reply previews
	message := &types.Message{
		ID:          messageID,
		SessionID:   sessionID,
		Content:     content,
		Sender:      types.SenderOperator,
		Timestamp:   time.Now(),
		Attachments: bridgeAttachments,
	}
	s.saveMessage(message)

	// Store bridge message IDs for reply/edit/delete
	bridgeIDs := &types.BridgeMessageIDs{}
	switch sourceBridge {
	case "telegram":
		if id, err := strconv.Atoi(bridgeMessageID); err == nil {
			bridgeIDs.TelegramMessageID = id
		}
	case "discord":
		bridgeIDs.DiscordMessageID = bridgeMessageID
	case "slack":
		bridgeIDs.SlackMessageTS = bridgeMessageID
	}
	s.saveBridgeIDs(messageID, bridgeIDs)

	// Emit operator message event
	event := &types.OperatorMessageEvent{
		Type:                   "operator_message",
		SessionID:              sessionID,
		MessageID:              messageID,
		Content:                content,
		SourceBridge:           sourceBridge,
		OperatorName:           operatorName,
		Attachments:            bridgeAttachments,
		ReplyToBridgeMessageID: replyToBridgeMessageID,
	}
	s.EmitEvent(event)

	// Sync to other bridges (cross-bridge sync)
	s.syncOperatorMessageToBridges(message, sessionID, sourceBridge, operatorName, bridgeAttachments)
}

// syncOperatorMessageToBridges sends operator messages to all bridges except the source
func (s *Server) syncOperatorMessageToBridges(message *types.Message, sessionID, sourceBridge, operatorName string, attachments []*types.Attachment) {
	// Build content with attachment links for cross-bridge sync
	contentWithAttachments := message.Content
	if len(attachments) > 0 {
		attachmentLinks := formatAttachmentLinks(attachments)
		if attachmentLinks != "" {
			contentWithAttachments += attachmentLinks
		}
	}

	// Create a minimal session for the bridge call
	session := &types.Session{
		ID: sessionID,
	}

	// Create message with attachment links included
	syncMessage := &types.Message{
		ID:        message.ID,
		SessionID: sessionID,
		Content:   contentWithAttachments,
		Sender:    types.SenderOperator,
		Timestamp: message.Timestamp,
	}

	// Call OnOperatorMessage on all bridges except the source
	for _, bridge := range s.bridges {
		if bridge.Name() == sourceBridge {
			continue
		}
		if err := bridge.OnOperatorMessage(syncMessage, session, sourceBridge, operatorName); err != nil {
			log.Printf("[%s] OnOperatorMessage sync error: %v", bridge.Name(), err)
		}
	}
}

// formatAttachmentLinks formats attachment URLs for display in bridges
func formatAttachmentLinks(attachments []*types.Attachment) string {
	if len(attachments) == 0 {
		return ""
	}

	var links []string
	for _, att := range attachments {
		if att.URL == "" {
			continue
		}
		emoji := "📎"
		if strings.HasPrefix(att.MimeType, "image/") {
			emoji = "🖼️"
		}
		// Use simple format that works across all bridges
		links = append(links, fmt.Sprintf("%s %s: %s", emoji, att.Filename, att.URL))
	}

	if len(links) == 0 {
		return ""
	}
	return "\n\n" + strings.Join(links, "\n")
}

func (s *Server) RecordOperatorMessageEdit(sessionID, bridgeMessageID, content, sourceBridge string, editedAt time.Time) {
	messageID := buildOperatorMessageID(sourceBridge, bridgeMessageID)
	s.updateMessage(messageID, func(msg *types.Message) {
		msg.Content = content
		msg.EditedAt = &editedAt
	})

	event := &types.OperatorMessageEditedEvent{
		Type:      "operator_message_edited",
		SessionID: sessionID,
		MessageID: messageID,
		Content:   content,
		EditedAt:  editedAt,
	}
	s.EmitEvent(event)
}

func (s *Server) RecordOperatorMessageDelete(sessionID, bridgeMessageID, sourceBridge string, deletedAt time.Time) {
	messageID := buildOperatorMessageID(sourceBridge, bridgeMessageID)
	s.updateMessage(messageID, func(msg *types.Message) {
		msg.DeletedAt = &deletedAt
	})

	event := &types.OperatorMessageDeletedEvent{
		Type:      "operator_message_deleted",
		SessionID: sessionID,
		MessageID: messageID,
		DeletedAt: deletedAt,
	}
	s.EmitEvent(event)
}

// handleTelegramWebhook handles incoming Telegram webhook requests
func (s *Server) handleTelegramWebhook(w http.ResponseWriter, r *http.Request) {
	if webhookHandler == nil {
		s.InitWebhooks()
	}
	webhookHandler.HandleTelegramWebhook()(w, r)
}

// handleSlackWebhook handles incoming Slack webhook requests
func (s *Server) handleSlackWebhook(w http.ResponseWriter, r *http.Request) {
	if webhookHandler == nil {
		s.InitWebhooks()
	}
	webhookHandler.HandleSlackWebhook()(w, r)
}

// handleDiscordWebhook handles incoming Discord webhook requests
func (s *Server) handleDiscordWebhook(w http.ResponseWriter, r *http.Request) {
	if webhookHandler == nil {
		s.InitWebhooks()
	}
	webhookHandler.HandleDiscordWebhook()(w, r)
}

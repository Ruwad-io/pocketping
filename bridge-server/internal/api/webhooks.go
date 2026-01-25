// Package api provides HTTP API routes for the bridge server
package api

import (
	"context"
	"net/http"

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
		OnOperatorMessage: func(ctx context.Context, sessionID, content, operatorName, sourceBridge string, attachments []pocketping.Attachment) {
			// Convert attachments
			var bridgeAttachments []*types.Attachment
			for _, att := range attachments {
				bridgeAttachments = append(bridgeAttachments, &types.Attachment{
					Filename: att.Filename,
					MimeType: att.MimeType,
					Size:     att.Size,
					Data:     att.Data,
				})
			}

			// Emit operator message event
			event := &types.OperatorMessageEvent{
				Type:         "operator_message",
				SessionID:    sessionID,
				Content:      content,
				SourceBridge: sourceBridge,
				OperatorName: operatorName,
				Attachments:  bridgeAttachments,
			}
			s.EmitEvent(event)
		},
	})
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

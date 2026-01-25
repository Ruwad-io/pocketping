package pocketping

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// ─────────────────────────────────────────────────────────────────
// Webhook Types
// ─────────────────────────────────────────────────────────────────

// OperatorMessageCallback is called when an operator sends a message from a bridge
// replyToBridgeMessageID is the Telegram message_id that this message replies to (nil if not a reply)
type OperatorMessageCallback func(ctx context.Context, sessionID, content, operatorName, sourceBridge string, attachments []Attachment, replyToBridgeMessageID *int)

// OperatorMessageWithIDsCallback is called when an operator sends a message and includes the bridge message ID
type OperatorMessageWithIDsCallback func(ctx context.Context, sessionID, content, operatorName, sourceBridge string, attachments []Attachment, replyToBridgeMessageID *int, bridgeMessageID string)

// OperatorMessageEditCallback is called when an operator edits a message on a bridge
type OperatorMessageEditCallback func(ctx context.Context, sessionID, bridgeMessageID, content, sourceBridge string, editedAt time.Time)

// OperatorMessageDeleteCallback is called when an operator deletes a message on a bridge
type OperatorMessageDeleteCallback func(ctx context.Context, sessionID, bridgeMessageID, sourceBridge string, deletedAt time.Time)

// WebhookConfig holds configuration for bridge webhooks
type WebhookConfig struct {
	// Telegram configuration
	TelegramBotToken string

	// Slack configuration
	SlackBotToken string

	// Discord configuration (not needed for interactions endpoint)
	DiscordBotToken string

	// Optional allowlist of bot IDs (for test bots)
	AllowedBotIDs []string

	// Callback for operator messages
	OnOperatorMessage OperatorMessageCallback
	// Callback for operator messages with bridge message IDs
	OnOperatorMessageWithIDs OperatorMessageWithIDsCallback
	// Callback for operator message edits
	OnOperatorMessageEdit OperatorMessageEditCallback
	// Callback for operator message deletes
	OnOperatorMessageDelete OperatorMessageDeleteCallback
}

// WebhookHandler handles incoming webhooks from bridges (Telegram, Slack, Discord)
type WebhookHandler struct {
	config     WebhookConfig
	httpClient *http.Client
}

// NewWebhookHandler creates a new webhook handler
func NewWebhookHandler(config WebhookConfig) *WebhookHandler {
	return &WebhookHandler{
		config:     config,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// ─────────────────────────────────────────────────────────────────
// Telegram Webhook
// ─────────────────────────────────────────────────────────────────

// TelegramUpdate represents an incoming Telegram update
type TelegramUpdate struct {
	UpdateID int              `json:"update_id"`
	Message  *TelegramMessage `json:"message,omitempty"`
	EditedMessage *TelegramMessage `json:"edited_message,omitempty"`
}

// TelegramMessage represents a Telegram message
type TelegramMessage struct {
	MessageID       int                    `json:"message_id"`
	MessageThreadID int                    `json:"message_thread_id,omitempty"`
	Chat            TelegramChat           `json:"chat"`
	From            *TelegramUser          `json:"from,omitempty"`
	Text            string                 `json:"text,omitempty"`
	Caption         string                 `json:"caption,omitempty"`
	Photo           []TelegramPhotoSize    `json:"photo,omitempty"`
	Document        *TelegramDocument      `json:"document,omitempty"`
	Audio           *TelegramAudio         `json:"audio,omitempty"`
	Video           *TelegramVideo         `json:"video,omitempty"`
	Voice           *TelegramVoice         `json:"voice,omitempty"`
	ReplyToMessage  *TelegramReplyMessage  `json:"reply_to_message,omitempty"`
	Date            int64                  `json:"date"`
	EditDate        int64                  `json:"edit_date,omitempty"`
}

// TelegramReplyMessage represents the message being replied to
type TelegramReplyMessage struct {
	MessageID int `json:"message_id"`
}

// TelegramChat represents a Telegram chat
type TelegramChat struct {
	ID int64 `json:"id"`
}

// TelegramUser represents a Telegram user
type TelegramUser struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	Username  string `json:"username,omitempty"`
}

// TelegramPhotoSize represents a Telegram photo size
type TelegramPhotoSize struct {
	FileID       string `json:"file_id"`
	FileUniqueID string `json:"file_unique_id"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	FileSize     int    `json:"file_size,omitempty"`
}

// TelegramDocument represents a Telegram document
type TelegramDocument struct {
	FileID   string `json:"file_id"`
	FileName string `json:"file_name,omitempty"`
	MimeType string `json:"mime_type,omitempty"`
	FileSize int    `json:"file_size,omitempty"`
}

// TelegramAudio represents a Telegram audio file
type TelegramAudio struct {
	FileID   string `json:"file_id"`
	FileName string `json:"file_name,omitempty"`
	MimeType string `json:"mime_type,omitempty"`
	FileSize int    `json:"file_size,omitempty"`
}

// TelegramVideo represents a Telegram video file
type TelegramVideo struct {
	FileID   string `json:"file_id"`
	FileName string `json:"file_name,omitempty"`
	MimeType string `json:"mime_type,omitempty"`
	FileSize int    `json:"file_size,omitempty"`
}

// TelegramVoice represents a Telegram voice message
type TelegramVoice struct {
	FileID   string `json:"file_id"`
	MimeType string `json:"mime_type,omitempty"`
	FileSize int    `json:"file_size,omitempty"`
}

// HandleTelegramWebhook returns an http.HandlerFunc for Telegram webhooks
func (wh *WebhookHandler) HandleTelegramWebhook() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if wh.config.TelegramBotToken == "" {
			http.Error(w, `{"error":"Telegram not configured"}`, http.StatusNotFound)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, `{"error":"Bad request"}`, http.StatusBadRequest)
			return
		}

		var update TelegramUpdate
		if err := json.Unmarshal(body, &update); err != nil {
			http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
			return
		}

		// Process edits
		if update.EditedMessage != nil {
			msg := update.EditedMessage

			if strings.HasPrefix(msg.Text, "/") {
				writeOK(w)
				return
			}

			text := msg.Text
			if text == "" {
				text = msg.Caption
			}

			if text == "" {
				writeOK(w)
				return
			}

			topicID := msg.MessageThreadID
			if topicID == 0 {
				writeOK(w)
				return
			}

			if wh.config.OnOperatorMessageEdit != nil {
				editedAt := time.Now()
				if msg.EditDate > 0 {
					editedAt = time.Unix(msg.EditDate, 0)
				}
				wh.config.OnOperatorMessageEdit(r.Context(), fmt.Sprintf("%d", topicID), fmt.Sprintf("%d", msg.MessageID), text, "telegram", editedAt)
			}

			writeOK(w)
			return
		}

		// Process message
		if update.Message != nil {
			msg := update.Message

			// Skip commands
			if strings.HasPrefix(msg.Text, "/") {
				writeOK(w)
				return
			}

			// Get text content (text or caption for media)
			text := msg.Text
			if text == "" {
				text = msg.Caption
			}

			// Parse media
			var media *parsedMedia
			if len(msg.Photo) > 0 {
				largest := msg.Photo[len(msg.Photo)-1]
				media = &parsedMedia{
					fileID:   largest.FileID,
					filename: fmt.Sprintf("photo_%d.jpg", time.Now().Unix()),
					mimeType: "image/jpeg",
					size:     largest.FileSize,
				}
			} else if msg.Document != nil {
				media = &parsedMedia{
					fileID:   msg.Document.FileID,
					filename: msg.Document.FileName,
					mimeType: msg.Document.MimeType,
					size:     msg.Document.FileSize,
				}
			} else if msg.Audio != nil {
				filename := msg.Audio.FileName
				if filename == "" {
					filename = fmt.Sprintf("audio_%d.mp3", time.Now().Unix())
				}
				media = &parsedMedia{
					fileID:   msg.Audio.FileID,
					filename: filename,
					mimeType: msg.Audio.MimeType,
					size:     msg.Audio.FileSize,
				}
			} else if msg.Video != nil {
				filename := msg.Video.FileName
				if filename == "" {
					filename = fmt.Sprintf("video_%d.mp4", time.Now().Unix())
				}
				media = &parsedMedia{
					fileID:   msg.Video.FileID,
					filename: filename,
					mimeType: msg.Video.MimeType,
					size:     msg.Video.FileSize,
				}
			} else if msg.Voice != nil {
				media = &parsedMedia{
					fileID:   msg.Voice.FileID,
					filename: fmt.Sprintf("voice_%d.ogg", time.Now().Unix()),
					mimeType: msg.Voice.MimeType,
					size:     msg.Voice.FileSize,
				}
			}

			// Skip if no content
			if text == "" && media == nil {
				writeOK(w)
				return
			}

			// Get topic ID (for forum topics)
			topicID := msg.MessageThreadID
			if topicID == 0 {
				writeOK(w)
				return
			}

			// Get operator name
			operatorName := "Operator"
			if msg.From != nil && msg.From.FirstName != "" {
				operatorName = msg.From.FirstName
			}

			// Get reply_to_message ID if present (for visual reply linking)
			var replyToBridgeMessageID *int
			if msg.ReplyToMessage != nil {
				replyToBridgeMessageID = &msg.ReplyToMessage.MessageID
			}

			// Download media if present
			var attachments []Attachment
			if media != nil {
				data, err := wh.downloadTelegramFile(media.fileID)
				if err != nil {
					log.Printf("[TelegramWebhook] Failed to download file: %v", err)
				} else {
					attachments = append(attachments, Attachment{
						Filename: media.filename,
						MimeType: media.mimeType,
						Size:     int64(media.size),
						Data:     data,
					})
				}
			}

			// Call callback
			if wh.config.OnOperatorMessage != nil {
				sessionID := fmt.Sprintf("%d", topicID)
				wh.config.OnOperatorMessage(r.Context(), sessionID, text, operatorName, "telegram", attachments, replyToBridgeMessageID)
			}
			if wh.config.OnOperatorMessageWithIDs != nil {
				sessionID := fmt.Sprintf("%d", topicID)
				wh.config.OnOperatorMessageWithIDs(r.Context(), sessionID, text, operatorName, "telegram", attachments, replyToBridgeMessageID, fmt.Sprintf("%d", msg.MessageID))
			}
		}

		writeOK(w)
	}
}

type parsedMedia struct {
	fileID   string
	filename string
	mimeType string
	size     int
}

func (wh *WebhookHandler) downloadTelegramFile(fileID string) ([]byte, error) {
	botToken := wh.config.TelegramBotToken

	// Get file path
	getFileURL := fmt.Sprintf("https://api.telegram.org/bot%s/getFile?file_id=%s", botToken, fileID)
	resp, err := wh.httpClient.Get(getFileURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		OK     bool `json:"ok"`
		Result struct {
			FilePath string `json:"file_path"`
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	if !result.OK || result.Result.FilePath == "" {
		return nil, fmt.Errorf("failed to get file path")
	}

	// Download file
	downloadURL := fmt.Sprintf("https://api.telegram.org/file/bot%s/%s", botToken, result.Result.FilePath)
	fileResp, err := wh.httpClient.Get(downloadURL)
	if err != nil {
		return nil, err
	}
	defer fileResp.Body.Close()

	return io.ReadAll(fileResp.Body)
}

// ─────────────────────────────────────────────────────────────────
// Slack Webhook
// ─────────────────────────────────────────────────────────────────

// SlackEventPayload represents an incoming Slack event
type SlackEventPayload struct {
	Type      string      `json:"type"`
	Token     string      `json:"token,omitempty"`
	Challenge string      `json:"challenge,omitempty"`
	TeamID    string      `json:"team_id,omitempty"`
	Event     *SlackEvent `json:"event,omitempty"`
}

// SlackEvent represents a Slack event
type SlackEvent struct {
	Type     string      `json:"type"`
	Channel  string      `json:"channel,omitempty"`
	User     string      `json:"user,omitempty"`
	Text     string      `json:"text,omitempty"`
	Ts       string      `json:"ts,omitempty"`
	ThreadTs string      `json:"thread_ts,omitempty"`
	BotID    string      `json:"bot_id,omitempty"`
	Subtype  string      `json:"subtype,omitempty"`
	Files    []SlackFile `json:"files,omitempty"`
	Message  *SlackEventMessage `json:"message,omitempty"`
	PreviousMessage *SlackEventMessage `json:"previous_message,omitempty"`
	DeletedTs string `json:"deleted_ts,omitempty"`
}

type SlackEventMessage struct {
	Text     string      `json:"text,omitempty"`
	User     string      `json:"user,omitempty"`
	Ts       string      `json:"ts,omitempty"`
	ThreadTs string      `json:"thread_ts,omitempty"`
	BotID    string      `json:"bot_id,omitempty"`
	Files    []SlackFile `json:"files,omitempty"`
}

// SlackFile represents a Slack file
type SlackFile struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Mimetype           string `json:"mimetype"`
	Size               int    `json:"size"`
	URLPrivate         string `json:"url_private"`
	URLPrivateDownload string `json:"url_private_download,omitempty"`
}

// HandleSlackWebhook returns an http.HandlerFunc for Slack webhooks
func (wh *WebhookHandler) HandleSlackWebhook() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if wh.config.SlackBotToken == "" {
			http.Error(w, `{"error":"Slack not configured"}`, http.StatusNotFound)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, `{"error":"Bad request"}`, http.StatusBadRequest)
			return
		}

		var payload SlackEventPayload
		if err := json.Unmarshal(body, &payload); err != nil {
			http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
			return
		}

		// Handle URL verification challenge
		if payload.Type == "url_verification" && payload.Challenge != "" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"challenge": payload.Challenge})
			return
		}

		// Handle event callbacks
		if payload.Type == "event_callback" && payload.Event != nil {
			event := payload.Event
			if event.Type != "message" {
				writeOK(w)
				return
			}

			if event.Subtype == "message_changed" {
				if wh.config.OnOperatorMessageEdit != nil {
					botID := ""
					if event.Message != nil && event.Message.BotID != "" {
						botID = event.Message.BotID
					} else if event.PreviousMessage != nil && event.PreviousMessage.BotID != "" {
						botID = event.PreviousMessage.BotID
					} else if event.BotID != "" {
						botID = event.BotID
					}

					if botID == "" || wh.isAllowedBot(botID) {
						threadTs := ""
						messageTs := ""
						text := ""
						if event.Message != nil {
							threadTs = event.Message.ThreadTs
							messageTs = event.Message.Ts
							text = event.Message.Text
						}
						if threadTs == "" && event.PreviousMessage != nil {
							threadTs = event.PreviousMessage.ThreadTs
						}
						if messageTs == "" && event.PreviousMessage != nil {
							messageTs = event.PreviousMessage.Ts
						}

						if threadTs != "" && messageTs != "" {
							wh.config.OnOperatorMessageEdit(r.Context(), threadTs, messageTs, text, "slack", time.Now())
						}
					}
				}

				writeOK(w)
				return
			}

			if event.Subtype == "message_deleted" {
				if wh.config.OnOperatorMessageDelete != nil {
					botID := ""
					if event.PreviousMessage != nil && event.PreviousMessage.BotID != "" {
						botID = event.PreviousMessage.BotID
					} else if event.BotID != "" {
						botID = event.BotID
					}

					if botID == "" || wh.isAllowedBot(botID) {
						threadTs := ""
						if event.PreviousMessage != nil {
							threadTs = event.PreviousMessage.ThreadTs
						}
						messageTs := event.DeletedTs
						if messageTs == "" && event.PreviousMessage != nil {
							messageTs = event.PreviousMessage.Ts
						}

						if threadTs != "" && messageTs != "" {
							wh.config.OnOperatorMessageDelete(r.Context(), threadTs, messageTs, "slack", time.Now())
						}
					}
				}

				writeOK(w)
				return
			}

			hasContent := event.Type == "message" && event.ThreadTs != "" && (event.BotID == "" || wh.isAllowedBot(event.BotID)) && event.Subtype == ""
			hasFiles := len(event.Files) > 0

			if hasContent && (event.Text != "" || hasFiles) {
				threadTs := event.ThreadTs
				text := event.Text

				// Download files if present
				var attachments []Attachment
				if hasFiles {
					for _, file := range event.Files {
						data, err := wh.downloadSlackFile(file)
						if err != nil {
							log.Printf("[SlackWebhook] Failed to download file %s: %v", file.Name, err)
							continue
						}
						attachments = append(attachments, Attachment{
							Filename: file.Name,
							MimeType: file.Mimetype,
							Size:     int64(file.Size),
							Data:     data,
						})
					}
				}

				// Get user info for operator name
				operatorName := "Operator"
				if event.User != "" {
					if name, err := wh.getSlackUserName(event.User); err == nil && name != "" {
						operatorName = name
					}
				}

				// Call callback (Slack reply support TODO)
				if wh.config.OnOperatorMessage != nil {
					wh.config.OnOperatorMessage(r.Context(), threadTs, text, operatorName, "slack", attachments, nil)
				}
				if wh.config.OnOperatorMessageWithIDs != nil {
					wh.config.OnOperatorMessageWithIDs(r.Context(), threadTs, text, operatorName, "slack", attachments, nil, event.Ts)
				}
			}
		}

		writeOK(w)
	}
}

func (wh *WebhookHandler) downloadSlackFile(file SlackFile) ([]byte, error) {
	downloadURL := file.URLPrivateDownload
	if downloadURL == "" {
		downloadURL = file.URLPrivate
	}

	req, err := http.NewRequest("GET", downloadURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+wh.config.SlackBotToken)

	resp, err := wh.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	return io.ReadAll(resp.Body)
}

func (wh *WebhookHandler) getSlackUserName(userID string) (string, error) {
	url := fmt.Sprintf("https://slack.com/api/users.info?user=%s", userID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+wh.config.SlackBotToken)

	resp, err := wh.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		OK   bool `json:"ok"`
		User struct {
			RealName string `json:"real_name"`
			Name     string `json:"name"`
		} `json:"user"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	if !result.OK {
		return "", fmt.Errorf("failed to get user info")
	}

	if result.User.RealName != "" {
		return result.User.RealName, nil
	}
	return result.User.Name, nil
}

func (wh *WebhookHandler) isAllowedBot(botID string) bool {
	if botID == "" {
		return false
	}
	for _, allowed := range wh.config.AllowedBotIDs {
		if allowed == botID {
			return true
		}
	}
	return false
}

// ─────────────────────────────────────────────────────────────────
// Discord Webhook
// ─────────────────────────────────────────────────────────────────

// DiscordInteraction represents a Discord interaction
type DiscordInteraction struct {
	Type          int                     `json:"type"`
	ID            string                  `json:"id"`
	ApplicationID string                  `json:"application_id"`
	Token         string                  `json:"token"`
	ChannelID     string                  `json:"channel_id,omitempty"`
	GuildID       string                  `json:"guild_id,omitempty"`
	Member        *DiscordMember          `json:"member,omitempty"`
	User          *DiscordInteractionUser `json:"user,omitempty"`
	Data          *DiscordInteractionData `json:"data,omitempty"`
}

// DiscordMember represents a Discord guild member
type DiscordMember struct {
	User *DiscordInteractionUser `json:"user"`
}

// DiscordInteractionUser represents a Discord user in an interaction
type DiscordInteractionUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

// DiscordInteractionData represents Discord interaction data
type DiscordInteractionData struct {
	Name     string                 `json:"name,omitempty"`
	CustomID string                 `json:"custom_id,omitempty"`
	Options  []DiscordCommandOption `json:"options,omitempty"`
}

// DiscordCommandOption represents a Discord command option
type DiscordCommandOption struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Discord interaction types
const (
	DiscordInteractionTypePing               = 1
	DiscordInteractionTypeApplicationCommand = 2
	DiscordInteractionTypeMessageComponent   = 3
)

// Discord response types
const (
	DiscordResponseTypePong                     = 1
	DiscordResponseTypeChannelMessageWithSource = 4
)

// HandleDiscordWebhook returns an http.HandlerFunc for Discord webhooks
func (wh *WebhookHandler) HandleDiscordWebhook() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, `{"error":"Bad request"}`, http.StatusBadRequest)
			return
		}

		var interaction DiscordInteraction
		if err := json.Unmarshal(body, &interaction); err != nil {
			http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
			return
		}

		// Handle PING (verification)
		if interaction.Type == DiscordInteractionTypePing {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]int{"type": DiscordResponseTypePong})
			return
		}

		// Handle Application Commands (slash commands)
		if interaction.Type == DiscordInteractionTypeApplicationCommand && interaction.Data != nil {
			if interaction.Data.Name == "reply" {
				threadID := interaction.ChannelID
				var content string
				for _, opt := range interaction.Data.Options {
					if opt.Name == "message" {
						content = opt.Value
						break
					}
				}

				if threadID != "" && content != "" {
					// Get operator name
					operatorName := "Operator"
					if interaction.Member != nil && interaction.Member.User != nil {
						operatorName = interaction.Member.User.Username
					} else if interaction.User != nil {
						operatorName = interaction.User.Username
					}

					// Call callback (Discord reply support TODO)
					if wh.config.OnOperatorMessage != nil {
						wh.config.OnOperatorMessage(r.Context(), threadID, content, operatorName, "discord", nil, nil)
					}

					// Respond to interaction
					w.Header().Set("Content-Type", "application/json")
					json.NewEncoder(w).Encode(map[string]interface{}{
						"type": DiscordResponseTypeChannelMessageWithSource,
						"data": map[string]string{"content": "✅ Message sent to visitor"},
					})
					return
				}
			}
		}

		// Default response
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{"type": DiscordResponseTypePong})
	}
}

// ─────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────

func writeOK(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

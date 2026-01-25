// Package config handles configuration loading for the bridge server
package config

import (
	"os"
	"strconv"
)

// TelegramConfig holds Telegram bridge configuration
type TelegramConfig struct {
	BotToken string
	ChatID   string
}

// DiscordConfig holds Discord bridge configuration
type DiscordConfig struct {
	// Bot mode
	BotToken  string
	ChannelID string
	// Webhook mode
	WebhookURL string
	// Optional
	Username  string
	AvatarURL string
}

// SlackConfig holds Slack bridge configuration
type SlackConfig struct {
	// Bot mode
	BotToken  string
	ChannelID string
	// Webhook mode
	WebhookURL string
	// Optional
	Username  string
	IconEmoji string
}

// Config holds the complete server configuration
type Config struct {
	Port   int
	APIKey string

	Telegram *TelegramConfig
	Discord  *DiscordConfig
	Slack    *SlackConfig

	BackendWebhookURL   string
	EventsWebhookURL    string
	EventsWebhookSecret string
}

// Load reads configuration from environment variables
func Load() *Config {
	port := 3001
	if p := os.Getenv("PORT"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil {
			port = parsed
		}
	}

	cfg := &Config{
		Port:                port,
		APIKey:              os.Getenv("API_KEY"),
		BackendWebhookURL:   os.Getenv("BACKEND_WEBHOOK_URL"),
		EventsWebhookURL:    os.Getenv("EVENTS_WEBHOOK_URL"),
		EventsWebhookSecret: os.Getenv("EVENTS_WEBHOOK_SECRET"),
	}

	// Telegram config
	if token := os.Getenv("TELEGRAM_BOT_TOKEN"); token != "" {
		cfg.Telegram = &TelegramConfig{
			BotToken: token,
			ChatID:   os.Getenv("TELEGRAM_CHAT_ID"),
		}
	}

	// Discord config
	if token := os.Getenv("DISCORD_BOT_TOKEN"); token != "" {
		cfg.Discord = &DiscordConfig{
			BotToken:  token,
			ChannelID: os.Getenv("DISCORD_CHANNEL_ID"),
			Username:  os.Getenv("DISCORD_USERNAME"),
			AvatarURL: os.Getenv("DISCORD_AVATAR_URL"),
		}
	} else if webhook := os.Getenv("DISCORD_WEBHOOK_URL"); webhook != "" {
		cfg.Discord = &DiscordConfig{
			WebhookURL: webhook,
			Username:   os.Getenv("DISCORD_USERNAME"),
			AvatarURL:  os.Getenv("DISCORD_AVATAR_URL"),
		}
	}

	// Slack config
	if token := os.Getenv("SLACK_BOT_TOKEN"); token != "" {
		cfg.Slack = &SlackConfig{
			BotToken:  token,
			ChannelID: os.Getenv("SLACK_CHANNEL_ID"),
			Username:  os.Getenv("SLACK_USERNAME"),
			IconEmoji: os.Getenv("SLACK_ICON_EMOJI"),
		}
	} else if webhook := os.Getenv("SLACK_WEBHOOK_URL"); webhook != "" {
		cfg.Slack = &SlackConfig{
			WebhookURL: webhook,
			Username:   os.Getenv("SLACK_USERNAME"),
			IconEmoji:  os.Getenv("SLACK_ICON_EMOJI"),
		}
	}

	return cfg
}

// HasBridges returns true if at least one bridge is configured
func (c *Config) HasBridges() bool {
	return c.Telegram != nil || c.Discord != nil || c.Slack != nil
}

// EnabledBridges returns a list of enabled bridge names
func (c *Config) EnabledBridges() []string {
	var bridges []string
	if c.Telegram != nil {
		bridges = append(bridges, "telegram")
	}
	if c.Discord != nil {
		bridges = append(bridges, "discord")
	}
	if c.Slack != nil {
		bridges = append(bridges, "slack")
	}
	return bridges
}

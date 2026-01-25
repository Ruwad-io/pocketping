package config

import (
	"os"
	"testing"
)

func clearEnv() {
	envVars := []string{
		"PORT", "API_KEY", "BACKEND_WEBHOOK_URL", "EVENTS_WEBHOOK_URL", "EVENTS_WEBHOOK_SECRET",
		"TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
		"DISCORD_BOT_TOKEN", "DISCORD_CHANNEL_ID", "DISCORD_WEBHOOK_URL", "DISCORD_ENABLE_GATEWAY", "DISCORD_USERNAME", "DISCORD_AVATAR_URL",
		"SLACK_BOT_TOKEN", "SLACK_CHANNEL_ID", "SLACK_WEBHOOK_URL", "SLACK_USERNAME", "SLACK_ICON_EMOJI",
		"BRIDGE_TEST_BOT_IDS",
	}
	for _, v := range envVars {
		os.Unsetenv(v)
	}
}

func TestLoad_DefaultValues(t *testing.T) {
	clearEnv()
	defer clearEnv()

	cfg := Load()

	if cfg.Port != 3001 {
		t.Errorf("expected default port 3001, got %d", cfg.Port)
	}
	if cfg.APIKey != "" {
		t.Errorf("expected empty API key, got %q", cfg.APIKey)
	}
	if cfg.Telegram != nil {
		t.Error("expected nil Telegram config")
	}
	if cfg.Discord != nil {
		t.Error("expected nil Discord config")
	}
	if cfg.Slack != nil {
		t.Error("expected nil Slack config")
	}
}

func TestLoad_CustomPort(t *testing.T) {
	clearEnv()
	defer clearEnv()

	os.Setenv("PORT", "8080")
	cfg := Load()

	if cfg.Port != 8080 {
		t.Errorf("expected port 8080, got %d", cfg.Port)
	}
}

func TestLoad_InvalidPort(t *testing.T) {
	clearEnv()
	defer clearEnv()

	os.Setenv("PORT", "invalid")
	cfg := Load()

	// Should fall back to default
	if cfg.Port != 3001 {
		t.Errorf("expected default port 3001 for invalid input, got %d", cfg.Port)
	}
}

func TestLoad_APIKey(t *testing.T) {
	clearEnv()
	defer clearEnv()

	os.Setenv("API_KEY", "secret123")
	cfg := Load()

	if cfg.APIKey != "secret123" {
		t.Errorf("expected API key 'secret123', got %q", cfg.APIKey)
	}
}

func TestLoad_WebhookURLs(t *testing.T) {
	clearEnv()
	defer clearEnv()

	os.Setenv("BACKEND_WEBHOOK_URL", "https://backend.example.com/webhook")
	os.Setenv("EVENTS_WEBHOOK_URL", "https://events.example.com/webhook")
	os.Setenv("EVENTS_WEBHOOK_SECRET", "webhook_secret")

	cfg := Load()

	if cfg.BackendWebhookURL != "https://backend.example.com/webhook" {
		t.Errorf("BackendWebhookURL mismatch")
	}
	if cfg.EventsWebhookURL != "https://events.example.com/webhook" {
		t.Errorf("EventsWebhookURL mismatch")
	}
	if cfg.EventsWebhookSecret != "webhook_secret" {
		t.Errorf("EventsWebhookSecret mismatch")
	}
}

func TestLoad_TelegramConfig(t *testing.T) {
	clearEnv()
	defer clearEnv()

	os.Setenv("TELEGRAM_BOT_TOKEN", "123456:ABC")
	os.Setenv("TELEGRAM_CHAT_ID", "-1001234567890")

	cfg := Load()

	if cfg.Telegram == nil {
		t.Fatal("expected Telegram config to be set")
	}
	if cfg.Telegram.BotToken != "123456:ABC" {
		t.Errorf("BotToken mismatch")
	}
	if cfg.Telegram.ChatID != "-1001234567890" {
		t.Errorf("ChatID mismatch")
	}
}

func TestLoad_DiscordBotMode(t *testing.T) {
	clearEnv()
	defer clearEnv()

	os.Setenv("DISCORD_BOT_TOKEN", "bot_token_123")
	os.Setenv("DISCORD_CHANNEL_ID", "channel_456")
	os.Setenv("DISCORD_ENABLE_GATEWAY", "true")
	os.Setenv("DISCORD_USERNAME", "TestBot")
	os.Setenv("DISCORD_AVATAR_URL", "https://example.com/avatar.png")

	cfg := Load()

	if cfg.Discord == nil {
		t.Fatal("expected Discord config to be set")
	}
	if cfg.Discord.BotToken != "bot_token_123" {
		t.Errorf("BotToken mismatch")
	}
	if cfg.Discord.ChannelID != "channel_456" {
		t.Errorf("ChannelID mismatch")
	}
	if !cfg.Discord.EnableGateway {
		t.Errorf("EnableGateway should be true")
	}
	if cfg.Discord.Username != "TestBot" {
		t.Errorf("Username mismatch")
	}
	if cfg.Discord.AvatarURL != "https://example.com/avatar.png" {
		t.Errorf("AvatarURL mismatch")
	}
	if cfg.Discord.WebhookURL != "" {
		t.Errorf("WebhookURL should be empty in bot mode")
	}
}

func TestLoad_DiscordGatewayEnabled_WithOne(t *testing.T) {
	clearEnv()
	defer clearEnv()

	os.Setenv("DISCORD_BOT_TOKEN", "bot_token")
	os.Setenv("DISCORD_CHANNEL_ID", "channel_id")
	os.Setenv("DISCORD_ENABLE_GATEWAY", "1")

	cfg := Load()

	if cfg.Discord == nil {
		t.Fatal("expected Discord config")
	}
	if !cfg.Discord.EnableGateway {
		t.Errorf("EnableGateway should be true when set to '1'")
	}
}

func TestLoad_DiscordWebhookMode(t *testing.T) {
	clearEnv()
	defer clearEnv()

	os.Setenv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc")
	os.Setenv("DISCORD_USERNAME", "WebhookBot")

	cfg := Load()

	if cfg.Discord == nil {
		t.Fatal("expected Discord config to be set")
	}
	if cfg.Discord.WebhookURL != "https://discord.com/api/webhooks/123/abc" {
		t.Errorf("WebhookURL mismatch")
	}
	if cfg.Discord.Username != "WebhookBot" {
		t.Errorf("Username mismatch")
	}
	if cfg.Discord.BotToken != "" {
		t.Errorf("BotToken should be empty in webhook mode")
	}
}

func TestLoad_DiscordBotModeTakesPrecedence(t *testing.T) {
	clearEnv()
	defer clearEnv()

	// Both bot token and webhook URL set - bot mode should take precedence
	os.Setenv("DISCORD_BOT_TOKEN", "bot_token")
	os.Setenv("DISCORD_CHANNEL_ID", "channel_id")
	os.Setenv("DISCORD_WEBHOOK_URL", "https://discord.com/webhook")

	cfg := Load()

	if cfg.Discord == nil {
		t.Fatal("expected Discord config")
	}
	if cfg.Discord.BotToken != "bot_token" {
		t.Errorf("BotToken should be set")
	}
	// Webhook URL should not be set when bot mode is active
	if cfg.Discord.WebhookURL != "" {
		t.Errorf("WebhookURL should be empty when bot mode is active")
	}
}

func TestLoad_SlackBotMode(t *testing.T) {
	clearEnv()
	defer clearEnv()

	os.Setenv("SLACK_BOT_TOKEN", "xoxb-123")
	os.Setenv("SLACK_CHANNEL_ID", "C123456")
	os.Setenv("SLACK_USERNAME", "PocketPing")
	os.Setenv("SLACK_ICON_EMOJI", ":robot:")

	cfg := Load()

	if cfg.Slack == nil {
		t.Fatal("expected Slack config to be set")
	}
	if cfg.Slack.BotToken != "xoxb-123" {
		t.Errorf("BotToken mismatch")
	}
	if cfg.Slack.ChannelID != "C123456" {
		t.Errorf("ChannelID mismatch")
	}
	if cfg.Slack.Username != "PocketPing" {
		t.Errorf("Username mismatch")
	}
	if cfg.Slack.IconEmoji != ":robot:" {
		t.Errorf("IconEmoji mismatch")
	}
}

func TestLoad_SlackWebhookMode(t *testing.T) {
	clearEnv()
	defer clearEnv()

	os.Setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T00/B00/XXX")

	cfg := Load()

	if cfg.Slack == nil {
		t.Fatal("expected Slack config to be set")
	}
	if cfg.Slack.WebhookURL != "https://hooks.slack.com/services/T00/B00/XXX" {
		t.Errorf("WebhookURL mismatch")
	}
}

func TestLoad_TestBotIDs(t *testing.T) {
	clearEnv()
	defer clearEnv()

	os.Setenv("BRIDGE_TEST_BOT_IDS", "bot1, bot2, bot3")

	cfg := Load()

	if len(cfg.TestBotIDs) != 3 {
		t.Fatalf("expected 3 test bot IDs, got %d", len(cfg.TestBotIDs))
	}
	if cfg.TestBotIDs[0] != "bot1" || cfg.TestBotIDs[1] != "bot2" || cfg.TestBotIDs[2] != "bot3" {
		t.Errorf("TestBotIDs mismatch: %v", cfg.TestBotIDs)
	}
}

func TestLoad_TestBotIDs_EmptyValues(t *testing.T) {
	clearEnv()
	defer clearEnv()

	os.Setenv("BRIDGE_TEST_BOT_IDS", "bot1,, ,bot2")

	cfg := Load()

	// Should filter out empty values
	if len(cfg.TestBotIDs) != 2 {
		t.Fatalf("expected 2 test bot IDs (empty filtered), got %d: %v", len(cfg.TestBotIDs), cfg.TestBotIDs)
	}
}

func TestConfig_HasBridges(t *testing.T) {
	tests := []struct {
		name     string
		config   *Config
		expected bool
	}{
		{
			name:     "no bridges",
			config:   &Config{},
			expected: false,
		},
		{
			name: "telegram only",
			config: &Config{
				Telegram: &TelegramConfig{BotToken: "token"},
			},
			expected: true,
		},
		{
			name: "discord only",
			config: &Config{
				Discord: &DiscordConfig{BotToken: "token"},
			},
			expected: true,
		},
		{
			name: "slack only",
			config: &Config{
				Slack: &SlackConfig{BotToken: "token"},
			},
			expected: true,
		},
		{
			name: "all bridges",
			config: &Config{
				Telegram: &TelegramConfig{},
				Discord:  &DiscordConfig{},
				Slack:    &SlackConfig{},
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.config.HasBridges() != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, tt.config.HasBridges())
			}
		})
	}
}

func TestConfig_EnabledBridges(t *testing.T) {
	tests := []struct {
		name     string
		config   *Config
		expected []string
	}{
		{
			name:     "no bridges",
			config:   &Config{},
			expected: nil,
		},
		{
			name: "telegram only",
			config: &Config{
				Telegram: &TelegramConfig{},
			},
			expected: []string{"telegram"},
		},
		{
			name: "all bridges",
			config: &Config{
				Telegram: &TelegramConfig{},
				Discord:  &DiscordConfig{},
				Slack:    &SlackConfig{},
			},
			expected: []string{"telegram", "discord", "slack"},
		},
		{
			name: "discord and slack",
			config: &Config{
				Discord: &DiscordConfig{},
				Slack:   &SlackConfig{},
			},
			expected: []string{"discord", "slack"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.config.EnabledBridges()
			if len(result) != len(tt.expected) {
				t.Errorf("expected %v, got %v", tt.expected, result)
				return
			}
			for i, v := range result {
				if v != tt.expected[i] {
					t.Errorf("expected %v, got %v", tt.expected, result)
					return
				}
			}
		})
	}
}

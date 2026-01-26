package pocketping

import (
	"fmt"
	"strings"
)

// SetupGuides contains helpful setup instructions for each bridge
var SetupGuides = map[string]map[string]string{
	"discord": {
		"bot_token": `To set up Discord Bot mode:

1. Go to https://discord.com/developers/applications
2. Create a new application
3. Go to Bot → Add Bot → Reset Token
4. Copy the token and set DISCORD_BOT_TOKEN

Enable MESSAGE CONTENT INTENT in Bot settings!`,
		"channel_id": `To get your Discord Channel ID:

1. Enable Developer Mode in Discord:
   User Settings → Advanced → Developer Mode
2. Right-click on your channel → Copy ID
3. Set DISCORD_CHANNEL_ID in your environment

Tip: Use a Forum channel for organized threads!`,
		"webhook_url": `To get a Discord Webhook URL:

1. Go to your channel settings
2. Integrations → Webhooks → New Webhook
3. Copy the Webhook URL

Note: Webhooks are send-only. Use Bot mode for full features.`,
	},
	"slack": {
		"bot_token": `To set up Slack Bot mode:

1. Go to https://api.slack.com/apps
2. Create New App → From scratch
3. OAuth & Permissions → Add Bot Token Scopes:
   - chat:write, channels:read, channels:join
   - channels:history, groups:history, users:read
4. Install to Workspace → Copy Bot Token (xoxb-...)`,
		"channel_id": `To get your Slack Channel ID:

1. Right-click on your channel in Slack
2. View channel details
3. Scroll down to find Channel ID (starts with C or G)

For private channels: /invite @YourBotName first`,
		"webhook_url": `To get a Slack Webhook URL:

1. Go to https://api.slack.com/apps
2. Incoming Webhooks → Add New Webhook
3. Select a channel → Copy Webhook URL

Note: Webhooks are send-only. Use Bot mode for full features.`,
	},
	"telegram": {
		"bot_token": `To create a Telegram Bot:

1. Open @BotFather in Telegram
2. Send /newbot
3. Choose a name and username
4. Copy the Bot Token you receive

Set TELEGRAM_BOT_TOKEN in your environment`,
		"chat_id": `To get your Telegram Chat ID:

1. Create a group and enable Topics (for forums)
2. Add your bot to the group as admin
3. Add @getidsbot to the group
4. Copy the Chat ID (starts with -100)

The bot needs "Manage Topics" permission!`,
	},
}

// SetupError is returned when bridge configuration is missing or invalid.
// It includes helpful setup instructions.
type SetupError struct {
	Bridge  string
	Missing string
	Guide   string
	DocsURL string
}

// NewSetupError creates a new SetupError with the given parameters.
func NewSetupError(bridge, missing string) *SetupError {
	guide := ""
	if bridgeGuides, ok := SetupGuides[strings.ToLower(bridge)]; ok {
		if g, ok := bridgeGuides[missing]; ok {
			guide = g
		}
	}

	return &SetupError{
		Bridge:  bridge,
		Missing: missing,
		Guide:   guide,
		DocsURL: fmt.Sprintf("https://pocketping.io/docs/%s", strings.ToLower(bridge)),
	}
}

// NewSetupErrorWithGuide creates a new SetupError with a custom guide.
func NewSetupErrorWithGuide(bridge, missing, guide string) *SetupError {
	return &SetupError{
		Bridge:  bridge,
		Missing: missing,
		Guide:   guide,
		DocsURL: fmt.Sprintf("https://pocketping.io/docs/%s", strings.ToLower(bridge)),
	}
}

// Error implements the error interface.
func (e *SetupError) Error() string {
	return fmt.Sprintf("[PocketPing] %s configuration error: %s is required", e.Bridge, e.Missing)
}

// FormattedGuide returns a formatted guide string for display.
func (e *SetupError) FormattedGuide() string {
	guideLines := strings.Split(e.Guide, "\n")
	formattedGuide := ""
	for _, line := range guideLines {
		formattedGuide += fmt.Sprintf("│  %s\n", line)
	}

	return fmt.Sprintf(`
┌─────────────────────────────────────────────────────────────┐
│  ⚠️  %s Setup Required
├─────────────────────────────────────────────────────────────┤
│
│  Missing: %s
│
%s│
│  📖 Full guide: %s
│
│  💡 Quick fix: npx @pocketping/cli init %s
│
└─────────────────────────────────────────────────────────────┘
`, e.Bridge, e.Missing, formattedGuide, e.DocsURL, strings.ToLower(e.Bridge))
}

// ValidateTelegramConfig validates Telegram configuration.
func ValidateTelegramConfig(botToken, chatID string) error {
	if botToken == "" {
		return NewSetupError("Telegram", "bot_token")
	}
	if chatID == "" {
		return NewSetupError("Telegram", "chat_id")
	}
	return nil
}

// ValidateDiscordBotConfig validates Discord Bot configuration.
func ValidateDiscordBotConfig(botToken, channelID string) error {
	if botToken == "" {
		return NewSetupError("Discord", "bot_token")
	}
	if channelID == "" {
		return NewSetupError("Discord", "channel_id")
	}
	return nil
}

// ValidateDiscordWebhookConfig validates Discord Webhook configuration.
func ValidateDiscordWebhookConfig(webhookURL string) error {
	if webhookURL == "" {
		return NewSetupError("Discord", "webhook_url")
	}
	if !strings.HasPrefix(webhookURL, "https://discord.com/api/webhooks/") {
		return NewSetupErrorWithGuide(
			"Discord",
			"valid webhook_url",
			"Webhook URL must start with https://discord.com/api/webhooks/\n\n"+SetupGuides["discord"]["webhook_url"],
		)
	}
	return nil
}

// ValidateSlackBotConfig validates Slack Bot configuration.
func ValidateSlackBotConfig(botToken, channelID string) error {
	if botToken == "" {
		return NewSetupError("Slack", "bot_token")
	}
	if !strings.HasPrefix(botToken, "xoxb-") {
		return NewSetupErrorWithGuide(
			"Slack",
			"valid bot_token",
			"Bot token must start with xoxb-\n\n"+SetupGuides["slack"]["bot_token"],
		)
	}
	if channelID == "" {
		return NewSetupError("Slack", "channel_id")
	}
	return nil
}

// ValidateSlackWebhookConfig validates Slack Webhook configuration.
func ValidateSlackWebhookConfig(webhookURL string) error {
	if webhookURL == "" {
		return NewSetupError("Slack", "webhook_url")
	}
	if !strings.HasPrefix(webhookURL, "https://hooks.slack.com/") {
		return NewSetupErrorWithGuide(
			"Slack",
			"valid webhook_url",
			"Webhook URL must start with https://hooks.slack.com/\n\n"+SetupGuides["slack"]["webhook_url"],
		)
	}
	return nil
}

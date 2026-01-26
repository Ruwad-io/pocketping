# frozen_string_literal: true

module PocketPing
  # Error raised when bridge configuration is missing or invalid.
  # Includes helpful setup instructions.
  class SetupError < StandardError
    attr_reader :bridge, :missing, :guide, :docs_url

    SETUP_GUIDES = {
      discord: {
        bot_token: <<~GUIDE,
          To set up Discord Bot mode:

          1. Go to https://discord.com/developers/applications
          2. Create a new application
          3. Go to Bot → Add Bot → Reset Token
          4. Copy the token and set DISCORD_BOT_TOKEN

          Enable MESSAGE CONTENT INTENT in Bot settings!
        GUIDE
        channel_id: <<~GUIDE,
          To get your Discord Channel ID:

          1. Enable Developer Mode in Discord:
             User Settings → Advanced → Developer Mode
          2. Right-click on your channel → Copy ID
          3. Set DISCORD_CHANNEL_ID in your environment

          Tip: Use a Forum channel for organized threads!
        GUIDE
        webhook_url: <<~GUIDE
          To get a Discord Webhook URL:

          1. Go to your channel settings
          2. Integrations → Webhooks → New Webhook
          3. Copy the Webhook URL

          Note: Webhooks are send-only. Use Bot mode for full features.
        GUIDE
      },
      slack: {
        bot_token: <<~GUIDE,
          To set up Slack Bot mode:

          1. Go to https://api.slack.com/apps
          2. Create New App → From scratch
          3. OAuth & Permissions → Add Bot Token Scopes:
             - chat:write, channels:read, channels:join
             - channels:history, groups:history, users:read
          4. Install to Workspace → Copy Bot Token (xoxb-...)
        GUIDE
        channel_id: <<~GUIDE,
          To get your Slack Channel ID:

          1. Right-click on your channel in Slack
          2. View channel details
          3. Scroll down to find Channel ID (starts with C or G)

          For private channels: /invite @YourBotName first
        GUIDE
        webhook_url: <<~GUIDE
          To get a Slack Webhook URL:

          1. Go to https://api.slack.com/apps
          2. Incoming Webhooks → Add New Webhook
          3. Select a channel → Copy Webhook URL

          Note: Webhooks are send-only. Use Bot mode for full features.
        GUIDE
      },
      telegram: {
        bot_token: <<~GUIDE,
          To create a Telegram Bot:

          1. Open @BotFather in Telegram
          2. Send /newbot
          3. Choose a name and username
          4. Copy the Bot Token you receive

          Set TELEGRAM_BOT_TOKEN in your environment
        GUIDE
        chat_id: <<~GUIDE
          To get your Telegram Chat ID:

          1. Create a group and enable Topics (for forums)
          2. Add your bot to the group as admin
          3. Add @getidsbot to the group
          4. Copy the Chat ID (starts with -100)

          The bot needs "Manage Topics" permission!
        GUIDE
      }
    }.freeze

    def initialize(bridge:, missing:, guide: nil, docs_url: nil)
      @bridge = bridge
      @missing = missing
      @guide = guide || SETUP_GUIDES.dig(bridge.downcase.to_sym, missing.to_sym) || ""
      @docs_url = docs_url || "https://pocketping.io/docs/#{bridge.downcase}"

      super("[PocketPing] #{bridge} configuration error: #{missing} is required")

      # Print helpful guide to stderr
      warn formatted_guide
    end

    def formatted_guide
      <<~OUTPUT

        ┌─────────────────────────────────────────────────────────────┐
        │  ⚠️  #{bridge} Setup Required
        ├─────────────────────────────────────────────────────────────┤
        │
        │  Missing: #{missing}
        │
        #{guide.lines.map { |l| "│  #{l}" }.join}
        │
        │  📖 Full guide: #{docs_url}
        │
        │  💡 Quick fix: npx @pocketping/cli init #{bridge.downcase}
        │
        └─────────────────────────────────────────────────────────────┘

      OUTPUT
    end
  end
end

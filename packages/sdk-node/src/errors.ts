/**
 * PocketPing Setup Error
 *
 * Thrown when bridge configuration is missing or invalid.
 * Includes helpful setup instructions.
 */
export class PocketPingSetupError extends Error {
  readonly bridge: string;
  readonly missing: string;
  readonly guide: string;
  readonly docsUrl: string;

  constructor(options: {
    bridge: string;
    missing: string;
    guide: string;
    docsUrl?: string;
  }) {
    const message = `[PocketPing] ${options.bridge} configuration error: ${options.missing} is required`;
    super(message);

    this.name = 'PocketPingSetupError';
    this.bridge = options.bridge;
    this.missing = options.missing;
    this.guide = options.guide;
    this.docsUrl = options.docsUrl || `https://pocketping.io/docs/${options.bridge.toLowerCase()}`;

    // Print helpful guide to console
    console.error(this.getFormattedGuide());
  }

  getFormattedGuide(): string {
    return `
┌─────────────────────────────────────────────────────────────┐
│  ⚠️  ${this.bridge} Setup Required
├─────────────────────────────────────────────────────────────┤
│
│  Missing: ${this.missing}
│
${this.guide.split('\n').map(line => `│  ${line}`).join('\n')}
│
│  📖 Full guide: ${this.docsUrl}
│
│  💡 Quick fix: npx @pocketping/cli init ${this.bridge.toLowerCase()}
│
└─────────────────────────────────────────────────────────────┘
`;
  }
}

/**
 * Setup guides for each bridge
 */
export const SETUP_GUIDES = {
  discord: {
    botToken: `
To set up Discord Bot mode:

1. Go to https://discord.com/developers/applications
2. Create a new application
3. Go to Bot → Add Bot → Reset Token
4. Copy the token and set DISCORD_BOT_TOKEN

Enable MESSAGE CONTENT INTENT in Bot settings!
`,
    channelId: `
To get your Discord Channel ID:

1. Enable Developer Mode in Discord:
   User Settings → Advanced → Developer Mode
2. Right-click on your channel → Copy ID
3. Set DISCORD_CHANNEL_ID in your .env

Tip: Use a Forum channel for organized threads!
`,
    webhookUrl: `
To get a Discord Webhook URL:

1. Go to your channel settings
2. Integrations → Webhooks → New Webhook
3. Copy the Webhook URL

Note: Webhooks are send-only. Use Bot mode for full features.
`,
  },

  slack: {
    botToken: `
To set up Slack Bot mode:

1. Go to https://api.slack.com/apps
2. Create New App → From scratch
3. OAuth & Permissions → Add Bot Token Scopes:
   - chat:write, channels:read, channels:join
   - channels:history, groups:history, users:read
4. Install to Workspace → Copy Bot Token (xoxb-...)
`,
    channelId: `
To get your Slack Channel ID:

1. Right-click on your channel in Slack
2. View channel details
3. Scroll down to find Channel ID (starts with C or G)

For private channels: /invite @YourBotName first
`,
    webhookUrl: `
To get a Slack Webhook URL:

1. Go to https://api.slack.com/apps
2. Incoming Webhooks → Add New Webhook
3. Select a channel → Copy Webhook URL

Note: Webhooks are send-only. Use Bot mode for full features.
`,
  },

  telegram: {
    botToken: `
To create a Telegram Bot:

1. Open @BotFather in Telegram
2. Send /newbot
3. Choose a name and username
4. Copy the Bot Token you receive

Set TELEGRAM_BOT_TOKEN in your .env
`,
    chatId: `
To get your Telegram Chat ID:

1. Create a group and enable Topics (for forums)
2. Add your bot to the group as admin
3. Add @getidsbot to the group
4. Copy the Chat ID (starts with -100)

The bot needs "Manage Topics" permission!
`,
  },
};

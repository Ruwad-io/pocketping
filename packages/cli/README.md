# @pocketping/cli

Interactive CLI for setting up PocketPing bridges.

## Installation

```bash
# Using npx (no installation required)
npx @pocketping/cli init

# Or install globally
npm install -g @pocketping/cli
pocketping init
```

## Commands

### `init` - Setup Wizard

Interactively configure one or more bridges (Telegram, Discord, Slack).

```bash
# Interactive mode - choose bridges
npx @pocketping/cli init

# Set up a specific bridge
npx @pocketping/cli init telegram
npx @pocketping/cli init discord
npx @pocketping/cli init slack
```

**What it does:**
- Prompts for bridge credentials (tokens, channel IDs)
- Validates input format
- Saves credentials to `.env` file
- Generates a config example file

### `doctor` - Configuration Check

Validates your configuration and tests connectivity.

```bash
npx @pocketping/cli doctor
```

**What it checks:**
- Bot token validity
- Channel/chat access
- Required permissions (forum/threads enabled)

## Example

```
┌  PocketPing Setup Wizard
│
◆  Which bridges do you want to set up?
│  ◼ Telegram
│
◆  Enter your Telegram Bot Token
│  123456789:ABCdefGHIjklMNOpqrsTUVwxyz
│
◆  Enter your Telegram Chat ID
│  -1001234567890
│
◇  Telegram configured!
◇  Configuration saved!
│
└  Setup complete!

   Next steps:
     1. Review your .env file
     2. Run npx @pocketping/cli doctor to verify
```

## Environment Variables

The CLI manages these variables in `.env`:

```bash
# Discord
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CHANNEL_ID=123456789012345678

# Slack
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_CHANNEL_ID=C0123456789

# Telegram
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=-1001234567890
```

## Documentation

See [full CLI documentation](https://pocketping.io/docs/cli) for more details.

## License

MIT

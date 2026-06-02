# @pocketping/cli

[![npm](https://img.shields.io/npm/v/@pocketping/cli.svg)](https://www.npmjs.com/package/@pocketping/cli)
[![license](https://img.shields.io/npm/l/@pocketping/cli.svg)](https://github.com/Ruwad-io/pocketping/blob/main/LICENSE)

Interactive setup wizard and health-check for [PocketPing](https://pocketping.io) — the
open-source, phone-first chat widget you answer from Telegram, Discord or Slack.

`init` walks you through creating each bot and **validates every token against the live
Telegram / Discord / Slack API** before writing your `.env`. `doctor` re-checks that
everything is still reachable.

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

All three bridges are checked **concurrently**, and the result is exit-code aware
(`doctor` exits non-zero when any bridge is misconfigured — handy in CI):

```
┌─ Telegram ─────────────────────────────┐
│ ✓ Bot Token: Valid — @mysupport_bot    │
│ ✓ Chat: Support HQ (Forum)             │
└────────────────────────────────────────┘

┌─ Discord ──────────────────────────────┐
│ ○ Configuration: Not configured        │
└────────────────────────────────────────┘
```

**What it checks:**
- Bot token validity (live API call)
- Channel/chat access
- Required permissions (forum/topics/threads enabled)

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

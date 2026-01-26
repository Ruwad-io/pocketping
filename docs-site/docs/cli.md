---
sidebar_position: 3
title: CLI
description: Set up PocketPing bridges interactively with the CLI
---

# CLI

The PocketPing CLI provides an interactive setup wizard for configuring bridges and validating your configuration.

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

The `init` command guides you through setting up one or more bridges interactively.

```bash
# Interactive mode - choose bridges to configure
npx @pocketping/cli init

# Set up a specific bridge directly
npx @pocketping/cli init telegram
npx @pocketping/cli init discord
npx @pocketping/cli init slack
```

**What it does:**

1. Prompts for bridge credentials (tokens, channel IDs)
2. Validates your input format
3. Saves credentials to `.env` file
4. Generates a config example file

**Example session:**

```
┌  PocketPing Setup Wizard
│
◆  Which bridges do you want to set up?
│  ◻ Discord (Forum threads for team conversations)
│  ◼ Slack (Channel threads for enterprise teams)
│  ◼ Telegram (Forum topics for organized chats)
│
◇  Setting up Telegram...
│
◆  Enter your Telegram Bot Token
│  123456789:ABCdefGHIjklMNOpqrsTUVwxyz
│
◆  Enter your Telegram Chat ID
│  -1001234567890
│
◇  Telegram configured!
│
◇  Configuration saved!
│
├  Added to .env
│  TELEGRAM_BOT_TOKEN=****
│  TELEGRAM_CHAT_ID=-1001234567890
│
└  Setup complete!

   Next steps:
     1. Review your .env file
     2. Check pocketping.config.example.ts for usage
     3. Run npx @pocketping/cli doctor to verify
```

### `doctor` - Configuration Check

The `doctor` command validates your configuration and tests connectivity to each bridge.

```bash
npx @pocketping/cli doctor
```

**What it checks:**

- **Discord**: Bot token validity, channel access, forum permissions
- **Slack**: Bot token validity, channel access, thread permissions
- **Telegram**: Bot token validity, chat access, forum topics enabled

**Example output:**

```
┌  PocketPing Doctor
│
ℹ  Checking your PocketPing configuration...

┌─ Discord ─────────────────────────────────────────┐
  ✓ Bot Token: Valid - PocketPing Bot
  ✓ Channel: #support (Forum)
└──────────────────────────────────────────────────┘

┌─ Slack ─────────────────────────────────────────┐
  ✓ Bot Token: Valid - Acme Workspace
  ✓ Channel: #customer-support
└──────────────────────────────────────────────────┘

┌─ Telegram ─────────────────────────────────────────┐
  ✓ Bot Token: Valid - @acme_support_bot
  ✓ Chat: Support Chat (Forum)
└──────────────────────────────────────────────────┘

└  3/3 bridges configured and healthy!
```

**Status indicators:**

| Icon | Status | Meaning |
|------|--------|---------|
| ✓ | OK | Configuration valid and working |
| ⚠ | Warning | Missing optional configuration |
| ✗ | Error | Invalid or broken configuration |
| ○ | Skip | Bridge not configured |

## Environment Variables

The CLI manages these environment variables in your `.env` file:

### Discord

```bash
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CHANNEL_ID=123456789012345678
```

### Slack

```bash
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_CHANNEL_ID=C0123456789
```

### Telegram

```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=-1001234567890
```

## Workflow

A typical setup workflow:

```bash
# 1. Run the setup wizard
npx @pocketping/cli init

# 2. Verify configuration
npx @pocketping/cli doctor

# 3. If doctor shows errors, re-run init for that bridge
npx @pocketping/cli init telegram
```

## Tips

### Re-running init

Running `init` again will **add or update** environment variables without removing existing ones. This is safe to run multiple times.

### Multiple environments

For different environments (dev, staging, prod), use separate `.env` files:

```bash
# Development
npx @pocketping/cli init
mv .env .env.development

# Production
npx @pocketping/cli init
mv .env .env.production
```

### CI/CD

In CI/CD pipelines, set environment variables directly instead of using `.env` files:

```yaml
# GitHub Actions example
env:
  TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
  TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
```

## Next Steps

- [Telegram Bridge Setup](/bridges/telegram) - Detailed Telegram configuration
- [Discord Bridge Setup](/bridges/discord) - Detailed Discord configuration
- [Slack Bridge Setup](/bridges/slack) - Detailed Slack configuration
- [SDK Documentation](/sdk) - Use bridges in your backend

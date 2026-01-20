---
sidebar_position: 1
title: Telegram
description: Configure Telegram notifications with PocketPing using Forum Topics
---

# Telegram Setup

Receive customer messages as Telegram notifications using Forum Topics for organized conversations.

:::info Why Forum Topics?
Each customer conversation becomes a separate topic in your Telegram group, making it easy to manage multiple conversations without clutter.
:::

## Step 1: Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow the prompts
3. Choose a name (e.g., "Acme Support Bot")
4. Choose a username (must end in "bot", e.g., "acme_support_bot")
5. **Save the bot token** - it looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

## Step 2: Create a Supergroup with Topics

1. Create a new group in Telegram
2. Go to Group Settings → Edit → Group Type
3. Enable **"Topics"** (this converts it to a supergroup with forum topics)
4. Add your team members to this group

## Step 3: Add Bot to Group

1. In your group, go to Settings → Administrators
2. Click "Add Administrator" and search for your bot
3. Grant these permissions:
   - ✅ Manage Topics
   - ✅ Post Messages
   - ✅ Edit Messages
   - ✅ Delete Messages

## Step 4: Get Chat ID

You need the chat ID of your supergroup. Here's how to get it:

### Option A: Use @userinfobot

1. Forward any message from your group to @userinfobot
2. It will reply with the chat ID (starts with -100)

### Option B: Use the API

```bash
# Send a message in your group, then run:
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates"

# Look for "chat":{"id":-100xxxxxxxxxx}
```

## Step 5: Configure PocketPing

### SaaS Users

Go to your [Bridge Settings](https://app.pocketping.io/settings/bridges) and enter your Bot Token and Chat ID.

### Self-Hosted Users

Add to your `.env` file:

```bash title=".env"
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_FORUM_CHAT_ID=-1001234567890
```

## How It Works

Each website visitor gets their own topic thread in your Telegram group. Messages sync in real-time between the widget and Telegram.

## Bot Commands

Inside a conversation topic, you can use these commands:

| Command | Description |
|---------|-------------|
| `/info` | Show session details (IP, browser, page) |
| `/close` | Close the conversation |
| `/ai on` | Enable AI for this conversation |
| `/ai off` | Disable AI for this conversation |

## Troubleshooting

### Bot not responding?

- Check the bot token is correct
- Verify the bot is admin in the group
- Make sure the chat ID starts with -100
- Check bridge server logs: `docker logs pocketping-bridge`

### Topics not being created?

- Ensure the group has Topics enabled
- Verify bot has "Manage Topics" permission
- The group must be a supergroup (chat ID starts with -100)

## Next Steps

- [Add Discord](/bridges/discord) - Connect Discord as another bridge
- [Setup AI Fallback](/ai-fallback) - Auto-respond when you're away

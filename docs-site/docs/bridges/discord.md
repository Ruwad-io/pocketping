---
sidebar_position: 2
title: Discord
description: Configure Discord notifications with PocketPing using threads
---

# Discord Setup

Receive customer messages as Discord notifications using threads for organized conversations.

## Step 1: Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to "Bot" in the sidebar
4. Click "Add Bot"
5. Under "Privileged Gateway Intents", enable:
   - ✅ **MESSAGE CONTENT INTENT** (required to read messages)
6. Click "Reset Token" and **save your bot token**

## Step 2: Invite Bot to Server

1. Go to "OAuth2" → "URL Generator"
2. Select scopes:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Select bot permissions:
   - ✅ Send Messages
   - ✅ Create Public Threads
   - ✅ Send Messages in Threads
   - ✅ Manage Threads
   - ✅ Read Message History
4. Copy the generated URL and open it to invite the bot

## Step 3: Get Channel ID

1. Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
2. Right-click on the channel where you want notifications
3. Click "Copy Channel ID"

## Step 4: Configure PocketPing

### SaaS Users

Go to your [Bridge Settings](https://app.pocketping.io/settings/bridges) and enter your Bot Token and Channel ID.

### Self-Hosted Users

Add to your `.env` file:

```bash title=".env"
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=123456789012345678
```

## How It Works

1. New visitor starts a chat on your website
2. A new thread is created in your Discord channel
3. Messages sync in real-time between widget and thread
4. Your replies in the thread appear in the widget

## Bot Commands

Use these slash commands in a conversation thread:

| Command | Description |
|---------|-------------|
| `/info` | Show session details |
| `/close` | Close the conversation |
| `/ai on` | Enable AI for this conversation |
| `/ai off` | Disable AI for this conversation |

## Troubleshooting

### Bot not responding?

- Check the bot token is correct
- Verify MESSAGE CONTENT INTENT is enabled
- Make sure bot has permissions in the channel
- Check bridge server logs: `docker logs pocketping-bridge`

### Threads not being created?

- Verify bot has "Create Public Threads" permission
- Check the channel ID is correct
- Ensure the bot can see the channel

## Next Steps

- [Add Slack](/bridges/slack) - Connect Slack as another bridge
- [Setup AI Fallback](/ai-fallback) - Auto-respond when you're away

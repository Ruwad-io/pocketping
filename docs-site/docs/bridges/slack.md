---
sidebar_position: 3
title: Slack
description: Configure Slack notifications with PocketPing
---

# Slack Setup

Receive customer messages as Slack notifications using threads for organized conversations.

## Step 1: Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App"
3. Choose "From scratch"
4. Name your app (e.g., "PocketPing") and select your workspace

## Step 2: Configure Bot

1. Go to "OAuth & Permissions"
2. Under "Bot Token Scopes", add:
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `users:read`
3. Click "Install to Workspace"
4. **Save the Bot User OAuth Token** (starts with `xoxb-`)

## Step 3: Enable Socket Mode

1. Go to "Socket Mode" in the sidebar
2. Enable Socket Mode
3. Create an App-Level Token with `connections:write` scope
4. **Save the App-Level Token** (starts with `xapp-`)

## Step 4: Enable Events

1. Go to "Event Subscriptions"
2. Enable Events
3. Subscribe to bot events:
   - `message.channels`
   - `message.groups`

## Step 5: Get Channel ID

1. Open Slack and go to the channel where you want notifications
2. Click the channel name at the top
3. Scroll down to find the Channel ID (starts with C)

## Step 6: Configure PocketPing

### SaaS Users

Go to your [Bridge Settings](https://app.pocketping.io/settings/bridges) and enter your tokens and Channel ID.

### Self-Hosted Users

Add to your `.env` file:

```bash title=".env"
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_CHANNEL_ID=C0123456789
```

## How It Works

1. New visitor starts a chat on your website
2. A message is posted in your Slack channel
3. Replies to that thread sync back to the widget
4. Each visitor conversation is a separate thread

## Bot Commands

Mention the bot in a thread with these commands:

| Command | Description |
|---------|-------------|
| `@PocketPing info` | Show session details |
| `@PocketPing close` | Close the conversation |
| `@PocketPing ai on` | Enable AI for this conversation |
| `@PocketPing ai off` | Disable AI for this conversation |

## Troubleshooting

### Bot not responding?

- Check the bot token is correct
- Verify Socket Mode is enabled
- Make sure bot is added to the channel (`/invite @PocketPing`)
- Check bridge server logs: `docker logs pocketping-bridge`

### Not receiving messages?

- Verify event subscriptions are enabled
- Check the channel ID is correct
- Ensure bot has required scopes

## Next Steps

- [Add Telegram](/bridges/telegram) - Connect Telegram as another bridge
- [Setup AI Fallback](/ai-fallback) - Auto-respond when you're away

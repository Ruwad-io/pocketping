---
sidebar_position: 2
title: Quick Start
description: Get PocketPing running in under 5 minutes
---

# Quick Start

Get PocketPing running on your website in under 5 minutes using our hosted solution.

:::tip SaaS Version
Sign up at [app.pocketping.io](https://app.pocketping.io) to get your project ID and skip the backend setup.
:::

## Step 1: Add the Widget

Add the PocketPing widget to your website using the CDN:

```html title="index.html"
<!-- Add before closing </body> tag -->
<script src="https://cdn.pocketping.io/widget.js"></script>
<script>
  PocketPing.init({
    // For SaaS users:
    projectId: 'your-project-id',

    // For self-hosted:
    // endpoint: 'https://yoursite.com/pocketping',

    // Customize appearance
    operatorName: 'Support Team',
    operatorAvatar: 'https://yoursite.com/avatar.png',
    primaryColor: '#6366f1',
    welcomeMessage: 'Hi! How can we help you today?',
  });
</script>
```

Or install via npm for more control:

```bash
npm install @pocketping/widget
```

```typescript title="app.tsx"
import { PocketPing } from '@pocketping/widget';

PocketPing.init({
  projectId: 'your-project-id',
  operatorName: 'Support Team',
  primaryColor: '#6366f1',
});
```

## Step 2: Configure Notifications

Set up where you want to receive notifications. Go to your [project settings](https://app.pocketping.io/settings) and connect one or more bridges:

### Telegram
1. Create bot with @BotFather
2. Create supergroup with Topics
3. Add bot as admin
4. Paste token & chat ID

### Discord
1. Create bot at Dev Portal
2. Enable MESSAGE CONTENT
3. Add to server
4. Paste token & channel ID

### Slack
1. Create app at Slack API
2. Enable Socket Mode
3. Add bot scopes
4. Paste tokens

## Step 3: Test It

Visit your website and click the chat widget. Send a test message and you should see it appear in your connected platforms within seconds.

Reply from Telegram, Discord, or Slack and watch the response appear in the widget in real-time!

## Next Steps

- [Widget Configuration](/widget/configuration) - Customize colors, position, and behavior
- [AI Fallback](/ai-fallback) - Set up automatic responses when you're away
- [Self-Hosting](/self-hosting) - Deploy on your own infrastructure

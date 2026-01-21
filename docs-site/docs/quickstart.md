---
sidebar_position: 2
title: Quick Start
description: Get PocketPing running in under 5 minutes
---

# Quick Start

Get PocketPing running on your website in **under 5 minutes**.

```
┌─────────────────────────────────────────────────────────────────┐
│                        What you'll do:                          │
│                                                                 │
│  1. Add widget to your site  ───►  2 minutes                    │
│  2. Connect Telegram         ───►  3 minutes                    │
│  3. Test it!                 ───►  30 seconds                   │
│                                                                 │
│  Total: ~5 minutes                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- A website where you can add JavaScript
- A Telegram account (we'll use Telegram for this tutorial)

:::tip Using SaaS?
Sign up at [app.pocketping.io](https://app.pocketping.io) to get your project ID. The dashboard handles bridge configuration for you.
:::

---

## Step 1: Add the Widget

### Option A: CDN (Easiest)

Add these two lines before the closing `</body>` tag:

```html title="index.html"
<script src="https://cdn.jsdelivr.net/npm/@pocketping/widget@latest/dist/index.global.js"></script>
<script>
  PocketPing.init({
    projectId: 'proj_xxxxxxxxxxxxx', // Get this from dashboard
    operatorName: 'Support',
  });
</script>
```

### Option B: npm (For React/Vue/etc.)

```bash
npm install @pocketping/widget
```

```jsx title="App.jsx"
import { useEffect } from 'react';

export default function App() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@pocketping/widget@latest/dist/index.global.js';
    script.onload = () => {
      window.PocketPing.init({
        projectId: 'proj_xxxxxxxxxxxxx',
        operatorName: 'Support',
      });
    };
    document.body.appendChild(script);
  }, []);

  return <div>Your app content</div>;
}
```

### Verify it works

Refresh your page. You should see a chat bubble in the bottom-right corner:

```
┌─────────────────────────────────┐
│                                 │
│         Your website            │
│                                 │
│                                 │
│                                 │
│                       ┌───────┐ │
│                       │  💬  │ │
│                       └───────┘ │
└─────────────────────────────────┘
         Chat bubble appears here ↗
```

Click it to open the chat interface.

:::info Not seeing the widget?
- Check browser console for errors (F12 → Console)
- Make sure the script is loading (Network tab)
- Verify your `projectId` is correct
:::

---

## Step 2: Connect Telegram

Now let's set up Telegram so you receive notifications on your phone.

### 2.1 Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a name (e.g., "Acme Support Bot")
4. Choose a username (must end in `bot`, e.g., "acme_support_bot")
5. **Copy the API token** (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

```
┌─────────────────────────────────────────┐
│ BotFather                               │
├─────────────────────────────────────────┤
│                                         │
│ Done! Your bot is created.              │
│                                         │
│ Token: 123456789:ABCdefGHIjklMNOpqrs... │
│         ↑                               │
│     Copy this!                          │
│                                         │
└─────────────────────────────────────────┘
```

### 2.2 Create a Supergroup with Topics

1. Create a new Telegram group
2. Make it a **supergroup** (Settings → Group Type → Public or Private)
3. Enable **Topics** (Settings → Topics → Enable)
4. Add your bot as an **admin** (Settings → Administrators → Add → Your bot)

```
Why Topics?
─────────────────────────────────────────────────────
Each visitor conversation becomes a separate topic,
keeping your chat organized:

┌─────────────────────────────────────────┐
│ Support Chat (Supergroup)               │
├─────────────────────────────────────────┤
│  📁 General                             │
│  📁 John from New York                  │ ← Visitor 1
│  📁 Sarah from Paris                    │ ← Visitor 2
│  📁 Mike from Tokyo                     │ ← Visitor 3
└─────────────────────────────────────────┘
```

### 2.3 Get the Chat ID

You need the group's Chat ID. There are two ways:

**Method A: Use @userinfobot**
1. Add @userinfobot to your group
2. It will reply with the chat ID (a negative number like `-1001234567890`)
3. Remove the bot after

**Method B: Use the API**
```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"
```
Look for `"chat":{"id":-1001234567890,...}`

### 2.4 Configure in Dashboard

Go to [app.pocketping.io/settings](https://app.pocketping.io/settings) and add:

| Field | Value |
|-------|-------|
| Bot Token | `123456789:ABCdefGHIjklMNOpqrs...` |
| Chat ID | `-1001234567890` |

Click **Save**.

---

## Step 3: Test It!

### Send a test message

1. Go to your website
2. Click the chat widget
3. Type "Hello, this is a test!" and send

### Check Telegram

Within seconds, you should see:

```
┌─────────────────────────────────────────┐
│ Support Chat                            │
├─────────────────────────────────────────┤
│                                         │
│  📁 New Visitor                         │
│  └── "Hello, this is a test!"           │
│                                         │
└─────────────────────────────────────────┘
```

### Reply from Telegram

Type a reply in the topic. The visitor will see it instantly in the widget!

```
Website Widget                    Your Phone
─────────────────                 ─────────────────
┌───────────────┐                ┌───────────────┐
│ You: Hello!   │   ◄──────────  │ Bot: Hello!   │
│               │                │               │
│ Support: Hi!  │   ──────────►  │ You: Hi!      │
└───────────────┘                └───────────────┘
     Real-time sync in both directions
```

---

## Troubleshooting

### Widget not appearing

| Problem | Solution |
|---------|----------|
| Script not loading | Check network tab for 404 errors |
| Console error | Check that `projectId` is correct |
| Z-index issue | Widget might be behind other elements |

### Not receiving messages in Telegram

| Problem | Solution |
|---------|----------|
| Bot not admin | Add bot as administrator in group settings |
| Wrong chat ID | Make sure it's negative (e.g., `-1001234...`) |
| Topics not enabled | Enable Topics in group settings |

### Messages not syncing

| Problem | Solution |
|---------|----------|
| Bot can't read messages | Enable Topics or add bot as admin |
| Wrong token | Regenerate token with @BotFather |

---

## What's Next?

You're up and running! Here's what to explore next:

### Customize the widget
```javascript
PocketPing.init({
  projectId: 'proj_xxx',
  operatorName: 'Sarah from Support',
  primaryColor: '#10b981', // Green theme
  welcomeMessage: 'Hi! How can I help?',
  position: 'bottom-left',
});
```
→ [Full configuration options](/widget/configuration)

### Add more bridges
Connect Discord and Slack too—all messages sync across platforms.
→ [Discord setup](/bridges/discord) | [Slack setup](/bridges/slack)

### Enable AI fallback
Let AI respond when you're away.
→ [AI Fallback guide](/ai-fallback)

### Track custom events
```javascript
PocketPing.trigger('clicked_pricing', { plan: 'pro' });
```
→ [Custom events guide](/widget/configuration#custom-events)

### Self-host
Deploy on your own infrastructure.
→ [Self-hosting guide](/self-hosting)

---

:::tip Need help?
- Open an issue on [GitHub](https://github.com/Ruwad-io/pocketping/issues)
- Use the chat widget on this page!
:::

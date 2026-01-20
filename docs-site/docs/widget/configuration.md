---
sidebar_position: 2
title: Configuration
description: Complete reference for PocketPing widget configuration options
---

# Widget Configuration

Complete reference for all available configuration options.

## Required Options

| Option | Type | Description |
|--------|------|-------------|
| `projectId` | string | Your PocketPing project ID (SaaS) |
| `endpoint` | string | Your backend URL (self-hosted) |

:::note
Use either `projectId` (SaaS) or `endpoint` (self-hosted), not both.
:::

## Appearance Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `operatorName` | string | "Support" | Name shown in the widget header |
| `operatorAvatar` | string | - | URL to operator avatar image |
| `primaryColor` | string | "#6366f1" | Main brand color (hex) |
| `theme` | "light" \| "dark" \| "auto" | "auto" | Widget color theme |
| `position` | "bottom-right" \| "bottom-left" | "bottom-right" | Widget position on screen |

## Behavior Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `welcomeMessage` | string | - | Auto-sent message when chat opens |
| `placeholder` | string | "Type a message..." | Input placeholder text |
| `soundEnabled` | boolean | true | Play sound on new messages |
| `showOnPages` | string[] | ["*"] | URL patterns where widget appears |
| `hideOnPages` | string[] | [] | URL patterns where widget is hidden |

## Callback Options

| Option | Type | Description |
|--------|------|-------------|
| `onOpen` | () => void | Called when widget opens |
| `onClose` | () => void | Called when widget closes |
| `onMessage` | (msg: Message) => void | Called on new message (sent or received) |
| `onSessionStart` | (session: Session) => void | Called when session is created |

## Full Example

```javascript
PocketPing.init({
  // Connection (choose one)
  projectId: 'proj_xxxxxxxxxxxxx',
  // endpoint: 'https://yoursite.com/pocketping',

  // Appearance
  operatorName: 'Acme Support',
  operatorAvatar: 'https://yoursite.com/avatar.png',
  primaryColor: '#0ea5e9',
  theme: 'auto',
  position: 'bottom-right',

  // Behavior
  welcomeMessage: 'Hi! How can we help you today?',
  placeholder: 'Ask us anything...',
  soundEnabled: true,
  showOnPages: ['*'],
  hideOnPages: ['/admin/*', '/checkout'],

  // Callbacks
  onOpen: () => {
    console.log('Chat opened');
    analytics.track('chat_opened');
  },
  onClose: () => {
    console.log('Chat closed');
  },
  onMessage: (message) => {
    console.log('New message:', message);
  },
  onSessionStart: (session) => {
    console.log('Session started:', session.id);
  },
});
```

## Methods

After initialization, you can control the widget programmatically:

```javascript
// Open the chat widget
PocketPing.open();

// Close the chat widget
PocketPing.close();

// Toggle open/closed
PocketPing.toggle();

// Update configuration
PocketPing.setConfig({ primaryColor: '#10b981' });

// Identify the visitor (for CRM integration)
PocketPing.identify({
  email: 'user@example.com',
  name: 'John Doe',
  plan: 'pro',
});

// Completely remove the widget
PocketPing.destroy();
```

## Next Steps

- [Customization](/widget/customization) - Styling and theming options
- [Telegram Setup](/bridges/telegram) - Connect to Telegram

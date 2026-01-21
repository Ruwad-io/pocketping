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

## Custom Events

Track user actions and respond to backend events for advanced integrations.

### Sending Events

Use `trigger()` to send custom events to your backend (for analytics, automation, etc.):

```javascript
// Track a user action
PocketPing.trigger('clicked_pricing', {
  plan: 'pro',
  source: 'homepage'
});

// Track page views
PocketPing.trigger('viewed_demo');

// Track form submissions
PocketPing.trigger('submitted_form', {
  formId: 'contact',
  fields: ['name', 'email']
});
```

### Listening to Events

Use `onEvent()` to react to events sent from your backend:

```javascript
// Show a popup when backend sends 'show_offer' event
const unsubscribe = PocketPing.onEvent('show_offer', (data) => {
  showPopup(data.message);
});

// Open chat programmatically
PocketPing.onEvent('open_chat', () => {
  PocketPing.open();
});

// Unsubscribe when done
unsubscribe();
```

### Event Flow

```
┌─────────────┐     trigger()      ┌─────────────┐
│   Widget    │ ─────────────────► │   Backend   │
│             │                    │   (SDK)     │
│             │ ◄───────────────── │             │
└─────────────┘     onEvent()      └─────────────┘
```

Events sent via `trigger()` are received by your backend SDK's `onCustomEvent()` handler.
Events sent from your backend via `sendEvent()` are received by the widget's `onEvent()` listeners.

## Next Steps

- [Customization](/widget/customization) - Styling and theming options
- [Telegram Setup](/bridges/telegram) - Connect to Telegram

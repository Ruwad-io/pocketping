---
sidebar_position: 2
title: Configuration
description: Complete reference for PocketPing widget configuration options
---

# Widget Configuration

Complete reference for all widget configuration options, methods, and custom events.

---

## Quick Reference

```javascript
PocketPing.init({
  // Required (choose one)
  projectId: 'proj_xxx',        // SaaS
  // endpoint: 'https://...',   // Self-hosted

  // Appearance
  operatorName: 'Support',
  operatorAvatar: 'https://...',
  primaryColor: '#6366f1',
  theme: 'auto',
  position: 'bottom-right',

  // Behavior
  welcomeMessage: 'Hi! How can we help?',
  placeholder: 'Type a message...',
  soundEnabled: true,

  // Page visibility
  showOnPages: ['*'],
  hideOnPages: ['/admin/*'],

  // Callbacks
  onOpen: () => {},
  onClose: () => {},
  onMessage: (msg) => {},
  onSessionStart: (session) => {},
});
```

---

## Connection Options

Choose ONE of these options:

| Option | Type | Description |
|--------|------|-------------|
| `projectId` | string | Your project ID from [app.pocketping.io](https://app.pocketping.io) dashboard |
| `endpoint` | string | Your self-hosted bridge server URL |

```javascript
// SaaS (recommended for most users)
PocketPing.init({
  projectId: 'proj_xxxxxxxxxxxxx',
});

// Self-hosted
PocketPing.init({
  endpoint: 'https://yoursite.com/pocketping',
});
```

:::warning Don't mix
Using both `projectId` and `endpoint` together will cause unexpected behavior. Choose one.
:::

---

## Appearance Options

Customize how the widget looks.

### Visual Reference

```
┌─────────────────────────────────────────────────────────────────┐
│                         WIDGET ANATOMY                           │
│                                                                 │
│   ┌───────────────────────────┐                                 │
│   │ [Avatar] Operator Name    │ ◄── operatorName, operatorAvatar│
│   │ ─────────────────────────│                                  │
│   │                          │                                  │
│   │ Welcome message appears  │ ◄── welcomeMessage               │
│   │ here when chat opens     │                                  │
│   │                          │                                  │
│   │ ─────────────────────────│                                  │
│   │ [Type a message...]      │ ◄── placeholder                  │
│   │                   [Send] │ ◄── primaryColor applied here    │
│   └───────────────────────────┘                                 │
│                                                                 │
│   Position: bottom-right ──────────────► or ◄── bottom-left     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `operatorName` | string | `"Support"` | Display name in widget header |
| `operatorAvatar` | string | - | URL to avatar image (square, min 64x64) |
| `primaryColor` | string | `"#6366f1"` | Brand color (buttons, links, accents) |
| `theme` | string | `"auto"` | Color scheme: `"light"`, `"dark"`, or `"auto"` |
| `position` | string | `"bottom-right"` | Screen position: `"bottom-right"` or `"bottom-left"` |

### Examples

**Custom branding:**

```javascript
PocketPing.init({
  projectId: 'proj_xxx',
  operatorName: 'Sarah from Acme',
  operatorAvatar: 'https://yoursite.com/sarah.jpg',
  primaryColor: '#10b981',  // Emerald green
  theme: 'light',
  position: 'bottom-left',
});
```

**Match system theme:**

```javascript
PocketPing.init({
  projectId: 'proj_xxx',
  theme: 'auto',  // Follows user's OS dark/light preference
});
```

---

## Behavior Options

Control how the widget behaves.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `welcomeMessage` | string | - | Message shown when chat first opens |
| `placeholder` | string | `"Type a message..."` | Input field placeholder text |
| `soundEnabled` | boolean | `true` | Play sound on incoming messages |
| `showOnPages` | string[] | `["*"]` | URL patterns where widget appears |
| `hideOnPages` | string[] | `[]` | URL patterns where widget is hidden |

### Welcome Messages

```javascript
// Simple welcome
PocketPing.init({
  projectId: 'proj_xxx',
  welcomeMessage: 'Hi! How can we help you today?',
});

// No auto-message (visitor speaks first)
PocketPing.init({
  projectId: 'proj_xxx',
  // welcomeMessage not set = no auto-message
});
```

### Page Visibility

Control where the widget appears:

```javascript
PocketPing.init({
  projectId: 'proj_xxx',

  // Show everywhere except admin and checkout
  showOnPages: ['*'],
  hideOnPages: ['/admin/*', '/checkout', '/checkout/*'],
});
```

```javascript
PocketPing.init({
  projectId: 'proj_xxx',

  // Only show on specific pages
  showOnPages: ['/pricing', '/contact', '/support/*'],
  hideOnPages: [],
});
```

**Pattern matching:**

| Pattern | Matches |
|---------|---------|
| `*` | All pages |
| `/pricing` | Exactly `/pricing` |
| `/docs/*` | `/docs/`, `/docs/intro`, `/docs/guides/setup` |
| `/blog/*` | `/blog/`, `/blog/post-1`, `/blog/2024/article` |

---

## Callback Options

React to widget events in your code.

| Option | Type | Description |
|--------|------|-------------|
| `onOpen` | `() => void` | Called when widget opens |
| `onClose` | `() => void` | Called when widget closes |
| `onMessage` | `(msg: Message) => void` | Called on any message (sent or received) |
| `onSessionStart` | `(session: Session) => void` | Called when a new session is created |

### Example: Analytics Integration

```javascript
PocketPing.init({
  projectId: 'proj_xxx',

  onOpen: () => {
    // Track in Google Analytics
    gtag('event', 'chat_opened', { event_category: 'engagement' });

    // Track in Mixpanel
    mixpanel.track('Chat Opened');
  },

  onClose: () => {
    gtag('event', 'chat_closed', { event_category: 'engagement' });
  },

  onMessage: (message) => {
    // Log all messages for debugging
    console.log('Message:', message.content, 'Direction:', message.direction);

    // Track message count
    gtag('event', 'chat_message', {
      event_category: 'engagement',
      direction: message.direction,  // 'inbound' or 'outbound'
    });
  },

  onSessionStart: (session) => {
    // Store session ID for support reference
    console.log('Session started:', session.id);

    // Identify session in your analytics
    mixpanel.identify(session.visitorId);
  },
});
```

### Message Object

```typescript
interface Message {
  id: string;
  content: string;
  direction: 'inbound' | 'outbound';  // inbound = from visitor, outbound = from you
  timestamp: string;
  sender: {
    name: string;
    type: 'visitor' | 'operator' | 'ai';
  };
}
```

---

## Methods

After initialization, control the widget programmatically.

### Basic Controls

```javascript
// Open the chat widget
PocketPing.open();

// Close the chat widget
PocketPing.close();

// Toggle open/closed
PocketPing.toggle();
```

### Dynamic Configuration

```javascript
// Update settings at runtime
PocketPing.setConfig({
  primaryColor: '#ef4444',  // Change to red
  operatorName: 'Emergency Support',
});
```

### Visitor Identification

Associate visitor with your user data so operators can see who they're talking to:

```javascript
// After user logs in
PocketPing.identify({
  id: 'user_12345',          // Required - unique user identifier
  email: 'user@example.com',
  name: 'John Doe',
  // Any custom properties
  plan: 'pro',
  company: 'Acme Inc',
  signupDate: '2024-01-15',
});
```

**Required field:** `id` must be a non-empty string (typically your user's database ID).

Identity is persisted in localStorage and automatically sent on reconnection, so users stay identified across page refreshes.

This data appears in your messaging platform (Telegram/Discord/Slack):

```
┌──────────────────────────────────────────────────────┐
│ 🆕 New conversation                                   │
│                                                      │
│ 👤 John Doe                                          │
│ 📧 user@example.com                                  │
│ 📋 plan: pro • company: Acme Inc                     │
├──────────────────────────────────────────────────────┤
│ "I need help with the API integration"               │
└──────────────────────────────────────────────────────┘
```

#### Reset Identity

Clear identity on logout and optionally start a fresh session:

```javascript
// Clear identity only (keep session)
await PocketPing.reset();

// Clear identity AND start new session (recommended on logout)
await PocketPing.reset({ newSession: true });
```

#### Get Current Identity

```javascript
const identity = PocketPing.getIdentity();
// Returns: { id: 'user_12345', email: '...', name: '...' } or null
```

### Cleanup

```javascript
// Completely remove the widget from the page
PocketPing.destroy();

// Widget can be re-initialized after destroy
PocketPing.init({ projectId: 'proj_xxx' });
```

---

## Custom Events

**This is PocketPing's most powerful feature.** Custom events enable bidirectional communication between your widget and backend.

### Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      CUSTOM EVENTS                               │
│                                                                 │
│   Widget                                           Backend      │
│   ┌───────────────┐                         ┌───────────────┐  │
│   │               │                         │               │  │
│   │  trigger()    │ ─────────────────────► │  onEvent()    │  │
│   │               │    "clicked_pricing"    │               │  │
│   │               │    { plan: 'pro' }      │               │  │
│   │               │                         │               │  │
│   │  onEvent()    │ ◄───────────────────── │  emitEvent()  │  │
│   │               │    "show_discount"      │               │  │
│   │               │    { percent: 20 }      │               │  │
│   └───────────────┘                         └───────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Sending Events (Widget → Backend)

Use `trigger()` to send events to your backend:

```javascript
// Track pricing page interactions
document.querySelector('#pricing-button').addEventListener('click', () => {
  PocketPing.trigger('clicked_pricing', {
    plan: 'pro',
    price: 49,
    source: 'homepage',
  });
});

// Track form submissions
document.querySelector('#signup-form').addEventListener('submit', () => {
  PocketPing.trigger('form_submitted', {
    formType: 'signup',
    fields: ['email', 'name'],
  });
});

// Track page views
PocketPing.trigger('page_viewed', {
  page: window.location.pathname,
  referrer: document.referrer,
});
```

Your backend receives these events via the SDK's `onEvent` handler.

### Listening to Events (Backend → Widget)

Use `onEvent()` to react to events from your backend:

```javascript
// Show a discount popup
PocketPing.onEvent('show_discount', (data) => {
  showPopup({
    title: 'Special Offer!',
    message: `Get ${data.percent}% off with code: ${data.code}`,
  });
});

// Highlight a feature
PocketPing.onEvent('highlight_feature', (data) => {
  document.querySelector(`#${data.featureId}`).classList.add('highlight');
});

// Open chat with a message
PocketPing.onEvent('open_chat', (data) => {
  PocketPing.open();
  if (data.message) {
    showSystemMessage(data.message);
  }
});
```

### Unsubscribing

```javascript
// Store the unsubscribe function
const unsubscribe = PocketPing.onEvent('some_event', (data) => {
  // Handle event
});

// Later, stop listening
unsubscribe();
```

### Use Cases

| Scenario | Direction | Event | Data |
|----------|-----------|-------|------|
| Track pricing clicks | Widget → Backend | `clicked_pricing` | `{ plan, price }` |
| Track form submissions | Widget → Backend | `form_submitted` | `{ formType, fields }` |
| Track feature usage | Widget → Backend | `used_feature` | `{ featureId }` |
| Show discount offer | Backend → Widget | `show_discount` | `{ percent, code }` |
| Highlight UI element | Backend → Widget | `highlight` | `{ selector }` |
| Open chat with context | Backend → Widget | `open_chat` | `{ message }` |
| Request form fill | Backend → Widget | `request_info` | `{ fields }` |

### Full Example: Lead Scoring

**Widget (track behavior):**

```javascript
// Track high-intent actions
PocketPing.trigger('viewed_pricing');
PocketPing.trigger('started_trial');
PocketPing.trigger('invited_team_member');

// Track engagement
PocketPing.trigger('time_on_page', { seconds: 120 });
```

**Backend (respond based on score):**

```javascript
// In your backend SDK
const pp = new PocketPing({
  onEvent: async (event, session) => {
    // Calculate lead score
    const score = await calculateLeadScore(session.visitorId, event);

    // High-intent visitor? Show offer
    if (score > 80) {
      await pp.emitEvent(session.id, 'show_discount', {
        percent: 20,
        code: 'HIGHINTENT20',
        expires: '24h',
      });
    }
  },
});
```

---

## Complete Example

```javascript
PocketPing.init({
  // Connection
  projectId: 'proj_xxxxxxxxxxxxx',

  // Appearance
  operatorName: 'Acme Support',
  operatorAvatar: 'https://acme.com/support-avatar.png',
  primaryColor: '#0ea5e9',
  theme: 'auto',
  position: 'bottom-right',

  // Behavior
  welcomeMessage: 'Hi! How can we help you today?',
  placeholder: 'Ask us anything...',
  soundEnabled: true,
  showOnPages: ['*'],
  hideOnPages: ['/admin/*', '/checkout'],

  // Analytics integration
  onOpen: () => {
    gtag('event', 'chat_opened');
  },

  onMessage: (message) => {
    if (message.direction === 'inbound') {
      gtag('event', 'message_sent');
    }
  },

  onSessionStart: (session) => {
    // Identify in Mixpanel
    mixpanel.identify(session.visitorId);
    mixpanel.people.set({ has_chatted: true });
  },
});

// Identify logged-in users
if (window.currentUser) {
  PocketPing.identify({
    email: window.currentUser.email,
    name: window.currentUser.name,
    plan: window.currentUser.plan,
  });
}

// Track pricing interest
document.querySelector('#pricing-cta')?.addEventListener('click', () => {
  PocketPing.trigger('clicked_pricing', { source: 'homepage' });
});

// Listen for backend events
PocketPing.onEvent('show_offer', (data) => {
  showOfferBanner(data);
});
```

---

## Next Steps

- **[Custom Events Guide](/widget/configuration#custom-events)** - Deep dive into event handling
- **[Telegram Bridge](/bridges/telegram)** - Connect to receive messages
- **[Discord Bridge](/bridges/discord)** - Connect Discord
- **[Slack Bridge](/bridges/slack)** - Connect Slack
- **[Node.js SDK](/sdk/nodejs)** - Backend event handling

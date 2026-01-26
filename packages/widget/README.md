# @pocketping/widget

Embeddable chat widget for PocketPing. Drop-in customer support chat that connects to your backend and notifies you via Telegram, Discord, or Slack.

## Installation

### Via CDN (Recommended)

**One-line install (SaaS users):**

```html
<script src="https://cdn.pocketping.io/widget.js" data-project-id="proj_xxxxxxxxxxxxx"></script>
```

**With custom options:**

```html
<script src="https://cdn.pocketping.io/widget.js"></script>
<script>
  PocketPing.init({
    projectId: 'proj_xxxxxxxxxxxxx',  // SaaS users
    // OR
    endpoint: 'https://yoursite.com/pocketping',  // Self-hosted
    operatorName: 'Support Team',
  });
</script>
```

### Via npm

```bash
npm install @pocketping/widget
```

```javascript
import PocketPing from '@pocketping/widget';

PocketPing.init({
  projectId: 'proj_xxxxxxxxxxxxx',  // SaaS users
  // OR
  endpoint: 'https://yoursite.com/pocketping',  // Self-hosted
});
```

---

## Configuration Options

### Required (one of)

| Option | Type | Description |
|--------|------|-------------|
| `projectId` | `string` | Your project ID from [app.pocketping.io](https://app.pocketping.io) (SaaS) |
| `endpoint` | `string` | Your backend endpoint (self-hosted, e.g., `"https://yoursite.com/pocketping"`) |

---

### Branding

Customize the widget's branding to match your company identity.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `operatorName` | `string` | - | Company/operator name displayed in header |
| `operatorAvatar` | `string` | - | Operator/company avatar URL (displayed in header) |
| `logoUrl` | `string` | - | Company logo URL (alternative to avatar) |
| `headerTitle` | `string` | `operatorName` | Header title text |
| `headerSubtitle` | `string` | - | Header subtitle (e.g., "We usually reply within minutes") |
| `welcomeMessage` | `string` | - | Welcome message shown when chat opens |
| `placeholder` | `string` | `"Type a message..."` | Placeholder text for message input |

**Example:**

```javascript
PocketPing.init({
  endpoint: 'https://yoursite.com/pocketping',
  operatorName: 'Acme Support',
  operatorAvatar: 'https://yoursite.com/avatar.png',
  headerTitle: 'Chat with us',
  headerSubtitle: 'We usually reply within 5 minutes',
  welcomeMessage: 'Hi there! How can we help you today?',
  placeholder: 'Ask us anything...'
});
```

---

### Appearance

Control the visual appearance of the widget.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Color theme (`'auto'` follows system preference) |
| `primaryColor` | `string` | `'#6366f1'` | Primary brand color (hex format) |
| `primaryTextColor` | `string` | `'#ffffff'` | Text color on primary background |
| `position` | `'bottom-right' \| 'bottom-left'` | `'bottom-right'` | Widget position on screen |
| `offset` | `number` | `20` | Distance from edge in pixels |
| `borderRadius` | `number` | `16` | Border radius in pixels |
| `fontFamily` | `string` | System font stack | Custom font family |
| `zIndex` | `number` | `9999` | Z-index for widget layering |
| `toggleIcon` | `'chat' \| 'message' \| 'help' \| string` | `'chat'` | Toggle button icon (or custom SVG) |
| `customCSS` | `string` | - | Custom CSS to inject |

**Example:**

```javascript
PocketPing.init({
  endpoint: 'https://yoursite.com/pocketping',
  theme: 'dark',
  primaryColor: '#10b981',
  primaryTextColor: '#ffffff',
  position: 'bottom-left',
  offset: 24,
  borderRadius: 12,
  fontFamily: '"Inter", sans-serif',
  zIndex: 10000,
  toggleIcon: 'help'
});
```

**Custom Icon Example:**

```javascript
PocketPing.init({
  endpoint: 'https://yoursite.com/pocketping',
  toggleIcon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>'
});
```

**Custom CSS Example:**

```javascript
PocketPing.init({
  endpoint: 'https://yoursite.com/pocketping',
  customCSS: `
    .pocketping-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .pocketping-message--visitor {
      background: #e0e7ff;
    }
  `
});
```

---

### Behavior

Control when and how the widget behaves.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `showOnPages` | `string[]` | - | Only show on pages matching these regex patterns |
| `hideOnPages` | `string[]` | - | Hide on pages matching these regex patterns |
| `showDelay` | `number` | `0` | Delay before showing widget (ms) |
| `autoOpenDelay` | `number` | `0` | Auto-open chat after delay (ms, `0` = disabled) |
| `autoOpenOnMessage` | `boolean` | `true` | Auto-open chat when operator sends a message |
| `soundEnabled` | `boolean` | `true` | Play sound on new message |
| `showUnreadBadge` | `boolean` | `true` | Show unread badge on toggle button |
| `persistOpenState` | `boolean` | `false` | Persist chat open/closed state in localStorage |

**Example:**

```javascript
PocketPing.init({
  endpoint: 'https://yoursite.com/pocketping',
  showOnPages: ['^/pricing', '^/contact', '^/help'],
  hideOnPages: ['^/admin', '^/checkout'],
  showDelay: 3000,
  autoOpenDelay: 10000,
  autoOpenOnMessage: true,
  soundEnabled: true,
  showUnreadBadge: true,
  persistOpenState: true
});
```

---

### Callbacks

React to widget events in your application.

| Option | Type | Description |
|--------|------|-------------|
| `onOpen` | `() => void` | Called when chat window opens |
| `onClose` | `() => void` | Called when chat window closes |
| `onMessage` | `(message: Message) => void` | Called when a message is received |
| `onConnect` | `(sessionId: string) => void` | Called when connected to backend |
| `onError` | `(error: Error) => void` | Called when connection fails |

**Example:**

```javascript
PocketPing.init({
  endpoint: 'https://yoursite.com/pocketping',
  onOpen: () => {
    console.log('Chat opened');
    analytics.track('chat_opened');
  },
  onClose: () => {
    console.log('Chat closed');
  },
  onMessage: (message) => {
    console.log('New message:', message.content);
  },
  onConnect: (sessionId) => {
    console.log('Connected with session:', sessionId);
  },
  onError: (error) => {
    console.error('Chat error:', error.message);
  }
});
```

---

## Complete Example

```javascript
PocketPing.init({
  // Required
  endpoint: 'https://api.yoursite.com/pocketping',

  // Branding
  operatorName: 'Acme Inc.',
  operatorAvatar: 'https://yoursite.com/logo-small.png',
  headerTitle: 'Chat with Acme Support',
  headerSubtitle: 'We typically reply within 5 minutes',
  welcomeMessage: 'Welcome! How can we help you today?',
  placeholder: 'Type your question...',

  // Appearance
  theme: 'auto',
  primaryColor: '#2563eb',
  primaryTextColor: '#ffffff',
  position: 'bottom-right',
  offset: 20,
  borderRadius: 16,
  fontFamily: '"Inter", system-ui, sans-serif',
  zIndex: 9999,
  toggleIcon: 'chat',

  // Behavior
  showOnPages: ['^/pricing', '^/features', '^/contact'],
  hideOnPages: ['^/admin'],
  showDelay: 2000,
  autoOpenDelay: 0,
  soundEnabled: true,
  showUnreadBadge: true,
  persistOpenState: true,

  // Callbacks
  onOpen: () => analytics.track('chat_opened'),
  onClose: () => analytics.track('chat_closed'),
  onConnect: (sessionId) => console.log('Session:', sessionId),
  onError: (error) => console.error('Error:', error)
});
```

---

## Programmatic Control

After initialization, you can control the widget programmatically:

```javascript
// Open the chat
PocketPing.open();

// Close the chat
PocketPing.close();

// Toggle the chat
PocketPing.toggle();

// Send a message programmatically
PocketPing.sendMessage('Hello!');

// Destroy the widget
PocketPing.destroy();
```

---

## Custom Events

PocketPing supports bidirectional custom events between your website and the backend. This enables powerful interactions like triggering alerts when users take specific actions.

### Triggering Events (Widget → Backend)

Send events to your backend when users perform actions:

```javascript
// Notify when user clicks pricing
PocketPing.trigger('clicked_pricing', { plan: 'pro', source: 'header' });

// Track user interactions
PocketPing.trigger('viewed_demo');
PocketPing.trigger('downloaded_pdf', { name: 'whitepaper.pdf' });

// Report errors
PocketPing.trigger('error_occurred', { code: 500, page: window.location.pathname });
```

Events are forwarded to your backend and displayed in Telegram/Discord/Slack with full context.

### Listening for Events (Backend → Widget)

Your backend can send events to the widget. Subscribe to handle them:

```javascript
// Subscribe to an event
const unsubscribe = PocketPing.onEvent('show_offer', (data) => {
  showPopup(`Special offer: ${data.discount}% off!`);
});

// Unsubscribe when done
unsubscribe();

// Or use offEvent
PocketPing.onEvent('announcement', handleAnnouncement);
PocketPing.offEvent('announcement', handleAnnouncement);
```

### Event Callback

You can also use an `onEvent` callback in the init config:

```javascript
PocketPing.init({
  endpoint: 'https://yoursite.com/pocketping',
  onEvent: (event) => {
    console.log('Received event:', event.name, event.data);
  }
});
```

### Use Cases

| Event | Use Case |
|-------|----------|
| `clicked_pricing` | Alert sales team when visitor shows interest |
| `error_spike` | Get notified of frontend errors |
| `cart_abandoned` | Trigger follow-up message |
| `show_offer` | Display personalized offer |
| `request_demo` | Open demo scheduling modal |
| `announcement` | Show system-wide notification |

---

## TypeScript Support

Full TypeScript definitions are included:

```typescript
import {
  init,
  trigger,
  onEvent,
  offEvent,
  PocketPingConfig,
  Message,
  CustomEvent,
  CustomEventHandler
} from '@pocketping/widget';

const config: PocketPingConfig = {
  endpoint: 'https://yoursite.com/pocketping',
  onMessage: (message: Message) => {
    console.log(message.content);
  }
};

init(config);

// Type-safe events
trigger('clicked_pricing', { plan: 'pro' });

const handler: CustomEventHandler = (data, event: CustomEvent) => {
  console.log(event.name, data);
};

onEvent('show_offer', handler);
```

---

## CSS Classes

For advanced customization, you can target these CSS classes:

| Class | Element |
|-------|---------|
| `.pocketping-container` | Main container |
| `.pocketping-toggle` | Toggle button |
| `.pocketping-toggle--unread` | Toggle with unread badge |
| `.pocketping-window` | Chat window |
| `.pocketping-header` | Chat header |
| `.pocketping-messages` | Messages container |
| `.pocketping-message` | Individual message |
| `.pocketping-message--visitor` | Visitor message |
| `.pocketping-message--operator` | Operator message |
| `.pocketping-message--ai` | AI message |
| `.pocketping-input` | Input container |
| `.pocketping-input__field` | Text input |
| `.pocketping-input__send` | Send button |

---

## Browser Support

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

---

## License

MIT



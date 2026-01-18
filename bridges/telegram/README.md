# @pocketping/bridge-telegram

Telegram bridge for PocketPing. Get notified on Telegram when users start chatting, and reply directly from your phone.

## Installation

```bash
npm install @pocketping/bridge-telegram
```

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and find [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Get Your Chat ID

1. Start a chat with your new bot
2. Send any message to the bot
3. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
4. Find your `chat.id` in the response

### 3. Add to Your Backend

```javascript
import { PocketPing } from '@pocketping/sdk';
import { TelegramBridge } from '@pocketping/bridge-telegram';

const pp = new PocketPing({
  storage: 'memory',
});

// Add the Telegram bridge
pp.addBridge(new TelegramBridge({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatIds: process.env.TELEGRAM_CHAT_ID, // or array of chat IDs
  showUrl: true,     // Show page URL in notifications
  inlineReply: true, // Show action buttons
}));
```

## Usage

Once connected, you'll receive notifications in Telegram:

```
🆕 New Visitor

Session: `abc123...`
Page: https://yoursite.com/pricing

Reply to any message from this user to respond.
```

### Commands

- `/online` - Mark yourself as available (users see "Online" status)
- `/offline` - Mark yourself as away (AI takes over if configured)
- `/status` - View current PocketPing status

### Replying to Users

Simply **reply** to any notification message to send a response to the user. Your reply will be delivered in real-time through the chat widget.

## Configuration

```typescript
interface TelegramBridgeConfig {
  // Required
  botToken: string;        // From @BotFather
  chatIds: string | string[]; // Your chat ID(s)

  // Optional
  showUrl?: boolean;       // Show page URL (default: true)
  inlineReply?: boolean;   // Show inline buttons (default: true)

  // Custom message templates
  templates?: {
    newSession?: (session: Session) => string;
    message?: (message: Message, session: Session) => string;
  };
}
```

## Multiple Recipients

You can notify multiple people (team members) by passing an array of chat IDs:

```javascript
new TelegramBridge({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatIds: [
    process.env.TELEGRAM_CHAT_ID_ALICE,
    process.env.TELEGRAM_CHAT_ID_BOB,
  ],
});
```

All team members will receive notifications. The first person to reply becomes the active responder.

## Custom Templates

```javascript
new TelegramBridge({
  botToken: '...',
  chatIds: '...',
  templates: {
    newSession: (session) => {
      return `🎉 Someone's on your site!\n${session.metadata?.url}`;
    },
    message: (message, session) => {
      return `💬 ${message.content}`;
    },
  },
});
```

## License

MIT

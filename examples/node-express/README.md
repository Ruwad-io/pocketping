# PocketPing - Express Example

A minimal example showing how to integrate PocketPing with Express.js.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Copy the environment file and add your credentials:
```bash
cp .env.example .env
```

3. Start the development server:
```bash
npm run dev
```

4. Open http://localhost:3000 in your browser

## Telegram Setup (Optional)

To receive notifications on Telegram:

1. Create a bot with [@BotFather](https://t.me/botfather)
2. Get your chat ID
3. Add the credentials to `.env`:
```
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CHAT_ID=123456789
```

4. Restart the server

Now when someone sends a message through the chat widget, you'll get a Telegram notification!

## Code Overview

```javascript
import { PocketPing } from '@pocketping/sdk';
import { TelegramBridge } from '@pocketping/bridge-telegram';

// Initialize PocketPing
const pp = new PocketPing({
  storage: 'memory',
  welcomeMessage: 'Hi! How can we help?',
});

// Add Telegram notifications
pp.addBridge(new TelegramBridge({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatIds: process.env.TELEGRAM_CHAT_ID,
}));

// Mount on Express
app.use('/pocketping', pp.middleware());

// Enable WebSocket for real-time updates
pp.attachWebSocket(server);
```

## Production Considerations

- Replace `'memory'` storage with a persistent database (Redis, PostgreSQL, etc.)
- Use environment variables for all secrets
- Add rate limiting
- Configure CORS properly
- Deploy behind a reverse proxy (nginx, Cloudflare, etc.)

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { PocketPing, TelegramBridge } from '@pocketping/sdk-node';

const app = express();
const server = createServer(app);

// Parse JSON bodies
app.use(express.json());

// ─────────────────────────────────────────────────────────────────
// Initialize PocketPing
// ─────────────────────────────────────────────────────────────────

const pp = new PocketPing({
  storage: 'memory', // Use 'memory' for dev, implement Storage interface for production

  welcomeMessage: 'Hi! 👋 How can we help you today?',

  aiTakeoverDelay: 300, // 5 minutes

  onNewSession: (session) => {
    console.log(`[PocketPing] New session: ${session.id}`);
    console.log(`  - Page: ${session.metadata?.url}`);
  },

  onMessage: (message, session) => {
    console.log(`[PocketPing] Message from ${message.sender}: ${message.content}`);
  },
});

// Add Telegram bridge (optional)
if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  pp.addBridge(new TelegramBridge({
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatIds: process.env.TELEGRAM_CHAT_ID,
    showUrl: true,
  }));
  console.log('[PocketPing] Telegram bridge enabled');
} else {
  console.log('[PocketPing] Telegram bridge disabled (no credentials)');
}

// Mount PocketPing middleware
app.use('/pocketping', pp.middleware());

// Attach WebSocket for real-time updates
pp.attachWebSocket(server);

// ─────────────────────────────────────────────────────────────────
// Demo page
// ─────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>PocketPing Demo</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }
        .container {
          text-align: center;
          padding: 40px;
          max-width: 600px;
        }
        h1 {
          font-size: 3rem;
          margin-bottom: 1rem;
        }
        p {
          font-size: 1.2rem;
          opacity: 0.9;
          margin-bottom: 2rem;
        }
        .hint {
          background: rgba(255,255,255,0.1);
          padding: 20px;
          border-radius: 12px;
          font-size: 0.9rem;
        }
        code {
          background: rgba(0,0,0,0.2);
          padding: 2px 6px;
          border-radius: 4px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔔 PocketPing</h1>
        <p>Real-time customer chat with mobile notifications.</p>
        <div class="hint">
          <p>Click the chat bubble in the bottom-right corner to start a conversation.</p>
          <br>
          <p>Messages will be sent to your Telegram if configured.</p>
        </div>
      </div>

      <!-- PocketPing Widget -->
      <script src="/pocketping-widget.js"></script>
      <script>
        PocketPing.init({
          endpoint: '/pocketping',
          theme: 'dark',
          primaryColor: '#667eea',
          welcomeMessage: 'Hi! 👋 How can we help you today?',
          operatorName: 'Support',
        });
      </script>
    </body>
    </html>
  `);
});

// Serve widget (in production, use the built bundle from @pocketping/widget)
app.get('/pocketping-widget.js', (req, res) => {
  res.redirect('https://unpkg.com/@pocketping/widget');
});

// ─────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🔔 PocketPing Demo Server                                   ║
║                                                               ║
║   Open http://localhost:${PORT} in your browser                 ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

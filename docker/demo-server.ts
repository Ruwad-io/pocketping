import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { PocketPing } from '@pocketping/sdk-node';
import { readFileSync } from 'fs';
import { join } from 'path';

const app = express();
const server = createServer(app);

app.use(express.json());

// Initialize PocketPing with memory storage
const pp = new PocketPing({
  welcomeMessage: 'Hi! How can we help you today?',
  onNewSession: (session) => {
    console.log(`[PocketPing] New session: ${session.id}`);
  },
  onMessage: (message, session) => {
    console.log(`[PocketPing] Message from ${message.sender}: ${message.content}`);
  },
});

// Mount PocketPing routes
app.use('/pocketping', pp.middleware());

// Attach WebSocket
pp.attachWebSocket(server);

// Serve local widget
app.get('/widget.js', (req, res) => {
  try {
    const widgetPath = join(process.cwd(), 'widget', 'dist', 'pocketping.min.global.js');
    const widget = readFileSync(widgetPath, 'utf-8');
    res.type('application/javascript').send(widget);
  } catch (err) {
    console.error('Widget not found:', err);
    res.status(404).send('Widget not found');
  }
});

// Demo page HTML generator
const getDemoPage = (theme: 'light' | 'dark') => `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PocketPing Demo${theme === 'dark' ? ' (Dark)' : ''}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: ${theme === 'dark' ? '#1a1a2e' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'};
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }
      .container { text-align: center; padding: 40px; max-width: 600px; }
      h1 { font-size: 3rem; margin-bottom: 1rem; }
      p { font-size: 1.2rem; opacity: 0.9; margin-bottom: 2rem; }
      .hint {
        background: rgba(255,255,255,0.1);
        padding: 20px;
        border-radius: 12px;
        font-size: 0.9rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>PocketPing</h1>
      <p>Real-time customer chat with mobile notifications.</p>
      <div class="hint">
        <p>Click the chat bubble in the bottom-right corner to start a conversation.</p>
      </div>
    </div>
    <script src="/widget.js"></script>
    <script>
      PocketPing.init({
        endpoint: '/pocketping',
        theme: '${theme}',
        primaryColor: '#667eea',
        welcomeMessage: 'Hi! How can we help you today?',
      });
    </script>
  </body>
  </html>
`;

// Demo pages
app.get('/', (req, res) => res.send(getDemoPage('light')));
app.get('/dark', (req, res) => res.send(getDemoPage('dark')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Demo server running on http://localhost:${PORT}`);
});

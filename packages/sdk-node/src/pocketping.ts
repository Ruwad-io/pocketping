import type { IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  PocketPingConfig,
  Session,
  Message,
  ConnectRequest,
  ConnectResponse,
  SendMessageRequest,
  SendMessageResponse,
  GetMessagesRequest,
  GetMessagesResponse,
  TypingRequest,
  PresenceResponse,
} from './types';
import type { Storage } from './storage/types';
import { MemoryStorage } from './storage/memory';
import type { Bridge } from './bridges/types';

export class PocketPing {
  private storage: Storage;
  private bridges: Bridge[];
  private config: PocketPingConfig;
  private wss: WebSocketServer | null = null;
  private sessionSockets: Map<string, Set<WebSocket>> = new Map();
  private operatorOnline = false;

  constructor(config: PocketPingConfig = {}) {
    this.config = config;
    this.storage = this.initStorage(config.storage);
    this.bridges = config.bridges ?? [];
  }

  private initStorage(storage?: Storage | 'memory'): Storage {
    if (!storage || storage === 'memory') {
      return new MemoryStorage();
    }
    return storage;
  }

  // ─────────────────────────────────────────────────────────────────
  // Express/Connect Middleware
  // ─────────────────────────────────────────────────────────────────

  middleware(): (req: IncomingMessage & { body?: unknown; query?: Record<string, string> }, res: ServerResponse, next?: () => void) => void {
    return async (req, res, next) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const path = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      try {
        const body = await this.parseBody(req);
        const query = Object.fromEntries(url.searchParams);

        let result: unknown;

        switch (path) {
          case 'connect':
            result = await this.handleConnect(body as ConnectRequest);
            break;
          case 'message':
            result = await this.handleMessage(body as SendMessageRequest);
            break;
          case 'messages':
            result = await this.handleGetMessages(query as unknown as GetMessagesRequest);
            break;
          case 'typing':
            result = await this.handleTyping(body as TypingRequest);
            break;
          case 'presence':
            result = await this.handlePresence();
            break;
          default:
            if (next) {
              next();
              return;
            }
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify(result));
      } catch (error) {
        console.error('[PocketPing] Error:', error);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    };
  }

  private async parseBody(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
    // If body is already parsed (Express with body-parser)
    if (req.body) return req.body;

    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // WebSocket
  // ─────────────────────────────────────────────────────────────────

  attachWebSocket(server: unknown): void {
    this.wss = new WebSocketServer({
      server: server as Parameters<typeof WebSocketServer>[0]['server'],
      path: '/pocketping/stream'
    });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const sessionId = url.searchParams.get('sessionId');

      if (!sessionId) {
        ws.close(4000, 'sessionId required');
        return;
      }

      // Track socket for this session
      if (!this.sessionSockets.has(sessionId)) {
        this.sessionSockets.set(sessionId, new Set());
      }
      this.sessionSockets.get(sessionId)!.add(ws);

      ws.on('close', () => {
        this.sessionSockets.get(sessionId)?.delete(ws);
      });

      ws.on('message', async (data) => {
        try {
          const event = JSON.parse(data.toString());
          await this.handleWebSocketMessage(sessionId, event);
        } catch (err) {
          console.error('[PocketPing] WS message error:', err);
        }
      });
    });
  }

  private async handleWebSocketMessage(sessionId: string, event: { type: string; data: unknown }): Promise<void> {
    switch (event.type) {
      case 'typing':
        this.broadcastToSession(sessionId, {
          type: 'typing',
          data: event.data,
        });
        break;
    }
  }

  private broadcastToSession(sessionId: string, event: unknown): void {
    const sockets = this.sessionSockets.get(sessionId);
    if (!sockets) return;

    const message = JSON.stringify(event);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Protocol Handlers
  // ─────────────────────────────────────────────────────────────────

  async handleConnect(request: ConnectRequest): Promise<ConnectResponse> {
    let session: Session | null = null;

    // Try to resume existing session
    if (request.sessionId) {
      session = await this.storage.getSession(request.sessionId);
    }

    // Create new session if needed
    if (!session) {
      session = {
        id: this.generateId(),
        visitorId: request.visitorId,
        createdAt: new Date(),
        lastActivity: new Date(),
        operatorOnline: this.operatorOnline,
        aiActive: false,
        metadata: request.metadata,
      };
      await this.storage.createSession(session);

      // Notify bridges about new session
      await this.notifyBridges('new_session', session);

      // Callback
      await this.config.onNewSession?.(session);
    }

    // Get existing messages
    const messages = await this.storage.getMessages(session.id);

    return {
      sessionId: session.id,
      visitorId: session.visitorId,
      operatorOnline: this.operatorOnline,
      welcomeMessage: this.config.welcomeMessage,
      messages,
    };
  }

  async handleMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    const session = await this.storage.getSession(request.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const message: Message = {
      id: this.generateId(),
      sessionId: request.sessionId,
      content: request.content,
      sender: request.sender,
      timestamp: new Date(),
      replyTo: request.replyTo,
    };

    await this.storage.saveMessage(message);

    // Update session activity
    session.lastActivity = new Date();
    await this.storage.updateSession(session);

    // Notify bridges
    if (request.sender === 'visitor') {
      await this.notifyBridges('message', message, session);
    }

    // Broadcast to WebSocket clients
    this.broadcastToSession(request.sessionId, {
      type: 'message',
      data: message,
    });

    // Callback
    await this.config.onMessage?.(message, session);

    return {
      messageId: message.id,
      timestamp: message.timestamp.toISOString(),
    };
  }

  async handleGetMessages(request: GetMessagesRequest): Promise<GetMessagesResponse> {
    const limit = Math.min(request.limit ?? 50, 100);
    const messages = await this.storage.getMessages(request.sessionId, request.after, limit + 1);

    return {
      messages: messages.slice(0, limit),
      hasMore: messages.length > limit,
    };
  }

  async handleTyping(request: TypingRequest): Promise<{ ok: boolean }> {
    this.broadcastToSession(request.sessionId, {
      type: 'typing',
      data: {
        sessionId: request.sessionId,
        sender: request.sender,
        isTyping: request.isTyping ?? true,
      },
    });

    return { ok: true };
  }

  async handlePresence(): Promise<PresenceResponse> {
    return {
      online: this.operatorOnline,
      aiEnabled: !!this.config.ai,
      aiActiveAfter: this.config.aiTakeoverDelay ?? 300,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Operator Actions (for bridges)
  // ─────────────────────────────────────────────────────────────────

  async sendOperatorMessage(sessionId: string, content: string): Promise<Message> {
    const response = await this.handleMessage({
      sessionId,
      content,
      sender: 'operator',
    });

    const message: Message = {
      id: response.messageId,
      sessionId,
      content,
      sender: 'operator',
      timestamp: new Date(response.timestamp),
    };

    return message;
  }

  setOperatorOnline(online: boolean): void {
    this.operatorOnline = online;

    // Broadcast to all sessions
    for (const sessionId of this.sessionSockets.keys()) {
      this.broadcastToSession(sessionId, {
        type: 'presence',
        data: { online },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Bridges
  // ─────────────────────────────────────────────────────────────────

  private async notifyBridges(event: string, ...args: unknown[]): Promise<void> {
    for (const bridge of this.bridges) {
      try {
        switch (event) {
          case 'new_session':
            await bridge.onNewSession?.(args[0] as Session);
            break;
          case 'message':
            await bridge.onMessage?.(args[0] as Message, args[1] as Session);
            break;
        }
      } catch (err) {
        console.error(`[PocketPing] Bridge ${bridge.name} error:`, err);
      }
    }
  }

  addBridge(bridge: Bridge): void {
    this.bridges.push(bridge);
    bridge.init?.(this);
  }

  // ─────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────

  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
  }

  getStorage(): Storage {
    return this.storage;
  }
}

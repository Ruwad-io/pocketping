import type { IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  PocketPingConfig,
  Session,
  SessionMetadata,
  Message,
  MessageStatus,
  ConnectRequest,
  ConnectResponse,
  SendMessageRequest,
  SendMessageResponse,
  GetMessagesRequest,
  GetMessagesResponse,
  TypingRequest,
  PresenceResponse,
  ReadRequest,
  ReadResponse,
} from './types';
import type { Storage } from './storage/types';
import { MemoryStorage } from './storage/memory';
import type { Bridge } from './bridges/types';

// ─────────────────────────────────────────────────────────────────
// IP & User Agent Helpers
// ─────────────────────────────────────────────────────────────────

function getClientIp(req: IncomingMessage): string {
  // Check common proxy headers
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ip?.trim() ?? 'unknown';
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] ?? 'unknown' : realIp;
  }

  // Fall back to socket address
  return req.socket?.remoteAddress ?? 'unknown';
}

function parseUserAgent(userAgent: string | undefined): {
  deviceType: 'desktop' | 'mobile' | 'tablet' | undefined;
  browser: string | undefined;
  os: string | undefined;
} {
  if (!userAgent) {
    return { deviceType: undefined, browser: undefined, os: undefined };
  }

  const ua = userAgent.toLowerCase();

  // Device type
  let deviceType: 'desktop' | 'mobile' | 'tablet' | undefined;
  if (['mobile', 'android', 'iphone', 'ipod'].some((x) => ua.includes(x))) {
    deviceType = 'mobile';
  } else if (['ipad', 'tablet'].some((x) => ua.includes(x))) {
    deviceType = 'tablet';
  } else {
    deviceType = 'desktop';
  }

  // Browser detection
  let browser: string | undefined;
  if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('edg')) browser = 'Edge';
  else if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('safari')) browser = 'Safari';
  else if (ua.includes('opera') || ua.includes('opr')) browser = 'Opera';

  // OS detection
  let os: string | undefined;
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac os') || ua.includes('macos')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

  return { deviceType, browser, os };
}

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
          case 'connect': {
            const connectReq = body as ConnectRequest;
            // Enrich metadata with server-side info
            const clientIp = getClientIp(req);
            const userAgent = req.headers['user-agent'];
            const uaInfo = parseUserAgent(connectReq.metadata?.userAgent ?? userAgent);

            if (connectReq.metadata) {
              connectReq.metadata.ip = clientIp;
              connectReq.metadata.deviceType = connectReq.metadata.deviceType ?? uaInfo.deviceType;
              connectReq.metadata.browser = connectReq.metadata.browser ?? uaInfo.browser;
              connectReq.metadata.os = connectReq.metadata.os ?? uaInfo.os;
            } else {
              connectReq.metadata = {
                ip: clientIp,
                userAgent,
                ...uaInfo,
              };
            }

            result = await this.handleConnect(connectReq);
            break;
          }
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
          case 'read':
            result = await this.handleRead(body as ReadRequest);
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachWebSocket(server: any): void {
    this.wss = new WebSocketServer({
      server,
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

    // Try to resume existing session by sessionId
    if (request.sessionId) {
      session = await this.storage.getSession(request.sessionId);
    }

    // Try to find existing session by visitorId
    if (!session && this.storage.getSessionByVisitorId) {
      session = await this.storage.getSessionByVisitorId(request.visitorId);
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
    } else if (request.metadata) {
      // Update metadata for returning visitor (e.g., new page URL)
      if (session.metadata) {
        // Preserve server-side fields (IP, country, city)
        request.metadata.ip = session.metadata.ip ?? request.metadata.ip;
        request.metadata.country = session.metadata.country ?? request.metadata.country;
        request.metadata.city = session.metadata.city ?? request.metadata.city;
      }
      session.metadata = request.metadata;
      session.lastActivity = new Date();
      await this.storage.updateSession(session);
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

  async handleRead(request: ReadRequest): Promise<ReadResponse> {
    const session = await this.storage.getSession(request.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const status: MessageStatus = request.status ?? 'read';
    const now = new Date();
    let updated = 0;

    // Update message status in storage
    const messages = await this.storage.getMessages(request.sessionId);
    for (const msg of messages) {
      if (request.messageIds.includes(msg.id)) {
        msg.status = status;
        if (status === 'delivered') {
          msg.deliveredAt = now;
        } else if (status === 'read') {
          msg.deliveredAt = msg.deliveredAt ?? now;
          msg.readAt = now;
        }
        await this.storage.saveMessage(msg);
        updated++;
      }
    }

    // Broadcast to WebSocket clients
    this.broadcastToSession(request.sessionId, {
      type: 'read',
      data: {
        messageIds: request.messageIds,
        status,
        deliveredAt: status === 'delivered' ? now.toISOString() : undefined,
        readAt: status === 'read' ? now.toISOString() : undefined,
      },
    });

    // Notify bridges
    await this.notifyBridgesRead(request.sessionId, request.messageIds, status);

    return { updated };
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

  private async notifyBridgesRead(
    sessionId: string,
    messageIds: string[],
    status: MessageStatus
  ): Promise<void> {
    for (const bridge of this.bridges) {
      try {
        await bridge.onMessageRead?.(sessionId, messageIds, status);
      } catch (err) {
        console.error(`[PocketPing] Bridge ${bridge.name} read notification error:`, err);
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

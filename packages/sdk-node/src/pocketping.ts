import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { AnthropicProvider } from './ai/anthropic';
import { GeminiProvider } from './ai/gemini';
import { OpenAIProvider } from './ai/openai';
import type { AIProvider } from './ai/types';
import type { Bridge } from './bridges/types';
import { MemoryStorage } from './storage/memory';
import type { Storage } from './storage/types';
import type {
  Attachment,
  ConnectRequest,
  ConnectResponse,
  CustomEvent,
  CustomEventHandler,
  DeleteMessageRequest,
  DeleteMessageResponse,
  DisconnectRequest,
  DisconnectResponse,
  EditMessageRequest,
  EditMessageResponse,
  GetMessagesRequest,
  GetMessagesResponse,
  IdentifyRequest,
  IdentifyResponse,
  Message,
  MessageStatus,
  PocketPingConfig,
  PresenceResponse,
  ReadRequest,
  ReadResponse,
  SendMessageRequest,
  SendMessageResponse,
  Session,
  TypingRequest,
  UploadRequest,
  UploadResponse,
  VersionCheckResult,
  VersionStatus,
  VisibilityRequest,
  VisibilityResponse,
  WebhookPayload,
} from './types';
import { checkIpFilter, type IpFilterLogEvent } from './utils/ip-filter';
import { checkUaFilter, type UaFilterLogEvent } from './utils/user-agent-filter';

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
    return Array.isArray(realIp) ? (realIp[0] ?? 'unknown') : realIp;
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

// ─────────────────────────────────────────────────────────────────
// Version Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Parse semver version string to comparable array
 * @example "0.2.1" -> [0, 2, 1]
 */
function parseVersion(version: string): number[] {
  return version
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

/**
 * Compare two semver versions
 * @returns -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const vA = parseVersion(a);
  const vB = parseVersion(b);
  const len = Math.max(vA.length, vB.length);

  for (let i = 0; i < len; i++) {
    const numA = vA[i] ?? 0;
    const numB = vB[i] ?? 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────
// Attachment Constants
// ─────────────────────────────────────────────────────────────────

/** Maximum allowed attachment size in bytes (10 MB) */
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

/** Default allowed MIME types for attachments */
export const DEFAULT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'video/mp4',
  'audio/mpeg',
];

/** Default base URL for generated upload/access URLs */
export const DEFAULT_UPLOAD_BASE_URL = 'https://uploads.pocketping.local';

/** Upload URL time-to-live in seconds (15 minutes) */
export const UPLOAD_URL_TTL_SECONDS = 900;

/** Default system prompt used by the AI fallback when none is configured. */
export const DEFAULT_AI_SYSTEM_PROMPT =
  "You are a helpful customer support assistant. Be friendly, concise, and helpful. If you don't know something, say so and offer to connect them with a human.";

/** Default number of seconds before the AI takes over from offline operators. */
export const DEFAULT_AI_TAKEOVER_DELAY = 300;

export class PocketPing {
  private storage: Storage;
  private bridges: Bridge[];
  private config: PocketPingConfig;
  private wss: WebSocketServer | null = null;
  private sessionSockets: Map<string, Set<WebSocket>> = new Map();
  private operatorOnline = false;
  private eventHandlers: Map<string, Set<CustomEventHandler>> = new Map();
  private maxAttachmentSize: number;
  private allowedMimeTypes: string[];
  private uploadBaseUrl: string;

  // AI fallback
  private aiProvider: AIProvider | null;
  private aiSystemPrompt: string;
  private aiTakeoverDelay: number;
  /** Per-session last operator activity timestamp (ms epoch). */
  private lastOperatorActivity: Map<string, number> = new Map();

  constructor(config: PocketPingConfig = {}) {
    this.config = config;
    this.storage = this.initStorage(config.storage);
    this.bridges = config.bridges ?? [];
    this.maxAttachmentSize = config.maxAttachmentSize ?? MAX_ATTACHMENT_SIZE;
    this.allowedMimeTypes = config.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;
    this.uploadBaseUrl = (config.uploadBaseUrl ?? DEFAULT_UPLOAD_BASE_URL).replace(/\/+$/, '');

    this.aiProvider = this.resolveAiProvider(config);
    this.aiSystemPrompt = config.ai?.systemPrompt ?? DEFAULT_AI_SYSTEM_PROMPT;
    this.aiTakeoverDelay =
      config.aiTakeoverDelay ?? config.ai?.fallbackAfter ?? DEFAULT_AI_TAKEOVER_DELAY;
  }

  /**
   * Resolve an AIProvider instance from the config.
   * Accepts either a ready provider instance or a provider name + apiKey/model.
   */
  private resolveAiProvider(config: PocketPingConfig): AIProvider | null {
    const ai = config.ai;
    if (!ai?.provider) return null;

    // Already a provider instance
    if (typeof ai.provider !== 'string') {
      return ai.provider;
    }

    // Build a concrete provider from a name + apiKey
    if (!ai.apiKey) return null;
    switch (ai.provider) {
      case 'openai':
        return new OpenAIProvider({ apiKey: ai.apiKey, model: ai.model });
      case 'anthropic':
        return new AnthropicProvider({ apiKey: ai.apiKey, model: ai.model });
      case 'gemini':
        return new GeminiProvider({ apiKey: ai.apiKey, model: ai.model });
      default:
        return null;
    }
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

  middleware(): (
    req: IncomingMessage & { body?: unknown; query?: Record<string, string> },
    res: ServerResponse,
    next?: () => void
  ) => void {
    return async (req, res, next) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const path = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PocketPing-Version');
      res.setHeader(
        'Access-Control-Expose-Headers',
        'X-PocketPing-Version-Status, X-PocketPing-Min-Version, X-PocketPing-Latest-Version, X-PocketPing-Version-Message'
      );

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      // IP Filtering - block before processing
      if (this.config.ipFilter?.enabled) {
        const clientIp = getClientIp(req);
        const filterResult = await checkIpFilter(clientIp, this.config.ipFilter, {
          path: path,
        });

        if (!filterResult.allowed) {
          // Log blocked request
          if (this.config.ipFilter.logBlocked !== false) {
            const logEvent: IpFilterLogEvent = {
              type: 'blocked',
              ip: clientIp,
              reason: filterResult.reason,
              path: path,
              timestamp: new Date(),
            };

            if (this.config.ipFilter.logger) {
              this.config.ipFilter.logger(logEvent);
            } else {
              console.log(`[PocketPing] IP blocked: ${clientIp} - reason: ${filterResult.reason}`);
            }
          }

          res.statusCode = this.config.ipFilter.blockedStatusCode ?? 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: this.config.ipFilter.blockedMessage ?? 'Forbidden',
            })
          );
          return;
        }
      }

      // User-Agent Filtering - block bots before processing
      if (this.config.uaFilter?.enabled) {
        const userAgent = req.headers['user-agent'];
        const uaFilterResult = await checkUaFilter(userAgent, this.config.uaFilter, {
          path: path,
        });

        if (!uaFilterResult.allowed) {
          // Log blocked request
          if (this.config.uaFilter.logBlocked !== false) {
            const logEvent: UaFilterLogEvent = {
              type: 'blocked',
              userAgent: userAgent ?? 'unknown',
              reason: uaFilterResult.reason,
              matchedPattern: uaFilterResult.matchedPattern,
              path: path,
              timestamp: new Date(),
            };

            if (this.config.uaFilter.logger) {
              this.config.uaFilter.logger(logEvent);
            } else {
              console.log(
                `[PocketPing] UA blocked: ${userAgent} - reason: ${uaFilterResult.reason}${
                  uaFilterResult.matchedPattern ? ` (matched: ${uaFilterResult.matchedPattern})` : ''
                }`
              );
            }
          }

          res.statusCode = this.config.uaFilter.blockedStatusCode ?? 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: this.config.uaFilter.blockedMessage ?? 'Forbidden',
            })
          );
          return;
        }
      }

      // Check widget version
      const widgetVersion = req.headers['x-pocketping-version'] as string | undefined;
      const versionCheck = this.checkWidgetVersion(widgetVersion);

      // Set version warning headers
      this.setVersionHeaders(res, versionCheck);

      // If version is unsupported, reject the request
      if (!versionCheck.canContinue) {
        res.statusCode = 426; // Upgrade Required
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Widget version unsupported',
            message: versionCheck.message,
            minVersion: versionCheck.minVersion,
            upgradeUrl:
              this.config.versionUpgradeUrl || 'https://docs.pocketping.io/widget/installation',
          })
        );
        return;
      }

      try {
        const body = await this.parseBody(req);
        const query = Object.fromEntries(url.searchParams);

        let result: unknown;
        let sessionId: string | undefined;

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

            const connectResult = await this.handleConnect(connectReq);
            sessionId = connectResult.sessionId;
            result = connectResult;
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
          case 'identify':
            result = await this.handleIdentify(body as IdentifyRequest);
            break;
          case 'edit':
            result = await this.handleEditMessage(body as EditMessageRequest);
            break;
          case 'delete':
            result = await this.handleDeleteMessage(body as DeleteMessageRequest);
            break;
          case 'disconnect':
            result = await this.handleDisconnect(body as DisconnectRequest);
            break;
          case 'visibility':
            result = await this.handleVisibility(body as VisibilityRequest);
            break;
          case 'upload-request':
            result = await this.handleUploadRequest(body as UploadRequest);
            break;
          case 'upload-complete':
            result = await this.handleUploadComplete((body as { attachmentId: string }).attachmentId);
            break;
          case 'upload-failed':
            result = await this.handleUploadFailed((body as { attachmentId: string }).attachmentId);
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

        // Send version warning via WebSocket after connect (with slight delay to ensure WS is connected)
        if (sessionId && versionCheck.status !== 'ok') {
          setTimeout(() => {
            this.sendVersionWarning(sessionId!, versionCheck);
          }, 500);
        }
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
      path: '/pocketping/stream',
    });

    this.wss.on('connection', async (ws, req) => {
      // IP Filtering for WebSocket connections
      if (this.config.ipFilter?.enabled) {
        const clientIp = getClientIp(req);
        const filterResult = await checkIpFilter(clientIp, this.config.ipFilter, {
          path: '/pocketping/stream',
        });

        if (!filterResult.allowed) {
          if (this.config.ipFilter.logBlocked !== false) {
            const logEvent: IpFilterLogEvent = {
              type: 'blocked',
              ip: clientIp,
              reason: filterResult.reason,
              path: '/pocketping/stream',
              timestamp: new Date(),
            };

            if (this.config.ipFilter.logger) {
              this.config.ipFilter.logger(logEvent);
            } else {
              console.log(
                `[PocketPing] WS IP blocked: ${clientIp} - reason: ${filterResult.reason}`
              );
            }
          }

          ws.close(4003, this.config.ipFilter.blockedMessage ?? 'Forbidden');
          return;
        }
      }

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

  private async handleWebSocketMessage(
    sessionId: string,
    event: { type: string; data: unknown }
  ): Promise<void> {
    switch (event.type) {
      case 'typing':
        this.broadcastToSession(sessionId, {
          type: 'typing',
          data: event.data,
        });
        break;

      case 'event': {
        // Custom event from widget
        const customEvent = event.data as CustomEvent;
        customEvent.sessionId = sessionId;
        await this.handleCustomEvent(sessionId, customEvent);
        break;
      }
    }
  }

  private async handleCustomEvent(sessionId: string, event: CustomEvent): Promise<void> {
    const session = await this.storage.getSession(sessionId);
    if (!session) {
      console.warn(`[PocketPing] Event received for unknown session: ${sessionId}`);
      return;
    }

    // Call registered handlers for this event name
    const handlers = this.eventHandlers.get(event.name);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(event, session);
        } catch (err) {
          console.error(`[PocketPing] Event handler error for '${event.name}':`, err);
        }
      }
    }

    // Call wildcard handlers (listening to all events)
    const wildcardHandlers = this.eventHandlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          await handler(event, session);
        } catch (err) {
          console.error(`[PocketPing] Wildcard event handler error:`, err);
        }
      }
    }

    // Call config callback if defined
    await this.config.onEvent?.(event, session);

    // Notify bridges about the event
    await this.notifyBridgesEvent(event, session);

    // Forward to webhook if configured (fire and forget)
    this.forwardToWebhook(event, session);
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
        identity: request.identity,
      };
      await this.storage.createSession(session);

      // Notify bridges about new session
      await this.notifyBridges('new_session', session);

      // Callback
      await this.config.onNewSession?.(session);
    } else {
      let needsUpdate = false;

      // Update metadata for returning visitor (e.g., new page URL)
      if (request.metadata) {
        if (session.metadata) {
          // Preserve server-side fields (IP, country, city)
          request.metadata.ip = session.metadata.ip ?? request.metadata.ip;
          request.metadata.country = session.metadata.country ?? request.metadata.country;
          request.metadata.city = session.metadata.city ?? request.metadata.city;
        }
        session.metadata = request.metadata;
        needsUpdate = true;
      }

      // Update identity if provided
      if (request.identity) {
        session.identity = request.identity;
        needsUpdate = true;
      }

      if (needsUpdate) {
        session.lastActivity = new Date();
        await this.storage.updateSession(session);
      }
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

    // Link attachments to this message before persisting / notifying bridges
    const linked = await this.linkAttachments(message.id, request.attachmentIds);
    if (linked.length > 0) {
      message.attachments = linked;
    } else if (request.attachments && request.attachments.length > 0) {
      // Inline attachments (e.g. operator messages from bridges)
      message.attachments = request.attachments;
    }

    await this.storage.saveMessage(message);

    // Update session activity
    session.lastActivity = new Date();

    // Track operator activity for AI takeover detection; an operator reply
    // also disables the AI fallback for this session.
    if (request.sender === 'operator') {
      this.lastOperatorActivity.set(request.sessionId, Date.now());
      if (session.aiActive) {
        session.aiActive = false;
      }
    }

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

    // AI fallback: after a visitor message is persisted and bridges notified,
    // optionally let the configured AI provider respond when operators are away.
    if (request.sender === 'visitor') {
      await this.maybeAiRespond(session);
    }

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
      aiEnabled: this.aiProvider !== null,
      aiActiveAfter: this.aiTakeoverDelay,
    };
  }

  /** Whether an operator is currently online. */
  isOperatorOnline(): boolean {
    return this.operatorOnline;
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
    await this.notifyBridgesRead(request.sessionId, request.messageIds, status, session);

    return { updated };
  }

  // ─────────────────────────────────────────────────────────────────
  // User Identity
  // ─────────────────────────────────────────────────────────────────

  /**
   * Handle user identification from widget
   * Called when visitor calls PocketPing.identify()
   */
  async handleIdentify(request: IdentifyRequest): Promise<IdentifyResponse> {
    if (!request.identity?.id) {
      throw new Error('identity.id is required');
    }

    const session = await this.storage.getSession(request.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Update session with identity
    session.identity = request.identity;
    session.lastActivity = new Date();
    await this.storage.updateSession(session);

    // Notify bridges about identity update
    await this.notifyBridgesIdentity(session);

    // Callback
    await this.config.onIdentify?.(session);

    // Forward identity event to webhook
    this.forwardIdentityToWebhook(session);

    return { ok: true };
  }

  /**
   * Handle visitor disconnect (page unload or inactivity)
   * Notifies bridges and triggers callback
   */
  async handleDisconnect(request: DisconnectRequest): Promise<DisconnectResponse> {
    const session = await this.storage.getSession(request.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Format duration for display
    const formatDuration = (seconds: number): string => {
      if (seconds < 60) return `${seconds}s`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
    };

    const visitorName =
      session.identity?.name || session.identity?.email?.split('@')[0] || 'Visitor';
    const durationText = formatDuration(request.duration);
    const message = `👋 ${visitorName} left (was here for ${durationText})`;

    // Notify all bridges
    await this.notifyBridgesDisconnect(session, message);

    // Trigger callback
    await this.config.onVisitorDisconnect?.(session, request.duration);

    return { ok: true };
  }

  /**
   * Handle visibility change (tab focus/blur)
   * Used for inactivity tracking
   */
  async handleVisibility(request: VisibilityRequest): Promise<VisibilityResponse> {
    const session = await this.storage.getSession(request.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Update session last activity when visitor becomes visible again
    if (request.state === 'visible') {
      session.lastActivity = new Date();
      await this.storage.updateSession(session);
    }

    return { ok: true };
  }

  /**
   * Notify all bridges when visitor disconnects
   */
  private async notifyBridgesDisconnect(session: Session, message: string): Promise<void> {
    for (const bridge of this.bridges) {
      try {
        if ('notifyDisconnect' in bridge && typeof bridge.notifyDisconnect === 'function') {
          await (bridge as { notifyDisconnect: (session: Session, message: string) => Promise<void> }).notifyDisconnect(session, message);
        }
      } catch (error) {
        console.error(`[PocketPing] Bridge disconnect notification failed:`, error);
      }
    }
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<Session | null> {
    return this.storage.getSession(sessionId);
  }

  // ─────────────────────────────────────────────────────────────────
  // Message Edit/Delete
  // ─────────────────────────────────────────────────────────────────

  /**
   * Handle message edit from widget
   * Only the message sender can edit their own messages
   */
  async handleEditMessage(request: EditMessageRequest): Promise<EditMessageResponse> {
    const session = await this.storage.getSession(request.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const message = await this.storage.getMessage(request.messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    if (message.sessionId !== request.sessionId) {
      throw new Error('Message does not belong to this session');
    }

    if (message.deletedAt) {
      throw new Error('Cannot edit deleted message');
    }

    // Only visitor messages can be edited from widget
    if (message.sender !== 'visitor') {
      throw new Error('Cannot edit this message');
    }

    // Validate content
    if (!request.content || request.content.trim().length === 0) {
      throw new Error('Content is required');
    }

    if (request.content.length > 4000) {
      throw new Error('Content exceeds maximum length');
    }

    // Update message
    message.content = request.content.trim();
    message.editedAt = new Date();

    if (this.storage.updateMessage) {
      await this.storage.updateMessage(message);
    } else {
      // Fallback: save message again
      await this.storage.saveMessage(message);
    }

    // Sync edit to bridges
    await this.syncEditToBridges(message.id, message.content);

    // Broadcast to WebSocket clients
    this.broadcastToSession(request.sessionId, {
      type: 'message_edited',
      data: {
        messageId: message.id,
        content: message.content,
        editedAt: message.editedAt.toISOString(),
      },
    });

    return {
      message: {
        id: message.id,
        content: message.content,
        editedAt: message.editedAt.toISOString(),
      },
    };
  }

  /**
   * Handle message delete from widget
   * Only the message sender can delete their own messages
   */
  async handleDeleteMessage(request: DeleteMessageRequest): Promise<DeleteMessageResponse> {
    const session = await this.storage.getSession(request.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const message = await this.storage.getMessage(request.messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    if (message.sessionId !== request.sessionId) {
      throw new Error('Message does not belong to this session');
    }

    if (message.deletedAt) {
      throw new Error('Message already deleted');
    }

    // Only visitor messages can be deleted from widget
    if (message.sender !== 'visitor') {
      throw new Error('Cannot delete this message');
    }

    // Sync delete to bridges BEFORE soft delete (need bridge IDs)
    await this.syncDeleteToBridges(message.id);

    // Soft delete message
    message.deletedAt = new Date();

    if (this.storage.updateMessage) {
      await this.storage.updateMessage(message);
    } else {
      await this.storage.saveMessage(message);
    }

    // Broadcast to WebSocket clients
    this.broadcastToSession(request.sessionId, {
      type: 'message_deleted',
      data: {
        messageId: message.id,
        deletedAt: message.deletedAt.toISOString(),
      },
    });

    return { deleted: true };
  }

  // ─────────────────────────────────────────────────────────────────
  // File Attachments
  // ─────────────────────────────────────────────────────────────────

  /**
   * Handle an upload request from the widget.
   * Validates the session, MIME type and size, then creates a pending
   * attachment and returns a presigned upload URL.
   */
  async handleUploadRequest(request: UploadRequest): Promise<UploadResponse> {
    // Fail fast if the storage cannot persist attachments — otherwise we would
    // hand back an attachmentId/uploadUrl that upload-complete can never resolve.
    if (!this.storage.saveAttachment) {
      throw new Error('Storage does not support attachments');
    }

    const session = await this.storage.getSession(request.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (!this.allowedMimeTypes.includes(request.mimeType)) {
      throw new Error(`Invalid mime type: ${request.mimeType}`);
    }

    if (request.size <= 0 || request.size > this.maxAttachmentSize) {
      throw new Error(
        `File too large: ${request.size} bytes (max ${this.maxAttachmentSize} bytes)`
      );
    }

    const id = this.generateId();
    const now = new Date();
    const url = `${this.uploadBaseUrl}/${id}`;

    const attachment: Attachment = {
      id,
      messageId: null,
      filename: request.filename,
      mimeType: request.mimeType,
      size: request.size,
      url,
      thumbnailUrl: null,
      status: 'pending',
      createdAt: now,
      uploadedFrom: 'widget',
    };

    if (this.storage.saveAttachment) {
      await this.storage.saveAttachment(attachment);
    }

    return {
      attachmentId: id,
      uploadUrl: url,
      expiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  /**
   * Mark an attachment as ready after the upload completes.
   */
  async handleUploadComplete(attachmentId: string): Promise<Attachment> {
    if (!this.storage.getAttachment) {
      throw new Error('Storage does not support attachments');
    }

    const attachment = await this.storage.getAttachment(attachmentId);
    if (!attachment) {
      throw new Error('Attachment not found');
    }

    attachment.status = 'ready';
    if (this.storage.updateAttachment) {
      await this.storage.updateAttachment(attachment);
    }

    return attachment;
  }

  /**
   * Mark an attachment as failed (e.g. when the upload errors out).
   */
  async handleUploadFailed(attachmentId: string): Promise<Attachment> {
    if (!this.storage.getAttachment) {
      throw new Error('Storage does not support attachments');
    }

    const attachment = await this.storage.getAttachment(attachmentId);
    if (!attachment) {
      throw new Error('Attachment not found');
    }

    attachment.status = 'failed';
    if (this.storage.updateAttachment) {
      await this.storage.updateAttachment(attachment);
    }

    return attachment;
  }

  /**
   * Link previously-uploaded attachments to a message.
   * Sets each attachment's messageId and returns the linked attachments.
   */
  private async linkAttachments(
    messageId: string,
    attachmentIds?: string[]
  ): Promise<Attachment[]> {
    if (!attachmentIds || attachmentIds.length === 0) return [];
    if (!this.storage.getAttachment) return [];

    const linked: Attachment[] = [];
    for (const id of attachmentIds) {
      const attachment = await this.storage.getAttachment(id);
      if (!attachment) continue;
      attachment.messageId = messageId;
      if (this.storage.updateAttachment) {
        await this.storage.updateAttachment(attachment);
      }
      linked.push(attachment);
    }
    return linked;
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
  // Custom Events (bidirectional)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Subscribe to custom events from widgets
   * @param eventName - The name of the event to listen for, or '*' for all events
   * @param handler - Callback function when event is received
   * @returns Unsubscribe function
   * @example
   * // Listen for specific event
   * pp.onEvent('clicked_pricing', async (event, session) => {
   *   console.log(`User ${session.visitorId} clicked pricing: ${event.data?.plan}`)
   * })
   *
   * // Listen for all events
   * pp.onEvent('*', async (event, session) => {
   *   console.log(`Event: ${event.name}`, event.data)
   * })
   */
  onEvent(eventName: string, handler: CustomEventHandler): () => void {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, new Set());
    }
    this.eventHandlers.get(eventName)!.add(handler);

    return () => {
      this.eventHandlers.get(eventName)?.delete(handler);
    };
  }

  /**
   * Unsubscribe from a custom event
   * @param eventName - The name of the event
   * @param handler - The handler to remove
   */
  offEvent(eventName: string, handler: CustomEventHandler): void {
    this.eventHandlers.get(eventName)?.delete(handler);
  }

  /**
   * Send a custom event to a specific widget/session
   * @param sessionId - The session ID to send the event to
   * @param eventName - The name of the event
   * @param data - Optional payload to send with the event
   * @example
   * // Send a promotion offer to a specific user
   * pp.emitEvent('session-123', 'show_offer', {
   *   discount: 20,
   *   code: 'SAVE20',
   *   message: 'Special offer just for you!'
   * })
   */
  emitEvent(sessionId: string, eventName: string, data?: Record<string, unknown>): void {
    const event: CustomEvent = {
      name: eventName,
      data,
      timestamp: new Date().toISOString(),
      sessionId,
    };

    this.broadcastToSession(sessionId, {
      type: 'event',
      data: event,
    });
  }

  /**
   * Broadcast a custom event to all connected widgets
   * @param eventName - The name of the event
   * @param data - Optional payload to send with the event
   * @example
   * // Notify all users about maintenance
   * pp.broadcastEvent('maintenance_warning', {
   *   message: 'Site will be down for maintenance in 5 minutes'
   * })
   */
  broadcastEvent(eventName: string, data?: Record<string, unknown>): void {
    const event: CustomEvent = {
      name: eventName,
      data,
      timestamp: new Date().toISOString(),
    };

    for (const sessionId of this.sessionSockets.keys()) {
      event.sessionId = sessionId;
      this.broadcastToSession(sessionId, {
        type: 'event',
        data: event,
      });
    }
  }

  /**
   * Process a custom event server-side (runs handlers, bridges, webhooks)
   * Useful for server-side automation or triggering events programmatically
   * @param sessionId - The session ID to associate with the event
   * @param eventName - The name of the event
   * @param data - Optional payload for the event
   * @example
   * // Trigger event from backend logic (e.g., after purchase)
   * await pp.triggerEvent('session-123', 'purchase_completed', {
   *   orderId: 'order-456',
   *   amount: 99.99
   * })
   */
  async triggerEvent(
    sessionId: string,
    eventName: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    const event: CustomEvent = {
      name: eventName,
      data,
      timestamp: new Date().toISOString(),
      sessionId,
    };
    await this.handleCustomEvent(sessionId, event);
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
          case 'message': {
            const message = args[0] as Message;
            const session = args[1] as Session;
            const result = await bridge.onVisitorMessage?.(message, session);

            // Save bridge message ID if returned and storage supports it
            if (result?.messageId && this.storage.saveBridgeMessageIds) {
              const bridgeIds: Record<string, unknown> = {};
              if (bridge.name === 'telegram') {
                bridgeIds.telegramMessageId = result.messageId;
              } else if (bridge.name === 'discord') {
                bridgeIds.discordMessageId = result.messageId;
              } else if (bridge.name === 'slack') {
                bridgeIds.slackMessageTs = result.messageId;
              }
              await this.storage.saveBridgeMessageIds(
                message.id,
                bridgeIds as import('./storage/types').BridgeMessageIds
              );
            }
            break;
          }
        }
      } catch (err) {
        console.error(`[PocketPing] Bridge ${bridge.name} error:`, err);
      }
    }
  }

  private async notifyBridgesRead(
    sessionId: string,
    messageIds: string[],
    status: MessageStatus,
    session: Session
  ): Promise<void> {
    for (const bridge of this.bridges) {
      try {
        await bridge.onMessageRead?.(sessionId, messageIds, status, session);
      } catch (err) {
        console.error(`[PocketPing] Bridge ${bridge.name} read notification error:`, err);
      }
    }
  }

  private async notifyBridgesEvent(event: CustomEvent, session: Session): Promise<void> {
    for (const bridge of this.bridges) {
      try {
        await bridge.onCustomEvent?.(event, session);
      } catch (err) {
        console.error(`[PocketPing] Bridge ${bridge.name} event notification error:`, err);
      }
    }
  }

  private async notifyBridgesIdentity(session: Session): Promise<void> {
    for (const bridge of this.bridges) {
      try {
        await bridge.onIdentityUpdate?.(session);
      } catch (err) {
        console.error(`[PocketPing] Bridge ${bridge.name} identity notification error:`, err);
      }
    }
  }

  /**
   * Notify bridges of an operator (or AI) message via the operator-message path,
   * so it shows up in Telegram/Discord/Slack just like a human operator reply.
   */
  private async notifyBridgesOperatorMessage(
    message: Message,
    session: Session,
    sourceBridge: string,
    operatorName: string
  ): Promise<void> {
    for (const bridge of this.bridges) {
      try {
        await bridge.onOperatorMessage?.(message, session, sourceBridge, operatorName);
      } catch (err) {
        console.error(`[PocketPing] Bridge ${bridge.name} operator message error:`, err);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // AI Fallback
  // ─────────────────────────────────────────────────────────────────

  /**
   * Maybe generate an AI reply for a session after a visitor message.
   *
   * Triggers an AI response when ALL of the following hold:
   *  1. an AI provider is configured;
   *  2. no operator is currently online;
   *  3. takeover is due — the takeover delay is <= 0, or the elapsed time since
   *     the last operator activity for this session is >= the takeover delay.
   *     If no operator activity has ever been recorded for the session, takeover
   *     is treated as due (the operator never showed up).
   *
   * Errors from the provider are logged and swallowed so message handling never
   * crashes because of the AI fallback.
   */
  private async maybeAiRespond(session: Session): Promise<void> {
    if (!this.aiProvider) return;
    if (this.isOperatorOnline()) return;
    if (!this.isAiTakeoverDue(session.id)) return;

    // Mark the session as AI-active and persist it.
    session.aiActive = true;
    await this.storage.updateSession(session);

    let reply = '';
    try {
      const messages = await this.storage.getMessages(session.id);
      reply = await this.aiProvider.generateResponse(messages, this.aiSystemPrompt);
    } catch (err) {
      console.error('[PocketPing] AI response error:', err);
      return;
    }

    if (!reply) return;

    const aiMessage: Message = {
      id: this.generateId(),
      sessionId: session.id,
      content: reply,
      sender: 'ai',
      timestamp: new Date(),
    };

    await this.storage.saveMessage(aiMessage);

    // Broadcast to widget clients.
    this.broadcastToSession(session.id, {
      type: 'message',
      data: aiMessage,
    });

    // Surface the AI reply on bridges via the operator-message path.
    await this.notifyBridgesOperatorMessage(aiMessage, session, 'ai', 'AI');

    // Callback
    await this.config.onMessage?.(aiMessage, session);
  }

  /**
   * Whether AI takeover is due for the given session based on the configured
   * takeover delay and the last recorded operator activity for that session.
   */
  private isAiTakeoverDue(sessionId: string): boolean {
    if (this.aiTakeoverDelay <= 0) return true;

    const lastActivity = this.lastOperatorActivity.get(sessionId);
    // No operator has ever acted on this session -> takeover is due.
    if (lastActivity === undefined) return true;

    const elapsedSeconds = (Date.now() - lastActivity) / 1000;
    return elapsedSeconds >= this.aiTakeoverDelay;
  }

  /**
   * Sync message edit to all bridges that support it
   */
  private async syncEditToBridges(messageId: string, newContent: string): Promise<void> {
    if (!this.storage.getBridgeMessageIds) {
      return; // Storage doesn't support bridge message IDs
    }

    const bridgeIds = await this.storage.getBridgeMessageIds(messageId);
    if (!bridgeIds) {
      return;
    }

    for (const bridge of this.bridges) {
      if (!bridge.onMessageEdit) continue;

      try {
        let bridgeMessageId: string | number | undefined;

        // Get the bridge-specific message ID
        if (bridge.name === 'telegram' && bridgeIds.telegramMessageId) {
          bridgeMessageId = bridgeIds.telegramMessageId;
        } else if (bridge.name === 'discord' && bridgeIds.discordMessageId) {
          bridgeMessageId = bridgeIds.discordMessageId;
        } else if (bridge.name === 'slack' && bridgeIds.slackMessageTs) {
          bridgeMessageId = bridgeIds.slackMessageTs;
        }

        if (bridgeMessageId) {
          await bridge.onMessageEdit(messageId, newContent, bridgeMessageId);
        }
      } catch (err) {
        console.error(`[PocketPing] Bridge ${bridge.name} edit sync error:`, err);
      }
    }
  }

  /**
   * Sync message delete to all bridges that support it
   */
  private async syncDeleteToBridges(messageId: string): Promise<void> {
    if (!this.storage.getBridgeMessageIds) {
      return;
    }

    const bridgeIds = await this.storage.getBridgeMessageIds(messageId);
    if (!bridgeIds) {
      return;
    }

    for (const bridge of this.bridges) {
      if (!bridge.onMessageDelete) continue;

      try {
        let bridgeMessageId: string | number | undefined;

        if (bridge.name === 'telegram' && bridgeIds.telegramMessageId) {
          bridgeMessageId = bridgeIds.telegramMessageId;
        } else if (bridge.name === 'discord' && bridgeIds.discordMessageId) {
          bridgeMessageId = bridgeIds.discordMessageId;
        } else if (bridge.name === 'slack' && bridgeIds.slackMessageTs) {
          bridgeMessageId = bridgeIds.slackMessageTs;
        }

        if (bridgeMessageId) {
          await bridge.onMessageDelete(messageId, bridgeMessageId);
        }
      } catch (err) {
        console.error(`[PocketPing] Bridge ${bridge.name} delete sync error:`, err);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Webhook Forwarding
  // ─────────────────────────────────────────────────────────────────

  /**
   * Forward custom event to configured webhook URL (non-blocking)
   * Used for integrations with Zapier, Make, n8n, or custom backends
   */
  private forwardToWebhook(event: CustomEvent, session: Session): void {
    if (!this.config.webhookUrl) return;

    const payload: WebhookPayload = {
      event,
      session: {
        id: session.id,
        visitorId: session.visitorId,
        metadata: session.metadata,
        identity: session.identity,
      },
      sentAt: new Date().toISOString(),
    };

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add HMAC signature if secret is configured
    if (this.config.webhookSecret) {
      const signature = createHmac('sha256', this.config.webhookSecret).update(body).digest('hex');
      headers['X-PocketPing-Signature'] = `sha256=${signature}`;
    }

    const timeout = this.config.webhookTimeout ?? 5000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    fetch(this.config.webhookUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
      .then((response) => {
        clearTimeout(timeoutId);
        if (!response.ok) {
          console.error(`[PocketPing] Webhook returned ${response.status}: ${response.statusText}`);
        }
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          console.error(`[PocketPing] Webhook timed out after ${timeout}ms`);
        } else {
          console.error(`[PocketPing] Webhook error:`, err.message);
        }
      });
  }

  /**
   * Forward identity update to webhook as a special event
   */
  private forwardIdentityToWebhook(session: Session): void {
    if (!this.config.webhookUrl || !session.identity) return;

    const event: CustomEvent = {
      name: 'identify',
      data: session.identity as Record<string, unknown>,
      timestamp: new Date().toISOString(),
      sessionId: session.id,
    };

    this.forwardToWebhook(event, session);
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

  // ─────────────────────────────────────────────────────────────────
  // Version Management
  // ─────────────────────────────────────────────────────────────────

  /**
   * Check widget version against configured min/latest versions
   * @param widgetVersion - Version from X-PocketPing-Version header
   * @returns Version check result with status and headers to set
   */
  checkWidgetVersion(widgetVersion: string | undefined): VersionCheckResult {
    // No version header = unknown (treat as outdated for logging)
    if (!widgetVersion) {
      return {
        status: 'ok',
        canContinue: true,
      };
    }

    const { minWidgetVersion, latestWidgetVersion } = this.config;

    // No version constraints configured
    if (!minWidgetVersion && !latestWidgetVersion) {
      return {
        status: 'ok',
        canContinue: true,
      };
    }

    let status: VersionStatus = 'ok';
    let message: string | undefined;
    let canContinue = true;

    // Check against minimum version
    if (minWidgetVersion && compareVersions(widgetVersion, minWidgetVersion) < 0) {
      // Widget is older than minimum supported
      status = 'unsupported';
      message =
        this.config.versionWarningMessage ||
        `Widget version ${widgetVersion} is no longer supported. Minimum version: ${minWidgetVersion}`;
      canContinue = false;
    }
    // Check against latest version (for deprecation warnings)
    else if (latestWidgetVersion && compareVersions(widgetVersion, latestWidgetVersion) < 0) {
      // Widget is older than latest (but still supported)
      const majorDiff = parseVersion(latestWidgetVersion)[0] - parseVersion(widgetVersion)[0];

      if (majorDiff >= 1) {
        // Major version behind = deprecated
        status = 'deprecated';
        message =
          this.config.versionWarningMessage ||
          `Widget version ${widgetVersion} is deprecated. Please update to ${latestWidgetVersion}`;
      } else {
        // Minor/patch behind = just outdated (info only)
        status = 'outdated';
        message = `A newer widget version ${latestWidgetVersion} is available`;
      }
    }

    return {
      status,
      message,
      minVersion: minWidgetVersion,
      latestVersion: latestWidgetVersion,
      canContinue,
    };
  }

  /**
   * Set version warning headers on HTTP response
   */
  private setVersionHeaders(res: ServerResponse, versionCheck: VersionCheckResult): void {
    if (versionCheck.status !== 'ok') {
      res.setHeader('X-PocketPing-Version-Status', versionCheck.status);
      if (versionCheck.minVersion) {
        res.setHeader('X-PocketPing-Min-Version', versionCheck.minVersion);
      }
      if (versionCheck.latestVersion) {
        res.setHeader('X-PocketPing-Latest-Version', versionCheck.latestVersion);
      }
      if (versionCheck.message) {
        res.setHeader('X-PocketPing-Version-Message', versionCheck.message);
      }
    }
  }

  /**
   * Send version warning via WebSocket to a session
   */
  sendVersionWarning(sessionId: string, versionCheck: VersionCheckResult): void {
    if (versionCheck.status === 'ok') return;

    this.broadcastToSession(sessionId, {
      type: 'version_warning',
      data: {
        severity:
          versionCheck.status === 'unsupported'
            ? 'error'
            : versionCheck.status === 'deprecated'
              ? 'warning'
              : 'info',
        message: versionCheck.message,
        currentVersion: 'unknown', // Will be filled by widget
        minVersion: versionCheck.minVersion,
        latestVersion: versionCheck.latestVersion,
        canContinue: versionCheck.canContinue,
        upgradeUrl:
          this.config.versionUpgradeUrl || 'https://docs.pocketping.io/widget/installation',
      },
    });
  }
}

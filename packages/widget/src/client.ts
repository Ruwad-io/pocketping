import type {
  PocketPingConfig,
  Message,
  MessageStatus,
  Session,
  ConnectResponse,
  SendMessageResponse,
  PresenceResponse,
  WebSocketEvent,
  CustomEvent,
  CustomEventHandler,
  VersionWarning,
} from './types';
import { VERSION } from './version';

type Listener<T> = (data: T) => void;

export class PocketPingClient {
  private config: PocketPingConfig;
  private session: Session | null = null;
  private ws: WebSocket | null = null;
  private isOpen = false;
  private listeners: Map<string, Set<Listener<unknown>>> = new Map();
  private customEventHandlers: Map<string, Set<CustomEventHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: PocketPingConfig) {
    this.config = config;
  }

  // ─────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────

  async connect(): Promise<Session> {
    const visitorId = this.getOrCreateVisitorId();
    const storedSessionId = this.getStoredSessionId();

    const response = await this.fetch<ConnectResponse>('/connect', {
      method: 'POST',
      body: JSON.stringify({
        visitorId,
        sessionId: storedSessionId,
        metadata: {
          url: window.location.href,
          referrer: document.referrer || undefined,
          pageTitle: document.title || undefined,
          userAgent: navigator.userAgent,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: navigator.language,
          screenResolution: `${window.screen.width}x${window.screen.height}`,
        },
      }),
    });

    this.session = {
      sessionId: response.sessionId,
      visitorId: response.visitorId,
      operatorOnline: response.operatorOnline ?? false,
      messages: response.messages ?? [],
    };

    // Store session
    this.storeSessionId(response.sessionId);

    // Connect WebSocket for real-time updates
    this.connectWebSocket();

    // Notify
    this.emit('connect', this.session);
    this.config.onConnect?.(response.sessionId);

    return this.session;
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.session = null;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
  }

  async sendMessage(content: string): Promise<Message> {
    if (!this.session) {
      throw new Error('Not connected');
    }

    // Create temporary message with 'sending' status
    const tempId = `temp-${this.generateId()}`;
    const tempMessage: Message = {
      id: tempId,
      sessionId: this.session.sessionId,
      content,
      sender: 'visitor',
      timestamp: new Date().toISOString(),
      status: 'sending',
    };

    // Add to local state immediately for instant UI feedback
    this.session.messages.push(tempMessage);
    this.emit('message', tempMessage);

    try {
      const response = await this.fetch<SendMessageResponse>('/message', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: this.session.sessionId,
          content,
          sender: 'visitor',
        }),
      });

      // Update the temporary message with real ID and 'sent' status
      const messageIndex = this.session.messages.findIndex((m) => m.id === tempId);
      if (messageIndex >= 0) {
        this.session.messages[messageIndex].id = response.messageId;
        this.session.messages[messageIndex].timestamp = response.timestamp;
        this.session.messages[messageIndex].status = 'sent';

        // Emit to trigger re-render with updated status
        this.emit('message', this.session.messages[messageIndex]);
      }

      const message = this.session.messages[messageIndex] || {
        id: response.messageId,
        sessionId: this.session.sessionId,
        content,
        sender: 'visitor',
        timestamp: response.timestamp,
        status: 'sent',
      };

      this.config.onMessage?.(message);
      return message;
    } catch (error) {
      // Remove failed message from local state
      const messageIndex = this.session.messages.findIndex((m) => m.id === tempId);
      if (messageIndex >= 0) {
        this.session.messages.splice(messageIndex, 1);
        this.emit('message', tempMessage); // Trigger re-render
      }
      throw error;
    }
  }

  async fetchMessages(after?: string): Promise<Message[]> {
    if (!this.session) {
      throw new Error('Not connected');
    }

    const params = new URLSearchParams({
      sessionId: this.session.sessionId,
    });
    if (after) {
      params.set('after', after);
    }

    const response = await this.fetch<{ messages: Message[] }>(
      `/messages?${params}`,
      { method: 'GET' }
    );

    return response.messages;
  }

  async sendTyping(isTyping = true): Promise<void> {
    if (!this.session) return;

    await this.fetch('/typing', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: this.session.sessionId,
        sender: 'visitor',
        isTyping,
      }),
    });
  }

  async sendReadStatus(messageIds: string[], status: MessageStatus): Promise<void> {
    if (!this.session || messageIds.length === 0) return;

    try {
      await this.fetch('/read', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: this.session.sessionId,
          messageIds,
          status,
        }),
      });

      // Update local message status
      for (const msg of this.session.messages) {
        if (messageIds.includes(msg.id)) {
          msg.status = status;
          if (status === 'delivered') {
            msg.deliveredAt = new Date().toISOString();
          } else if (status === 'read') {
            msg.readAt = new Date().toISOString();
          }
        }
      }

      this.emit('readStatusSent', { messageIds, status });
    } catch (err) {
      console.error('[PocketPing] Failed to send read status:', err);
    }
  }

  async getPresence(): Promise<PresenceResponse> {
    return this.fetch<PresenceResponse>('/presence', { method: 'GET' });
  }

  // ─────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────

  getSession(): Session | null {
    return this.session;
  }

  getMessages(): Message[] {
    return this.session?.messages ?? [];
  }

  isConnected(): boolean {
    return this.session !== null;
  }

  isWidgetOpen(): boolean {
    return this.isOpen;
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.emit('openChange', open);
    if (open) {
      this.config.onOpen?.();
    } else {
      this.config.onClose?.();
    }
  }

  toggleOpen(): void {
    this.setOpen(!this.isOpen);
  }

  // ─────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────

  on<T>(event: string, listener: Listener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as Listener<unknown>);

    return () => {
      this.listeners.get(event)?.delete(listener as Listener<unknown>);
    };
  }

  private emit(event: string, data: unknown): void {
    this.listeners.get(event)?.forEach((listener) => listener(data));
  }

  // ─────────────────────────────────────────────────────────────────
  // Custom Events (bidirectional)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Trigger a custom event to the backend
   * @param eventName - The name of the event (e.g., 'clicked_pricing', 'viewed_demo')
   * @param data - Optional payload to send with the event
   * @example
   * PocketPing.trigger('clicked_cta', { button: 'signup', page: '/pricing' })
   */
  trigger(eventName: string, data?: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[PocketPing] Cannot trigger event: WebSocket not connected');
      return;
    }

    const event: CustomEvent = {
      name: eventName,
      data,
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify({
      type: 'event',
      data: event,
    }));

    // Also emit locally for any local listeners
    this.emit(`event:${eventName}`, event);
  }

  /**
   * Subscribe to custom events from the backend
   * @param eventName - The name of the event to listen for (e.g., 'show_offer', 'open_chat')
   * @param handler - Callback function when event is received
   * @returns Unsubscribe function
   * @example
   * const unsubscribe = PocketPing.onEvent('show_offer', (data) => {
   *   showPopup(data.message)
   * })
   */
  onEvent(eventName: string, handler: CustomEventHandler): () => void {
    if (!this.customEventHandlers.has(eventName)) {
      this.customEventHandlers.set(eventName, new Set());
    }
    this.customEventHandlers.get(eventName)!.add(handler);

    return () => {
      this.customEventHandlers.get(eventName)?.delete(handler);
    };
  }

  /**
   * Unsubscribe from a custom event
   * @param eventName - The name of the event
   * @param handler - The handler to remove
   */
  offEvent(eventName: string, handler: CustomEventHandler): void {
    this.customEventHandlers.get(eventName)?.delete(handler);
  }

  private emitCustomEvent(event: CustomEvent): void {
    const handlers = this.customEventHandlers.get(event.name);
    if (handlers) {
      handlers.forEach((handler) => handler(event.data, event));
    }

    // Also emit to generic 'event' listeners
    this.emit('event', event);
    this.emit(`event:${event.name}`, event);
  }

  // ─────────────────────────────────────────────────────────────────
  // WebSocket
  // ─────────────────────────────────────────────────────────────────

  private connectWebSocket(): void {
    if (!this.session) return;

    const wsUrl = this.config.endpoint
      .replace(/^http/, 'ws')
      .replace(/\/$/, '') + `/stream?sessionId=${this.session.sessionId}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.emit('wsConnected', null);
      };

      this.ws.onmessage = (event) => {
        try {
          const wsEvent: WebSocketEvent = JSON.parse(event.data);
          this.handleWebSocketEvent(wsEvent);
        } catch (err) {
          console.error('[PocketPing] Failed to parse WS message:', err);
        }
      };

      this.ws.onclose = () => {
        this.emit('wsDisconnected', null);
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[PocketPing] WebSocket error:', err);
      };
    } catch (err) {
      // WebSocket not supported or blocked, fall back to polling
      console.warn('[PocketPing] WebSocket unavailable, using polling');
      this.startPolling();
    }
  }

  private handleWebSocketEvent(event: WebSocketEvent): void {
    switch (event.type) {
      case 'message':
        const message = event.data as Message;
        if (this.session) {
          // First, try to find by exact ID
          let existingIndex = this.session.messages.findIndex((m) => m.id === message.id);

          // If not found and it's a visitor message, look for a pending temp message
          // This handles the race condition where WS arrives before HTTP response
          if (existingIndex < 0 && message.sender === 'visitor') {
            existingIndex = this.session.messages.findIndex(
              (m) => m.id.startsWith('temp-') && m.content === message.content && m.sender === 'visitor'
            );
            // Update the temp ID to the real server ID
            if (existingIndex >= 0) {
              this.session.messages[existingIndex].id = message.id;
            }
          }

          // For operator/AI messages, also check for duplicates by content (within 2 seconds)
          if (existingIndex < 0 && message.sender !== 'visitor') {
            const msgTime = new Date(message.timestamp).getTime();
            existingIndex = this.session.messages.findIndex(
              (m) =>
                m.sender === message.sender &&
                m.content === message.content &&
                Math.abs(new Date(m.timestamp).getTime() - msgTime) < 2000
            );
          }

          if (existingIndex >= 0) {
            // Update existing message (status update from server)
            const existing = this.session.messages[existingIndex];
            if (message.status && message.status !== existing.status) {
              existing.status = message.status;
              if (message.deliveredAt) existing.deliveredAt = message.deliveredAt;
              if (message.readAt) existing.readAt = message.readAt;
              // Emit read event to trigger UI update
              this.emit('read', { messageIds: [message.id], status: message.status });
            }
          } else {
            // Add new message (operator/AI messages)
            this.session.messages.push(message);
            this.emit('message', message);
            this.config.onMessage?.(message);
          }
        }
        // Clear typing indicator when operator/AI sends a message
        if (message.sender !== 'visitor') {
          this.emit('typing', { isTyping: false });
        }
        break;

      case 'typing':
        // Only show typing indicator if it's from operator/AI, not visitor
        const typingData = event.data as { isTyping: boolean; sender?: string };
        if (typingData.sender !== 'visitor') {
          this.emit('typing', { isTyping: typingData.isTyping });
        }
        break;

      case 'presence':
        if (this.session) {
          this.session.operatorOnline = (event.data as { online: boolean }).online;
        }
        this.emit('presence', event.data);
        break;

      case 'ai_takeover':
        this.emit('aiTakeover', event.data);
        break;

      case 'read':
        const readData = event.data as { messageIds: string[]; status: MessageStatus; readAt?: string; deliveredAt?: string };
        if (this.session) {
          for (const msg of this.session.messages) {
            if (readData.messageIds.includes(msg.id)) {
              msg.status = readData.status;
              if (readData.deliveredAt) msg.deliveredAt = readData.deliveredAt;
              if (readData.readAt) msg.readAt = readData.readAt;
            }
          }
        }
        this.emit('read', readData);
        break;

      case 'event':
        // Custom event from backend
        const customEvent = event.data as CustomEvent;
        this.emitCustomEvent(customEvent);
        break;

      case 'version_warning':
        // Version mismatch warning from backend
        const versionWarning = event.data as VersionWarning;
        this.handleVersionWarning(versionWarning);
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Version Management
  // ─────────────────────────────────────────────────────────────────

  private handleVersionWarning(warning: VersionWarning): void {
    // Console output based on severity
    const prefix = '[PocketPing]';
    const upgradeHint = warning.upgradeUrl
      ? ` Upgrade: ${warning.upgradeUrl}`
      : ' Update your widget to the latest version.';

    switch (warning.severity) {
      case 'error':
        console.error(`${prefix} 🚨 VERSION ERROR: ${warning.message}${upgradeHint}`);
        console.error(`${prefix} Current: ${warning.currentVersion}, Required: ${warning.minVersion || 'unknown'}`);
        break;
      case 'warning':
        console.warn(`${prefix} ⚠️ VERSION WARNING: ${warning.message}${upgradeHint}`);
        console.warn(`${prefix} Current: ${warning.currentVersion}, Latest: ${warning.latestVersion || 'unknown'}`);
        break;
      case 'info':
        console.info(`${prefix} ℹ️ ${warning.message}`);
        break;
    }

    // Emit event for application handlers
    this.emit('versionWarning', warning);

    // Call config callback if provided
    this.config.onVersionWarning?.(warning);

    // If critical, prevent further operation
    if (!warning.canContinue) {
      console.error(`${prefix} Widget is incompatible with backend. Please update immediately.`);
      this.disconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[PocketPing] Max reconnect attempts reached, switching to polling');
      this.startPolling();
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  private startPolling(): void {
    // Fallback polling implementation
    const poll = async () => {
      if (!this.session) return;

      try {
        const lastMessageId = this.session.messages[this.session.messages.length - 1]?.id;
        const newMessages = await this.fetchMessages(lastMessageId);

        for (const message of newMessages) {
          if (!this.session.messages.find((m) => m.id === message.id)) {
            this.session.messages.push(message);
            this.emit('message', message);
            this.config.onMessage?.(message);
          }
        }
      } catch (err) {
        console.error('[PocketPing] Polling error:', err);
      }

      if (this.session) {
        setTimeout(poll, 3000);
      }
    };

    poll();
  }

  // ─────────────────────────────────────────────────────────────────
  // HTTP
  // ─────────────────────────────────────────────────────────────────

  private async fetch<T>(path: string, options: RequestInit): Promise<T> {
    const url = this.config.endpoint.replace(/\/$/, '') + path;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-PocketPing-Version': VERSION,
        ...options.headers,
      },
    });

    // Check for version warnings in response headers
    this.checkVersionHeaders(response);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`PocketPing API error: ${response.status} ${error}`);
    }

    return response.json();
  }

  private checkVersionHeaders(response: Response): void {
    const versionStatus = response.headers.get('X-PocketPing-Version-Status');
    const minVersion = response.headers.get('X-PocketPing-Min-Version');
    const latestVersion = response.headers.get('X-PocketPing-Latest-Version');
    const versionMessage = response.headers.get('X-PocketPing-Version-Message');

    if (!versionStatus || versionStatus === 'ok') {
      return;
    }

    // Parse severity from status
    let severity: 'info' | 'warning' | 'error' = 'info';
    let canContinue = true;

    if (versionStatus === 'deprecated') {
      severity = 'warning';
    } else if (versionStatus === 'unsupported') {
      severity = 'error';
      canContinue = false;
    } else if (versionStatus === 'outdated') {
      severity = 'info';
    }

    const warning: VersionWarning = {
      severity,
      message: versionMessage || `Widget version ${VERSION} is ${versionStatus}`,
      currentVersion: VERSION,
      minVersion: minVersion || undefined,
      latestVersion: latestVersion || undefined,
      canContinue,
      upgradeUrl: 'https://docs.pocketping.io/widget/installation',
    };

    this.handleVersionWarning(warning);
  }

  // ─────────────────────────────────────────────────────────────────
  // Storage
  // ─────────────────────────────────────────────────────────────────

  private getOrCreateVisitorId(): string {
    const key = 'pocketping_visitor_id';
    let visitorId = localStorage.getItem(key);

    if (!visitorId) {
      visitorId = this.generateId();
      localStorage.setItem(key, visitorId);
    }

    return visitorId;
  }

  private getStoredSessionId(): string | null {
    return localStorage.getItem('pocketping_session_id');
  }

  private storeSessionId(sessionId: string): void {
    localStorage.setItem('pocketping_session_id', sessionId);
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

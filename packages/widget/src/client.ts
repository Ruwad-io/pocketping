import type {
  ResolvedPocketPingConfig,
  Message,
  MessageStatus,
  Session,
  ConnectResponse,
  SendMessageResponse,
  EditMessageResponse,
  DeleteMessageResponse,
  PresenceResponse,
  WebSocketEvent,
  CustomEvent,
  CustomEventHandler,
  VersionWarning,
  UserIdentity,
  TriggerOptions,
  TrackedElement,
  Attachment,
  InitiateUploadResponse,
  CompleteUploadResponse,
  PreChatFormData,
} from './types';
import { VERSION } from './version';

type Listener<T> = (data: T) => void;

export class PocketPingClient {
  private config: ResolvedPocketPingConfig;
  private session: Session | null = null;
  private ws: WebSocket | null = null;
  private sse: EventSource | null = null;
  private isOpen = false;
  private listeners: Map<string, Set<Listener<unknown>>> = new Map();
  private customEventHandlers: Map<string, Set<CustomEventHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollingTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollingFailures = 0;
  private maxPollingFailures = 10;
  private wsConnectedAt = 0;
  private quickFailureThreshold = 2000; // If WS fails within 2s, assume serverless
  private connectionMode: 'none' | 'ws' | 'sse' | 'polling' = 'none';
  private trackedElementCleanups: Array<() => void> = [];
  private currentTrackedElements: TrackedElement[] = [];
  private inspectorMode = false;
  private inspectorCleanup: (() => void) | null = null;
  private connectedAt: number = 0;
  private disconnectNotified = false;
  private boundHandleUnload: (() => void) | null = null;
  private boundHandleVisibilityChange: (() => void) | null = null;

  constructor(config: ResolvedPocketPingConfig) {
    this.config = config;
  }

  // ─────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────

  async connect(): Promise<Session> {
    const visitorId = this.getOrCreateVisitorId();
    const storedSessionId = this.getStoredSessionId();
    const storedIdentity = this.getStoredIdentity();

    // Check for inspector mode from URL
    const urlParams = new URLSearchParams(window.location.search);
    const inspectorToken = urlParams.get('pp_inspector');

    const response = await this.fetch<ConnectResponse>('/connect', {
      method: 'POST',
      body: JSON.stringify({
        visitorId,
        sessionId: storedSessionId,
        inspectorToken: inspectorToken || undefined,
        metadata: {
          url: window.location.href,
          referrer: document.referrer || undefined,
          pageTitle: document.title || undefined,
          userAgent: navigator.userAgent,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: navigator.language,
          screenResolution: `${window.screen.width}x${window.screen.height}`,
        },
        // Include stored identity if available
        identity: storedIdentity || undefined,
      }),
    });

    this.session = {
      sessionId: response.sessionId,
      visitorId: response.visitorId,
      operatorOnline: response.operatorOnline ?? false,
      messages: response.messages ?? [],
      identity: response.identity || storedIdentity || undefined,
      preChatForm: response.preChatForm,
    };

    // Merge server config into client config (server values take precedence)
    // This allows SaaS dashboard settings to override widget init values
    if (response.operatorName) {
      this.config.operatorName = response.operatorName;
    }
    if (response.operatorAvatar) {
      this.config.operatorAvatar = response.operatorAvatar;
    }
    if (response.primaryColor) {
      this.config.primaryColor = response.primaryColor;
    }
    if (response.headerColor) {
      this.config.headerColor = response.headerColor;
    }
    if (response.footerColor) {
      this.config.footerColor = response.footerColor;
    }
    if (response.chatBackground) {
      this.config.chatBackground = response.chatBackground;
    }
    if (response.toggleColor) {
      this.config.toggleColor = response.toggleColor;
    }
    if (response.welcomeMessage) {
      this.config.welcomeMessage = response.welcomeMessage;
    }

    // Emit config update for UI to re-render with server values
    this.emit('configUpdate', {
      operatorName: this.config.operatorName,
      operatorAvatar: this.config.operatorAvatar,
      primaryColor: this.config.primaryColor,
      headerColor: this.config.headerColor,
      footerColor: this.config.footerColor,
      chatBackground: this.config.chatBackground,
      toggleColor: this.config.toggleColor,
      welcomeMessage: this.config.welcomeMessage,
    });

    // Store session
    this.storeSessionId(response.sessionId);

    // Track connection time for session duration
    this.connectedAt = Date.now();
    this.disconnectNotified = false;

    // Setup page unload listeners to notify bridges when visitor leaves
    this.setupUnloadListeners();

    // Connect real-time (WebSocket → SSE → Polling)
    this.connectRealtime();

    // Check if inspector mode is active
    if (response.inspectorMode) {
      this.enableInspectorMode();
    } else if (response.trackedElements?.length) {
      // Setup tracked elements from backend config (SaaS)
      this.setupTrackedElements(response.trackedElements);
    }

    // Notify
    this.emit('connect', this.session);
    this.config.onConnect?.(response.sessionId);

    return this.session;
  }

  disconnect(): void {
    // Notify backend about visitor leaving (if not already notified)
    this.notifyDisconnect();

    // Cleanup unload listeners
    this.cleanupUnloadListeners();

    // Clear WebSocket handlers before closing
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }
    // Close SSE connection
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
    this.session = null;
    this.connectionMode = 'none';
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    // Stop polling
    this.stopPolling();
    // Cleanup tracked elements
    this.cleanupTrackedElements();
    // Cleanup inspector mode if active
    this.disableInspectorMode();
  }

  async sendMessage(content: string, attachmentIds?: string[], replyTo?: string): Promise<Message> {
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
      replyTo,
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
          attachmentIds: attachmentIds || [],
          replyTo,
        }),
      });

      // Update the temporary message with real ID, 'sent' status, and attachments
      const messageIndex = this.session.messages.findIndex((m) => m.id === tempId);
      if (messageIndex >= 0) {
        this.session.messages[messageIndex].id = response.messageId;
        this.session.messages[messageIndex].timestamp = response.timestamp;
        this.session.messages[messageIndex].status = 'sent';
        // Add attachments from server response
        if (response.attachments && response.attachments.length > 0) {
          this.session.messages[messageIndex].attachments = response.attachments;
        }

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
        attachments: response.attachments,
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

  /**
   * Upload a file attachment
   * Returns the attachment data after successful upload
   * @param file - File object to upload
   * @param onProgress - Optional callback for upload progress (0-100)
   * @example
   * const attachment = await PocketPing.uploadFile(file, (progress) => {
   *   console.log(`Upload ${progress}% complete`)
   * })
   * await PocketPing.sendMessage('Check this file', [attachment.id])
   */
  async uploadFile(
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<Attachment> {
    if (!this.session) {
      throw new Error('Not connected');
    }

    // Emit upload start event
    this.emit('uploadStart', { filename: file.name, size: file.size });

    try {
      // Step 1: Initiate upload to get presigned URL
      const initResponse = await this.fetch<InitiateUploadResponse>('/upload', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: this.session.sessionId,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
        }),
      });

      // Emit progress for initiation
      onProgress?.(10);
      this.emit('uploadProgress', { filename: file.name, progress: 10 });

      // Step 2: Upload file to presigned URL
      await this.uploadToPresignedUrl(initResponse.uploadUrl, file, (progress) => {
        // Map upload progress from 10-90%
        const mappedProgress = 10 + (progress * 0.8);
        onProgress?.(mappedProgress);
        this.emit('uploadProgress', { filename: file.name, progress: mappedProgress });
      });

      // Step 3: Complete the upload
      const completeResponse = await this.fetch<CompleteUploadResponse>('/upload/complete', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: this.session.sessionId,
          attachmentId: initResponse.attachmentId,
        }),
      });

      // Emit completion
      onProgress?.(100);
      this.emit('uploadComplete', completeResponse);

      return {
        id: completeResponse.id,
        filename: completeResponse.filename,
        mimeType: completeResponse.mimeType,
        size: completeResponse.size,
        url: completeResponse.url,
        thumbnailUrl: completeResponse.thumbnailUrl,
        status: completeResponse.status,
      };
    } catch (error) {
      this.emit('uploadError', { filename: file.name, error });
      throw error;
    }
  }

  /**
   * Upload multiple files at once
   * @param files - Array of File objects to upload
   * @param onProgress - Optional callback for overall progress (0-100)
   * @returns Array of uploaded attachments
   */
  async uploadFiles(
    files: File[],
    onProgress?: (progress: number) => void
  ): Promise<Attachment[]> {
    const attachments: Attachment[] = [];
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
      const file = files[i];
      const baseProgress = (i / totalFiles) * 100;
      const fileProgress = 100 / totalFiles;

      const attachment = await this.uploadFile(file, (progress) => {
        const totalProgress = baseProgress + (progress / 100) * fileProgress;
        onProgress?.(totalProgress);
      });

      attachments.push(attachment);
    }

    return attachments;
  }

  /**
   * Upload file to presigned URL with progress tracking
   */
  private uploadToPresignedUrl(
    url: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const progress = (event.loaded / event.total) * 100;
          onProgress?.(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'));
      });

      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.send(file);
    });
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

  /**
   * Edit a message (visitor can only edit their own messages)
   * @param messageId - ID of the message to edit
   * @param content - New content for the message
   */
  async editMessage(messageId: string, content: string): Promise<Message> {
    if (!this.session) {
      throw new Error('Not connected');
    }

    const response = await this.fetch<EditMessageResponse>(`/message/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sessionId: this.session.sessionId,
        content,
      }),
    });

    // Update local message
    const messageIndex = this.session.messages.findIndex((m) => m.id === messageId);
    if (messageIndex >= 0) {
      this.session.messages[messageIndex].content = response.message.content;
      this.session.messages[messageIndex].editedAt = response.message.editedAt;
      this.emit('messageEdited', this.session.messages[messageIndex]);
    }

    return this.session.messages[messageIndex];
  }

  /**
   * Delete a message (soft delete - visitor can only delete their own messages)
   * @param messageId - ID of the message to delete
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    if (!this.session) {
      throw new Error('Not connected');
    }

    // Note: DELETE endpoint expects sessionId in query params, not body
    const response = await this.fetch<DeleteMessageResponse>(
      `/message/${messageId}?sessionId=${encodeURIComponent(this.session.sessionId)}`,
      {
        method: 'DELETE',
      }
    );

    if (response.deleted) {
      // Update local message
      const messageIndex = this.session.messages.findIndex((m) => m.id === messageId);
      if (messageIndex >= 0) {
        this.session.messages[messageIndex].deletedAt = new Date().toISOString();
        this.session.messages[messageIndex].content = ''; // Clear content
        this.emit('messageDeleted', this.session.messages[messageIndex]);
      }
    }

    return response.deleted;
  }

  async getPresence(): Promise<PresenceResponse> {
    return this.fetch<PresenceResponse>('/presence', { method: 'GET' });
  }

  // ─────────────────────────────────────────────────────────────────
  // User Identity
  // ─────────────────────────────────────────────────────────────────

  /**
   * Identify the current user with metadata
   * Call after user logs in or when user data becomes available
   * @param identity - User identity data with required id field
   * @example
   * PocketPing.identify({
   *   id: 'user_123',
   *   email: 'john@example.com',
   *   name: 'John Doe',
   *   plan: 'pro',
   *   company: 'Acme Inc'
   * })
   */
  async identify(identity: UserIdentity): Promise<void> {
    if (!identity?.id) {
      throw new Error('[PocketPing] identity.id is required');
    }

    // Store identity in localStorage for persistence
    this.storeIdentity(identity);

    // If connected, send identify request to backend
    if (this.session) {
      try {
        await this.fetch<{ ok: boolean }>('/identify', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: this.session.sessionId,
            identity,
          }),
        });

        // Update local session
        this.session.identity = identity;
        this.emit('identify', identity);
      } catch (err) {
        console.error('[PocketPing] Failed to identify:', err);
        throw err;
      }
    }
  }

  /**
   * Submit pre-chat form data (email and/or phone)
   * @param data - Form data containing email and/or phone
   */
  async submitPreChat(data: PreChatFormData): Promise<void> {
    if (!this.session) {
      throw new Error('[PocketPing] Not connected');
    }

    if (!data.email && !data.phone) {
      throw new Error('[PocketPing] Either email or phone is required');
    }

    try {
      await this.fetch<{ ok: boolean }>('/prechat', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: this.session.sessionId,
          email: data.email,
          phone: data.phone,
          phoneCountry: data.phoneCountry,
        }),
      });

      // Mark pre-chat form as completed in session
      if (this.session.preChatForm) {
        this.session.preChatForm.completed = true;
      }
      this.emit('preChatCompleted', data);
    } catch (err) {
      console.error('[PocketPing] Failed to submit pre-chat form:', err);
      throw err;
    }
  }

  /**
   * Reset the user identity and optionally start a new session
   * Call on user logout to clear user data
   * @param options - Optional settings: { newSession: boolean }
   */
  async reset(options?: { newSession?: boolean }): Promise<void> {
    // Clear stored identity
    this.clearIdentity();

    // Clear session identity
    if (this.session) {
      this.session.identity = undefined;
    }

    // Optionally start a new session
    if (options?.newSession) {
      // Clear session and visitor IDs
      localStorage.removeItem('pocketping_session_id');
      localStorage.removeItem('pocketping_visitor_id');

      // Disconnect current session
      this.disconnect();

      // Reconnect with fresh IDs
      await this.connect();
    }

    this.emit('reset', null);
  }

  /**
   * Get the current user identity
   * @returns UserIdentity or null if not identified
   */
  getIdentity(): UserIdentity | null {
    return this.session?.identity || this.getStoredIdentity();
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

  getConfig(): ResolvedPocketPingConfig {
    return this.config;
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
   * @param options - Optional trigger options (widgetMessage to open chat)
   * @example
   * // Silent event (just notify bridges)
   * PocketPing.trigger('clicked_cta', { button: 'signup' })
   *
   * // Open widget with message
   * PocketPing.trigger('clicked_pricing', { plan: 'pro' }, { widgetMessage: 'Need help choosing a plan?' })
   */
  trigger(eventName: string, data?: Record<string, unknown>, options?: TriggerOptions): void {
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

    // If widgetMessage provided, open widget and show the message
    if (options?.widgetMessage) {
      this.setOpen(true);
      // Emit a special event that the UI can listen to for showing the message
      this.emit('triggerMessage', { message: options.widgetMessage, eventName });
    }
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

    // Call config onEvent callback
    this.config.onEvent?.(event);

    // Also emit to generic 'event' listeners
    this.emit('event', event);
    this.emit(`event:${event.name}`, event);
  }

  // ─────────────────────────────────────────────────────────────────
  // Tracked Elements (SaaS auto-tracking)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Setup tracked elements from config (used by SaaS dashboard)
   * @param elements - Array of tracked element configurations
   */
  setupTrackedElements(elements: TrackedElement[]): void {
    // Cleanup existing tracked elements first
    this.cleanupTrackedElements();

    this.currentTrackedElements = elements;

    for (const config of elements) {
      const eventType = config.event || 'click';

      const handler = (domEvent: Event) => {
        // Merge static data with dynamic element data
        const elementData: Record<string, unknown> = {
          ...config.data,
          selector: config.selector,
          elementText: (domEvent.target as HTMLElement)?.textContent?.trim().slice(0, 100),
          url: window.location.href,
        };

        this.trigger(config.name, elementData, {
          widgetMessage: config.widgetMessage,
        });
      };

      // Use event delegation for better performance and to handle dynamic elements
      const delegatedHandler = (domEvent: Event) => {
        const target = domEvent.target as Element;
        if (target?.closest(config.selector)) {
          handler(domEvent);
        }
      };

      document.addEventListener(eventType, delegatedHandler, true);

      // Store cleanup function
      this.trackedElementCleanups.push(() => {
        document.removeEventListener(eventType, delegatedHandler, true);
      });
    }

    if (elements.length > 0) {
      console.info(`[PocketPing] Tracking ${elements.length} element(s)`);
    }
  }

  /**
   * Cleanup all tracked element listeners
   */
  private cleanupTrackedElements(): void {
    for (const cleanup of this.trackedElementCleanups) {
      cleanup();
    }
    this.trackedElementCleanups = [];
    this.currentTrackedElements = [];
  }

  /**
   * Get current tracked elements configuration
   */
  getTrackedElements(): TrackedElement[] {
    return [...this.currentTrackedElements];
  }

  // ─────────────────────────────────────────────────────────────────
  // Inspector Mode (SaaS visual element selector)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Enable inspector mode for visual element selection
   * This shows an overlay that allows clicking on elements to get their CSS selector
   */
  private enableInspectorMode(): void {
    if (this.inspectorMode) return;
    this.inspectorMode = true;

    console.info('[PocketPing] 🔍 Inspector mode active - click on any element to select it');

    // Create overlay UI
    const overlay = document.createElement('div');
    overlay.id = 'pp-inspector-overlay';
    overlay.innerHTML = `
      <style>
        #pp-inspector-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 999999;
          pointer-events: none;
        }
        #pp-inspector-overlay * {
          pointer-events: auto;
        }
        #pp-inspector-banner {
          position: fixed;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: white;
          padding: 12px 24px;
          border-radius: 12px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          font-weight: 500;
          box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
          display: flex;
          align-items: center;
          gap: 12px;
          z-index: 1000000;
        }
        #pp-inspector-banner svg {
          animation: pp-pulse 1.5s ease-in-out infinite;
        }
        @keyframes pp-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        #pp-inspector-exit {
          background: rgba(255,255,255,0.2);
          border: none;
          color: white;
          padding: 6px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          margin-left: 8px;
        }
        #pp-inspector-exit:hover {
          background: rgba(255,255,255,0.3);
        }
        .pp-inspector-highlight {
          outline: 3px dashed #6366f1 !important;
          outline-offset: 2px !important;
          background: rgba(99, 102, 241, 0.1) !important;
        }
        #pp-inspector-tooltip {
          position: fixed;
          background: #1f2937;
          color: white;
          padding: 8px 12px;
          border-radius: 8px;
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 12px;
          pointer-events: none;
          z-index: 1000001;
          max-width: 400px;
          word-break: break-all;
          display: none;
        }
      </style>
      <div id="pp-inspector-banner">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="22" y1="22" x2="16.65" y2="16.65"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12" y2="16"/>
        </svg>
        <span>Inspector Mode - Click an element to capture its selector</span>
        <button id="pp-inspector-exit">Exit</button>
      </div>
      <div id="pp-inspector-tooltip"></div>
    `;

    document.body.appendChild(overlay);

    const tooltip = document.getElementById('pp-inspector-tooltip')!;
    let currentHighlight: Element | null = null;

    // Generate optimal CSS selector for an element
    const getSelector = (element: Element): string => {
      // Try ID first
      if (element.id && !element.id.startsWith('pp-')) {
        return `#${CSS.escape(element.id)}`;
      }

      // Try unique class
      const classes = Array.from(element.classList).filter(c => !c.startsWith('pp-'));
      if (classes.length > 0) {
        const classSelector = '.' + classes.map(c => CSS.escape(c)).join('.');
        if (document.querySelectorAll(classSelector).length === 1) {
          return classSelector;
        }
      }

      // Try data attributes
      for (const attr of Array.from(element.attributes)) {
        if (attr.name.startsWith('data-') && attr.value) {
          const dataSelector = `[${attr.name}="${CSS.escape(attr.value)}"]`;
          if (document.querySelectorAll(dataSelector).length === 1) {
            return dataSelector;
          }
        }
      }

      // Build path from ancestors
      const path: string[] = [];
      let current: Element | null = element;

      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();

        if (current.id && !current.id.startsWith('pp-')) {
          selector = `#${CSS.escape(current.id)}`;
          path.unshift(selector);
          break;
        }

        const parent: Element | null = current.parentElement;
        if (parent) {
          const currentTagName = current.tagName;
          const siblings = Array.from(parent.children).filter(
            (c: Element) => c.tagName === currentTagName
          );
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }

        path.unshift(selector);
        current = parent;
      }

      return path.join(' > ');
    };

    // Mouseover handler
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as Element;

      // Ignore our own elements
      if (target.closest('#pp-inspector-overlay') || target.closest('#pocketping-widget')) {
        return;
      }

      // Remove previous highlight
      if (currentHighlight) {
        currentHighlight.classList.remove('pp-inspector-highlight');
      }

      // Add highlight to new element
      target.classList.add('pp-inspector-highlight');
      currentHighlight = target;

      // Update tooltip
      const selector = getSelector(target);
      tooltip.textContent = selector;
      tooltip.style.display = 'block';
      tooltip.style.left = `${e.clientX + 15}px`;
      tooltip.style.top = `${e.clientY + 15}px`;

      // Keep tooltip in viewport
      const rect = tooltip.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        tooltip.style.left = `${e.clientX - rect.width - 15}px`;
      }
      if (rect.bottom > window.innerHeight) {
        tooltip.style.top = `${e.clientY - rect.height - 15}px`;
      }
    };

    // Mouseout handler
    const handleMouseOut = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest('#pp-inspector-overlay')) return;

      target.classList.remove('pp-inspector-highlight');
      tooltip.style.display = 'none';
    };

    // Click handler
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element;

      // Handle exit button
      if ((target as HTMLElement).id === 'pp-inspector-exit') {
        this.disableInspectorMode();
        return;
      }

      // Ignore our own elements
      if (target.closest('#pp-inspector-overlay') || target.closest('#pocketping-widget')) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const selector = getSelector(target);

      // Send selector to dashboard via WebSocket
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'inspector_select',
          data: {
            selector,
            tagName: target.tagName.toLowerCase(),
            text: target.textContent?.trim().slice(0, 50) || '',
            url: window.location.href,
          },
        }));
      }

      // Also emit locally
      this.emit('inspectorSelect', { selector, element: target });

      // Visual feedback
      target.classList.remove('pp-inspector-highlight');
      target.classList.add('pp-inspector-highlight');
      setTimeout(() => {
        target.classList.remove('pp-inspector-highlight');
      }, 500);

      // Show confirmation
      const banner = document.getElementById('pp-inspector-banner');
      if (banner) {
        const originalHTML = banner.innerHTML;
        banner.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>Selector captured: <code style="background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;font-family:monospace;">${selector}</code></span>
        `;
        setTimeout(() => {
          if (banner && this.inspectorMode) {
            banner.innerHTML = originalHTML;
            // Reattach exit button handler
            document.getElementById('pp-inspector-exit')?.addEventListener('click', () => {
              this.disableInspectorMode();
            });
          }
        }, 2000);
      }

      console.info(`[PocketPing] 📌 Selector captured: ${selector}`);
    };

    // Attach handlers
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('click', handleClick, true);

    // Store cleanup
    this.inspectorCleanup = () => {
      document.removeEventListener('mouseover', handleMouseOver, true);
      document.removeEventListener('mouseout', handleMouseOut, true);
      document.removeEventListener('click', handleClick, true);
      overlay.remove();
      if (currentHighlight) {
        currentHighlight.classList.remove('pp-inspector-highlight');
      }
    };

    // Attach exit button handler
    document.getElementById('pp-inspector-exit')?.addEventListener('click', () => {
      this.disableInspectorMode();
    });
  }

  /**
   * Disable inspector mode
   */
  private disableInspectorMode(): void {
    if (!this.inspectorMode) return;
    this.inspectorMode = false;

    if (this.inspectorCleanup) {
      this.inspectorCleanup();
      this.inspectorCleanup = null;
    }

    console.info('[PocketPing] Inspector mode disabled');
    this.emit('inspectorDisabled', null);
  }

  /**
   * Check if inspector mode is active
   */
  isInspectorModeActive(): boolean {
    return this.inspectorMode;
  }

  // ─────────────────────────────────────────────────────────────────
  // Real-time Connection (WebSocket → SSE → Polling)
  // ─────────────────────────────────────────────────────────────────

  private connectRealtime(): void {
    if (!this.session) return;

    // Use cached connection mode if we've already determined it
    if (this.connectionMode === 'polling') {
      this.startPolling();
      return;
    }
    if (this.connectionMode === 'sse') {
      this.connectSSE();
      return;
    }

    // Try WebSocket first
    this.connectWebSocket();
  }

  private connectWebSocket(): void {
    if (!this.session) return;

    const wsUrl = this.config.endpoint
      .replace(/^http/, 'ws')
      .replace(/\/$/, '') + `/stream?sessionId=${this.session.sessionId}`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.wsConnectedAt = Date.now();

      // Timeout for hanging connections (serverless platforms)
      const connectionTimeout = setTimeout(() => {
        console.warn('[PocketPing] ⏱️ WebSocket timeout - trying SSE');
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          this.ws.onclose = null;
          this.ws.onerror = null;
          this.ws.onopen = null;
          this.ws.close();
          this.ws = null;
          this.connectSSE(); // Try SSE next
        }
      }, 5000);

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        this.connectionMode = 'ws';
        this.reconnectAttempts = 0;
        this.wsConnectedAt = Date.now();
        this.emit('wsConnected', null);
      };

      this.ws.onmessage = (event) => {
        try {
          const wsEvent: WebSocketEvent = JSON.parse(event.data);
          this.handleRealtimeEvent(wsEvent);
        } catch (err) {
          console.error('[PocketPing] Failed to parse WS message:', err);
        }
      };

      this.ws.onclose = () => {
        clearTimeout(connectionTimeout);
        this.emit('wsDisconnected', null);
        this.handleWsFailure();
      };

      this.ws.onerror = () => {
        clearTimeout(connectionTimeout);
        // Error will be followed by onclose
      };
    } catch {
      console.warn('[PocketPing] WebSocket unavailable - trying SSE');
      this.connectSSE();
    }
  }

  private connectSSE(): void {
    if (!this.session) return;

    // Build SSE URL with last known message timestamp
    const params = new URLSearchParams({
      sessionId: this.session.sessionId,
    });

    const lastEventTimestamp = this.getLastEventTimestamp();
    if (lastEventTimestamp) {
      params.set('after', lastEventTimestamp);
    }

    const sseUrl = this.config.endpoint.replace(/\/$/, '') + `/stream?${params.toString()}`;

    try {
      this.sse = new EventSource(sseUrl);

      // Timeout for SSE connection
      const connectionTimeout = setTimeout(() => {
        console.warn('[PocketPing] ⏱️ SSE timeout - falling back to polling');
        if (this.sse && this.sse.readyState !== EventSource.OPEN) {
          this.sse.close();
          this.sse = null;
          this.connectionMode = 'polling';
          this.startPolling();
        }
      }, 5000);

      this.sse.onopen = () => {
        clearTimeout(connectionTimeout);
        this.connectionMode = 'sse';
        this.emit('sseConnected', null);
      };

      this.sse.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleRealtimeEvent(data);
        } catch (err) {
          console.error('[PocketPing] Failed to parse SSE message:', err);
        }
      });

      this.sse.addEventListener('connected', () => {
        // SSE connected event received - connection established
      });

      this.sse.onerror = () => {
        clearTimeout(connectionTimeout);
        console.warn('[PocketPing] ❌ SSE error - falling back to polling');
        if (this.sse) {
          this.sse.close();
          this.sse = null;
        }
        this.connectionMode = 'polling';
        this.startPolling();
      };
    } catch {
      console.warn('[PocketPing] SSE unavailable - falling back to polling');
      this.connectionMode = 'polling';
      this.startPolling();
    }
  }

  private handleWsFailure(): void {
    const timeSinceConnect = Date.now() - this.wsConnectedAt;

    // If WebSocket fails quickly, try SSE
    if (timeSinceConnect < this.quickFailureThreshold) {
      console.info('[PocketPing] WebSocket failed quickly - trying SSE');
      this.connectSSE();
      return;
    }

    // Otherwise try to reconnect WebSocket
    this.scheduleReconnect();
  }

  private handleRealtimeEvent(event: WebSocketEvent): void {
    // Unified handler for both WS and SSE events
    this.handleWebSocketEvent(event);
  }

  private getLastEventTimestamp(): string | null {
    if (!this.session) return null;

    let latest: Date | null = null;
    for (const msg of this.session.messages) {
      const candidates = [msg.timestamp, msg.editedAt, msg.deletedAt, msg.deliveredAt, msg.readAt]
        .filter(Boolean)
        .map((value) => new Date(value as string))
        .filter((date) => !isNaN(date.getTime()));

      for (const date of candidates) {
        if (!latest || date > latest) {
          latest = date;
        }
      }
    }

    return latest ? latest.toISOString() : null;
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
            let updated = false;
            if (message.status && message.status !== existing.status) {
              existing.status = message.status;
              updated = true;
              if (message.deliveredAt) {
                existing.deliveredAt = message.deliveredAt;
              }
              if (message.readAt) {
                existing.readAt = message.readAt;
              }
              // Emit read event to trigger UI update
              this.emit('read', { messageIds: [message.id], status: message.status });
            }
            if (message.content !== undefined && message.content !== existing.content) {
              existing.content = message.content;
              updated = true;
            }
            if (message.editedAt !== undefined && message.editedAt !== existing.editedAt) {
              existing.editedAt = message.editedAt;
              updated = true;
            }
            if (message.deletedAt !== undefined && message.deletedAt !== existing.deletedAt) {
              existing.deletedAt = message.deletedAt;
              updated = true;
            }
            if (message.replyTo !== undefined) {
              existing.replyTo = message.replyTo;
              updated = true;
            }
            if (message.attachments !== undefined) {
              existing.attachments = message.attachments;
              updated = true;
            }
            if (updated) {
              this.emit('message', existing);
            }
          } else {
            // Add new message (operator/AI messages)
            this.session.messages.push(message);
            this.emit('message', message);
            this.config.onMessage?.(message);

            // Auto-open widget when operator/AI sends a message (if enabled)
            if (message.sender !== 'visitor' && !this.isOpen) {
              const autoOpen = this.config.autoOpenOnMessage ?? true;
              if (autoOpen) {
                this.setOpen(true);
              }
            }
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

      case 'message_edited':
        if (this.session) {
          const editData = event.data as { messageId: string; content: string; editedAt?: string };
          const msgIndex = this.session.messages.findIndex((m) => m.id === editData.messageId);
          if (msgIndex >= 0) {
            const existing = this.session.messages[msgIndex];
            existing.content = editData.content;
            existing.editedAt = editData.editedAt ?? new Date().toISOString();
            this.emit('message', existing);
          }
        }
        break;

      case 'message_deleted':
        if (this.session) {
          const deleteData = event.data as { messageId: string; deletedAt?: string };
          const msgIndex = this.session.messages.findIndex((m) => m.id === deleteData.messageId);
          if (msgIndex >= 0) {
            const existing = this.session.messages[msgIndex];
            existing.deletedAt = deleteData.deletedAt ?? new Date().toISOString();
            this.emit('message', existing);
          }
        }
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

      case 'config_update':
        // Hot-reload tracked elements from SaaS dashboard
        const configData = event.data as { trackedElements?: TrackedElement[] };
        if (configData.trackedElements) {
          this.setupTrackedElements(configData.trackedElements);
          this.emit('configUpdate', configData);
        }
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
      console.warn('[PocketPing] Max reconnect attempts reached, trying SSE');
      this.connectSSE();
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
        const lastEventTimestamp = this.getLastEventTimestamp();
        const newMessages = await this.fetchMessages(lastEventTimestamp ?? undefined);

        // Reset failure counter on success
        this.pollingFailures = 0;

        for (const message of newMessages) {
          const existingIndex = this.session.messages.findIndex((m) => m.id === message.id);
          if (existingIndex >= 0) {
            const existing = this.session.messages[existingIndex];
            let updated = false;
            if (message.status && message.status !== existing.status) {
              existing.status = message.status;
              updated = true;
              if (message.deliveredAt) existing.deliveredAt = message.deliveredAt;
              if (message.readAt) existing.readAt = message.readAt;
              this.emit('read', { messageIds: [message.id], status: message.status });
            }
            if (message.content !== undefined && message.content !== existing.content) {
              existing.content = message.content;
              updated = true;
            }
            if (message.editedAt !== undefined && message.editedAt !== existing.editedAt) {
              existing.editedAt = message.editedAt;
              updated = true;
            }
            if (message.deletedAt !== undefined && message.deletedAt !== existing.deletedAt) {
              existing.deletedAt = message.deletedAt;
              updated = true;
            }
            if (message.replyTo !== undefined) {
              existing.replyTo = message.replyTo;
              updated = true;
            }
            if (message.attachments !== undefined) {
              existing.attachments = message.attachments;
              updated = true;
            }
            if (updated) {
              this.emit('message', existing);
            }
          } else {
            this.session.messages.push(message);
            this.emit('message', message);
            this.config.onMessage?.(message);

            // Auto-open widget when operator/AI sends a message (if enabled)
            if (message.sender !== 'visitor' && !this.isOpen) {
              const autoOpen = this.config.autoOpenOnMessage ?? true;
              if (autoOpen) {
                this.setOpen(true);
              }
            }
          }
        }
      } catch (err) {
        this.pollingFailures++;
        console.error(`[PocketPing] ❌ Polling error:`, err);

        // Only log every 3rd failure to reduce console spam
        if (this.pollingFailures <= 3 || this.pollingFailures % 3 === 0) {
          console.warn(`[PocketPing] Polling failed (${this.pollingFailures}/${this.maxPollingFailures})`);
        }

        // Stop polling after max failures
        if (this.pollingFailures >= this.maxPollingFailures) {
          console.error('[PocketPing] Polling disabled after too many failures. Real-time updates unavailable.');
          this.emit('pollingDisabled', { failures: this.pollingFailures });
          return;
        }
      }

      if (this.session) {
        // Exponential backoff on failures: 2s -> 4s -> 8s -> max 30s
        const delay = this.pollingFailures > 0
          ? Math.min(2000 * Math.pow(2, this.pollingFailures - 1), 30000)
          : 2000;
        this.pollingTimeout = setTimeout(poll, delay);
      }
    };

    // Small delay before first poll to ensure session is ready
    this.pollingTimeout = setTimeout(poll, 500);
  }

  private stopPolling(): void {
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
    }
    this.pollingFailures = 0;
  }

  // ─────────────────────────────────────────────────────────────────
  // Visitor Disconnect Notification
  // ─────────────────────────────────────────────────────────────────

  private setupUnloadListeners(): void {
    // Handle page unload (tab close, navigation away)
    this.boundHandleUnload = () => this.notifyDisconnect();
    window.addEventListener('beforeunload', this.boundHandleUnload);
    window.addEventListener('pagehide', this.boundHandleUnload);

    // Handle visibility change (tab switch, minimize)
    // Only notify on hidden if the page stays hidden for a while (handled by backend inactivity timeout)
    this.boundHandleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Send a ping to let backend know user might be leaving
        // Backend will handle the actual timeout logic
        this.sendVisibilityPing('hidden');
      } else if (document.visibilityState === 'visible') {
        // User came back - send ping to reset inactivity timer
        this.sendVisibilityPing('visible');
      }
    };
    document.addEventListener('visibilitychange', this.boundHandleVisibilityChange);
  }

  private cleanupUnloadListeners(): void {
    if (this.boundHandleUnload) {
      window.removeEventListener('beforeunload', this.boundHandleUnload);
      window.removeEventListener('pagehide', this.boundHandleUnload);
      this.boundHandleUnload = null;
    }
    if (this.boundHandleVisibilityChange) {
      document.removeEventListener('visibilitychange', this.boundHandleVisibilityChange);
      this.boundHandleVisibilityChange = null;
    }
  }

  /**
   * Notify backend that visitor is leaving
   * Uses sendBeacon for reliability on page unload
   */
  private notifyDisconnect(): void {
    if (this.disconnectNotified || !this.session) {
      return;
    }

    this.disconnectNotified = true;
    const sessionDuration = this.connectedAt ? Math.round((Date.now() - this.connectedAt) / 1000) : 0;

    const url = this.config.endpoint.replace(/\/$/, '') + '/disconnect';
    const data = JSON.stringify({
      sessionId: this.session.sessionId,
      duration: sessionDuration,
      reason: 'page_unload',
    });

    // Use sendBeacon for reliability on page unload (doesn't wait for response)
    if (navigator.sendBeacon) {
      const blob = new Blob([data], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    } else {
      // Fallback to sync XHR (less reliable but works)
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, false); // Synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(data);
      } catch {
        // Ignore errors on unload
      }
    }
  }

  /**
   * Send visibility ping to backend (for inactivity tracking)
   */
  private sendVisibilityPing(state: 'hidden' | 'visible'): void {
    if (!this.session) return;

    const url = this.config.endpoint.replace(/\/$/, '') + '/visibility';
    const data = JSON.stringify({
      sessionId: this.session.sessionId,
      state,
      timestamp: Date.now(),
    });

    // Fire and forget - use sendBeacon for hidden state
    if (state === 'hidden' && navigator.sendBeacon) {
      const blob = new Blob([data], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    } else {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: data,
        keepalive: true,
      }).catch(() => {
        // Ignore errors
      });
    }
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

  private getStoredIdentity(): UserIdentity | null {
    try {
      const stored = localStorage.getItem('pocketping_user_identity');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  private storeIdentity(identity: UserIdentity): void {
    localStorage.setItem('pocketping_user_identity', JSON.stringify(identity));
  }

  private clearIdentity(): void {
    localStorage.removeItem('pocketping_user_identity');
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

import { render, h } from 'preact';
import { ChatWidget } from './components/ChatWidget';
import { PocketPingClient } from './client';
import type { PocketPingConfig, ResolvedPocketPingConfig, Message, CustomEvent, CustomEventHandler, VersionWarning, UserIdentity, TriggerOptions, TrackedElement, Attachment } from './types';

export type { PocketPingConfig, Message, CustomEvent, CustomEventHandler, VersionWarning, UserIdentity, TriggerOptions, TrackedElement, Attachment };

let client: PocketPingClient | null = null;
let container: HTMLElement | null = null;

// SaaS API base URL
const SAAS_API_BASE = 'https://app.pocketping.io/api/widget';

export function init(config: PocketPingConfig): PocketPingClient {
  if (client) {
    console.warn('[PocketPing] Already initialized');
    return client;
  }

  // Resolve endpoint from projectId if not provided
  let resolvedEndpoint = config.endpoint;
  if (!resolvedEndpoint && config.projectId) {
    resolvedEndpoint = `${SAAS_API_BASE}/${config.projectId}`;
  }

  // Validate config
  if (!resolvedEndpoint) {
    throw new Error('[PocketPing] endpoint or projectId is required');
  }

  // Create client with resolved endpoint
  const resolvedConfig: ResolvedPocketPingConfig = { ...config, endpoint: resolvedEndpoint };
  client = new PocketPingClient(resolvedConfig);

  // Create container
  container = document.createElement('div');
  container.id = 'pocketping-container';
  document.body.appendChild(container);

  // Render widget
  render(h(ChatWidget, { client, config }), container);

  // Auto-connect
  client.connect().catch((err) => {
    console.error('[PocketPing] Failed to connect:', err);
  });

  return client;
}

export function destroy(): void {
  if (container) {
    render(null, container);
    container.remove();
    container = null;
  }
  if (client) {
    client.disconnect();
    client = null;
  }
}

export function open(): void {
  client?.setOpen(true);
}

export function close(): void {
  client?.setOpen(false);
}

export function toggle(): void {
  client?.toggleOpen();
}

export function sendMessage(content: string, attachmentIds?: string[]): Promise<Message> {
  if (!client) {
    throw new Error('[PocketPing] Not initialized');
  }
  return client.sendMessage(content, attachmentIds);
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
export async function uploadFile(
  file: File,
  onProgress?: (progress: number) => void
): Promise<Attachment> {
  if (!client) {
    throw new Error('[PocketPing] Not initialized');
  }
  return client.uploadFile(file, onProgress);
}

/**
 * Upload multiple files at once
 * @param files - Array of File objects to upload
 * @param onProgress - Optional callback for overall progress (0-100)
 * @returns Array of uploaded attachments
 * @example
 * const attachments = await PocketPing.uploadFiles(files)
 * const ids = attachments.map(a => a.id)
 * await PocketPing.sendMessage('Here are the files', ids)
 */
export async function uploadFiles(
  files: File[],
  onProgress?: (progress: number) => void
): Promise<Attachment[]> {
  if (!client) {
    throw new Error('[PocketPing] Not initialized');
  }
  return client.uploadFiles(files, onProgress);
}

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
 * PocketPing.trigger('clicked_pricing', { plan: 'pro' }, { widgetMessage: 'Need help choosing?' })
 */
export function trigger(eventName: string, data?: Record<string, unknown>, options?: TriggerOptions): void {
  if (!client) {
    console.warn('[PocketPing] Not initialized, cannot trigger event');
    return;
  }
  client.trigger(eventName, data, options);
}

/**
 * Setup tracked elements for auto-tracking (typically called by SaaS backend)
 * @param elements - Array of tracked element configurations
 * @example
 * PocketPing.setupTrackedElements([
 *   { selector: '#search-btn', event: 'click', name: 'clicked_search' },
 *   { selector: '.pricing-card', event: 'click', name: 'viewed_pricing', widgetMessage: 'Need help?' }
 * ])
 */
export function setupTrackedElements(elements: TrackedElement[]): void {
  if (!client) {
    console.warn('[PocketPing] Not initialized, cannot setup tracked elements');
    return;
  }
  client.setupTrackedElements(elements);
}

/**
 * Get current tracked elements configuration
 */
export function getTrackedElements(): TrackedElement[] {
  return client?.getTrackedElements() || [];
}

/**
 * Subscribe to custom events from the backend
 * @param eventName - The name of the event to listen for
 * @param handler - Callback function when event is received
 * @returns Unsubscribe function
 * @example
 * const unsubscribe = PocketPing.onEvent('show_offer', (data) => {
 *   showPopup(data.message)
 * })
 */
export function onEvent(eventName: string, handler: CustomEventHandler): () => void {
  if (!client) {
    console.warn('[PocketPing] Not initialized, cannot subscribe to event');
    return () => {};
  }
  return client.onEvent(eventName, handler);
}

/**
 * Unsubscribe from a custom event
 * @param eventName - The name of the event
 * @param handler - The handler to remove
 */
export function offEvent(eventName: string, handler: CustomEventHandler): void {
  client?.offEvent(eventName, handler);
}

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
export async function identify(identity: UserIdentity): Promise<void> {
  if (!client) {
    throw new Error('[PocketPing] Not initialized');
  }
  return client.identify(identity);
}

/**
 * Reset the user identity and optionally start a new session
 * Call on user logout to clear user data
 * @param options - Optional settings: { newSession: boolean }
 * @example
 * // Clear identity but keep session
 * PocketPing.reset()
 *
 * // Clear everything and start fresh
 * PocketPing.reset({ newSession: true })
 */
export async function reset(options?: { newSession?: boolean }): Promise<void> {
  if (!client) {
    console.warn('[PocketPing] Not initialized');
    return;
  }
  return client.reset(options);
}

/**
 * Get the current user identity
 * @returns UserIdentity or null if not identified
 */
export function getIdentity(): UserIdentity | null {
  return client?.getIdentity() || null;
}

/**
 * Subscribe to internal widget events
 * @param eventName - Event name: 'versionWarning', 'message', 'connect', 'typing', etc.
 * @param handler - Callback function
 * @returns Unsubscribe function
 * @example
 * PocketPing.on('versionWarning', (warning) => {
 *   if (warning.severity === 'error') {
 *     showUpgradeNotice(warning.message);
 *   }
 * })
 */
export function on<T>(eventName: string, handler: (data: T) => void): () => void {
  if (!client) {
    console.warn('[PocketPing] Not initialized, cannot subscribe to event');
    return () => {};
  }
  return client.on(eventName, handler);
}

// Auto-init from script tag data attributes
if (typeof document !== 'undefined') {
  const script = document.currentScript as HTMLScriptElement | null;
  if (script) {
    const projectId = script.dataset.projectId; // data-project-id for SaaS
    const endpoint = script.dataset.endpoint; // data-endpoint for self-hosted

    if (projectId || endpoint) {
      init({
        projectId,
        endpoint,
        theme: (script.dataset.theme as 'light' | 'dark' | 'auto') || 'auto',
        position: (script.dataset.position as 'bottom-right' | 'bottom-left') || 'bottom-right',
      });
    }
  }
}

// Global export for IIFE build
export default { init, destroy, open, close, toggle, sendMessage, uploadFile, uploadFiles, trigger, onEvent, offEvent, on, identify, reset, getIdentity, setupTrackedElements, getTrackedElements };

import { render, h } from 'preact';
import { ChatWidget } from './components/ChatWidget';
import { PocketPingClient } from './client';
import type { PocketPingConfig, Message, CustomEvent, CustomEventHandler, VersionWarning, UserIdentity } from './types';

export type { PocketPingConfig, Message, CustomEvent, CustomEventHandler, VersionWarning, UserIdentity };

let client: PocketPingClient | null = null;
let container: HTMLElement | null = null;

export function init(config: PocketPingConfig): PocketPingClient {
  if (client) {
    console.warn('[PocketPing] Already initialized');
    return client;
  }

  // Validate config
  if (!config.endpoint) {
    throw new Error('[PocketPing] endpoint is required');
  }

  // Create client
  client = new PocketPingClient(config);

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

export function sendMessage(content: string): Promise<Message> {
  if (!client) {
    throw new Error('[PocketPing] Not initialized');
  }
  return client.sendMessage(content);
}

/**
 * Trigger a custom event to the backend
 * @param eventName - The name of the event (e.g., 'clicked_pricing', 'viewed_demo')
 * @param data - Optional payload to send with the event
 * @example
 * PocketPing.trigger('clicked_cta', { button: 'signup', page: '/pricing' })
 */
export function trigger(eventName: string, data?: Record<string, unknown>): void {
  if (!client) {
    console.warn('[PocketPing] Not initialized, cannot trigger event');
    return;
  }
  client.trigger(eventName, data);
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
  if (script?.dataset.endpoint) {
    init({
      endpoint: script.dataset.endpoint,
      theme: (script.dataset.theme as 'light' | 'dark' | 'auto') || 'auto',
      position: (script.dataset.position as 'bottom-right' | 'bottom-left') || 'bottom-right',
    });
  }
}

// Global export for IIFE build
export default { init, destroy, open, close, toggle, sendMessage, trigger, onEvent, offEvent, on, identify, reset, getIdentity };

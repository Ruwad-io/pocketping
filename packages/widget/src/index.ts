import { render, h } from 'preact';
import { ChatWidget } from './components/ChatWidget';
import { PocketPingClient } from './client';
import type { PocketPingConfig, Message } from './types';

export type { PocketPingConfig, Message };

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
export default { init, destroy, open, close, toggle, sendMessage };

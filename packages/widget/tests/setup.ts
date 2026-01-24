import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/preact';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock WebSocket class
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 1; // OPEN
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: any) => void) | null = null;

  // Instance constants for compatibility
  CONNECTING = 0;
  OPEN = 1;
  CLOSING = 2;
  CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  });

  // Test helpers
  simulateMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

// Add static constants after class definition (avoids esbuild transformation issues)
(MockWebSocket as any).CONNECTING = 0;
(MockWebSocket as any).OPEN = 1;
(MockWebSocket as any).CLOSING = 2;
(MockWebSocket as any).CLOSED = 3;

// Replace WebSocket globally - use Object.defineProperty to ensure it overrides jsdom's WebSocket
Object.defineProperty(globalThis, 'WebSocket', {
  value: MockWebSocket,
  writable: true,
  configurable: true
});
// Also set on window for browser-like access
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'WebSocket', {
    value: MockWebSocket,
    writable: true,
    configurable: true
  });
}

// Mock EventSource (SSE)
class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  readyState = 1; // OPEN
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: any) => void) | null = null;
  private eventListeners: Map<string, ((event: { data: string }) => void)[]> = new Map();

  // Instance constants
  CONNECTING = 0;
  OPEN = 1;
  CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.onopen?.();
    }, 0);
  }

  close = vi.fn(() => {
    this.readyState = 2; // CLOSED
  });

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: (event: { data: string }) => void) {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  // Test helpers
  simulateMessage(data: any) {
    const event = { data: JSON.stringify(data) };
    this.onmessage?.(event);
    const listeners = this.eventListeners.get('message') || [];
    listeners.forEach((listener) => listener(event));
  }

  simulateEvent(eventName: string, data: any) {
    const event = { data: JSON.stringify(data) };
    const listeners = this.eventListeners.get(eventName) || [];
    listeners.forEach((listener) => listener(event));
  }

  simulateError() {
    this.readyState = 2; // CLOSED
    this.onerror?.({});
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

// Add static constants
(MockEventSource as any).CONNECTING = 0;
(MockEventSource as any).OPEN = 1;
(MockEventSource as any).CLOSED = 2;

// Replace EventSource globally
Object.defineProperty(globalThis, 'EventSource', {
  value: MockEventSource,
  writable: true,
  configurable: true
});
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'EventSource', {
    value: MockEventSource,
    writable: true,
    configurable: true
  });
}

// Mock fetch
globalThis.fetch = vi.fn();

// Mock window.location
Object.defineProperty(globalThis, 'location', {
  value: {
    href: 'http://localhost:3000/test-page',
    pathname: '/test-page',
  },
  writable: true,
});

// Mock document
Object.defineProperty(globalThis, 'document', {
  value: {
    ...globalThis.document,
    referrer: 'http://google.com',
    title: 'Test Page',
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  writable: true,
});

// Mock navigator
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    language: 'en-US',
  },
  writable: true,
});

// Mock screen
Object.defineProperty(globalThis, 'screen', {
  value: {
    width: 1920,
    height: 1080,
  },
  writable: true,
});

// Mock Intl
Object.defineProperty(globalThis, 'Intl', {
  value: {
    DateTimeFormat: () => ({
      resolvedOptions: () => ({ timeZone: 'Europe/Paris' }),
    }),
  },
  writable: true,
});

export { MockWebSocket, MockEventSource, localStorageMock };

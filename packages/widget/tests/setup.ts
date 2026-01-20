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

// Mock WebSocket with explicit constants
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 1; // OPEN
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: any) => void) | null = null;

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

// Add WebSocket constants to both the class and instances
Object.defineProperty(MockWebSocket, 'CONNECTING', { value: 0, writable: false });
Object.defineProperty(MockWebSocket, 'OPEN', { value: 1, writable: false });
Object.defineProperty(MockWebSocket, 'CLOSING', { value: 2, writable: false });
Object.defineProperty(MockWebSocket, 'CLOSED', { value: 3, writable: false });

// Also add to prototype for instance access
Object.defineProperty(MockWebSocket.prototype, 'CONNECTING', { value: 0, writable: false });
Object.defineProperty(MockWebSocket.prototype, 'OPEN', { value: 1, writable: false });
Object.defineProperty(MockWebSocket.prototype, 'CLOSING', { value: 2, writable: false });
Object.defineProperty(MockWebSocket.prototype, 'CLOSED', { value: 3, writable: false });

Object.defineProperty(globalThis, 'WebSocket', { value: MockWebSocket, writable: true, configurable: true });

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

export { MockWebSocket, localStorageMock };

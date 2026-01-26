import { afterEach, vi } from 'vitest';

// Reset mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});

// Mock WebSocket for testing
vi.mock('ws', () => ({
  WebSocketServer: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
  WebSocket: {
    OPEN: 1,
    CLOSED: 3,
  },
}));

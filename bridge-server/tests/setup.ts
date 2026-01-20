/**
 * Test setup file for bridge-server
 */

import { vi, beforeEach } from 'bun:test';

// Mock environment variables
process.env.PORT = '3001';
process.env.API_KEY = 'test-api-key';
process.env.BACKEND_WEBHOOK_URL = 'http://localhost:8000/api/bridge/webhook';

// Mock fetch globally
globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
});

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

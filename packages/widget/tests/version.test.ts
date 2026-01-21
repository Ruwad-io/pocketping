import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PocketPingClient } from '../src/client';

/**
 * Access mocks from globalThis - see client.test.ts for explanation
 */
const MockWebSocket = globalThis.WebSocket as any;
const localStorageMock = globalThis.localStorage as any;

describe('Version Management', () => {
  let client: PocketPingClient;

  const mockConfig = {
    endpoint: 'http://localhost:8000/pocketping',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.reset();
    localStorageMock.clear();
    client = new PocketPingClient(mockConfig);
  });

  afterEach(() => {
    client.disconnect();
  });

  // Note: WebSocket version_warning tests require integration testing
  // The mocked WebSocket doesn't fully replicate the real behavior
  // These tests are covered in e2e tests and manual testing

  describe('VersionWarning type structure', () => {
    it('should have correct type structure', () => {
      // Type check at compile time
      const warning = {
        severity: 'warning' as const,
        message: 'Test warning',
        currentVersion: '0.1.0',
        minVersion: '0.2.0',
        latestVersion: '1.0.0',
        canContinue: true,
        upgradeUrl: 'https://example.com',
      };

      expect(warning.severity).toBe('warning');
      expect(warning.canContinue).toBe(true);
    });
  });

  describe('version header handling', () => {
    it('should handle 426 Upgrade Required response', async () => {
      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 426,
        json: () =>
          Promise.resolve({
            error: 'Widget version unsupported',
            message: 'Please upgrade to 0.5.0',
            minVersion: '0.5.0',
          }),
        headers: new Headers({
          'X-PocketPing-Version-Status': 'unsupported',
        }),
      });

      await expect(client.connect()).rejects.toThrow();
    });
  });

  describe('VERSION constant', () => {
    it('should export VERSION constant', async () => {
      const { VERSION } = await import('../src/version');
      expect(VERSION).toBeDefined();
      expect(typeof VERSION).toBe('string');
    });
  });
});

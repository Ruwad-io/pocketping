import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { PocketPing } from '../src/pocketping';

describe('Webhook Forwarding', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // Save original fetch
    originalFetch = globalThis.fetch;

    // Create mock fetch
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    // Restore original fetch
    vi.stubGlobal('fetch', originalFetch);
    vi.restoreAllMocks();
  });

  describe('webhookUrl configuration', () => {
    it('should not call webhook when webhookUrl is not configured', async () => {
      const pp = new PocketPing({});

      const { sessionId } = await pp.handleConnect({
        visitorId: 'visitor-1',
      });

      // Trigger event through public API
      await pp.triggerEvent(sessionId, 'test_event', { key: 'value' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not call fetch since webhookUrl is not configured
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should POST to webhook when webhookUrl is configured', async () => {
      const pp = new PocketPing({
        webhookUrl: 'https://webhook.example.com/events',
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: 'visitor-1',
        metadata: { url: 'https://example.com/pricing' },
      });

      await pp.triggerEvent(sessionId, 'clicked_pricing', { plan: 'pro' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://webhook.example.com/events',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body).toHaveProperty('event');
      expect(body).toHaveProperty('session');
      expect(body).toHaveProperty('sentAt');
      expect(body.event.name).toBe('clicked_pricing');
      expect(body.event.data).toEqual({ plan: 'pro' });
      expect(body.session.id).toBe(sessionId);
      expect(body.session.visitorId).toBe('visitor-1');
    });
  });

  describe('webhookSecret (HMAC signature)', () => {
    it('should add X-PocketPing-Signature header when webhookSecret is set', async () => {
      const secret = 'my-webhook-secret';
      const pp = new PocketPing({
        webhookUrl: 'https://webhook.example.com/events',
        webhookSecret: secret,
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: 'visitor-1',
      });

      await pp.triggerEvent(sessionId, 'test_event', { foo: 'bar' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];

      expect(options.headers).toHaveProperty('X-PocketPing-Signature');
      const signatureHeader = options.headers['X-PocketPing-Signature'];
      expect(signatureHeader).toMatch(/^sha256=[a-f0-9]+$/);

      const expectedSignature = createHmac('sha256', secret)
        .update(options.body)
        .digest('hex');
      expect(signatureHeader).toBe(`sha256=${expectedSignature}`);
    });

    it('should not add signature header when webhookSecret is not set', async () => {
      const pp = new PocketPing({
        webhookUrl: 'https://webhook.example.com/events',
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: 'visitor-1',
      });

      await pp.triggerEvent(sessionId, 'test_event', {});

      await new Promise((resolve) => setTimeout(resolve, 50));

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers).not.toHaveProperty('X-PocketPing-Signature');
    });
  });

  describe('webhook payload structure', () => {
    it('should include event, session, and sentAt in payload', async () => {
      const pp = new PocketPing({
        webhookUrl: 'https://webhook.example.com/events',
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: 'visitor-1',
        metadata: {
          url: 'https://example.com',
          country: 'France',
          browser: 'Chrome',
          deviceType: 'desktop',
        },
      });

      await pp.triggerEvent(sessionId, 'clicked_pricing', {
        plan: 'enterprise',
        seats: 50,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload.event.name).toBe('clicked_pricing');
      expect(payload.event.data).toEqual({ plan: 'enterprise', seats: 50 });
      expect(payload.event.sessionId).toBe(sessionId);
      expect(payload.event.timestamp).toBeDefined();

      expect(payload.session.id).toBe(sessionId);
      expect(payload.session.visitorId).toBe('visitor-1');
      expect(payload.session.metadata).toEqual({
        url: 'https://example.com',
        country: 'France',
        browser: 'Chrome',
        deviceType: 'desktop',
      });

      expect(payload.sentAt).toBeDefined();
      expect(() => new Date(payload.sentAt)).not.toThrow();
    });
  });

  describe('webhook error handling', () => {
    it('should log error when webhook returns non-OK status', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const pp = new PocketPing({
        webhookUrl: 'https://webhook.example.com/events',
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: 'visitor-1',
      });

      await pp.triggerEvent(sessionId, 'test_event', {});

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(consoleSpy).toHaveBeenCalledWith(
        '[PocketPing] Webhook returned 500: Internal Server Error'
      );
    });

    it('should log error when webhook request fails', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const pp = new PocketPing({
        webhookUrl: 'https://webhook.example.com/events',
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: 'visitor-1',
      });

      await pp.triggerEvent(sessionId, 'test_event', {});

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(consoleSpy).toHaveBeenCalledWith(
        '[PocketPing] Webhook error:',
        'Network error'
      );
    });

    it('should not throw when webhook fails (non-blocking)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const pp = new PocketPing({
        webhookUrl: 'https://webhook.example.com/events',
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: 'visitor-1',
      });

      // Should not throw - triggerEvent completes even if webhook fails
      await expect(
        pp.triggerEvent(sessionId, 'test_event', {})
      ).resolves.not.toThrow();
    });
  });

  describe('webhookTimeout', () => {
    it('should use default timeout of 5000ms', async () => {
      const pp = new PocketPing({
        webhookUrl: 'https://webhook.example.com/events',
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: 'visitor-1',
      });

      await pp.triggerEvent(sessionId, 'test_event', {});

      await new Promise((resolve) => setTimeout(resolve, 50));

      const [, options] = mockFetch.mock.calls[0];
      expect(options.signal).toBeDefined();
    });

    it('should use custom timeout when configured', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Create a mock that respects the abort signal
      mockFetch.mockImplementation(
        (_url: string, options?: { signal?: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            // Listen to abort signal
            if (options?.signal) {
              options.signal.addEventListener('abort', () => {
                const error = new Error('This operation was aborted');
                error.name = 'AbortError';
                reject(error);
              });
            }
            // Never resolve otherwise (simulates slow server)
          });
        }
      );

      const pp = new PocketPing({
        webhookUrl: 'https://webhook.example.com/events',
        webhookTimeout: 100,
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: 'visitor-1',
      });

      await pp.triggerEvent(sessionId, 'test_event', {});

      // Wait for timeout to occur (needs extra time for AbortController)
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(consoleSpy).toHaveBeenCalledWith(
        '[PocketPing] Webhook timed out after 100ms'
      );
    });
  });
});

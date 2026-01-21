import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { createHmac } from "crypto";
import { createApp } from "../src/api/routes";
import type { Bridge } from "../src/bridges/base";
import type { BridgeServerConfig, OutgoingEvent } from "../src/types";

// Mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock bridge that does nothing
class MockBridge implements Bridge {
  name = "mock";
  async init() {}
  async destroy() {}
  async onNewSession() {}
  async onVisitorMessage() {}
  async onAITakeover() {}
  async onOperatorStatusChange() {}
  async onOperatorMessage() {}
  async onMessageRead() {}
  async onCustomEvent() {}
}

function createTestContext(config: Partial<BridgeServerConfig> = {}) {
  return {
    bridges: [new MockBridge()],
    config: {
      port: 3001,
      ...config,
    },
    eventListeners: new Set<(event: OutgoingEvent) => void>(),
  };
}

describe("Bridge Server Webhook", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("EVENTS_WEBHOOK_URL configuration", () => {
    it("should not forward events when eventsWebhookUrl is not configured", async () => {
      const context = createTestContext();
      const app = createApp(context);

      const response = await app.request("/api/custom-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            name: "clicked_pricing",
            data: { plan: "pro" },
            timestamp: new Date().toISOString(),
          },
          session: {
            id: "session-123",
            visitorId: "visitor-456",
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should forward events when eventsWebhookUrl is configured", async () => {
      const context = createTestContext({
        eventsWebhookUrl: "https://webhook.example.com/events",
      });
      const app = createApp(context);

      const response = await app.request("/api/custom-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            name: "clicked_pricing",
            data: { plan: "pro" },
            timestamp: "2026-01-21T00:00:00.000Z",
          },
          session: {
            id: "session-123",
            visitorId: "visitor-456",
            metadata: { url: "https://example.com/pricing" },
          },
        }),
      });

      expect(response.status).toBe(200);

      // Wait for async webhook call
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://webhook.example.com/events",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });
  });

  describe("Webhook payload structure", () => {
    it("should include event, session, and sentAt in payload", async () => {
      const context = createTestContext({
        eventsWebhookUrl: "https://webhook.example.com/events",
      });
      const app = createApp(context);

      await app.request("/api/custom-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            name: "clicked_pricing",
            data: { plan: "enterprise", seats: 50 },
            timestamp: "2026-01-21T12:00:00.000Z",
            sessionId: "session-123",
          },
          session: {
            id: "session-123",
            visitorId: "visitor-456",
            metadata: {
              url: "https://example.com/pricing",
              country: "France",
              browser: "Chrome",
            },
          },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);

      // Verify event structure
      expect(payload.event).toEqual({
        name: "clicked_pricing",
        data: { plan: "enterprise", seats: 50 },
        timestamp: "2026-01-21T12:00:00.000Z",
        sessionId: "session-123",
      });

      // Verify session structure
      expect(payload.session.id).toBe("session-123");
      expect(payload.session.visitorId).toBe("visitor-456");
      expect(payload.session.metadata).toEqual({
        url: "https://example.com/pricing",
        country: "France",
        browser: "Chrome",
      });

      // Verify sentAt
      expect(payload.sentAt).toBeDefined();
    });
  });

  describe("HMAC Signature", () => {
    it("should add X-PocketPing-Signature header when eventsWebhookSecret is set", async () => {
      const context = createTestContext({
        eventsWebhookUrl: "https://webhook.example.com/events",
        eventsWebhookSecret: "my-secret-key",
      });
      const app = createApp(context);

      await app.request("/api/custom-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: { name: "test_event", data: { foo: "bar" } },
          session: { id: "session-123", visitorId: "visitor-456" },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers["X-PocketPing-Signature"]).toBeDefined();
      expect(options.headers["X-PocketPing-Signature"]).toMatch(/^sha256=[a-f0-9]+$/);
    });

    it("should compute correct HMAC signature", async () => {
      const secret = "my-secret-key";
      const context = createTestContext({
        eventsWebhookUrl: "https://webhook.example.com/events",
        eventsWebhookSecret: secret,
      });
      const app = createApp(context);

      await app.request("/api/custom-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: { name: "test_event", data: { foo: "bar" } },
          session: { id: "session-123", visitorId: "visitor-456" },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const [, options] = mockFetch.mock.calls[0];
      const body = options.body;
      const signatureHeader = options.headers["X-PocketPing-Signature"];

      // Compute expected signature
      const expectedSignature = createHmac("sha256", secret).update(body).digest("hex");

      expect(signatureHeader).toBe(`sha256=${expectedSignature}`);
    });

    it("should not add signature header when eventsWebhookSecret is not set", async () => {
      const context = createTestContext({
        eventsWebhookUrl: "https://webhook.example.com/events",
        // No eventsWebhookSecret
      });
      const app = createApp(context);

      await app.request("/api/custom-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: { name: "test_event", data: {} },
          session: { id: "session-123", visitorId: "visitor-456" },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers["X-PocketPing-Signature"]).toBeUndefined();
    });
  });

  describe("Error handling", () => {
    it("should log error when webhook returns non-OK status", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });

      const context = createTestContext({
        eventsWebhookUrl: "https://webhook.example.com/events",
      });
      const app = createApp(context);

      await app.request("/api/custom-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: { name: "test_event", data: {} },
          session: { id: "session-123", visitorId: "visitor-456" },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(consoleSpy).toHaveBeenCalledWith(
        "[API] Events webhook returned 500: Internal Server Error"
      );
    });

    it("should log error when webhook request fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const context = createTestContext({
        eventsWebhookUrl: "https://webhook.example.com/events",
      });
      const app = createApp(context);

      await app.request("/api/custom-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: { name: "test_event", data: {} },
          session: { id: "session-123", visitorId: "visitor-456" },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(consoleSpy).toHaveBeenCalled();
    });

    it("should not fail the request when webhook fails (non-blocking)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const context = createTestContext({
        eventsWebhookUrl: "https://webhook.example.com/events",
      });
      const app = createApp(context);

      const response = await app.request("/api/custom-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: { name: "test_event", data: {} },
          session: { id: "session-123", visitorId: "visitor-456" },
        }),
      });

      // Request should still succeed even if webhook fails
      expect(response.status).toBe(200);
    });
  });

  describe("Via /api/events endpoint", () => {
    it("should forward custom_event type to webhook", async () => {
      const context = createTestContext({
        eventsWebhookUrl: "https://webhook.example.com/events",
      });
      const app = createApp(context);

      await app.request("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "custom_event",
          event: {
            name: "clicked_pricing",
            data: { plan: "pro" },
            timestamp: new Date().toISOString(),
          },
          session: {
            id: "session-123",
            visitorId: "visitor-456",
          },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

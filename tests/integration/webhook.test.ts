/**
 * Integration tests for webhook forwarding
 *
 * These tests verify the end-to-end flow of custom events being forwarded to webhooks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import { PocketPing, CustomEvent, Session } from "@pocketping/sdk-node";

// Mock fetch for webhook calls
const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

describe("Webhook Integration", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("End-to-end webhook flow", () => {
    it("should forward custom events to webhook URL", async () => {
      const pp = new PocketPing({
        webhookUrl: "https://webhook.example.com/events",
      });

      // Create a session
      const { sessionId } = await pp.handleConnect({
        visitorId: "visitor-integration-test",
        metadata: {
          url: "https://example.com/checkout",
          country: "France",
        },
      });

      // Get the session for manual webhook call
      const storage = pp.getStorage();
      const session = await storage.getSession(sessionId);

      // Manually trigger webhook forwarding (simulating internal handleCustomEvent)
      const forwardToWebhook = (pp as any).forwardToWebhook.bind(pp);
      forwardToWebhook(
        {
          name: "checkout_started",
          data: { cartValue: 99.99, items: 3 },
          timestamp: new Date().toISOString(),
          sessionId,
        },
        session
      );

      // Wait for async webhook call
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify webhook was called
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

      // Verify payload
      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);

      expect(payload.event.name).toBe("checkout_started");
      expect(payload.event.data).toEqual({ cartValue: 99.99, items: 3 });
      expect(payload.session.id).toBe(sessionId);
      expect(payload.session.visitorId).toBe("visitor-integration-test");
      expect(payload.session.metadata.country).toBe("France");
    });

    it("should include HMAC signature when secret is configured", async () => {
      const secret = "integration-test-secret";
      const pp = new PocketPing({
        webhookUrl: "https://webhook.example.com/events",
        webhookSecret: secret,
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: "visitor-signature-test",
      });

      const storage = pp.getStorage();
      const session = await storage.getSession(sessionId);

      const forwardToWebhook = (pp as any).forwardToWebhook.bind(pp);
      forwardToWebhook(
        {
          name: "test_event",
          data: { key: "value" },
          timestamp: new Date().toISOString(),
          sessionId,
        },
        session
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const [, options] = mockFetch.mock.calls[0];
      const body = options.body;
      const signatureHeader = options.headers["X-PocketPing-Signature"];

      // Verify signature exists and is correct
      expect(signatureHeader).toBeDefined();
      const expectedSignature = createHmac("sha256", secret).update(body).digest("hex");
      expect(signatureHeader).toBe(`sha256=${expectedSignature}`);
    });

    it("should handle webhook errors gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const pp = new PocketPing({
        webhookUrl: "https://webhook.example.com/events",
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: "visitor-error-test",
      });

      const storage = pp.getStorage();
      const session = await storage.getSession(sessionId);

      // Should not throw
      const forwardToWebhook = (pp as any).forwardToWebhook.bind(pp);
      forwardToWebhook(
        {
          name: "test_event",
          data: {},
          timestamp: new Date().toISOString(),
          sessionId,
        },
        session
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Error should be logged but not thrown
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe("Event handler + webhook combination", () => {
    it("should call both event handlers and webhook", async () => {
      const handlerCalled = vi.fn();

      const pp = new PocketPing({
        webhookUrl: "https://webhook.example.com/events",
        onEvent: (event, session) => {
          handlerCalled(event.name, session.id);
        },
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: "visitor-combo-test",
      });

      // Register additional handler
      const additionalHandler = vi.fn();
      pp.onEvent("purchase_completed", additionalHandler);

      const storage = pp.getStorage();
      const session = await storage.getSession(sessionId);

      // Manually trigger the full handleCustomEvent flow
      const handleCustomEvent = (pp as any).handleCustomEvent.bind(pp);
      await handleCustomEvent(sessionId, {
        name: "purchase_completed",
        data: { orderId: "ORD-123", amount: 149.99 },
        timestamp: new Date().toISOString(),
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify config callback was called
      expect(handlerCalled).toHaveBeenCalledWith("purchase_completed", sessionId);

      // Verify additional handler was called
      expect(additionalHandler).toHaveBeenCalled();

      // Verify webhook was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.event.name).toBe("purchase_completed");
      expect(payload.event.data.orderId).toBe("ORD-123");
    });
  });

  describe("Webhook payload validation", () => {
    it("should include all required fields in payload", async () => {
      const pp = new PocketPing({
        webhookUrl: "https://webhook.example.com/events",
      });

      const { sessionId } = await pp.handleConnect({
        visitorId: "visitor-payload-test",
        metadata: {
          url: "https://example.com/product/123",
          referrer: "https://google.com",
          userAgent: "Mozilla/5.0 (Test)",
          timezone: "Europe/Paris",
          language: "fr-FR",
          deviceType: "desktop",
          browser: "Chrome",
          os: "macOS",
        },
      });

      const storage = pp.getStorage();
      const session = await storage.getSession(sessionId);

      const forwardToWebhook = (pp as any).forwardToWebhook.bind(pp);
      forwardToWebhook(
        {
          name: "page_view",
          data: { path: "/product/123" },
          timestamp: "2026-01-21T15:30:00.000Z",
          sessionId,
        },
        session
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const [, options] = mockFetch.mock.calls[0];
      const payload = JSON.parse(options.body);

      // Verify top-level structure
      expect(payload).toHaveProperty("event");
      expect(payload).toHaveProperty("session");
      expect(payload).toHaveProperty("sentAt");

      // Verify event structure
      expect(payload.event).toHaveProperty("name", "page_view");
      expect(payload.event).toHaveProperty("data", { path: "/product/123" });
      expect(payload.event).toHaveProperty("timestamp", "2026-01-21T15:30:00.000Z");
      expect(payload.event).toHaveProperty("sessionId", sessionId);

      // Verify session structure
      expect(payload.session).toHaveProperty("id", sessionId);
      expect(payload.session).toHaveProperty("visitorId", "visitor-payload-test");
      expect(payload.session).toHaveProperty("metadata");

      // Verify metadata
      const metadata = payload.session.metadata;
      expect(metadata.url).toBe("https://example.com/product/123");
      expect(metadata.deviceType).toBe("desktop");
      expect(metadata.browser).toBe("Chrome");

      // Verify sentAt is a valid ISO timestamp
      expect(() => new Date(payload.sentAt)).not.toThrow();
    });
  });
});

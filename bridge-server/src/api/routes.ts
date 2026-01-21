/**
 * HTTP API routes for Bridge Server
 */

import { createHmac } from "crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Bridge } from "../bridges/base";
import type {
  IncomingEvent,
  NewSessionEvent,
  VisitorMessageEvent,
  AITakeoverEvent,
  OperatorStatusEvent,
  MessageReadEvent,
  CustomEventEvent,
  IdentityUpdateEvent,
  OutgoingEvent,
  BridgeServerConfig,
  CustomEvent,
  Session,
  VersionCheckResult,
  VersionStatus,
} from "../types";

interface AppContext {
  bridges: Bridge[];
  config: BridgeServerConfig;
  eventListeners: Set<(event: OutgoingEvent) => void>;
}

export function createApp(context: AppContext): Hono {
  const app = new Hono();

  // Middleware
  app.use("*", cors());
  app.use("*", logger());

  // API Key middleware
  app.use("/api/*", async (c, next) => {
    if (context.config.apiKey) {
      const authHeader = c.req.header("Authorization");
      const providedKey = authHeader?.replace("Bearer ", "");

      if (providedKey !== context.config.apiKey) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    }
    await next();
  });

  // Health check
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      bridges: context.bridges.map((b) => b.name),
    });
  });

  // Receive events from backend
  app.post("/api/events", async (c) => {
    const event = (await c.req.json()) as IncomingEvent;

    try {
      switch (event.type) {
        case "new_session":
          await handleNewSession(context.bridges, event);
          break;
        case "visitor_message":
          await handleVisitorMessage(context.bridges, event);
          break;
        case "ai_takeover":
          await handleAITakeover(context.bridges, event);
          break;
        case "operator_status":
          await handleOperatorStatus(context.bridges, event);
          break;
        case "message_read":
          await handleMessageRead(context.bridges, event);
          break;
        case "custom_event":
          await handleCustomEvent(context.bridges, event, context.config);
          break;
        case "identity_update":
          await handleIdentityUpdate(context.bridges, event);
          break;
        default:
          return c.json({ error: "Unknown event type" }, 400);
      }

      return c.json({ ok: true });
    } catch (error) {
      console.error("[API] Error handling event:", error);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // Specific endpoints for convenience
  app.post("/api/sessions", async (c) => {
    const session = await c.req.json();
    const event: NewSessionEvent = { type: "new_session", session };
    await handleNewSession(context.bridges, event);
    return c.json({ ok: true });
  });

  app.post("/api/messages", async (c) => {
    const { message, session } = await c.req.json();
    const event: VisitorMessageEvent = { type: "visitor_message", message, session };
    await handleVisitorMessage(context.bridges, event);
    return c.json({ ok: true });
  });

  app.post("/api/operator/status", async (c) => {
    const { online } = await c.req.json();
    const event: OperatorStatusEvent = { type: "operator_status", online };
    await handleOperatorStatus(context.bridges, event);
    return c.json({ ok: true });
  });

  // Custom events endpoint
  app.post("/api/custom-events", async (c) => {
    const { event: customEvent, session } = await c.req.json();
    const eventPayload: CustomEventEvent = { type: "custom_event", event: customEvent, session };
    await handleCustomEvent(context.bridges, eventPayload, context.config);
    return c.json({ ok: true });
  });

  // SSE endpoint for receiving events from bridges (outgoing events)
  app.get("/api/events/stream", async (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const listener = (event: OutgoingEvent) => {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        };

        context.eventListeners.add(listener);

        // Send heartbeat every 30 seconds
        const heartbeat = setInterval(() => {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }, 30000);

        // Cleanup on close
        c.req.raw.signal.addEventListener("abort", () => {
          context.eventListeners.delete(listener);
          clearInterval(heartbeat);
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return app;
}

async function handleNewSession(bridges: Bridge[], event: NewSessionEvent): Promise<void> {
  await Promise.all(bridges.map((bridge) => bridge.onNewSession(event.session)));
}

async function handleVisitorMessage(bridges: Bridge[], event: VisitorMessageEvent): Promise<void> {
  await Promise.all(bridges.map((bridge) => bridge.onVisitorMessage(event.message, event.session)));
}

async function handleAITakeover(bridges: Bridge[], event: AITakeoverEvent): Promise<void> {
  await Promise.all(bridges.map((bridge) => bridge.onAITakeover(event.session, event.reason)));
}

async function handleOperatorStatus(bridges: Bridge[], event: OperatorStatusEvent): Promise<void> {
  await Promise.all(bridges.map((bridge) => bridge.onOperatorStatusChange(event.online)));
}

async function handleMessageRead(bridges: Bridge[], event: MessageReadEvent): Promise<void> {
  await Promise.all(
    bridges.map((bridge) => bridge.onMessageRead(event.sessionId, event.messageIds, event.status))
  );
}

async function handleCustomEvent(
  bridges: Bridge[],
  event: CustomEventEvent,
  config: BridgeServerConfig
): Promise<void> {
  // Forward to bridges
  await Promise.all(bridges.map((bridge) => bridge.onCustomEvent(event.event, event.session)));

  // Forward to events webhook if configured (non-blocking)
  if (config.eventsWebhookUrl) {
    forwardToEventsWebhook(event.event, event.session, config).catch((err) => {
      console.error("[API] Events webhook error:", err);
    });
  }
}

async function handleIdentityUpdate(bridges: Bridge[], event: IdentityUpdateEvent): Promise<void> {
  await Promise.all(bridges.map((bridge) => bridge.onIdentityUpdate(event.session)));
}

/**
 * Forward custom event to the configured events webhook URL
 * Used for integrations with Zapier, Make, n8n, or custom backends
 */
async function forwardToEventsWebhook(
  event: CustomEvent,
  session: Session,
  config: BridgeServerConfig
): Promise<void> {
  if (!config.eventsWebhookUrl) return;

  const payload = {
    event: {
      name: event.name,
      data: event.data,
      timestamp: event.timestamp,
      sessionId: event.sessionId,
    },
    session: {
      id: session.id,
      visitorId: session.visitorId,
      metadata: session.metadata,
    },
    sentAt: new Date().toISOString(),
  };

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Add HMAC signature if secret is configured
  if (config.eventsWebhookSecret) {
    const signature = createHmac("sha256", config.eventsWebhookSecret)
      .update(body)
      .digest("hex");
    headers["X-PocketPing-Signature"] = `sha256=${signature}`;
  }

  const response = await fetch(config.eventsWebhookUrl, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    console.error(`[API] Events webhook returned ${response.status}: ${response.statusText}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// Version Checking Helpers (exported for custom integrations)
// ─────────────────────────────────────────────────────────────────

/**
 * Parse semver version string to comparable array
 * @example "0.2.1" -> [0, 2, 1]
 */
function parseVersion(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

/**
 * Compare two semver versions
 * @returns -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const vA = parseVersion(a);
  const vB = parseVersion(b);
  const len = Math.max(vA.length, vB.length);

  for (let i = 0; i < len; i++) {
    const numA = vA[i] ?? 0;
    const numB = vB[i] ?? 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

/**
 * Check widget version against configured min/latest versions
 * Exported for custom integrations that need version checking
 */
export function checkWidgetVersion(
  widgetVersion: string | undefined,
  config: BridgeServerConfig
): VersionCheckResult {
  // No version header = unknown
  if (!widgetVersion) {
    return {
      status: "ok",
      canContinue: true,
    };
  }

  const { minWidgetVersion, latestWidgetVersion } = config;

  // No version constraints configured
  if (!minWidgetVersion && !latestWidgetVersion) {
    return {
      status: "ok",
      canContinue: true,
    };
  }

  let status: VersionStatus = "ok";
  let message: string | undefined;
  let canContinue = true;

  // Check against minimum version
  if (minWidgetVersion && compareVersions(widgetVersion, minWidgetVersion) < 0) {
    status = "unsupported";
    message =
      config.versionWarningMessage ||
      `Widget version ${widgetVersion} is no longer supported. Minimum version: ${minWidgetVersion}`;
    canContinue = false;
  }
  // Check against latest version (for deprecation warnings)
  else if (latestWidgetVersion && compareVersions(widgetVersion, latestWidgetVersion) < 0) {
    const majorDiff = parseVersion(latestWidgetVersion)[0] - parseVersion(widgetVersion)[0];

    if (majorDiff >= 1) {
      status = "deprecated";
      message =
        config.versionWarningMessage ||
        `Widget version ${widgetVersion} is deprecated. Please update to ${latestWidgetVersion}`;
    } else {
      status = "outdated";
      message = `A newer widget version ${latestWidgetVersion} is available`;
    }
  }

  return {
    status,
    message,
    minVersion: minWidgetVersion,
    latestVersion: latestWidgetVersion,
    canContinue,
  };
}

/**
 * Get version warning headers for HTTP response
 */
export function getVersionHeaders(versionCheck: VersionCheckResult): Record<string, string> {
  if (versionCheck.status === "ok") {
    return {};
  }

  const headers: Record<string, string> = {
    "X-PocketPing-Version-Status": versionCheck.status,
  };

  if (versionCheck.minVersion) {
    headers["X-PocketPing-Min-Version"] = versionCheck.minVersion;
  }
  if (versionCheck.latestVersion) {
    headers["X-PocketPing-Latest-Version"] = versionCheck.latestVersion;
  }
  if (versionCheck.message) {
    headers["X-PocketPing-Version-Message"] = versionCheck.message;
  }

  return headers;
}

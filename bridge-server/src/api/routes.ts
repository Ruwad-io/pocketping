/**
 * HTTP API routes for Bridge Server
 */

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
  OutgoingEvent,
  BridgeServerConfig,
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

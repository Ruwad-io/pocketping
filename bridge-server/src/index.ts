/**
 * PocketPing Bridge Server
 *
 * A standalone server that handles all notification bridges (Telegram, Discord, Slack)
 * and communicates with backends via HTTP/SSE.
 */

import { serve } from "bun";
import { loadConfig } from "./config";
import { createApp } from "./api/routes";
import { Bridge, TelegramBridge, DiscordBridge, SlackBridge } from "./bridges";
import type { OutgoingEvent } from "./types";

async function main() {
  console.log("🚀 PocketPing Bridge Server starting...\n");

  // Load configuration
  const config = loadConfig();

  // Initialize bridges
  const bridges: Bridge[] = [];
  const eventListeners = new Set<(event: OutgoingEvent) => void>();

  // Event callback that broadcasts to SSE listeners and webhook
  const eventCallback = async (event: OutgoingEvent) => {
    // Notify SSE listeners
    eventListeners.forEach((listener) => listener(event));

    // Send to webhook if configured
    if (config.backendWebhookUrl) {
      try {
        await fetch(config.backendWebhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
          },
          body: JSON.stringify(event),
        });
      } catch (error) {
        console.error("[Bridge Server] Failed to send webhook:", error);
      }
    }

    // Cross-bridge sync: notify other bridges about operator messages
    if (event.type === "operator_message") {
      const message = {
        id: `bridge-${Date.now()}`,
        sessionId: event.sessionId,
        content: event.content,
        sender: "operator" as const,
        timestamp: new Date(),
      };

      // We need the session to sync - fetch it or use a minimal version
      const session = {
        id: event.sessionId,
        visitorId: "",
        createdAt: new Date(),
        lastActivity: new Date(),
        operatorOnline: true,
        aiActive: false,
      };

      // Notify all bridges about this operator message
      for (const bridge of bridges) {
        if (bridge.name !== event.sourceBridge) {
          try {
            await bridge.onOperatorMessage(message, session, event.sourceBridge, event.operatorName);
          } catch (error) {
            console.error(`[Bridge Server] Error syncing to ${bridge.name}:`, error);
          }
        }
      }
    }
  };

  // Initialize Telegram bridge
  if (config.telegram) {
    console.log("[Bridge Server] Initializing Telegram bridge...");
    const telegram = new TelegramBridge(config.telegram);
    telegram.setEventCallback(eventCallback);
    await telegram.init();
    bridges.push(telegram);
  }

  // Initialize Discord bridge
  if (config.discord) {
    console.log("[Bridge Server] Initializing Discord bridge...");
    const discord = new DiscordBridge(config.discord);
    discord.setEventCallback(eventCallback);
    await discord.init();
    bridges.push(discord);
  }

  // Initialize Slack bridge
  if (config.slack) {
    console.log("[Bridge Server] Initializing Slack bridge...");
    const slack = new SlackBridge(config.slack);
    slack.setEventCallback(eventCallback);
    await slack.init();
    bridges.push(slack);
  }

  if (bridges.length === 0) {
    console.warn("\n⚠️  No bridges configured! Set environment variables to enable bridges.");
    console.log("\nExample .env file:");
    console.log("  TELEGRAM_BOT_TOKEN=your_token");
    console.log("  TELEGRAM_FORUM_CHAT_ID=your_chat_id");
    console.log("");
  }

  // Create HTTP server
  const app = createApp({ bridges, config, eventListeners });

  // Start server
  serve({
    fetch: app.fetch,
    port: config.port,
  });

  console.log(`\n✅ Bridge Server running on http://localhost:${config.port}`);
  console.log(`   Enabled bridges: ${bridges.map((b) => b.name).join(", ") || "none"}`);
  console.log("\nEndpoints:");
  console.log(`   GET  /health              - Health check`);
  console.log(`   POST /api/events          - Receive events from backend`);
  console.log(`   POST /api/sessions        - New session notification`);
  console.log(`   POST /api/messages        - Visitor message notification`);
  console.log(`   POST /api/operator/status - Update operator status`);
  console.log(`   POST /api/custom-events   - Custom event notification`);
  console.log(`   GET  /api/events/stream   - SSE stream of operator events`);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n\n🛑 Shutting down Bridge Server...");
    for (const bridge of bridges) {
      await bridge.destroy();
    }
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\n\n🛑 Shutting down Bridge Server...");
    for (const bridge of bridges) {
      await bridge.destroy();
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Failed to start Bridge Server:", error);
  process.exit(1);
});

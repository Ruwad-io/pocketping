/**
 * Configuration loader from environment variables
 */

import type {
  BridgeServerConfig,
  TelegramConfig,
  DiscordConfig,
  SlackConfig,
  IpFilterConfigOptions,
  IpFilterMode,
} from "./types";

function getTelegramConfig(): TelegramConfig | undefined {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return undefined;

  const forumChatId = process.env.TELEGRAM_FORUM_CHAT_ID
    ? parseInt(process.env.TELEGRAM_FORUM_CHAT_ID, 10)
    : undefined;
  const chatId = process.env.TELEGRAM_CHAT_ID
    ? parseInt(process.env.TELEGRAM_CHAT_ID, 10)
    : undefined;

  if (!forumChatId && !chatId) {
    console.warn("[Config] Telegram bot token provided but no chat ID configured");
    return undefined;
  }

  return {
    botToken,
    forumChatId,
    chatId,
  };
}

function getDiscordConfig(): DiscordConfig | undefined {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!botToken || !channelId) return undefined;

  const useThreads = process.env.DISCORD_USE_THREADS !== "false";
  const autoArchiveDuration = process.env.DISCORD_AUTO_ARCHIVE_DURATION
    ? parseInt(process.env.DISCORD_AUTO_ARCHIVE_DURATION, 10)
    : 1440;

  return {
    botToken,
    channelId,
    useThreads,
    autoArchiveDuration,
  };
}

function getSlackConfig(): SlackConfig | undefined {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (!botToken || !appToken || !channelId) return undefined;

  return {
    botToken,
    appToken,
    channelId,
  };
}

function getIpFilterConfig(): IpFilterConfigOptions | undefined {
  const enabled = process.env.IP_FILTER_ENABLED === "true";
  if (!enabled) return undefined;

  const mode = (process.env.IP_FILTER_MODE as IpFilterMode) || "blocklist";

  // Parse comma-separated lists
  const blocklist = process.env.IP_FILTER_BLOCKLIST
    ? process.env.IP_FILTER_BLOCKLIST.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const allowlist = process.env.IP_FILTER_ALLOWLIST
    ? process.env.IP_FILTER_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const logBlocked = process.env.IP_FILTER_LOG_BLOCKED !== "false";
  const blockedStatusCode = process.env.IP_FILTER_BLOCKED_STATUS_CODE
    ? parseInt(process.env.IP_FILTER_BLOCKED_STATUS_CODE, 10)
    : 403;
  const blockedMessage = process.env.IP_FILTER_BLOCKED_MESSAGE || "Forbidden";

  return {
    enabled,
    mode,
    allowlist,
    blocklist,
    logBlocked,
    blockedStatusCode,
    blockedMessage,
  };
}

export function loadConfig(): BridgeServerConfig {
  const port = parseInt(process.env.PORT || "3001", 10);
  const apiKey = process.env.API_KEY;
  const backendWebhookUrl = process.env.BACKEND_WEBHOOK_URL;
  const eventsWebhookUrl = process.env.EVENTS_WEBHOOK_URL;
  const eventsWebhookSecret = process.env.EVENTS_WEBHOOK_SECRET;

  // Version management
  const minWidgetVersion = process.env.MIN_WIDGET_VERSION;
  const latestWidgetVersion = process.env.LATEST_WIDGET_VERSION;
  const versionWarningMessage = process.env.VERSION_WARNING_MESSAGE;
  const versionUpgradeUrl = process.env.VERSION_UPGRADE_URL;

  const ipFilter = getIpFilterConfig();

  const config: BridgeServerConfig = {
    port,
    apiKey,
    backendWebhookUrl,
    eventsWebhookUrl,
    eventsWebhookSecret,
    minWidgetVersion,
    latestWidgetVersion,
    versionWarningMessage,
    versionUpgradeUrl,
    telegram: getTelegramConfig(),
    discord: getDiscordConfig(),
    slack: getSlackConfig(),
    ipFilter,
  };

  // Log enabled bridges
  const enabledBridges: string[] = [];
  if (config.telegram) {
    enabledBridges.push(config.telegram.forumChatId ? "Telegram (Forum Topics)" : "Telegram (Legacy)");
  }
  if (config.discord) {
    enabledBridges.push(config.discord.useThreads ? "Discord (Threads)" : "Discord (Legacy)");
  }
  if (config.slack) {
    enabledBridges.push("Slack");
  }

  if (enabledBridges.length === 0) {
    console.warn("[Config] No bridges configured! Set environment variables to enable bridges.");
  } else {
    console.log(`[Config] Enabled bridges: ${enabledBridges.join(", ")}`);
  }

  // Log IP filter status
  if (config.ipFilter?.enabled) {
    const filterInfo = [
      `mode: ${config.ipFilter.mode}`,
      config.ipFilter.blocklist?.length ? `blocklist: ${config.ipFilter.blocklist.length} entries` : null,
      config.ipFilter.allowlist?.length ? `allowlist: ${config.ipFilter.allowlist.length} entries` : null,
    ].filter(Boolean).join(", ");
    console.log(`[Config] IP filtering enabled (${filterInfo})`);
  }

  return config;
}

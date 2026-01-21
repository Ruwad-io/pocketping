/**
 * Configuration loader from environment variables
 */

import type { BridgeServerConfig, TelegramConfig, DiscordConfig, SlackConfig } from "./types";

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

  return config;
}

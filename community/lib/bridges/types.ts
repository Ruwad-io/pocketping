/**
 * Bridge types for PocketPing Community Edition
 */

export interface SessionInfo {
  id: string
  visitorId: string
  userName?: string | null
  userEmail?: string | null
  userPhone?: string | null
  userAgent?: string | null
  url?: string | null
  referrer?: string | null
  country?: string | null
  city?: string | null
}

export interface AttachmentData {
  filename: string
  url: string
  mimeType: string
  size: number
}

export interface BridgeMessageResult {
  messageId?: string | number
  threadId?: string
}

// Telegram types
export interface TelegramConfig {
  botToken: string
  chatId: string
}

// Discord types
export interface DiscordConfig {
  botToken: string
  channelId: string
}

// Slack types
export interface SlackConfig {
  botToken: string
  channelId: string
}

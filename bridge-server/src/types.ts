/**
 * Core types for PocketPing Bridge Server
 */

export interface SessionMetadata {
  // Page info
  url?: string;
  referrer?: string;
  pageTitle?: string;

  // Client info
  userAgent?: string;
  timezone?: string;
  language?: string;
  screenResolution?: string;

  // Geo info (populated server-side from IP)
  ip?: string;
  country?: string;
  city?: string;

  // Device info (parsed from user agent)
  deviceType?: "desktop" | "mobile" | "tablet";
  browser?: string;
  os?: string;
}

export interface Session {
  id: string;
  visitorId: string;
  createdAt: Date;
  lastActivity: Date;
  operatorOnline: boolean;
  aiActive: boolean;
  metadata?: SessionMetadata;
}

export type SenderType = "visitor" | "operator" | "ai";
export type MessageStatus = "sending" | "sent" | "delivered" | "read";

export interface Message {
  id: string;
  sessionId: string;
  content: string;
  sender: SenderType;
  timestamp: Date;
  replyTo?: string;

  // Read receipt fields
  status?: MessageStatus;
  deliveredAt?: Date;
  readAt?: Date;
}

// Events sent TO the Bridge Server (from backends)
export interface NewSessionEvent {
  type: "new_session";
  session: Session;
}

export interface VisitorMessageEvent {
  type: "visitor_message";
  message: Message;
  session: Session;
}

export interface AITakeoverEvent {
  type: "ai_takeover";
  session: Session;
  reason: string;
}

export interface OperatorStatusEvent {
  type: "operator_status";
  online: boolean;
}

export interface MessageReadEvent {
  type: "message_read";
  sessionId: string;
  messageIds: string[];
  status: MessageStatus;
  readAt?: Date;
  deliveredAt?: Date;
}

export type IncomingEvent =
  | NewSessionEvent
  | VisitorMessageEvent
  | AITakeoverEvent
  | OperatorStatusEvent
  | MessageReadEvent;

// Events sent FROM the Bridge Server (to backends)
export interface OperatorMessageEvent {
  type: "operator_message";
  sessionId: string;
  content: string;
  sourceBridge: string;
  operatorName?: string;
}

export interface OperatorTypingEvent {
  type: "operator_typing";
  sessionId: string;
  isTyping: boolean;
  sourceBridge: string;
}

export interface SessionClosedEvent {
  type: "session_closed";
  sessionId: string;
  sourceBridge: string;
}

export interface MessageDeliveredEvent {
  type: "message_delivered";
  sessionId: string;
  messageId: string;
  sourceBridge: string;
}

export interface MessageReadByReactionEvent {
  type: "message_read_by_reaction";
  sessionId: string;
  messageIds: string[];
  sourceBridge: string;
}

export type OutgoingEvent =
  | OperatorMessageEvent
  | OperatorTypingEvent
  | SessionClosedEvent
  | MessageDeliveredEvent
  | MessageReadByReactionEvent;

// Bridge configuration
export interface TelegramConfig {
  botToken: string;
  forumChatId?: number; // For Forum Topics mode
  chatId?: number; // For legacy mode
}

export interface DiscordConfig {
  botToken: string;
  channelId: string;
  useThreads?: boolean;
  autoArchiveDuration?: number;
}

export interface SlackConfig {
  botToken: string;
  appToken: string;
  channelId: string;
}

export interface BridgeServerConfig {
  port: number;
  apiKey?: string;
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
  slack?: SlackConfig;
  backendWebhookUrl?: string; // URL to send operator messages to
}

// Callback for sending events back to the backend
export type EventCallback = (event: OutgoingEvent) => Promise<void>;

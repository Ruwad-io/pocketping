/**
 * Core types for PocketPing Bridge Server
 */

export interface SessionMetadata {
  url?: string;
  referrer?: string;
  userAgent?: string;
  timezone?: string;
  language?: string;
  screenWidth?: number;
  screenHeight?: number;
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

export interface Message {
  id: string;
  sessionId: string;
  content: string;
  sender: SenderType;
  timestamp: Date;
  replyTo?: string;
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

export type IncomingEvent =
  | NewSessionEvent
  | VisitorMessageEvent
  | AITakeoverEvent
  | OperatorStatusEvent;

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

export type OutgoingEvent =
  | OperatorMessageEvent
  | OperatorTypingEvent
  | SessionClosedEvent;

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

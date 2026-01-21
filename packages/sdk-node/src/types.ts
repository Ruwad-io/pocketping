import type { Storage } from './storage/types';
import type { Bridge } from './bridges/types';
import type { AIProvider } from './ai/types';

export interface PocketPingConfig {
  /** Storage adapter for sessions and messages */
  storage?: Storage | 'memory';

  /** Notification bridges (Telegram, Discord, etc.) */
  bridges?: Bridge[];

  /** AI fallback configuration */
  ai?: AIConfig;

  /** Welcome message shown to new visitors */
  welcomeMessage?: string;

  /** Seconds of inactivity before AI takes over (default: 300) */
  aiTakeoverDelay?: number;

  /** Callback when a new session is created */
  onNewSession?: (session: Session) => void | Promise<void>;

  /** Callback when a message is received */
  onMessage?: (message: Message, session: Session) => void | Promise<void>;

  /** Callback when a custom event is received from widget */
  onEvent?: (event: CustomEvent, session: Session) => void | Promise<void>;

  // ─────────────────────────────────────────────────────────────────
  // Webhook Configuration (forward events to external services)
  // ─────────────────────────────────────────────────────────────────

  /** Webhook URL to forward custom events (Zapier, Make, n8n, etc.) */
  webhookUrl?: string;

  /** Secret key for HMAC-SHA256 signature (X-PocketPing-Signature header) */
  webhookSecret?: string;

  /** Webhook request timeout in milliseconds (default: 5000) */
  webhookTimeout?: number;

  // ─────────────────────────────────────────────────────────────────
  // Version Management
  // ─────────────────────────────────────────────────────────────────

  /** Minimum supported widget version (e.g., "0.2.0") */
  minWidgetVersion?: string;

  /** Latest available widget version (e.g., "0.3.0") */
  latestWidgetVersion?: string;

  /** Custom message for version warnings */
  versionWarningMessage?: string;

  /** URL to upgrade instructions */
  versionUpgradeUrl?: string;
}

export interface AIConfig {
  provider: AIProvider | 'openai' | 'gemini' | 'anthropic';
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
  fallbackAfter?: number; // seconds
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
  deviceType?: 'desktop' | 'mobile' | 'tablet';
  browser?: string;
  os?: string;

  // Allow custom fields
  [key: string]: unknown;
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read';

export interface Message {
  id: string;
  sessionId: string;
  content: string;
  sender: 'visitor' | 'operator' | 'ai';
  timestamp: Date;
  replyTo?: string;
  metadata?: Record<string, unknown>;

  // Read receipt fields
  status?: MessageStatus;
  deliveredAt?: Date;
  readAt?: Date;
}

// Request/Response types

export interface ConnectRequest {
  visitorId: string;
  sessionId?: string;
  metadata?: SessionMetadata;
}

export interface ConnectResponse {
  sessionId: string;
  visitorId: string;
  operatorOnline: boolean;
  welcomeMessage?: string;
  messages: Message[];
}

export interface SendMessageRequest {
  sessionId: string;
  content: string;
  sender: 'visitor' | 'operator';
  replyTo?: string;
}

export interface SendMessageResponse {
  messageId: string;
  timestamp: string;
}

export interface GetMessagesRequest {
  sessionId: string;
  after?: string;
  limit?: number;
}

export interface GetMessagesResponse {
  messages: Message[];
  hasMore: boolean;
}

export interface TypingRequest {
  sessionId: string;
  sender: 'visitor' | 'operator';
  isTyping?: boolean;
}

export interface ReadRequest {
  sessionId: string;
  messageIds: string[];
  status?: MessageStatus;
}

export interface ReadResponse {
  updated: number;
}

export interface PresenceResponse {
  online: boolean;
  operators?: Array<{
    id: string;
    name: string;
    avatar?: string;
  }>;
  aiEnabled: boolean;
  aiActiveAfter?: number;
}

// ─────────────────────────────────────────────────────────────────
// Custom Events (bidirectional communication)
// ─────────────────────────────────────────────────────────────────

/** Custom event sent from widget to backend or vice versa */
export interface CustomEvent {
  /** Event name (e.g., 'clicked_pricing', 'show_offer') */
  name: string;
  /** Event payload */
  data?: Record<string, unknown>;
  /** Timestamp of the event */
  timestamp: string;
  /** Session ID (populated by SDK when event comes from widget) */
  sessionId?: string;
}

/** Handler for custom events */
export type CustomEventHandler = (
  event: CustomEvent,
  session: Session
) => void | Promise<void>;

// ─────────────────────────────────────────────────────────────────
// Version Management Types
// ─────────────────────────────────────────────────────────────────

export type VersionStatus = 'ok' | 'outdated' | 'deprecated' | 'unsupported';

export interface VersionCheckResult {
  status: VersionStatus;
  message?: string;
  minVersion?: string;
  latestVersion?: string;
  canContinue: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Webhook Types
// ─────────────────────────────────────────────────────────────────

/** Payload sent to webhook URL */
export interface WebhookPayload {
  /** The custom event */
  event: CustomEvent;
  /** Session information */
  session: {
    id: string;
    visitorId: string;
    metadata?: SessionMetadata;
  };
  /** Timestamp when webhook was sent */
  sentAt: string;
}

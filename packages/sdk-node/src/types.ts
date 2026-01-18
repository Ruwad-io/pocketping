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
  url?: string;
  referrer?: string;
  userAgent?: string;
  timezone?: string;
  language?: string;
  [key: string]: unknown;
}

export interface Message {
  id: string;
  sessionId: string;
  content: string;
  sender: 'visitor' | 'operator' | 'ai';
  timestamp: Date;
  replyTo?: string;
  metadata?: Record<string, unknown>;
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

export interface PocketPingConfig {
  /** Your backend endpoint (e.g., "https://yoursite.com/pocketping") */
  endpoint: string;

  /** Color theme */
  theme?: 'light' | 'dark' | 'auto';

  /** Widget position */
  position?: 'bottom-right' | 'bottom-left';

  /** Primary brand color */
  primaryColor?: string;

  /** Welcome message shown when chat opens */
  welcomeMessage?: string;

  /** Placeholder text for input */
  placeholder?: string;

  /** Company/operator name */
  operatorName?: string;

  /** Operator avatar URL */
  operatorAvatar?: string;

  /** Only show on certain pages (regex patterns) */
  showOnPages?: string[];

  /** Hide on certain pages (regex patterns) */
  hideOnPages?: string[];

  /** Delay before showing widget (ms) */
  showDelay?: number;

  /** Custom CSS to inject */
  customCSS?: string;

  /** Callbacks */
  onOpen?: () => void;
  onClose?: () => void;
  onMessage?: (message: Message) => void;
  onConnect?: (sessionId: string) => void;
}

export interface Message {
  id: string;
  sessionId: string;
  content: string;
  sender: 'visitor' | 'operator' | 'ai';
  timestamp: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface Session {
  sessionId: string;
  visitorId: string;
  operatorOnline: boolean;
  messages: Message[];
}

export interface ConnectResponse {
  sessionId: string;
  visitorId: string;
  operatorOnline?: boolean;
  welcomeMessage?: string;
  messages?: Message[];
}

export interface SendMessageResponse {
  messageId: string;
  timestamp: string;
}

export interface PresenceResponse {
  online: boolean;
  operators?: Array<{
    id: string;
    name: string;
    avatar?: string;
  }>;
  aiEnabled?: boolean;
  aiActiveAfter?: number;
}

export type WebSocketEventType = 'message' | 'typing' | 'presence' | 'ai_takeover';

export interface WebSocketEvent {
  type: WebSocketEventType;
  data: unknown;
}

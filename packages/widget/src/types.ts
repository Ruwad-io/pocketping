export interface PocketPingConfig {
  // ─────────────────────────────────────────────────────────────────
  // Required
  // ─────────────────────────────────────────────────────────────────

  /** Your backend endpoint (e.g., "https://yoursite.com/pocketping") */
  endpoint: string;

  // ─────────────────────────────────────────────────────────────────
  // Branding
  // ─────────────────────────────────────────────────────────────────

  /** Company/operator name displayed in header */
  operatorName?: string;

  /** Operator/company avatar URL (displayed in header) */
  operatorAvatar?: string;

  /** Company logo URL (displayed in header, alternative to avatar) */
  logoUrl?: string;

  /** Header title (defaults to operatorName) */
  headerTitle?: string;

  /** Header subtitle (e.g., "We usually reply within minutes") */
  headerSubtitle?: string;

  /** Welcome message shown when chat opens */
  welcomeMessage?: string;

  /** Placeholder text for message input */
  placeholder?: string;

  // ─────────────────────────────────────────────────────────────────
  // Appearance
  // ─────────────────────────────────────────────────────────────────

  /** Color theme */
  theme?: 'light' | 'dark' | 'auto';

  /** Primary brand color (hex, e.g., "#6366f1") */
  primaryColor?: string;

  /** Text color on primary background (defaults to white) */
  primaryTextColor?: string;

  /** Widget position */
  position?: 'bottom-right' | 'bottom-left';

  /** Distance from edge in pixels (default: 20) */
  offset?: number;

  /** Border radius in pixels (default: 16) */
  borderRadius?: number;

  /** Font family (defaults to system font stack) */
  fontFamily?: string;

  /** Z-index for widget (default: 9999) */
  zIndex?: number;

  /** Toggle button icon: 'chat' | 'message' | 'help' | custom SVG string */
  toggleIcon?: 'chat' | 'message' | 'help' | string;

  /** Custom CSS to inject (for advanced customization) */
  customCSS?: string;

  // ─────────────────────────────────────────────────────────────────
  // Behavior
  // ─────────────────────────────────────────────────────────────────

  /** Only show on certain pages (regex patterns) */
  showOnPages?: string[];

  /** Hide on certain pages (regex patterns) */
  hideOnPages?: string[];

  /** Delay before showing widget in ms (default: 0) */
  showDelay?: number;

  /** Auto-open chat after delay in ms (0 = disabled) */
  autoOpenDelay?: number;

  /** Play sound on new message */
  soundEnabled?: boolean;

  /** Show unread badge on toggle button */
  showUnreadBadge?: boolean;

  /** Persist chat open/closed state in localStorage */
  persistOpenState?: boolean;

  // ─────────────────────────────────────────────────────────────────
  // Callbacks
  // ─────────────────────────────────────────────────────────────────

  /** Called when chat window opens */
  onOpen?: () => void;

  /** Called when chat window closes */
  onClose?: () => void;

  /** Called when a message is received */
  onMessage?: (message: Message) => void;

  /** Called when connected to backend */
  onConnect?: (sessionId: string) => void;

  /** Called when connection fails */
  onError?: (error: Error) => void;
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

/**
 * Theme-aware color value
 * Allows setting different colors for light and dark themes
 */
export interface ThemeColor {
  light: string;
  dark: string;
}

/**
 * Gradient color value
 * Creates a linear gradient between two colors
 * @example { from: '#36e3ff', to: '#7c5cff', direction: 'to right' }
 */
export interface GradientColor {
  from: string;
  to: string;
  /** CSS gradient direction (default: 'to right') */
  direction?: 'to right' | 'to left' | 'to bottom' | 'to top' | string;
}

/**
 * Color value that can be a solid color, gradient, or theme-aware
 */
export type ColorValue = string | GradientColor | ThemeColor | ThemeGradientColor;

/**
 * Theme-aware gradient - different gradients for light/dark themes
 */
export interface ThemeGradientColor {
  light: string | GradientColor;
  dark: string | GradientColor;
}

export interface PocketPingConfig {
  // ─────────────────────────────────────────────────────────────────
  // Required (one of endpoint or projectId)
  // ─────────────────────────────────────────────────────────────────

  /** Your backend endpoint for self-hosted (e.g., "https://yoursite.com/pocketping") */
  endpoint?: string;

  /** Project ID for SaaS users (e.g., "proj_xxxxxxxxxxxxx") - from dashboard */
  projectId?: string;

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

  /**
   * Header background color or gradient
   * Can be a solid color, gradient, or theme-aware
   * @example "#7c5cff"
   * @example { from: '#36e3ff', to: '#7c5cff' }
   * @example { light: "#7c5cff", dark: "#202c33" }
   * @example { light: { from: '#36e3ff', to: '#7c5cff' }, dark: "#202c33" }
   */
  headerColor?: ColorValue;

  /**
   * Footer/input area background color
   * Can be a string (same for both themes) or object with light/dark values
   * @example "#f0f2f5" or { light: "#f0f2f5", dark: "#202c33" }
   */
  footerColor?: string | ThemeColor;

  /**
   * Chat background style:
   * - 'whatsapp' (default) - WhatsApp-style pattern
   * - 'dots' - Subtle dot pattern
   * - 'plain' - Solid color only
   * - URL string - Custom image URL
   * Can also be theme-aware with { light: '...', dark: '...' }
   */
  chatBackground?: 'whatsapp' | 'dots' | 'plain' | string | ThemeColor;

  /**
   * Toggle button background color or gradient
   * Can be a solid color, gradient, or theme-aware
   * @example "#7c5cff"
   * @example { from: '#36e3ff', to: '#7c5cff' }
   * @example { light: "#7c5cff", dark: "#7c5cff" }
   */
  toggleColor?: ColorValue;

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

  /** Auto-open chat when operator sends a message (default: true) */
  autoOpenOnMessage?: boolean;

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

  /** Called when a version mismatch is detected */
  onVersionWarning?: (warning: VersionWarning) => void;

  /** Called when a custom event is received from the backend */
  onEvent?: (event: CustomEvent) => void;
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read';

export type AttachmentStatus = 'pending' | 'uploading' | 'ready' | 'failed';

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  status: AttachmentStatus;
}

/** Reply reference - either a string ID or embedded data from SSE */
export interface ReplyToData {
  id: string;
  content: string;
  sender: string;
  deleted?: boolean;
  /** Indicates if the replied message has attachments (e.g., image) */
  hasAttachment?: boolean;
  /** MIME type of the first attachment (for icon display) */
  attachmentType?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  content: string;
  sender: 'visitor' | 'operator' | 'ai';
  timestamp: string;
  /** Reply reference - string ID when sending, object with data from SSE */
  replyTo?: string | ReplyToData;
  metadata?: Record<string, unknown>;
  attachments?: Attachment[];

  // Read receipt fields
  status?: MessageStatus;
  deliveredAt?: string;
  readAt?: string;

  // Edit/delete fields
  editedAt?: string;
  deletedAt?: string;
}

export interface Session {
  sessionId: string;
  visitorId: string;
  operatorOnline: boolean;
  messages: Message[];
  /** User identity if identified via PocketPing.identify() */
  identity?: UserIdentity;
  /** Pre-chat form configuration */
  preChatForm?: PreChatFormConfig;
}

/** Pre-chat form configuration */
export interface PreChatFormConfig {
  /** Whether the form is enabled */
  enabled: boolean;
  /** Whether the form is required (can't skip) */
  required: boolean;
  /** When to show the form: 'before-first-message' | 'after-first-message' */
  timing: 'before-first-message' | 'after-first-message';
  /** What fields to collect: 'email-only' | 'phone-only' | 'email-or-phone' | 'email-and-phone' */
  fields: 'email-only' | 'phone-only' | 'email-or-phone' | 'email-and-phone';
  /** Whether the form was already completed for this session */
  completed: boolean;
}

/** Pre-chat form submission data */
export interface PreChatFormData {
  email?: string;
  phone?: string;
  phoneCountry?: string;
}

export interface ConnectResponse {
  sessionId: string;
  visitorId: string;
  operatorOnline?: boolean;
  welcomeMessage?: string;
  messages?: Message[];
  /** User identity if provided on connect */
  identity?: UserIdentity;
  /** Tracked elements config from SaaS dashboard */
  trackedElements?: TrackedElement[];
  /** Inspector mode active (for SaaS visual element selector) */
  inspectorMode?: boolean;
  // Widget config from server (SaaS)
  /** Operator/company name from server */
  operatorName?: string;
  /** Operator/company avatar URL from server */
  operatorAvatar?: string;
  /** Primary color from server */
  primaryColor?: string;
  /** Header background color/gradient from server */
  headerColor?: ColorValue;
  /** Footer/input area background color from server (string or theme-aware) */
  footerColor?: string | ThemeColor;
  /** Chat background style from server (string or theme-aware) */
  chatBackground?: 'whatsapp' | 'dots' | 'plain' | string | ThemeColor;
  /** Toggle button color/gradient from server */
  toggleColor?: ColorValue;
  /** Pre-chat form configuration */
  preChatForm?: PreChatFormConfig;
}

export interface SendMessageResponse {
  messageId: string;
  timestamp: string;
  attachments?: Attachment[];
}

export interface EditMessageResponse {
  message: {
    id: string;
    content: string;
    editedAt: string;
  };
}

export interface DeleteMessageResponse {
  deleted: boolean;
}

export interface InitiateUploadResponse {
  attachmentId: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface CompleteUploadResponse {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  status: AttachmentStatus;
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

export type WebSocketEventType =
  | 'message'
  | 'message_edited'
  | 'message_deleted'
  | 'typing'
  | 'presence'
  | 'ai_takeover'
  | 'read'
  | 'event'
  | 'version_warning'
  | 'config_update'
  | 'screenshot_request';

export interface WebSocketEvent {
  type: WebSocketEventType;
  data: unknown;
}

// ─────────────────────────────────────────────────────────────────
// Version Management
// ─────────────────────────────────────────────────────────────────

export type VersionWarningSeverity = 'info' | 'warning' | 'error';

export interface VersionWarning {
  /** Severity level of the warning */
  severity: VersionWarningSeverity;
  /** Human-readable warning message */
  message: string;
  /** Current widget version */
  currentVersion: string;
  /** Minimum supported version (if applicable) */
  minVersion?: string;
  /** Latest available version (if applicable) */
  latestVersion?: string;
  /** Whether the widget should still function */
  canContinue: boolean;
  /** URL to upgrade instructions */
  upgradeUrl?: string;
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
}

/** Handler for custom events */
export type CustomEventHandler = (data: Record<string, unknown> | undefined, event: CustomEvent) => void;

/** Options for trigger() method */
export interface TriggerOptions {
  /** If provided, opens the widget and shows this message */
  widgetMessage?: string;
}

/** Tracked element configuration (for SaaS auto-tracking) */
export interface TrackedElement {
  /** CSS selector for the element(s) to track */
  selector: string;
  /** DOM event to listen for (default: 'click') */
  event?: 'click' | 'submit' | 'focus' | 'change' | 'mouseenter';
  /** Event name sent to backend */
  name: string;
  /** If provided, opens widget with this message when triggered */
  widgetMessage?: string;
  /** Additional data to send with the event */
  data?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────
// User Identity
// ─────────────────────────────────────────────────────────────────

/**
 * User identity data for identifying visitors
 * @example
 * PocketPing.identify({
 *   id: 'user_123',
 *   email: 'john@example.com',
 *   name: 'John Doe',
 *   plan: 'pro',
 *   company: 'Acme Inc'
 * })
 */
export interface UserIdentity {
  /** Required unique user identifier */
  id: string;
  /** User's email address */
  email?: string;
  /** User's display name */
  name?: string;
  /** Any custom fields (plan, company, etc.) */
  [key: string]: unknown;
}

// Internal type for resolved config (endpoint is guaranteed after init)
export type ResolvedPocketPingConfig = Omit<PocketPingConfig, 'endpoint'> & { endpoint: string };

/** Gradient color type */
export interface GradientColor {
  from: string;
  to: string;
  direction?: string;
}

/** Theme-aware color type (can include gradients) */
export type ColorOrGradient = string | GradientColor;
export type ThemeColorValue = ColorOrGradient | { light: ColorOrGradient; dark: ColorOrGradient };

export interface StyleOptions {
  primaryColor: string;
  theme: 'light' | 'dark';
  headerColor?: ThemeColorValue;
  footerColor?: ThemeColorValue;
  chatBackground?: ThemeColorValue;
  toggleColor?: ThemeColorValue;
}

/** Default gradient from logo: cyan → violet */
const DEFAULT_GRADIENT: GradientColor = { from: '#36e3ff', to: '#7c5cff', direction: 'to right' };

/** Check if a value is a gradient object */
function isGradient(value: unknown): value is GradientColor {
  return typeof value === 'object' && value !== null && 'from' in value && 'to' in value;
}

/** Convert a color or gradient to a CSS value */
function toCssColor(value: ColorOrGradient): string {
  if (isGradient(value)) {
    const direction = value.direction || 'to right';
    return `linear-gradient(${direction}, ${value.from}, ${value.to})`;
  }
  return value;
}

/** Get the first color from a gradient (for hover states, etc.) */
function getBaseColor(value: ColorOrGradient): string {
  if (isGradient(value)) {
    return value.to; // Use the 'to' color as the base
  }
  return value;
}

/** Resolve a theme-aware color to a CSS value */
function resolveThemeColor(
  color: ThemeColorValue | undefined,
  isDark: boolean,
  defaultLight: ColorOrGradient,
  defaultDark: ColorOrGradient
): string {
  if (!color) {
    return toCssColor(isDark ? defaultDark : defaultLight);
  }
  if (typeof color === 'string') {
    return color;
  }
  if (isGradient(color)) {
    return toCssColor(color);
  }
  // Theme-aware object
  const resolved = isDark ? color.dark : color.light;
  return toCssColor(resolved);
}

/** Resolve to base color (for hover states) */
function resolveBaseColor(
  color: ThemeColorValue | undefined,
  isDark: boolean,
  defaultLight: ColorOrGradient,
  defaultDark: ColorOrGradient
): string {
  if (!color) {
    return getBaseColor(isDark ? defaultDark : defaultLight);
  }
  if (typeof color === 'string') {
    return color;
  }
  if (isGradient(color)) {
    return getBaseColor(color);
  }
  // Theme-aware object
  const resolved = isDark ? color.dark : color.light;
  return getBaseColor(resolved);
}

export function styles(options: StyleOptions): string {
  const { primaryColor, theme, headerColor, footerColor, chatBackground, toggleColor } = options;
  const isDark = theme === 'dark';

  // Resolved colors with defaults (theme-aware)
  // Brand colors from logo: gradient #36e3ff → #7c5cff, pink #ff5fd4
  const resolvedHeaderColor = resolveThemeColor(headerColor, isDark, DEFAULT_GRADIENT, '#202c33');
  const resolvedFooterColor = resolveThemeColor(footerColor, isDark, '#f0f2f5', '#202c33');
  const resolvedToggleColor = resolveThemeColor(toggleColor, isDark, DEFAULT_GRADIENT, DEFAULT_GRADIENT);

  // For hover states, we need the base color (not gradient)
  const headerBaseColor = resolveBaseColor(headerColor, isDark, DEFAULT_GRADIENT, '#202c33');
  const toggleBaseColor = resolveBaseColor(toggleColor, isDark, DEFAULT_GRADIENT, DEFAULT_GRADIENT);
  const resolvedToggleHoverColor = adjustBrightness(toggleBaseColor, -15);
  const resolvedSendButtonHoverColor = adjustBrightness(headerBaseColor, -15);

  // Background patterns
  const whatsappPattern = isDark
    ? 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.03\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")'
    : 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23000000\' fill-opacity=\'0.03\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")';

  const dotsPattern = isDark
    ? 'url("data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' viewBox=\'0 0 20 20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Ccircle cx=\'10\' cy=\'10\' r=\'1\' fill=\'%23ffffff\' fill-opacity=\'0.05\'/%3E%3C/svg%3E")'
    : 'url("data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' viewBox=\'0 0 20 20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Ccircle cx=\'10\' cy=\'10\' r=\'1\' fill=\'%23000000\' fill-opacity=\'0.05\'/%3E%3C/svg%3E")';

  // Resolve chat background (theme-aware)
  const resolvedChatBg = resolveThemeColor(chatBackground, isDark, 'whatsapp', 'whatsapp');
  const chatBgColor = isDark ? '#0b141a' : '#e5ddd5';
  let chatBgImage = whatsappPattern;
  let chatBgSize = 'auto';

  if (resolvedChatBg === 'plain') {
    chatBgImage = 'none';
  } else if (resolvedChatBg === 'dots') {
    chatBgImage = dotsPattern;
  } else if (resolvedChatBg === 'whatsapp' || !resolvedChatBg) {
    chatBgImage = whatsappPattern;
  } else if (resolvedChatBg.startsWith('http') || resolvedChatBg.startsWith('/') || resolvedChatBg.startsWith('data:')) {
    // Custom image URL
    chatBgImage = `url("${resolvedChatBg}")`;
    chatBgSize = 'cover';
  }

  const colors = {
    bg: isDark ? '#1f2937' : '#ffffff',
    bgSecondary: isDark ? '#374151' : '#f3f4f6',
    text: isDark ? '#f9fafb' : '#111827',
    textSecondary: isDark ? '#9ca3af' : '#6b7280',
    border: isDark ? '#4b5563' : '#e5e7eb',
    messageBg: isDark ? '#374151' : '#f3f4f6',
  };

// Helper function to adjust color brightness
function adjustBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + percent));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + percent));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + percent));
  return '#' + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

  return `
    #pocketping-container {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: ${colors.text};
    }

    #pocketping-container,
    #pocketping-container * {
      box-sizing: border-box;
    }

    #pocketping-container img,
    #pocketping-container video {
      max-width: 100%;
      height: auto;
    }

    .pp-toggle {
      position: fixed;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: ${resolvedToggleColor};
      color: white;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15), 0 2px 4px rgba(0, 0, 0, 0.1);
      transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
      z-index: 9999;
    }

    .pp-toggle:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2), 0 2px 6px rgba(0, 0, 0, 0.15);
      background: ${resolvedToggleHoverColor};
    }

    .pp-toggle:active {
      transform: scale(0.95);
    }

    .pp-toggle svg {
      width: 28px;
      height: 28px;
    }

    .pp-toggle.pp-bottom-right {
      bottom: 20px;
      right: 20px;
    }

    .pp-toggle.pp-bottom-left {
      bottom: 20px;
      left: 20px;
    }

    .pp-online-dot {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 12px;
      height: 12px;
      background: #ff5fd4;
      border-radius: 50%;
      border: 2px solid white;
    }

    .pp-unread-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      background: #ef4444;
      color: white;
      border-radius: 10px;
      border: 2px solid white;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: pp-badge-pop 0.3s ease-out;
    }

    @keyframes pp-badge-pop {
      0% { transform: scale(0); }
      50% { transform: scale(1.2); }
      100% { transform: scale(1); }
    }

    .pp-window {
      position: fixed;
      width: 375px;
      height: 550px;
      max-height: calc(100vh - 100px);
      max-height: calc(100dvh - 100px);
      background: ${isDark ? '#111b21' : '#ffffff'};
      border-radius: 12px;
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.2), 0 4px 10px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 9998;
      transition: max-height 0.2s ease, bottom 0.2s ease;
    }

    .pp-window.pp-bottom-right {
      bottom: 20px;
      right: 20px;
    }

    .pp-window.pp-bottom-left {
      bottom: 20px;
      left: 20px;
    }

    /* Mobile: fullscreen widget to prevent scroll issues */
    @media (max-width: 480px) {
      .pp-window {
        position: fixed !important;
        /* No !important on top/bottom/height - controlled by JS for keyboard handling */
        top: 0;
        left: 0 !important;
        right: 0 !important;
        bottom: auto;
        width: 100vw !important;
        height: 100vh;
        height: 100dvh;
        max-width: 100vw !important;
        max-height: 100vh;
        max-height: 100dvh;
        min-height: 0; /* Allow shrinking for keyboard */
        border-radius: 0 !important;
        overflow: hidden !important;
        touch-action: manipulation; /* Allow scroll and touch, prevent double-tap zoom */
        margin: 0 !important;
        padding: 0 !important;
        box-sizing: border-box !important;
      }

      /* Prevent any overflow */
      .pp-window *,
      .pp-window *::before,
      .pp-window *::after {
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      /* Ensure messages area scrolls properly */
      .pp-messages {
        max-width: 100vw !important;
        min-height: 0 !important; /* Allow shrinking for scroll */
        overflow-x: hidden !important;
        overflow-y: auto !important;
        touch-action: pan-y !important; /* Enable vertical scrolling */
        -webkit-overflow-scrolling: touch; /* Smooth scrolling on iOS */
      }

      /* Allow touch on input area for typing */
      .pp-input-form,
      .pp-input,
      .pp-send-btn,
      .pp-attach-btn {
        touch-action: manipulation !important;
      }
    }

    .pp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      background: ${resolvedHeaderColor};
      color: white;
      flex-shrink: 0; /* Never shrink - always visible */
      position: relative;
      z-index: 10; /* Stay above messages during any scroll issues */
    }

    .pp-header-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .pp-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid rgba(255, 255, 255, 0.2);
    }

    .pp-header-title {
      font-weight: 500;
      font-size: 16px;
      letter-spacing: 0.1px;
    }

    .pp-header-status {
      font-size: 13px;
      opacity: 0.9;
      display: flex;
      align-items: center;
      gap: 5px;
      font-weight: 400;
    }

    .pp-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.5);
    }

    .pp-status-dot.pp-online {
      background: #ff5fd4;
      box-shadow: 0 0 0 2px rgba(255, 95, 212, 0.3);
    }

    .pp-close-btn {
      background: transparent;
      border: none;
      color: white;
      cursor: pointer;
      padding: 8px;
      border-radius: 50%;
      opacity: 0.9;
      transition: opacity 0.2s, background 0.2s;
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .pp-close-btn:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.1);
    }

    .pp-close-btn svg {
      width: 18px;
      height: 18px;
    }

    .pp-messages {
      flex: 1;
      min-height: 0; /* Critical: allows flex child to shrink and enable scrolling */
      overflow-y: auto;
      overflow-x: hidden;
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      position: relative;
      background: ${chatBgColor};
      background-image: ${chatBgImage};
      background-size: ${chatBgSize};
      background-position: center;
      touch-action: pan-y; /* Only allow vertical scrolling */
    }

    .pp-welcome {
      text-align: center;
      color: ${isDark ? '#8696a0' : '#667781'};
      padding: 32px 24px;
      font-size: 14px;
      line-height: 1.5;
      background: ${isDark ? 'rgba(17, 27, 33, 0.9)' : 'rgba(255, 255, 255, 0.95)'};
      margin: 12px;
      border-radius: 8px;
      box-shadow: 0 1px 0.5px rgba(0, 0, 0, 0.13);
      flex-shrink: 0;
    }

    .pp-date-separator {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 12px 0;
      flex-shrink: 0;
    }

    .pp-date-separator span {
      background: ${isDark ? 'rgba(17, 27, 33, 0.9)' : 'rgba(255, 255, 255, 0.95)'};
      color: ${isDark ? '#8696a0' : '#54656f'};
      font-size: 12px;
      padding: 6px 12px;
      border-radius: 8px;
      font-weight: 400;
      box-shadow: 0 1px 0.5px rgba(0, 0, 0, 0.13);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    /* Swipe container for mobile actions */
    .pp-message-swipe-container {
      position: relative;
      display: flex;
      align-items: stretch;
      overflow: hidden; /* Prevent horizontal overflow */
      touch-action: pan-y; /* Only vertical scroll */
      max-width: 100%;
      flex-shrink: 0; /* Never shrink - maintain natural size for scrolling */
    }

    .pp-swipe-left {
      justify-content: flex-end;
    }

    .pp-swipe-right {
      justify-content: flex-start;
    }

    .pp-swipe-actions {
      position: absolute;
      top: 0;
      bottom: 0;
      display: none; /* Hidden by default - only show on mobile with touch */
      align-items: center;
      gap: 4px;
      opacity: 0;
      pointer-events: none;
    }

    /* Only show swipe actions on touch devices */
    @media (hover: none) and (pointer: coarse) {
      .pp-swipe-actions {
        display: flex;
      }
    }

    .pp-swipe-left .pp-swipe-actions {
      right: -80px; /* Hidden off-screen to the right */
      left: auto;
      padding-right: 8px;
    }

    .pp-swipe-right .pp-swipe-actions {
      left: -80px; /* Hidden off-screen to the left */
      right: auto;
      padding-left: 8px;
    }

    .pp-swipe-action {
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.9;
    }

    .pp-swipe-action svg {
      width: 16px;
      height: 16px;
    }

    .pp-swipe-reply {
      background: ${primaryColor};
    }

    .pp-swipe-edit {
      background: #3b82f6;
    }

    .pp-swipe-delete {
      background: #ef4444;
    }

    .pp-message {
      max-width: 80%;
      padding: 6px 8px 6px 9px;
      border-radius: 8px;
      word-wrap: break-word;
      overflow-wrap: break-word;
      position: relative;
      user-select: text;
      -webkit-user-select: text;
      font-size: 14.2px;
      line-height: 1.4;
      display: block; /* Block for proper float behavior */
      will-change: transform;
      box-shadow: 0 1px 0.5px rgba(0, 0, 0, 0.13);
      flex-shrink: 0; /* Never shrink - for typing indicator which is direct child */
    }

    .pp-message-visitor {
      align-self: flex-end;
      background: ${isDark ? '#005c4b' : '#d9fdd3'};
      color: ${isDark ? '#e9edef' : '#111b21'};
      border-top-right-radius: 8px;
      border-top-left-radius: 8px;
      border-bottom-left-radius: 8px;
      border-bottom-right-radius: 0;
      margin-left: 48px;
    }

    /* WhatsApp-style tail for visitor messages */
    .pp-message-visitor::after {
      content: '';
      position: absolute;
      right: -7px;
      bottom: 0;
      width: 8px;
      height: 13px;
      background: ${isDark ? '#005c4b' : '#d9fdd3'};
      clip-path: path('M 0 0 L 0 13 L 8 13 Q 2 10 0 0');
    }

    .pp-message-operator,
    .pp-message-ai {
      align-self: flex-start;
      background: ${isDark ? '#202c33' : '#ffffff'};
      color: ${isDark ? '#e9edef' : '#111b21'};
      border-top-right-radius: 8px;
      border-top-left-radius: 8px;
      border-bottom-right-radius: 8px;
      border-bottom-left-radius: 0;
      margin-right: 48px;
    }

    /* WhatsApp-style tail for operator messages */
    .pp-message-operator::after,
    .pp-message-ai::after {
      content: '';
      position: absolute;
      left: -7px;
      bottom: 0;
      width: 8px;
      height: 13px;
      background: ${isDark ? '#202c33' : '#ffffff'};
      clip-path: path('M 8 0 L 8 13 L 0 13 Q 6 10 8 0');
    }

    /* Add spacing between different senders */
    .pp-message-swipe-container + .pp-message-swipe-container {
      margin-top: 4px;
    }

    /* More spacing when sender changes (visitor <-> operator/ai) */
    .pp-swipe-left + .pp-swipe-right,
    .pp-swipe-right + .pp-swipe-left {
      margin-top: 16px;
    }

    .pp-message-content {
      display: inline;
    }

    /* Markdown styles */
    .pp-message-content strong {
      font-weight: 600;
    }

    .pp-message-content em {
      font-style: italic;
    }

    .pp-message-content code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.9em;
      background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'};
      padding: 1px 4px;
      border-radius: 3px;
    }

    .pp-md-list {
      margin: 4px 0;
      padding-left: 20px;
      display: block;
    }

    .pp-md-list li {
      margin: 2px 0;
    }

    /* WhatsApp-style inline timestamp - floats to the right */
    .pp-message-time {
      font-size: 11px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      float: right;
      margin: 3px 0 0 12px;
      color: ${isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)'};
      white-space: nowrap;
    }

    .pp-message-visitor .pp-message-time {
      color: ${isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.45)'};
    }

    /* Timestamp for attachment-only messages */
    .pp-attachment-time {
      float: none;
      display: flex;
      justify-content: flex-end;
      margin-top: 4px;
    }

    .pp-ai-badge {
      background: ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0, 0, 0, 0.08)'};
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .pp-status {
      display: inline-flex;
      align-items: center;
      margin-left: 4px;
    }

    .pp-status svg {
      width: 14px;
      height: 14px;
    }

    .pp-check,
    .pp-check-double {
      stroke: ${isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.35)'};
    }

    .pp-check-read {
      stroke: #53bdeb;
    }

    .pp-status-sending .pp-check {
      opacity: 0.5;
    }

    .pp-typing {
      display: flex;
      gap: 4px;
      padding: 12px 14px;
      align-items: center;
    }

    .pp-typing span {
      width: 7px;
      height: 7px;
      background: ${isDark ? '#8696a0' : '#667781'};
      border-radius: 50%;
      animation: pp-bounce 1.4s infinite ease-in-out both;
    }

    .pp-typing span:nth-child(1) { animation-delay: -0.32s; }
    .pp-typing span:nth-child(2) { animation-delay: -0.16s; }

    @keyframes pp-bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }

    .pp-input-form {
      display: flex;
      padding: 8px 10px;
      gap: 8px;
      background: ${resolvedFooterColor};
      align-items: flex-end;
      flex-shrink: 0; /* Never shrink */
    }

    .pp-input {
      flex: 1;
      min-width: 0;
      min-height: 42px;
      max-height: 120px;
      padding: 10px 14px;
      border: none;
      border-radius: 8px;
      background: ${isDark ? '#2a3942' : '#ffffff'};
      color: ${isDark ? '#e9edef' : '#111b21'};
      font-size: 15px;
      line-height: 1.4;
      outline: none;
      box-sizing: border-box;
      margin: 0;
      resize: none;
      font-family: inherit;
      overflow-y: auto;
    }

    .pp-input:focus {
      outline: none;
    }

    .pp-input::placeholder {
      color: ${isDark ? '#8696a0' : '#667781'};
    }

    .pp-send-btn {
      width: 42px;
      height: 42px;
      min-width: 42px;
      border-radius: 50%;
      background: ${resolvedHeaderColor};
      color: white;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s, transform 0.1s;
      flex-shrink: 0;
      margin: 0;
      padding: 0;
    }

    .pp-send-btn:not(:disabled):hover {
      background: ${resolvedSendButtonHoverColor};
    }

    .pp-send-btn:not(:disabled):active {
      transform: scale(0.95);
    }

    .pp-send-btn:disabled {
      background: ${isDark ? '#3b4a54' : '#b3b3b3'};
      cursor: not-allowed;
    }

    .pp-send-btn svg {
      width: 20px;
      height: 20px;
    }

    .pp-footer {
      text-align: center;
      padding: 6px 8px;
      font-size: 10px;
      color: ${isDark ? '#8696a0' : '#667781'};
      background: ${resolvedFooterColor};
      flex-shrink: 0; /* Never shrink */
    }

    .pp-footer a {
      color: ${primaryColor};
      text-decoration: none;
      font-weight: 500;
    }

    .pp-footer a:hover {
      text-decoration: underline;
    }

    /* Attachment Styles */
    .pp-file-input {
      /* Use offscreen positioning instead of display:none for better browser compatibility */
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .pp-attach-btn {
      width: 42px;
      height: 42px;
      min-width: 42px;
      border-radius: 50%;
      background: transparent;
      color: ${isDark ? '#8696a0' : '#54656f'};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 0;
      transition: color 0.2s, background 0.2s;
      flex-shrink: 0;
    }

    .pp-attach-btn:hover:not(:disabled) {
      color: ${isDark ? '#aebac1' : '#3b4a54'};
      background: ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'};
    }

    .pp-attach-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .pp-attach-btn svg {
      width: 22px;
      height: 22px;
    }

    .pp-attachments-preview {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      overflow-x: auto;
      background: ${resolvedFooterColor};
    }

    .pp-attachment-preview {
      position: relative;
      width: 64px;
      height: 64px;
      border-radius: 10px;
      overflow: hidden;
      flex-shrink: 0;
      background: ${isDark ? '#2a3942' : '#ffffff'};
      box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    }

    .pp-preview-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .pp-preview-file {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${colors.textSecondary};
    }

    .pp-preview-file svg {
      width: 24px;
      height: 24px;
    }

    .pp-remove-attachment {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }

    .pp-remove-attachment svg {
      width: 10px;
      height: 10px;
    }

    .pp-upload-progress {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 3px;
      background: ${primaryColor};
      transition: width 0.1s;
    }

    .pp-upload-error {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #ef4444;
      color: white;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }

    .pp-attachment-uploading {
      opacity: 0.7;
    }

    .pp-attachment-error {
      border-color: #ef4444;
    }

    /* Message Attachments */
    .pp-message-attachments {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 6px;
      max-width: 100%;
      align-items: flex-start;
      flex-shrink: 0;
    }

    .pp-attachment {
      display: block;
      text-decoration: none;
      color: inherit;
      border-radius: 8px;
      overflow: hidden;
    }

    .pp-attachment-image,
    .pp-attachment-video,
    .pp-attachment-audio {
      width: 240px;
      max-width: 100%;
    }

    .pp-attachment-image img {
      width: 100% !important;
      height: auto !important;
      max-width: 240px;
      max-height: 200px;
      border-radius: 8px;
      display: block;
      object-fit: cover !important;
      object-position: center;
    }

    .pp-attachment-audio {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .pp-attachment-audio audio {
      width: 240px;
      max-width: 100%;
      height: 36px;
    }

    .pp-attachment-audio .pp-attachment-name {
      font-size: 11px;
      opacity: 0.7;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }

    .pp-attachment-video video {
      width: 100% !important;
      height: auto !important;
      max-width: 240px;
      max-height: none;
      border-radius: 8px;
      display: block;
      object-fit: contain !important;
      object-position: center;
    }

    .pp-attachment-file {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'};
      border-radius: 8px;
      transition: background 0.2s;
    }

    .pp-attachment-file:hover {
      background: ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'};
    }

    .pp-attachment-file svg {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
    }

    .pp-attachment-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .pp-attachment-name {
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pp-attachment-size {
      font-size: 11px;
      opacity: 0.7;
    }

    /* Drag & Drop */
    /* Note: .pp-window already has position: fixed which acts as
       containing block for the absolutely positioned overlay */

    .pp-drop-overlay {
      position: absolute;
      inset: 0;
      background: ${isDark ? 'rgba(17, 27, 33, 0.95)' : 'rgba(255,255,255,0.97)'};
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      z-index: 100;
      border: 3px dashed #7c5cff;
      border-radius: 12px;
      margin: 4px;
      pointer-events: none;
    }

    .pp-drop-icon svg {
      width: 56px;
      height: 56px;
      color: #7c5cff;
    }

    .pp-drop-text {
      font-size: 17px;
      font-weight: 500;
      color: ${isDark ? '#e9edef' : '#111b21'};
    }

    /* Message Context Menu */
    .pp-message-menu {
      position: fixed;
      background: ${isDark ? '#233138' : '#ffffff'};
      border: none;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1);
      padding: 6px;
      z-index: 200;
      min-width: 140px;
    }

    .pp-message-menu button {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 14px;
      border: none;
      background: transparent;
      color: ${isDark ? '#e9edef' : '#111b21'};
      font-size: 14px;
      cursor: pointer;
      border-radius: 8px;
      text-align: left;
      transition: background 0.15s;
    }

    .pp-message-menu button:hover {
      background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'};
    }

    .pp-message-menu button svg {
      width: 18px;
      height: 18px;
    }

    .pp-menu-delete {
      color: #ef4444 !important;
    }

    .pp-menu-delete:hover {
      background: ${isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)'} !important;
    }

    /* Edit Modal */
    .pp-edit-modal {
      position: absolute;
      bottom: 80px;
      left: 12px;
      right: 12px;
      background: ${isDark ? '#233138' : '#ffffff'};
      border: none;
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.1);
      z-index: 150;
      overflow: hidden;
    }

    .pp-edit-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 16px;
      border-bottom: 1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'};
      font-weight: 500;
      color: ${isDark ? '#e9edef' : '#111b21'};
    }

    .pp-edit-header button {
      background: transparent;
      border: none;
      color: ${isDark ? '#8696a0' : '#667781'};
      cursor: pointer;
      padding: 6px;
      border-radius: 50%;
      transition: background 0.15s;
    }

    .pp-edit-header button:hover {
      background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'};
    }

    .pp-edit-header button svg {
      width: 18px;
      height: 18px;
    }

    .pp-edit-input {
      width: 100%;
      padding: 14px 16px;
      border: none;
      background: transparent;
      color: ${isDark ? '#e9edef' : '#111b21'};
      font-size: 15px;
      resize: none;
      min-height: 80px;
      outline: none;
      line-height: 1.5;
    }

    .pp-edit-input::placeholder {
      color: ${isDark ? '#8696a0' : '#667781'};
    }

    .pp-edit-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 12px 16px;
      border-top: 1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'};
    }

    .pp-edit-cancel {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'};
      color: ${isDark ? '#e9edef' : '#111b21'};
      font-size: 14px;
      cursor: pointer;
      transition: background 0.15s;
    }

    .pp-edit-cancel:hover {
      background: ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'};
    }

    .pp-edit-save {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      background: #7c5cff;
      color: white;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .pp-edit-save:hover:not(:disabled) {
      background: #6a4ee6;
    }

    .pp-edit-save:disabled {
      background: ${isDark ? '#3b4a54' : '#b3b3b3'};
      cursor: not-allowed;
    }

    /* Reply Preview */
    .pp-reply-preview {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: ${resolvedFooterColor};
      border-left: 4px solid #7c5cff;
    }

    .pp-reply-preview-content {
      flex: 1;
      min-width: 0;
    }

    .pp-reply-label {
      display: block;
      font-size: 12px;
      color: #7c5cff;
      font-weight: 500;
      margin-bottom: 2px;
    }

    .pp-reply-text {
      display: block;
      font-size: 13px;
      color: ${isDark ? '#8696a0' : '#667781'};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pp-reply-cancel {
      background: transparent;
      border: none;
      border-radius: 50%;
      color: ${isDark ? '#8696a0' : '#667781'};
      cursor: pointer;
      padding: 0;
      width: 28px;
      height: 28px;
      min-width: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s, color 0.15s;
    }

    .pp-reply-cancel:hover {
      background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'};
      color: ${isDark ? '#aebac1' : '#3b4a54'};
    }

    .pp-reply-cancel svg {
      width: 16px;
      height: 16px;
    }

    /* Reply Quote in Message */
    .pp-reply-quote {
      background: ${isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)'};
      border-left: 3px solid #7c5cff;
      padding: 6px 10px;
      margin-bottom: 4px;
      border-radius: 0 6px 6px 0;
      font-size: 13px;
      position: relative;
      z-index: 1;
    }

    .pp-reply-sender {
      display: block;
      font-weight: 500;
      color: #7c5cff;
      margin-bottom: 2px;
      font-size: 12px;
    }

    .pp-reply-content {
      display: block;
      color: ${isDark ? '#8696a0' : '#667781'};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Clickable reply quote */
    .pp-reply-quote-clickable {
      cursor: pointer;
      transition: background 0.15s;
    }

    .pp-reply-quote-clickable:hover {
      background: ${isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)'};
    }

    .pp-reply-quote-clickable:active {
      transform: scale(0.99);
    }

    /* Reply quote in visitor message bubble needs higher contrast */
    .pp-message-visitor .pp-reply-quote {
      background: ${isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.08)'};
      border-left-color: ${isDark ? 'rgba(255,255,255,0.5)' : '#7c5cff'};
    }

    .pp-message-visitor .pp-reply-quote-clickable:hover {
      background: ${isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.12)'};
    }

    .pp-message-visitor .pp-reply-sender {
      color: ${isDark ? 'rgba(255,255,255,0.9)' : '#7c5cff'};
    }

    .pp-message-visitor .pp-reply-content {
      color: ${isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'};
    }

    /* Message highlight animation (when scrolling to a message) */
    .pp-message-highlight {
      animation: pp-highlight-pulse 1.5s ease-out;
    }

    @keyframes pp-highlight-pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(124, 92, 255, 0.5);
      }
      30% {
        box-shadow: 0 0 0 6px rgba(124, 92, 255, 0.25);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(124, 92, 255, 0);
      }
    }

    /* Deleted Message */
    .pp-message-deleted {
      opacity: 0.6;
    }

    .pp-deleted-content {
      font-style: italic;
      color: ${colors.textSecondary};
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .pp-deleted-icon {
      font-size: 12px;
    }

    /* Edited Badge */
    .pp-edited-badge {
      font-size: 10px;
      margin-left: 4px;
      font-style: italic;
      opacity: 0.7;
    }

    /* Pre-Chat Form */
    .pp-prechat {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 24px 20px;
      overflow-y: auto;
      background: ${isDark ? '#111b21' : '#ffffff'};
    }

    .pp-prechat-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
      color: ${isDark ? '#e9edef' : '#111b21'};
    }

    .pp-prechat-subtitle {
      font-size: 14px;
      color: ${isDark ? '#8696a0' : '#667781'};
      margin-bottom: 24px;
      line-height: 1.5;
    }

    .pp-prechat-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
    }

    .pp-prechat-tab {
      flex: 1;
      padding: 10px;
      border: 1px solid ${colors.border};
      border-radius: 8px;
      background: transparent;
      color: ${colors.textSecondary};
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .pp-prechat-tab:hover {
      background: ${colors.bgSecondary};
    }

    .pp-prechat-tab.active {
      background: ${primaryColor}15;
      border-color: ${primaryColor};
      color: ${primaryColor};
    }

    .pp-prechat-tab svg {
      width: 16px;
      height: 16px;
    }

    .pp-prechat-field {
      margin-bottom: 16px;
    }

    .pp-prechat-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: ${colors.textSecondary};
      margin-bottom: 6px;
    }

    .pp-prechat-input {
      width: 100%;
      height: 44px;
      padding: 0 14px;
      border: 1px solid ${colors.border};
      border-radius: 8px;
      background: ${colors.bg};
      color: ${colors.text};
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
      box-sizing: border-box;
    }

    .pp-prechat-input:focus {
      border-color: ${primaryColor};
    }

    .pp-prechat-input::placeholder {
      color: ${colors.textSecondary};
    }

    .pp-prechat-input.error {
      border-color: #ef4444;
    }

    .pp-prechat-error {
      color: #ef4444;
      font-size: 12px;
      margin-top: 4px;
    }

    .pp-phone-input-wrapper {
      display: flex;
      gap: 8px;
    }

    .pp-country-select {
      position: relative;
    }

    .pp-country-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      height: 44px;
      padding: 0 10px;
      border: 1px solid ${colors.border};
      border-radius: 8px;
      background: ${colors.bg};
      color: ${colors.text};
      font-size: 14px;
      cursor: pointer;
      transition: border-color 0.2s;
    }

    .pp-country-btn:focus {
      border-color: ${primaryColor};
      outline: none;
    }

    .pp-country-flag {
      font-size: 18px;
      line-height: 1;
    }

    .pp-country-code {
      font-size: 13px;
      color: ${colors.textSecondary};
    }

    .pp-country-chevron {
      width: 12px;
      height: 12px;
      color: ${colors.textSecondary};
    }

    .pp-country-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      width: 280px;
      max-height: 280px;
      overflow-y: auto;
      background: ${colors.bg};
      border: 1px solid ${colors.border};
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 100;
    }

    .pp-country-search {
      position: sticky;
      top: 0;
      padding: 8px;
      background: ${colors.bg};
      border-bottom: 1px solid ${colors.border};
    }

    .pp-country-search-input {
      width: 100%;
      height: 36px;
      padding: 0 12px;
      border: 1px solid ${colors.border};
      border-radius: 6px;
      background: ${colors.bgSecondary};
      color: ${colors.text};
      font-size: 13px;
      outline: none;
      box-sizing: border-box;
    }

    .pp-country-search-input:focus {
      border-color: ${primaryColor};
    }

    .pp-country-list {
      padding: 4px;
    }

    .pp-country-option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      cursor: pointer;
      border-radius: 6px;
      transition: background 0.15s;
    }

    .pp-country-option:hover {
      background: ${colors.bgSecondary};
    }

    .pp-country-option.selected {
      background: ${primaryColor}15;
    }

    .pp-country-name {
      flex: 1;
      font-size: 13px;
      color: ${colors.text};
    }

    .pp-country-dial {
      font-size: 12px;
      color: ${colors.textSecondary};
    }

    .pp-phone-number-input {
      flex: 1;
    }

    .pp-prechat-submit {
      width: 100%;
      height: 48px;
      margin-top: 12px;
      border: none;
      border-radius: 8px;
      background: #7c5cff;
      color: white;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
    }

    .pp-prechat-submit:hover:not(:disabled) {
      background: #6a4ee6;
    }

    .pp-prechat-submit:active:not(:disabled) {
      transform: scale(0.98);
    }

    .pp-prechat-submit:disabled {
      background: ${isDark ? '#3b4a54' : '#b3b3b3'};
      cursor: not-allowed;
    }

    .pp-prechat-skip {
      width: 100%;
      padding: 14px;
      margin-top: 8px;
      border: none;
      background: transparent;
      color: ${isDark ? '#8696a0' : '#667781'};
      font-size: 14px;
      cursor: pointer;
      transition: color 0.2s;
    }

    .pp-prechat-skip:hover {
      color: ${isDark ? '#aebac1' : '#3b4a54'};
    }
  `;
}

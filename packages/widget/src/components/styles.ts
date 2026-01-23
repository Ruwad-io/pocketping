export function styles(primaryColor: string, theme: 'light' | 'dark'): string {
  const isDark = theme === 'dark';

  const colors = {
    bg: isDark ? '#1f2937' : '#ffffff',
    bgSecondary: isDark ? '#374151' : '#f3f4f6',
    text: isDark ? '#f9fafb' : '#111827',
    textSecondary: isDark ? '#9ca3af' : '#6b7280',
    border: isDark ? '#4b5563' : '#e5e7eb',
    messageBg: isDark ? '#374151' : '#f3f4f6',
  };

  return `
    #pocketping-container {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: ${colors.text};
    }

    .pp-toggle {
      position: fixed;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: ${primaryColor};
      color: white;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: transform 0.2s, box-shadow 0.2s;
      z-index: 9999;
    }

    .pp-toggle:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    }

    .pp-toggle svg {
      width: 24px;
      height: 24px;
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
      background: #22c55e;
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
      width: 380px;
      height: 520px;
      max-height: calc(100vh - 100px);
      max-height: calc(100dvh - 100px);
      background: ${colors.bg};
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 9998;
    }

    .pp-window.pp-bottom-right {
      bottom: 88px;
      right: 20px;
    }

    .pp-window.pp-bottom-left {
      bottom: 88px;
      left: 20px;
    }

    @media (max-width: 480px) {
      .pp-window {
        width: calc(100vw - 20px);
        height: auto;
        max-height: calc(100vh - 100px);
        max-height: calc(100dvh - 100px);
        bottom: 80px;
        right: 10px;
        left: 10px;
        border-radius: 12px;
      }
    }

    .pp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      background: ${primaryColor};
      color: white;
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
    }

    .pp-header-title {
      font-weight: 600;
      font-size: 16px;
    }

    .pp-header-status {
      font-size: 12px;
      opacity: 0.9;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .pp-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.5);
    }

    .pp-status-dot.pp-online {
      background: #22c55e;
    }

    .pp-close-btn {
      background: transparent;
      border: none;
      color: white;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      opacity: 0.8;
      transition: opacity 0.2s;
    }

    .pp-close-btn:hover {
      opacity: 1;
    }

    .pp-close-btn svg {
      width: 20px;
      height: 20px;
    }

    .pp-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .pp-welcome {
      text-align: center;
      color: ${colors.textSecondary};
      padding: 24px;
      font-size: 13px;
    }

    .pp-message {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 16px;
      word-wrap: break-word;
    }

    .pp-message-visitor {
      align-self: flex-end;
      background: ${primaryColor};
      color: white;
      border-bottom-right-radius: 4px;
    }

    .pp-message-operator,
    .pp-message-ai {
      align-self: flex-start;
      background: ${colors.messageBg};
      color: ${colors.text};
      border-bottom-left-radius: 4px;
    }

    .pp-message-content {
      margin-bottom: 4px;
    }

    .pp-message-time {
      font-size: 11px;
      opacity: 0.7;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .pp-ai-badge {
      background: rgba(0, 0, 0, 0.1);
      padding: 1px 4px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
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
      stroke: rgba(255, 255, 255, 0.7);
    }

    .pp-check-read {
      stroke: #34b7f1;
    }

    .pp-status-sending .pp-check {
      opacity: 0.5;
    }

    .pp-typing {
      display: flex;
      gap: 4px;
      padding: 14px 18px;
    }

    .pp-typing span {
      width: 8px;
      height: 8px;
      background: ${colors.textSecondary};
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
      padding: 12px;
      gap: 8px;
      border-top: 1px solid ${colors.border};
    }

    .pp-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid ${colors.border};
      border-radius: 20px;
      background: ${colors.bg};
      color: ${colors.text};
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }

    .pp-input:focus {
      border-color: ${primaryColor};
    }

    .pp-input::placeholder {
      color: ${colors.textSecondary};
    }

    .pp-send-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: ${primaryColor};
      color: white;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s;
    }

    .pp-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .pp-send-btn svg {
      width: 18px;
      height: 18px;
    }

    .pp-footer {
      text-align: center;
      padding: 8px;
      font-size: 11px;
      color: ${colors.textSecondary};
      border-top: 1px solid ${colors.border};
    }

    .pp-footer a {
      color: ${primaryColor};
      text-decoration: none;
    }

    .pp-footer a:hover {
      text-decoration: underline;
    }
  `;
}

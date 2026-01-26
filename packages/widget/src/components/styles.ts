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
      transition: max-height 0.2s ease, bottom 0.2s ease;
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
        min-height: 300px;
        max-height: calc(100vh - 100px);
        max-height: calc(100svh - 100px); /* svh = small viewport, excludes keyboard */
        bottom: 80px;
        right: 10px;
        left: 10px;
        border-radius: 12px;
      }

      /* When keyboard is likely open (input focused), reduce height */
      .pp-window:has(.pp-input:focus) {
        max-height: calc(50vh - 20px);
        max-height: calc(50svh - 20px);
        bottom: 10px;
      }
    }

    .pp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      background: ${primaryColor};
      color: white;
    }

    .pp-header-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .pp-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
    }

    .pp-header-title {
      font-weight: 600;
      font-size: 15px;
    }

    .pp-header-status {
      font-size: 11px;
      opacity: 0.85;
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
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .pp-close-btn:hover {
      opacity: 1;
    }

    .pp-close-btn svg {
      width: 16px;
      height: 16px;
    }

    .pp-messages {
      flex: 1;
      overflow-y: auto;
      padding: 32px 12px 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      /* Ensure proper stacking context for positioned elements */
      position: relative;
    }

    .pp-welcome {
      text-align: center;
      color: ${colors.textSecondary};
      padding: 24px;
      font-size: 13px;
    }

    .pp-date-separator {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 16px 0 12px;
    }

    .pp-date-separator span {
      background: ${colors.bgSecondary};
      color: ${colors.textSecondary};
      font-size: 11px;
      padding: 4px 12px;
      border-radius: 12px;
      font-weight: 500;
    }

    /* Swipe container for mobile actions */
    .pp-message-swipe-container {
      position: relative;
      display: flex;
      align-items: stretch;
      overflow: visible;
      touch-action: pan-y;
    }

    .pp-swipe-left {
      justify-content: flex-end;
    }

    .pp-swipe-right {
      justify-content: flex-start;
    }

    .pp-swipe-actions {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      padding-right: 8px;
    }

    .pp-swipe-left .pp-swipe-actions {
      right: 0;
      left: auto;
    }

    .pp-swipe-right .pp-swipe-actions {
      left: 0;
      right: auto;
      padding-left: 8px;
      padding-right: 0;
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
      max-width: 85%;
      padding: 6px 10px;
      border-radius: 12px;
      word-wrap: break-word;
      position: relative;
      user-select: text;
      -webkit-user-select: text;
      font-size: 14px;
      line-height: 1.35;
      display: flex;
      flex-direction: column;
      will-change: transform;
    }

    /* Hover actions container - positioned above message (Slack style) */
    .pp-message-actions {
      position: absolute;
      top: -32px;
      display: flex;
      gap: 2px;
      background: ${colors.bg};
      border: 1px solid ${colors.border};
      border-radius: 6px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
      padding: 2px;
      opacity: 0;
      animation: pp-actions-fade-in 0.12s ease forwards;
      z-index: 10;
      /* Reset color inheritance from message */
      color: ${colors.textSecondary};
      /* Ensure actions don't interfere with layout */
      pointer-events: auto;
    }

    @keyframes pp-actions-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Visitor messages: actions aligned right */
    .pp-actions-left {
      right: 0;
    }

    /* Operator messages: actions aligned left */
    .pp-actions-right {
      left: 0;
    }

    .pp-message-actions .pp-action-btn {
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${colors.textSecondary} !important;
      transition: background 0.1s, color 0.1s;
    }

    .pp-message-actions .pp-action-btn:hover {
      background: ${colors.bgSecondary};
      color: ${colors.text} !important;
    }

    .pp-message-actions .pp-action-btn svg {
      width: 14px;
      height: 14px;
      stroke: ${colors.textSecondary};
    }

    .pp-message-actions .pp-action-btn:hover svg {
      stroke: ${colors.text};
    }

    .pp-message-actions .pp-action-delete:hover {
      background: #fef2f2;
    }

    .pp-message-actions .pp-action-delete:hover svg {
      stroke: #ef4444;
    }

    .pp-theme-dark .pp-message-actions .pp-action-delete:hover {
      background: #7f1d1d;
    }

    .pp-theme-dark .pp-message-actions .pp-action-delete:hover svg {
      stroke: #fca5a5;
    }

    /* Hide hover actions on mobile */
    @media (hover: none) and (pointer: coarse) {
      .pp-message-actions {
        display: none;
      }
    }

    .pp-message-visitor {
      align-self: flex-end;
      background: ${primaryColor};
      color: white;
      border-bottom-right-radius: 3px;
      margin-left: 32px;
    }

    .pp-message-operator,
    .pp-message-ai {
      align-self: flex-start;
      background: ${colors.messageBg};
      color: ${colors.text};
      border-bottom-left-radius: 3px;
      margin-right: 32px;
    }

    /* Add spacing between different senders */
    .pp-message-visitor + .pp-message-operator,
    .pp-message-visitor + .pp-message-ai,
    .pp-message-operator + .pp-message-visitor,
    .pp-message-ai + .pp-message-visitor {
      margin-top: 8px;
    }

    .pp-message-content {
      display: block;
      flex: 1;
    }

    .pp-message-time {
      font-size: 10px;
      opacity: 0.6;
      display: flex;
      align-items: center;
      gap: 3px;
      justify-content: flex-end;
      margin-top: 8px;
      flex-shrink: 0;
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
      gap: 3px;
      padding: 8px 12px;
    }

    .pp-typing span {
      width: 6px;
      height: 6px;
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
      padding: 10px 12px;
      gap: 8px;
      border-top: 1px solid ${colors.border};
      align-items: center;
    }

    .pp-input {
      flex: 1;
      min-width: 0;
      height: 40px;
      line-height: 40px;
      padding: 0 16px;
      border: 1px solid ${colors.border};
      border-radius: 20px;
      background: ${colors.bg};
      color: ${colors.text};
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
      box-sizing: border-box;
      margin: 0;
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
      min-width: 40px;
      border-radius: 50%;
      background: ${primaryColor};
      color: white;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s, transform 0.1s;
      flex-shrink: 0;
      margin: 0;
      padding: 0;
    }

    .pp-send-btn:not(:disabled):hover {
      transform: scale(1.05);
    }

    .pp-send-btn:not(:disabled):active {
      transform: scale(0.95);
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
      opacity: 0.7;
    }

    .pp-footer a {
      color: ${primaryColor};
      text-decoration: none;
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
      width: 40px;
      height: 40px;
      min-width: 40px;
      border-radius: 50%;
      background: transparent;
      color: ${colors.textSecondary};
      border: 1px solid ${colors.border};
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 0;
      transition: color 0.2s, border-color 0.2s;
      flex-shrink: 0;
    }

    .pp-attach-btn:hover:not(:disabled) {
      color: ${primaryColor};
      border-color: ${primaryColor};
    }

    .pp-attach-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .pp-attach-btn svg {
      width: 18px;
      height: 18px;
    }

    .pp-attachments-preview {
      display: flex;
      gap: 8px;
      padding: 8px 12px;
      border-top: 1px solid ${colors.border};
      overflow-x: auto;
      background: ${colors.bgSecondary};
    }

    .pp-attachment-preview {
      position: relative;
      width: 60px;
      height: 60px;
      border-radius: 8px;
      overflow: hidden;
      flex-shrink: 0;
      background: ${colors.bg};
      border: 1px solid ${colors.border};
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
      background: ${isDark ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.95)'};
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      z-index: 100;
      border: 3px dashed ${primaryColor};
      border-radius: 16px;
      margin: 4px;
      pointer-events: none;
    }

    .pp-drop-icon svg {
      width: 48px;
      height: 48px;
      color: ${primaryColor};
    }

    .pp-drop-text {
      font-size: 16px;
      font-weight: 500;
      color: ${colors.text};
    }

    /* Message Context Menu */
    .pp-message-menu {
      position: fixed;
      background: ${colors.bg};
      border: 1px solid ${colors.border};
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      padding: 4px;
      z-index: 200;
      min-width: 120px;
    }

    .pp-message-menu button {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 12px;
      border: none;
      background: transparent;
      color: ${colors.text};
      font-size: 13px;
      cursor: pointer;
      border-radius: 4px;
      text-align: left;
    }

    .pp-message-menu button:hover {
      background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'};
    }

    .pp-message-menu button svg {
      width: 16px;
      height: 16px;
    }

    .pp-menu-delete {
      color: #ef4444 !important;
    }

    /* Edit Modal */
    .pp-edit-modal {
      position: absolute;
      bottom: 80px;
      left: 12px;
      right: 12px;
      background: ${colors.bg};
      border: 1px solid ${colors.border};
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      z-index: 150;
      overflow: hidden;
    }

    .pp-edit-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid ${colors.border};
      font-weight: 500;
    }

    .pp-edit-header button {
      background: transparent;
      border: none;
      color: ${colors.textSecondary};
      cursor: pointer;
      padding: 4px;
    }

    .pp-edit-header button svg {
      width: 18px;
      height: 18px;
    }

    .pp-edit-input {
      width: 100%;
      padding: 12px 16px;
      border: none;
      background: transparent;
      color: ${colors.text};
      font-size: 14px;
      resize: none;
      min-height: 80px;
      outline: none;
    }

    .pp-edit-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid ${colors.border};
    }

    .pp-edit-cancel {
      padding: 8px 16px;
      border: 1px solid ${colors.border};
      border-radius: 6px;
      background: transparent;
      color: ${colors.text};
      font-size: 13px;
      cursor: pointer;
    }

    .pp-edit-save {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      background: ${primaryColor};
      color: white;
      font-size: 13px;
      cursor: pointer;
    }

    .pp-edit-save:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Reply Preview */
    .pp-reply-preview {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'};
      border-top: 1px solid ${colors.border};
      border-left: 3px solid ${primaryColor};
    }

    .pp-reply-preview-content {
      flex: 1;
      min-width: 0;
    }

    .pp-reply-label {
      display: block;
      font-size: 11px;
      color: ${primaryColor};
      font-weight: 500;
      margin-bottom: 2px;
    }

    .pp-reply-text {
      display: block;
      font-size: 12px;
      color: ${colors.textSecondary};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pp-reply-cancel {
      background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'};
      border: none;
      border-radius: 50%;
      color: ${colors.textSecondary};
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      min-width: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s;
    }

    .pp-reply-cancel:hover {
      background: ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'};
    }

    .pp-reply-cancel svg {
      width: 14px;
      height: 14px;
    }

    /* Reply Quote in Message */
    .pp-reply-quote {
      background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'};
      border-left: 2px solid ${primaryColor};
      padding: 4px 8px;
      margin-bottom: 6px;
      border-radius: 0 4px 4px 0;
      font-size: 12px;
      position: relative;
      z-index: 1;
    }

    .pp-reply-sender {
      display: block;
      font-weight: 500;
      color: ${primaryColor};
      margin-bottom: 2px;
    }

    .pp-reply-content {
      display: block;
      color: ${colors.textSecondary};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Clickable reply quote */
    .pp-reply-quote-clickable {
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
    }

    .pp-reply-quote-clickable:hover {
      background: ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'};
    }

    .pp-reply-quote-clickable:active {
      transform: scale(0.98);
    }

    /* Reply quote in visitor message bubble needs higher contrast */
    .pp-message-visitor .pp-reply-quote {
      background: rgba(255, 255, 255, 0.18);
      border-left-color: rgba(255, 255, 255, 0.7);
    }

    .pp-message-visitor .pp-reply-quote-clickable:hover {
      background: rgba(255, 255, 255, 0.25);
    }

    .pp-message-visitor .pp-reply-sender,
    .pp-message-visitor .pp-reply-content {
      color: rgba(255, 255, 255, 0.9);
    }

    /* Message highlight animation (when scrolling to a message) */
    .pp-message-highlight {
      animation: pp-highlight-pulse 1.5s ease-out;
    }

    @keyframes pp-highlight-pulse {
      0% {
        box-shadow: 0 0 0 0 ${primaryColor}80;
      }
      30% {
        box-shadow: 0 0 0 6px ${primaryColor}40;
      }
      100% {
        box-shadow: 0 0 0 0 ${primaryColor}00;
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
      color: ${colors.textSecondary};
      margin-left: 4px;
      font-style: italic;
    }

    /* Pre-Chat Form */
    .pp-prechat {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 24px 20px;
      overflow-y: auto;
    }

    .pp-prechat-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
      color: ${colors.text};
    }

    .pp-prechat-subtitle {
      font-size: 13px;
      color: ${colors.textSecondary};
      margin-bottom: 24px;
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
      height: 44px;
      margin-top: 8px;
      border: none;
      border-radius: 8px;
      background: ${primaryColor};
      color: white;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
    }

    .pp-prechat-submit:hover:not(:disabled) {
      opacity: 0.9;
    }

    .pp-prechat-submit:active:not(:disabled) {
      transform: scale(0.98);
    }

    .pp-prechat-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .pp-prechat-skip {
      width: 100%;
      padding: 12px;
      margin-top: 8px;
      border: none;
      background: transparent;
      color: ${colors.textSecondary};
      font-size: 13px;
      cursor: pointer;
      transition: color 0.2s;
    }

    .pp-prechat-skip:hover {
      color: ${colors.text};
    }
  `;
}

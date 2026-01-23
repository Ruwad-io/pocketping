import { h, Fragment } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { PocketPingClient } from '../client';
import type { PocketPingConfig, Message, MessageStatus } from '../types';
import { styles } from './styles';

interface Props {
  client: PocketPingClient;
  config: PocketPingConfig;
}

export function ChatWidget({ client, config: initialConfig }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [operatorOnline, setOperatorOnline] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // Config can be updated from server (SaaS dashboard settings)
  const [config, setConfig] = useState(initialConfig);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Subscribe to client events
  useEffect(() => {
    const unsubOpen = client.on<boolean>('openChange', setIsOpen);
    const unsubMessage = client.on<Message>('message', () => {
      // Simply sync with client's authoritative message list
      // Client already handles deduplication
      setMessages([...client.getMessages()]);
    });
    const unsubTyping = client.on<{ isTyping: boolean }>('typing', (data) => {
      setIsTyping(data.isTyping);
    });
    const unsubPresence = client.on<{ online: boolean }>('presence', (data) => {
      setOperatorOnline(data.online);
    });
    const unsubConnect = client.on('connect', () => {
      setIsConnected(true);
      setMessages(client.getMessages());
      setOperatorOnline(client.getSession()?.operatorOnline ?? false);
      // Update config with server values after connect
      setConfig(client.getConfig());
    });
    // Listen for config updates from server (SaaS dashboard changes)
    const unsubConfig = client.on('configUpdate', () => {
      setConfig(client.getConfig());
    });

    // Initial state
    if (client.isConnected()) {
      setIsConnected(true);
      setMessages(client.getMessages());
      setOperatorOnline(client.getSession()?.operatorOnline ?? false);
      setConfig(client.getConfig());
    }

    return () => {
      unsubOpen();
      unsubMessage();
      unsubTyping();
      unsubPresence();
      unsubConnect();
      unsubConfig();
    };
  }, [client]);

  // Auto-scroll to bottom when messages change (only if chat is open)
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Handle chat open: scroll to bottom and focus input
  useEffect(() => {
    if (isOpen) {
      // Scroll to bottom immediately when opening (instant, not smooth)
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 50);
      inputRef.current?.focus();
      // Clear unread count when chat opens
      setUnreadCount(0);
    }
  }, [isOpen]);

  // Track unread messages (from operator/AI) when chat is closed
  useEffect(() => {
    if (!isOpen && messages.length > 0) {
      const unread = messages.filter(
        (msg) => msg.sender !== 'visitor' && msg.status !== 'read'
      ).length;
      setUnreadCount(unread);
    }
  }, [messages, isOpen]);

  // Mark operator/AI messages as read when widget is open and visible
  const markMessagesAsRead = useCallback(() => {
    if (!isOpen || !isConnected) return;

    // Find operator/AI messages that haven't been marked as read
    const unreadMessages = messages.filter(
      (msg) => msg.sender !== 'visitor' && msg.status !== 'read'
    );

    if (unreadMessages.length > 0) {
      const messageIds = unreadMessages.map((msg) => msg.id);
      client.sendReadStatus(messageIds, 'read');
    }
  }, [isOpen, isConnected, messages, client]);

  // Auto-mark messages as read when widget opens or new messages arrive
  useEffect(() => {
    if (!isOpen || !isConnected) return;

    // Small delay to ensure user has actually seen the messages
    const timer = setTimeout(() => {
      markMessagesAsRead();
    }, 1000);

    return () => clearTimeout(timer);
  }, [isOpen, isConnected, messages, markMessagesAsRead]);

  // Mark as read when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isOpen) {
        markMessagesAsRead();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isOpen, markMessagesAsRead]);

  // Listen for read status updates from server
  useEffect(() => {
    const unsubRead = client.on<{ messageIds: string[]; status: MessageStatus }>(
      'read',
      () => {
        // Force re-render to update status indicators
        setMessages([...client.getMessages()]);
      }
    );

    return () => unsubRead();
  }, [client]);

  // Check page visibility
  const shouldShow = checkPageVisibility(config);
  if (!shouldShow) return null;

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const content = inputValue;
    setInputValue('');

    try {
      await client.sendMessage(content);
    } catch (err) {
      console.error('[PocketPing] Failed to send message:', err);
      // Could show error UI here
    }
  };

  const handleInputChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    setInputValue(target.value);
    // Debounce typing indicator
    client.sendTyping(true);
  };

  const position = config.position ?? 'bottom-right';
  const theme = getTheme(config.theme ?? 'auto');
  const primaryColor = config.primaryColor ?? '#6366f1';

  return (
    <Fragment>
      <style>{styles(primaryColor, theme)}</style>

      {/* Toggle Button */}
      <button
        class={`pp-toggle pp-${position}`}
        onClick={() => client.toggleOpen()}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
      >
        {isOpen ? (
          <CloseIcon />
        ) : (
          <ChatIcon />
        )}
        {/* Show unread badge when there are unread messages, otherwise show online dot */}
        {!isOpen && unreadCount > 0 && (
          <span class="pp-unread-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
        {!isOpen && unreadCount === 0 && operatorOnline && <span class="pp-online-dot" />}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div class={`pp-window pp-${position} pp-theme-${theme}`}>
          {/* Header */}
          <div class="pp-header">
            <div class="pp-header-info">
              {config.operatorAvatar && (
                <img src={config.operatorAvatar} alt="" class="pp-avatar" />
              )}
              <div>
                <div class="pp-header-title">
                  {config.operatorName ?? 'Support'}
                </div>
                <div class="pp-header-status">
                  {operatorOnline ? (
                    <><span class="pp-status-dot pp-online" /> Online</>
                  ) : (
                    <><span class="pp-status-dot" /> Away</>
                  )}
                </div>
              </div>
            </div>
            <button
              class="pp-close-btn"
              onClick={() => client.setOpen(false)}
              aria-label="Close chat"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Messages */}
          <div class="pp-messages">
            {config.welcomeMessage && messages.length === 0 && (
              <div class="pp-welcome">
                {config.welcomeMessage}
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                class={`pp-message pp-message-${msg.sender}`}
              >
                <div class="pp-message-content">{msg.content}</div>
                <div class="pp-message-time">
                  {formatTime(msg.timestamp)}
                  {msg.sender === 'ai' && <span class="pp-ai-badge">AI</span>}
                  {msg.sender === 'visitor' && (
                    <span class={`pp-status pp-status-${msg.status ?? 'sent'}`}>
                      <StatusIcon status={msg.status} />
                    </span>
                  )}
                </div>
              </div>
            ))}

            {isTyping && (
              <div class="pp-message pp-message-operator pp-typing">
                <span></span><span></span><span></span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form class="pp-input-form" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              class="pp-input"
              placeholder={config.placeholder ?? 'Type a message...'}
              value={inputValue}
              onInput={handleInputChange}
              disabled={!isConnected}
            />
            <button
              type="submit"
              class="pp-send-btn"
              disabled={!inputValue.trim() || !isConnected}
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          </form>

          {/* Powered by */}
          <div class="pp-footer">
            Powered by <a href="https://pocketping.io" target="_blank" rel="noopener">PocketPing</a>
          </div>
        </div>
      )}
    </Fragment>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function checkPageVisibility(config: PocketPingConfig): boolean {
  const path = window.location.pathname;

  if (config.hideOnPages?.some((pattern) => new RegExp(pattern).test(path))) {
    return false;
  }

  if (config.showOnPages?.length) {
    return config.showOnPages.some((pattern) => new RegExp(pattern).test(path));
  }

  return true;
}

function getTheme(theme: 'light' | 'dark' | 'auto'): 'light' | 'dark' {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function StatusIcon({ status }: { status?: MessageStatus }) {
  // Single check for sending/sent
  if (!status || status === 'sending' || status === 'sent') {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" class="pp-check">
        <polyline points="3 8 7 12 13 4" />
      </svg>
    );
  }

  // Double check for delivered
  if (status === 'delivered') {
    return (
      <svg viewBox="0 0 20 16" fill="none" stroke="currentColor" stroke-width="2" class="pp-check-double">
        <polyline points="1 8 5 12 11 4" />
        <polyline points="7 8 11 12 17 4" />
      </svg>
    );
  }

  // Blue double check for read
  if (status === 'read') {
    return (
      <svg viewBox="0 0 20 16" fill="none" stroke="currentColor" stroke-width="2" class="pp-check-double pp-check-read">
        <polyline points="1 8 5 12 11 4" />
        <polyline points="7 8 11 12 17 4" />
      </svg>
    );
  }

  return null;
}

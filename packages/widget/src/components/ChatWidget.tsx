import { h, Fragment } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import type { PocketPingClient } from '../client';
import type { PocketPingConfig, Message } from '../types';
import { styles } from './styles';

interface Props {
  client: PocketPingClient;
  config: PocketPingConfig;
}

export function ChatWidget({ client, config }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [operatorOnline, setOperatorOnline] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Subscribe to client events
  useEffect(() => {
    const unsubOpen = client.on<boolean>('openChange', setIsOpen);
    const unsubMessage = client.on<Message>('message', (msg) => {
      setMessages((prev) => [...prev, msg]);
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
    });

    // Initial state
    if (client.isConnected()) {
      setIsConnected(true);
      setMessages(client.getMessages());
      setOperatorOnline(client.getSession()?.operatorOnline ?? false);
    }

    return () => {
      unsubOpen();
      unsubMessage();
      unsubTyping();
      unsubPresence();
      unsubConnect();
    };
  }, [client]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

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
        {!isOpen && operatorOnline && <span class="pp-online-dot" />}
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
            Powered by <a href="https://github.com/pocketping/pocketping" target="_blank" rel="noopener">PocketPing</a>
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

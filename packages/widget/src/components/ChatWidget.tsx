import { h, Fragment } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { PocketPingClient } from '../client';
import type { PocketPingConfig, Message, MessageStatus, Attachment, ReplyToData, PreChatFormConfig } from '../types';
import { styles } from './styles';
import { PreChatForm } from './PreChatForm';

// Format date for message separators (Today, Yesterday, or date)
function formatDateSeparator(date: Date): string {
  const now = new Date();
  const messageDate = new Date(date);

  // Reset time for comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate());

  const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  // Format as "Jan 15, 2024"
  return messageDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: messageDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

// Get date string for comparison (YYYY-MM-DD)
function getDateKey(date: Date): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface Props {
  client: PocketPingClient;
  config: PocketPingConfig;
}

interface PendingAttachment {
  id: string;
  file: File;
  preview?: string;
  progress: number;
  status: 'pending' | 'uploading' | 'ready' | 'error';
  attachment?: Attachment;
  error?: string;
}

export function ChatWidget({ client, config: initialConfig }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [operatorOnline, setOperatorOnline] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  // Edit/Delete/Reply state
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState('');
  const [messageMenu, setMessageMenu] = useState<{ message: Message; x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Swipe state for mobile
  const [swipedMessageId, setSwipedMessageId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  // Config can be updated from server (SaaS dashboard settings)
  const [config, setConfig] = useState(initialConfig);
  // Pre-chat form state
  const [preChatForm, setPreChatForm] = useState<PreChatFormConfig | undefined>(undefined);
  const [preChatSkipped, setPreChatSkipped] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

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
      // Set pre-chat form config from session
      setPreChatForm(client.getSession()?.preChatForm);
    });
    const unsubPreChat = client.on('preChatCompleted', () => {
      // Mark pre-chat as completed in local state
      setPreChatForm((prev) => prev ? { ...prev, completed: true } : prev);
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
      setPreChatForm(client.getSession()?.preChatForm);
    }

    return () => {
      unsubOpen();
      unsubMessage();
      unsubTyping();
      unsubPresence();
      unsubConnect();
      unsubPreChat();
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
    const hasContent = inputValue.trim().length > 0;
    const readyAttachments = pendingAttachments.filter((a) => a.status === 'ready' && a.attachment);

    if (!hasContent && readyAttachments.length === 0) return;

    const content = inputValue;
    const attachmentIds = readyAttachments.map((a) => a.attachment!.id);
    const replyToId = replyingTo?.id;

    setInputValue('');
    setPendingAttachments([]);
    setReplyingTo(null);

    try {
      await client.sendMessage(content, attachmentIds, replyToId);
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

  const handleFileSelect = async (e: Event) => {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    // Add files to pending list
    const newPending: PendingAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = `pending-${Date.now()}-${i}`;

      // Create preview for images
      let preview: string | undefined;
      if (file.type.startsWith('image/')) {
        preview = URL.createObjectURL(file);
      }

      newPending.push({
        id,
        file,
        preview,
        progress: 0,
        status: 'pending',
      });
    }

    setPendingAttachments((prev) => [...prev, ...newPending]);

    // Reset input value AFTER processing files (so we can select the same file again)
    target.value = '';

    // Upload files
    setIsUploading(true);
    for (const pending of newPending) {
      try {
        // Update status to uploading
        setPendingAttachments((prev) =>
          prev.map((a) => (a.id === pending.id ? { ...a, status: 'uploading' as const } : a))
        );

        const attachment = await client.uploadFile(pending.file, (progress) => {
          setPendingAttachments((prev) =>
            prev.map((a) => (a.id === pending.id ? { ...a, progress } : a))
          );
        });

        // Update with completed attachment
        setPendingAttachments((prev) =>
          prev.map((a) =>
            a.id === pending.id
              ? { ...a, status: 'ready' as const, progress: 100, attachment }
              : a
          )
        );
      } catch (err) {
        console.error('[PocketPing] Failed to upload file:', err);
        setPendingAttachments((prev) =>
          prev.map((a) =>
            a.id === pending.id
              ? { ...a, status: 'error' as const, error: 'Upload failed' }
              : a
          )
        );
      }
    }
    setIsUploading(false);
  };

  const handleRemoveAttachment = (id: string) => {
    setPendingAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      // Revoke blob URL if preview exists
      if (removed?.preview) {
        URL.revokeObjectURL(removed.preview);
      }
      return prev.filter((a) => a.id !== id);
    });
  };

  // ─────────────────────────────────────────────────────────────────
  // Reply, Edit, Delete handlers
  // ─────────────────────────────────────────────────────────────────

  const handleReply = (message: Message) => {
    setReplyingTo(message);
    setMessageMenu(null);
    inputRef.current?.focus();
  };

  const handleCancelReply = () => {
    setReplyingTo(null);
  };

  const handleStartEdit = (message: Message) => {
    if (message.sender !== 'visitor') return; // Can only edit own messages
    setEditingMessage(message);
    setEditContent(message.content);
    setMessageMenu(null);
  };

  const handleCancelEdit = () => {
    setEditingMessage(null);
    setEditContent('');
  };

  const handleSaveEdit = async () => {
    if (!editingMessage || !editContent.trim()) return;
    try {
      await client.editMessage(editingMessage.id, editContent.trim());
      setEditingMessage(null);
      setEditContent('');
    } catch (err) {
      console.error('[PocketPing] Failed to edit message:', err);
    }
  };

  const handleDelete = async (message: Message) => {
    if (message.sender !== 'visitor') return; // Can only delete own messages
    setMessageMenu(null);
    if (confirm('Delete this message?')) {
      try {
        await client.deleteMessage(message.id);
      } catch (err) {
        console.error('[PocketPing] Failed to delete message:', err);
      }
    }
  };

  // Long press / context menu for message actions
  const handleMessageContextMenu = (e: Event, message: Message) => {
    e.preventDefault();
    const mouseEvent = e as MouseEvent;
    setMessageMenu({
      message,
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
    });
  };

  // Long press for mobile
  // Swipe gesture handlers for mobile
  const handleTouchStart = (e: TouchEvent, message: Message) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };

    // Reset any other swiped message
    if (swipedMessageId && swipedMessageId !== message.id) {
      setSwipedMessageId(null);
      setSwipeOffset(0);
    }
  };

  const handleTouchMove = (e: TouchEvent, message: Message) => {
    if (!touchStartRef.current) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;

    // If scrolling vertically, don't swipe
    if (Math.abs(deltaY) > Math.abs(deltaX)) return;

    // Only allow left swipe (negative deltaX)
    if (deltaX < 0) {
      // Limit swipe to -100px max
      const offset = Math.max(deltaX, -100);
      setSwipeOffset(offset);
      setSwipedMessageId(message.id);
    }
  };

  const handleTouchEnd = (message: Message) => {
    if (!touchStartRef.current) return;

    const elapsed = Date.now() - touchStartRef.current.time;

    // If swiped more than 50px or fast swipe, lock open
    if (swipeOffset < -50 || (swipeOffset < -20 && elapsed < 200)) {
      setSwipeOffset(-80); // Lock at action reveal position
      if (navigator.vibrate) navigator.vibrate(30);
    } else {
      // Reset
      setSwipeOffset(0);
      setSwipedMessageId(null);
    }

    touchStartRef.current = null;
  };

  const resetSwipe = () => {
    setSwipedMessageId(null);
    setSwipeOffset(0);
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!messageMenu) return;
    const handleClickOutside = () => setMessageMenu(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [messageMenu]);

  // Scroll to message when clicking on a reply quote
  const scrollToMessage = (messageId: string) => {
    const messageElement = document.getElementById(`pp-msg-${messageId}`);
    if (messageElement) {
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add highlight animation
      messageElement.classList.add('pp-message-highlight');
      setTimeout(() => {
        messageElement.classList.remove('pp-message-highlight');
      }, 1500);
    }
  };

  // ─────────────────────────────────────────────────────────────────
  // Drag & Drop handlers
  // ─────────────────────────────────────────────────────────────────

  // Track drag enter/leave with a counter to handle nested elements
  const dragCounterRef = useRef(0);

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Process dropped files (reuse file select logic)
    const newPending: PendingAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = `pending-${Date.now()}-${i}`;

      let preview: string | undefined;
      if (file.type.startsWith('image/')) {
        preview = URL.createObjectURL(file);
      }

      newPending.push({
        id,
        file,
        preview,
        progress: 0,
        status: 'pending',
      });
    }

    setPendingAttachments((prev) => [...prev, ...newPending]);

    // Upload files
    setIsUploading(true);
    for (const pending of newPending) {
      try {
        setPendingAttachments((prev) =>
          prev.map((a) => (a.id === pending.id ? { ...a, status: 'uploading' as const } : a))
        );

        const attachment = await client.uploadFile(pending.file, (progress) => {
          setPendingAttachments((prev) =>
            prev.map((a) => (a.id === pending.id ? { ...a, progress } : a))
          );
        });

        setPendingAttachments((prev) =>
          prev.map((a) =>
            a.id === pending.id
              ? { ...a, status: 'ready' as const, progress: 100, attachment }
              : a
          )
        );
      } catch (err) {
        console.error('[PocketPing] Failed to upload dropped file:', err);
        setPendingAttachments((prev) =>
          prev.map((a) =>
            a.id === pending.id
              ? { ...a, status: 'error' as const, error: 'Upload failed' }
              : a
          )
        );
      }
    }
    setIsUploading(false);
  };

  const position = config.position ?? 'bottom-right';
  const theme = getTheme(config.theme ?? 'auto');
  const primaryColor = config.primaryColor ?? '#6366f1';
  // Action icon color (matches styles.ts textSecondary)
  const actionIconColor = theme === 'dark' ? '#9ca3af' : '#6b7280';

  // Style options for customizable colors
  const styleOptions = {
    primaryColor,
    theme,
    headerColor: config.headerColor,
    footerColor: config.footerColor,
    chatBackground: config.chatBackground,
    toggleColor: config.toggleColor,
  };

  // Determine if we should show the pre-chat form
  const shouldShowPreChat = preChatForm
    && preChatForm.enabled
    && !preChatForm.completed
    && !preChatSkipped
    && (
      // Before first message: show immediately
      (preChatForm.timing === 'before-first-message' && messages.length === 0)
      // After first message: show when visitor has sent at least one message
      || (preChatForm.timing === 'after-first-message' && messages.some(m => m.sender === 'visitor'))
    );

  return (
    <Fragment>
      <style>{styles(styleOptions)}</style>

      {/* Toggle Button - Hidden when chat is open (close via header X button) */}
      {!isOpen && (
        <button
          class={`pp-toggle pp-${position}`}
          onClick={() => client.toggleOpen()}
          aria-label="Open chat"
        >
          <ChatIcon />
          {/* Show unread badge when there are unread messages, otherwise show online dot */}
          {unreadCount > 0 && (
            <span class="pp-unread-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
          {unreadCount === 0 && operatorOnline && <span class="pp-online-dot" />}
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div
          class={`pp-window pp-${position} pp-theme-${theme} ${isDragging ? 'pp-dragging' : ''}`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag & Drop Overlay */}
          {isDragging && (
            <div class="pp-drop-overlay">
              <div class="pp-drop-icon"><AttachIcon /></div>
              <div class="pp-drop-text">Drop files to upload</div>
            </div>
          )}

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

          {/* Pre-Chat Form */}
          {shouldShowPreChat && preChatForm && (
            <PreChatForm
              client={client}
              config={preChatForm}
              onComplete={() => {
                setPreChatForm((prev) => prev ? { ...prev, completed: true } : prev);
              }}
              onSkip={() => {
                setPreChatSkipped(true);
              }}
            />
          )}

          {/* Messages */}
          {!shouldShowPreChat && (
          <div class="pp-messages" ref={messagesContainerRef} onClick={() => swipedMessageId && resetSwipe()}>
            {config.welcomeMessage && messages.length === 0 && (
              <div class="pp-welcome">
                {config.welcomeMessage}
              </div>
            )}

            {messages.map((msg, index) => {
              const isDeleted = !!msg.deletedAt;
              const isEdited = !!msg.editedAt;

              // Check if we need a date separator
              const msgDate = new Date(msg.timestamp);
              const prevMsg = index > 0 ? messages[index - 1] : null;
              const showDateSeparator = !prevMsg || getDateKey(new Date(prevMsg.timestamp)) !== getDateKey(msgDate);

              // Handle replyTo - can be string ID or embedded object from SSE
              let replyData: ReplyToData | null = null;
              if (msg.replyTo) {
                if (typeof msg.replyTo === 'object') {
                  // SSE sends embedded reply data
                  replyData = msg.replyTo as ReplyToData;
                } else {
                  // String ID - try to find in local messages
                  const replyToMsg = messages.find((m) => m.id === msg.replyTo);
                  if (replyToMsg) {
                    const hasAttachment = !!(replyToMsg.attachments && replyToMsg.attachments.length > 0);
                    replyData = {
                      id: replyToMsg.id,
                      sender: replyToMsg.sender,
                      content: replyToMsg.content,
                      deleted: !!replyToMsg.deletedAt,
                      hasAttachment,
                      attachmentType: hasAttachment ? replyToMsg.attachments![0].mimeType : undefined,
                    };
                  }
                }
              }

              const isSwiped = swipedMessageId === msg.id;
              const msgSwipeOffset = isSwiped ? swipeOffset : 0;

              return (
                <Fragment key={msg.id}>
                  {showDateSeparator && (
                    <div class="pp-date-separator">
                      <span>{formatDateSeparator(msgDate)}</span>
                    </div>
                  )}
                  <div class={`pp-message-swipe-container ${msg.sender === 'visitor' ? 'pp-swipe-left' : 'pp-swipe-right'}`}>
                    {/* Swipe actions (mobile) - revealed when swiping */}
                    <div class="pp-swipe-actions">
                      <button
                        class="pp-swipe-action pp-swipe-reply"
                        onClick={() => { handleReply(msg); resetSwipe(); }}
                      >
                        <ReplyIcon color="#fff" />
                      </button>
                      {msg.sender === 'visitor' && !isDeleted && (
                        <>
                          <button
                            class="pp-swipe-action pp-swipe-edit"
                            onClick={() => { handleStartEdit(msg); resetSwipe(); }}
                          >
                            <EditIcon color="#fff" />
                          </button>
                          <button
                            class="pp-swipe-action pp-swipe-delete"
                            onClick={() => { handleDelete(msg); resetSwipe(); }}
                          >
                            <DeleteIcon color="#fff" />
                          </button>
                        </>
                      )}
                    </div>
                    <div
                      id={`pp-msg-${msg.id}`}
                      class={`pp-message pp-message-${msg.sender} ${isDeleted ? 'pp-message-deleted' : ''}`}
                      style={{ transform: `translateX(${msgSwipeOffset}px)`, transition: touchStartRef.current ? 'none' : 'transform 0.2s ease-out' }}
                      onContextMenu={(e) => handleMessageContextMenu(e, msg)}
                      onTouchStart={(e) => handleTouchStart(e, msg)}
                      onTouchMove={(e) => handleTouchMove(e, msg)}
                      onTouchEnd={() => handleTouchEnd(msg)}
                      onTouchCancel={() => handleTouchEnd(msg)}
                    >
                  {/* Reply quote - clickable to scroll to original message */}
                  {replyData && (replyData.content || replyData.hasAttachment) && (
                    <div
                      class="pp-reply-quote pp-reply-quote-clickable"
                      onClick={() => scrollToMessage(replyData.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && scrollToMessage(replyData.id)}
                    >
                      <span class="pp-reply-sender">{replyData.sender === 'visitor' ? 'You' : 'Support'}</span>
                      <span class="pp-reply-content">
                        {replyData.deleted ? 'Message deleted' : (
                          <>
                            {replyData.hasAttachment && (
                              <span class="pp-reply-attachment-icon">
                                {replyData.attachmentType?.startsWith('image/') ? '📷 ' : '📎 '}
                              </span>
                            )}
                            {replyData.content ? (
                              <>{(replyData.content || '').slice(0, 50)}{(replyData.content || '').length > 50 ? '...' : ''}</>
                            ) : (
                              replyData.attachmentType?.startsWith('image/') ? 'Photo' : 'File'
                            )}
                          </>
                        )}
                      </span>
                    </div>
                  )}
                  {isDeleted ? (
                    <div class="pp-message-content pp-deleted-content">
                      <span class="pp-deleted-icon">🗑️</span> Message deleted
                    </div>
                  ) : (
                    <>
                      {msg.content && (
                        <div class="pp-message-content">
                          {msg.content}
                          <span class="pp-message-time">
                            {formatTime(msg.timestamp)}
                            {isEdited && <span class="pp-edited-badge">edited</span>}
                            {msg.sender === 'ai' && <span class="pp-ai-badge">AI</span>}
                            {msg.sender === 'visitor' && (
                              <span class={`pp-status pp-status-${msg.status ?? 'sent'}`}>
                                <StatusIcon status={msg.status} />
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div class="pp-message-attachments">
                          {msg.attachments.map((att) => (
                            <AttachmentDisplay key={att.id} attachment={att} />
                          ))}
                          {!msg.content && (
                            <span class="pp-message-time pp-attachment-time">
                              {formatTime(msg.timestamp)}
                              {isEdited && <span class="pp-edited-badge">edited</span>}
                              {msg.sender === 'ai' && <span class="pp-ai-badge">AI</span>}
                              {msg.sender === 'visitor' && (
                                <span class={`pp-status pp-status-${msg.status ?? 'sent'}`}>
                                  <StatusIcon status={msg.status} />
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                    </div>
                  </div>
                </Fragment>
              );
            })}

            {isTyping && (
              <div class="pp-message pp-message-operator pp-typing">
                <span></span><span></span><span></span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
          )}

          {/* Message Context Menu */}
          {messageMenu && (
            <div
              class="pp-message-menu"
              style={{ top: `${messageMenu.y}px`, left: `${messageMenu.x}px` }}
            >
              <button onClick={() => handleReply(messageMenu.message)}>
                <ReplyIcon color={actionIconColor} /> Reply
              </button>
              {messageMenu.message.sender === 'visitor' && !messageMenu.message.deletedAt && (
                <>
                  <button onClick={() => handleStartEdit(messageMenu.message)}>
                    <EditIcon color={actionIconColor} /> Edit
                  </button>
                  <button class="pp-menu-delete" onClick={() => handleDelete(messageMenu.message)}>
                    <DeleteIcon color="#ef4444" /> Delete
                  </button>
                </>
              )}
            </div>
          )}

          {/* Edit Modal */}
          {editingMessage && (
            <div class="pp-edit-modal">
              <div class="pp-edit-header">
                <span>Edit message</span>
                <button onClick={handleCancelEdit}><CloseIcon /></button>
              </div>
              <textarea
                class="pp-edit-input"
                value={editContent}
                onInput={(e) => setEditContent((e.target as HTMLTextAreaElement).value)}
                autoFocus
              />
              <div class="pp-edit-actions">
                <button class="pp-edit-cancel" onClick={handleCancelEdit}>Cancel</button>
                <button class="pp-edit-save" onClick={handleSaveEdit} disabled={!editContent.trim()}>Save</button>
              </div>
            </div>
          )}

          {/* Reply Preview */}
          {replyingTo && (
            <div class="pp-reply-preview">
              <div class="pp-reply-preview-content">
                <span class="pp-reply-label">Replying to</span>
                <span class="pp-reply-text">
                  {replyingTo.attachments && replyingTo.attachments.length > 0 && (
                    <span class="pp-reply-attachment-icon">
                      {replyingTo.attachments[0].mimeType.startsWith('image/') ? '📷 ' : '📎 '}
                    </span>
                  )}
                  {replyingTo.content ? (
                    <>{replyingTo.content.slice(0, 50)}{replyingTo.content.length > 50 ? '...' : ''}</>
                  ) : (
                    replyingTo.attachments?.[0]?.mimeType.startsWith('image/') ? 'Photo' : 'File'
                  )}
                </span>
              </div>
              <button class="pp-reply-cancel" onClick={handleCancelReply}><CloseIcon /></button>
            </div>
          )}

          {/* Attachment Preview */}
          {pendingAttachments.length > 0 && (
            <div class="pp-attachments-preview">
              {pendingAttachments.map((pending) => (
                <div key={pending.id} class={`pp-attachment-preview pp-attachment-${pending.status}`}>
                  {pending.preview ? (
                    <img src={pending.preview} alt={pending.file.name} class="pp-preview-img" />
                  ) : (
                    <div class="pp-preview-file">
                      <FileIcon mimeType={pending.file.type} />
                    </div>
                  )}
                  <button
                    class="pp-remove-attachment"
                    onClick={() => handleRemoveAttachment(pending.id)}
                    aria-label="Remove attachment"
                    type="button"
                  >
                    <CloseIcon />
                  </button>
                  {pending.status === 'uploading' && (
                    <div class="pp-upload-progress" style={{ width: `${pending.progress}%` }} />
                  )}
                  {pending.status === 'error' && (
                    <div class="pp-upload-error" title={pending.error}>!</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          {!shouldShowPreChat && (
          <form class="pp-input-form" onSubmit={handleSubmit}>
            {/* Hidden file input - using both onChange and native onchange for Preact compatibility */}
            <input
              ref={(el) => {
                fileInputRef.current = el;
                if (el) {
                  // Directly attach native event listener for maximum compatibility
                  el.onchange = handleFileSelect as unknown as (ev: Event) => void;
                }
              }}
              type="file"
              class="pp-file-input"
              accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              multiple
            />
            {/* Attachment button */}
            <button
              type="button"
              class="pp-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isConnected || isUploading}
              aria-label="Attach file"
            >
              <AttachIcon />
            </button>
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
              disabled={(!inputValue.trim() && pendingAttachments.filter(a => a.status === 'ready').length === 0) || !isConnected || isUploading}
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          </form>
          )}

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

function AttachIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function ReplyIcon({ color, size = 16 }: { color?: string; size?: number }) {
  const strokeColor = color || 'currentColor';
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke-width="2" style={{ stroke: strokeColor, width: `${size}px`, minWidth: `${size}px`, height: `${size}px`, display: 'block', flexShrink: 0 }}>
      <polyline points="9 17 4 12 9 7" />
      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

function EditIcon({ color, size = 16 }: { color?: string; size?: number }) {
  const strokeColor = color || 'currentColor';
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke-width="2" style={{ stroke: strokeColor, width: `${size}px`, minWidth: `${size}px`, height: `${size}px`, display: 'block', flexShrink: 0 }}>
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function DeleteIcon({ color, size = 16 }: { color?: string; size?: number }) {
  const strokeColor = color || 'currentColor';
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke-width="2" style={{ stroke: strokeColor, width: `${size}px`, minWidth: `${size}px`, height: `${size}px`, display: 'block', flexShrink: 0 }}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function FileIcon({ mimeType }: { mimeType: string }) {
  // PDF
  if (mimeType === 'application/pdf') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M9 15h6" />
        <path d="M9 11h6" />
      </svg>
    );
  }
  // Audio
  if (mimeType.startsWith('audio/')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  // Video
  if (mimeType.startsWith('video/')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
        <line x1="7" y1="2" x2="7" y2="22" />
        <line x1="17" y1="2" x2="17" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="2" y1="7" x2="7" y2="7" />
        <line x1="2" y1="17" x2="7" y2="17" />
        <line x1="17" y1="17" x2="22" y2="17" />
        <line x1="17" y1="7" x2="22" y2="7" />
      </svg>
    );
  }
  // Default file icon
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function AttachmentDisplay({ attachment }: { attachment: Attachment }) {
  const isImage = attachment.mimeType.startsWith('image/');
  const isAudio = attachment.mimeType.startsWith('audio/');
  const isVideo = attachment.mimeType.startsWith('video/');

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (isImage) {
    return (
      <a href={attachment.url} target="_blank" rel="noopener" class="pp-attachment pp-attachment-image">
        <img src={attachment.thumbnailUrl || attachment.url} alt={attachment.filename} />
      </a>
    );
  }

  if (isAudio) {
    return (
      <div class="pp-attachment pp-attachment-audio">
        <audio controls preload="metadata">
          <source src={attachment.url} type={attachment.mimeType} />
        </audio>
        <span class="pp-attachment-name">{attachment.filename}</span>
      </div>
    );
  }

  if (isVideo) {
    return (
      <div class="pp-attachment pp-attachment-video">
        <video controls preload="metadata">
          <source src={attachment.url} type={attachment.mimeType} />
        </video>
      </div>
    );
  }

  // Default: file download link
  return (
    <a href={attachment.url} target="_blank" rel="noopener" class="pp-attachment pp-attachment-file">
      <FileIcon mimeType={attachment.mimeType} />
      <div class="pp-attachment-info">
        <span class="pp-attachment-name">{attachment.filename}</span>
        <span class="pp-attachment-size">{formatSize(attachment.size)}</span>
      </div>
    </a>
  );
}

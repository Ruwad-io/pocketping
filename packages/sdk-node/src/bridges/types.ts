import type { PocketPing } from '../pocketping';
import type { CustomEvent, Message, MessageStatus, Session } from '../types';

/**
 * Result from sending a message to a bridge.
 * Contains the bridge-specific message ID for later edit/delete.
 */
export interface BridgeMessageResult {
  /** Bridge-specific message ID */
  messageId?: string | number;
}

/**
 * Bridge interface for notification channels.
 * Implement this interface to add support for Telegram, Discord, Slack, etc.
 */
export interface Bridge {
  /** Unique name for this bridge */
  name: string;

  /** Called when the bridge is added to PocketPing */
  init?(pocketping: PocketPing): void | Promise<void>;

  /** Called when a new chat session is created */
  onNewSession?(session: Session): void | Promise<void>;

  /**
   * Called when a visitor sends a message.
   * Return the bridge message ID for edit/delete sync.
   */
  onVisitorMessage?(
    message: Message,
    session: Session
  ): void | BridgeMessageResult | Promise<void | BridgeMessageResult>;

  /** Called when an operator sends a message (for cross-bridge sync) */
  onOperatorMessage?(
    message: Message,
    session: Session,
    sourceBridge?: string,
    operatorName?: string
  ): void | Promise<void>;

  /** Called when visitor starts/stops typing */
  onTyping?(sessionId: string, isTyping: boolean): void | Promise<void>;

  /** Called when messages are marked as delivered/read */
  onMessageRead?(
    sessionId: string,
    messageIds: string[],
    status: MessageStatus,
    session: Session
  ): void | Promise<void>;

  /**
   * Called when a visitor edits their message.
   * @param messageId - The message ID in PocketPing
   * @param newContent - The new message content
   * @param bridgeMessageId - The bridge-specific message ID
   * @returns true if edit succeeded, false otherwise
   */
  onMessageEdit?(
    messageId: string,
    newContent: string,
    bridgeMessageId: string | number
  ): boolean | Promise<boolean>;

  /**
   * Called when a visitor deletes their message.
   * @param messageId - The message ID in PocketPing
   * @param bridgeMessageId - The bridge-specific message ID
   * @returns true if delete succeeded, false otherwise
   */
  onMessageDelete?(messageId: string, bridgeMessageId: string | number): boolean | Promise<boolean>;

  /** Called when a custom event is triggered from the widget */
  onCustomEvent?(event: CustomEvent, session: Session): void | Promise<void>;

  /** Called when a user identifies themselves via PocketPing.identify() */
  onIdentityUpdate?(session: Session): void | Promise<void>;

  /** Cleanup when bridge is removed */
  destroy?(): void | Promise<void>;
}

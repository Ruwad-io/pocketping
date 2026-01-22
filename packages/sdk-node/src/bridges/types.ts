import type { PocketPing } from '../pocketping';
import type { Session, Message, MessageStatus, CustomEvent } from '../types';

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

  /** Called when a visitor sends a message */
  onVisitorMessage?(message: Message, session: Session): void | Promise<void>;

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

  /** Called when a custom event is triggered from the widget */
  onCustomEvent?(event: CustomEvent, session: Session): void | Promise<void>;

  /** Called when a user identifies themselves via PocketPing.identify() */
  onIdentityUpdate?(session: Session): void | Promise<void>;

  /** Cleanup when bridge is removed */
  destroy?(): void | Promise<void>;
}

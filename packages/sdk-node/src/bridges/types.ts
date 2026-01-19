import type { PocketPing } from '../pocketping';
import type { Session, Message, MessageStatus } from '../types';

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
  onMessage?(message: Message, session: Session): void | Promise<void>;

  /** Called when visitor starts/stops typing */
  onTyping?(sessionId: string, isTyping: boolean): void | Promise<void>;

  /** Called when messages are marked as delivered/read */
  onMessageRead?(
    sessionId: string,
    messageIds: string[],
    status: MessageStatus
  ): void | Promise<void>;

  /** Cleanup when bridge is removed */
  destroy?(): void | Promise<void>;
}

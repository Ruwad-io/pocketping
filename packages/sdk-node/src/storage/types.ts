import type { Message, Session } from '../types';

/**
 * Bridge message IDs for edit/delete sync.
 * Stored when a message is sent to bridges.
 */
export interface BridgeMessageIds {
  telegramMessageId?: number;
  discordMessageId?: string;
  slackMessageTs?: string;
}

/**
 * Storage adapter interface.
 * Implement this interface to use any database with PocketPing.
 */
export interface Storage {
  // Sessions
  createSession(session: Session): Promise<void>;
  getSession(sessionId: string): Promise<Session | null>;
  getSessionByVisitorId?(visitorId: string): Promise<Session | null>;
  updateSession(session: Session): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;

  // Messages
  saveMessage(message: Message): Promise<void>;
  getMessages(sessionId: string, after?: string, limit?: number): Promise<Message[]>;
  getMessage(messageId: string): Promise<Message | null>;
  /** Update an existing message (for edit/delete) */
  updateMessage?(message: Message): Promise<void>;

  // Bridge message IDs (for edit/delete sync)
  /** Save bridge message IDs for a message */
  saveBridgeMessageIds?(messageId: string, bridgeIds: BridgeMessageIds): Promise<void>;
  /** Get bridge message IDs for a message */
  getBridgeMessageIds?(messageId: string): Promise<BridgeMessageIds | null>;

  // Optional: Cleanup old sessions
  cleanupOldSessions?(olderThan: Date): Promise<number>;
}

import type { Session, Message } from '../types';

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

  // Optional: Cleanup old sessions
  cleanupOldSessions?(olderThan: Date): Promise<number>;
}

import type { Storage } from './types';
import type { Session, Message } from '../types';

/**
 * In-memory storage adapter.
 * Useful for development and testing. Data is lost on restart.
 */
export class MemoryStorage implements Storage {
  private sessions: Map<string, Session> = new Map();
  private messages: Map<string, Message[]> = new Map();
  private messageById: Map<string, Message> = new Map();

  async createSession(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
    this.messages.set(session.id, []);
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async getSessionByVisitorId(visitorId: string): Promise<Session | null> {
    const visitorSessions = Array.from(this.sessions.values()).filter(
      (s) => s.visitorId === visitorId
    );
    if (visitorSessions.length === 0) return null;
    // Return most recent by lastActivity
    return visitorSessions.reduce((latest, s) =>
      s.lastActivity > latest.lastActivity ? s : latest
    );
  }

  async updateSession(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
  }

  async saveMessage(message: Message): Promise<void> {
    const sessionMessages = this.messages.get(message.sessionId) ?? [];
    sessionMessages.push(message);
    this.messages.set(message.sessionId, sessionMessages);
    this.messageById.set(message.id, message);
  }

  async getMessages(sessionId: string, after?: string, limit = 50): Promise<Message[]> {
    const sessionMessages = this.messages.get(sessionId) ?? [];

    let startIndex = 0;
    if (after) {
      const afterIndex = sessionMessages.findIndex((m) => m.id === after);
      if (afterIndex !== -1) {
        startIndex = afterIndex + 1;
      }
    }

    return sessionMessages.slice(startIndex, startIndex + limit);
  }

  async getMessage(messageId: string): Promise<Message | null> {
    return this.messageById.get(messageId) ?? null;
  }

  async cleanupOldSessions(olderThan: Date): Promise<number> {
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (session.lastActivity < olderThan) {
        this.sessions.delete(id);
        this.messages.delete(id);
        count++;
      }
    }
    return count;
  }
}

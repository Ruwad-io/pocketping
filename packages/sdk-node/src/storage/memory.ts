import type { Attachment, Message, Session } from '../types';
import type { BridgeMessageIds, Storage } from './types';

/**
 * In-memory storage adapter.
 * Useful for development and testing. Data is lost on restart.
 */
export class MemoryStorage implements Storage {
  private sessions: Map<string, Session> = new Map();
  private messages: Map<string, Message[]> = new Map();
  private messageById: Map<string, Message> = new Map();
  private bridgeMessageIds: Map<string, BridgeMessageIds> = new Map();
  private attachments: Map<string, Attachment> = new Map();

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

  async listSessions(opts?: { since?: Date }): Promise<Session[]> {
    const all = Array.from(this.sessions.values());
    if (!opts?.since) return all;
    const since = opts.since.getTime();
    return all.filter((s) => s.createdAt.getTime() >= since);
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

    return sessionMessages.slice(startIndex, startIndex + limit).map((m) => this.hydrate(m));
  }

  async getMessage(messageId: string): Promise<Message | null> {
    const message = this.messageById.get(messageId);
    return message ? this.hydrate(message) : null;
  }

  /** Populate message.attachments from stored attachments when empty */
  private hydrate(message: Message): Message {
    if (message.attachments && message.attachments.length > 0) {
      return message;
    }
    const attachments = Array.from(this.attachments.values()).filter(
      (a) => a.messageId === message.id
    );
    if (attachments.length === 0) {
      return message;
    }
    return { ...message, attachments };
  }

  async updateMessage(message: Message): Promise<void> {
    this.messageById.set(message.id, message);
    // Also update in the session's messages array
    const sessionMessages = this.messages.get(message.sessionId);
    if (sessionMessages) {
      const index = sessionMessages.findIndex((m) => m.id === message.id);
      if (index !== -1) {
        sessionMessages[index] = message;
      }
    }
  }

  async saveBridgeMessageIds(messageId: string, bridgeIds: BridgeMessageIds): Promise<void> {
    const existing = this.bridgeMessageIds.get(messageId) ?? {};
    this.bridgeMessageIds.set(messageId, { ...existing, ...bridgeIds });
  }

  async getBridgeMessageIds(messageId: string): Promise<BridgeMessageIds | null> {
    return this.bridgeMessageIds.get(messageId) ?? null;
  }

  async saveAttachment(attachment: Attachment): Promise<void> {
    this.attachments.set(attachment.id, attachment);
  }

  async getAttachment(attachmentId: string): Promise<Attachment | null> {
    return this.attachments.get(attachmentId) ?? null;
  }

  async getMessageAttachments(messageId: string): Promise<Attachment[]> {
    return Array.from(this.attachments.values()).filter((a) => a.messageId === messageId);
  }

  async updateAttachment(attachment: Attachment): Promise<void> {
    this.attachments.set(attachment.id, attachment);
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

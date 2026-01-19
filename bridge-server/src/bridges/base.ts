/**
 * Base bridge class for notification bridges
 */

import type { Message, Session, EventCallback, OutgoingEvent } from "../types";

export abstract class Bridge {
  protected eventCallback?: EventCallback;

  /**
   * Unique name for this bridge
   */
  abstract get name(): string;

  /**
   * Set the callback for sending events to the backend
   */
  setEventCallback(callback: EventCallback): void {
    this.eventCallback = callback;
  }

  /**
   * Emit an event to the backend
   */
  protected async emit(event: OutgoingEvent): Promise<void> {
    if (this.eventCallback) {
      await this.eventCallback(event);
    }
  }

  /**
   * Initialize the bridge (connect to platform)
   */
  abstract init(): Promise<void>;

  /**
   * Called when a new chat session is created
   */
  abstract onNewSession(session: Session): Promise<void>;

  /**
   * Called when a visitor sends a message
   */
  abstract onVisitorMessage(message: Message, session: Session): Promise<void>;

  /**
   * Called when AI takes over a conversation
   */
  abstract onAITakeover(session: Session, reason: string): Promise<void>;

  /**
   * Called when an operator sends a message (from any bridge)
   * Used for cross-bridge synchronization
   */
  abstract onOperatorMessage(
    message: Message,
    session: Session,
    sourceBridge: string,
    operatorName?: string
  ): Promise<void>;

  /**
   * Called when operator status changes
   */
  abstract onOperatorStatusChange(online: boolean): Promise<void>;

  /**
   * Cleanup and disconnect
   */
  abstract destroy(): Promise<void>;
}

/**
 * Test utilities for PocketPing SDK
 * @internal - Only for testing purposes
 */

import type { PocketPing } from './pocketping';
import type { CustomEvent, Session } from './types';

/**
 * Trigger a custom event for testing webhook forwarding
 * @internal
 */
export async function triggerCustomEvent(
  instance: PocketPing,
  sessionId: string,
  event: Omit<CustomEvent, 'sessionId'>
): Promise<void> {
  const fullEvent: CustomEvent = {
    ...event,
    sessionId,
  };

  // Access the private method through prototype
  const proto = Object.getPrototypeOf(instance);
  if (typeof proto.handleCustomEvent === 'function') {
    await proto.handleCustomEvent.call(instance, sessionId, fullEvent);
  } else {
    throw new Error('handleCustomEvent not available - this is a test utility issue');
  }
}

/**
 * Directly call forwardToWebhook for testing
 * @internal
 */
export function callForwardToWebhook(
  instance: PocketPing,
  event: CustomEvent,
  session: Session
): void {
  // Access through instance since it's now public
  (instance as any).forwardToWebhook(event, session);
}

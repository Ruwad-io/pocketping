export { PocketPingProvider } from './PocketPingProvider';
export type { PocketPingProviderProps } from './PocketPingProvider';
export { usePocketPing } from './usePocketPing';
export type { PocketPingControls } from './usePocketPing';

// Re-export the underlying imperative API + types for convenience, so consumers
// rarely need to depend on @pocketping/widget directly.
export {
  init,
  destroy,
  open,
  close,
  toggle,
  trigger,
  identify,
  reset,
  sendMessage,
  getIdentity,
  onEvent,
  offEvent,
} from '@pocketping/widget';

export type {
  PocketPingConfig,
  UserIdentity,
  Message,
  CustomEvent,
  CustomEventHandler,
  TriggerOptions,
  Attachment,
} from '@pocketping/widget';

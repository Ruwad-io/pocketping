import {
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

/**
 * Imperative controls for the running widget. All members are stable function
 * references from `@pocketping/widget`, so the returned object is referentially
 * stable across renders and safe to use in dependency arrays.
 */
const controls = Object.freeze({
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
});

export type PocketPingControls = typeof controls;

/**
 * Access the widget controls from anywhere inside a `<PocketPingProvider>`.
 *
 * ```tsx
 * const { open, trigger } = usePocketPing();
 * return <button onClick={open}>Need help?</button>;
 * ```
 */
export function usePocketPing(): PocketPingControls {
  return controls;
}

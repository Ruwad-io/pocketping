import { useEffect, useRef, type ReactNode } from 'react';
import {
  init,
  destroy,
  identify,
  reset,
  type PocketPingConfig,
  type UserIdentity,
} from '@pocketping/widget';

export interface PocketPingProviderProps extends PocketPingConfig {
  /**
   * The currently authenticated user. Pass the user object when logged in and
   * `null`/`undefined` when logged out — the widget identity is synced
   * automatically (and a fresh anonymous session is started on logout).
   */
  user?: UserIdentity | null;
  children?: ReactNode;
}

/**
 * Mounts the PocketPing widget for the lifetime of this component and keeps the
 * visitor identity in sync with your auth state. Render it once near the root
 * of your app:
 *
 * ```tsx
 * <PocketPingProvider projectId="proj_xxx" user={user}>
 *   <App />
 * </PocketPingProvider>
 * ```
 */
export function PocketPingProvider({ user, children, ...config }: PocketPingProviderProps) {
  // Boot the widget on mount, tear it down on unmount. We intentionally only
  // re-initialize when the connection target changes (not on every render),
  // so a new `config` object identity each render does not thrash the widget.
  // The mount → unmount → mount cycle React 18 StrictMode runs in dev is safe:
  // destroy() clears the singleton before init() runs again.
  useEffect(() => {
    init(config);
    return () => destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.projectId, config.endpoint]);

  // Sync identity with auth state. The effect is keyed on a serialized snapshot
  // of `user`, so a profile refresh (email, name, custom fields) re-identifies
  // even when the id is unchanged.
  const userKey = user ? JSON.stringify(user) : null;
  // Only reset on an actual logout transition (identified → logged out). We must
  // NOT reset on the initial anonymous mount: init() has already started the
  // session there, and reset() would disconnect/reconnect for no reason.
  const hasIdentified = useRef(false);
  useEffect(() => {
    if (user) {
      hasIdentified.current = true;
      void identify(user);
    } else if (hasIdentified.current) {
      hasIdentified.current = false;
      void reset({ newSession: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey]);

  return <>{children}</>;
}

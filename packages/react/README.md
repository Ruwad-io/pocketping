# @pocketping/react

React bindings for the [PocketPing](https://pocketping.io) chat widget — a
declarative `<PocketPingProvider>` and a `usePocketPing()` hook, so you never
have to inject a `<script>` tag or poke at `window.PocketPing` by hand.

## Install

```bash
npm install @pocketping/react @pocketping/widget
# react >= 18 is a peer dependency
```

## Usage

Mount the provider once near the root of your app. It boots the widget on
mount, tears it down on unmount, and keeps the visitor identity in sync with
your auth state.

```tsx
import { PocketPingProvider } from '@pocketping/react';
import { useUser } from './hooks/useUser';

export default function App() {
  const { user } = useUser();

  return (
    <PocketPingProvider projectId="proj_xxxxxxxxxxxxx" user={user}>
      <YourApp />
    </PocketPingProvider>
  );
}
```

- Pass any [`PocketPingConfig`](https://docs.pocketping.io) field as a prop
  (`projectId`, `endpoint`, `operatorName`, `onEvent`, …).
- Pass `user` when logged in; pass `null`/`undefined` when logged out and the
  widget starts a fresh anonymous session automatically.

### Imperative controls

```tsx
import { usePocketPing } from '@pocketping/react';

function HelpButton() {
  const { open, trigger } = usePocketPing();
  return <button onClick={open}>Need help?</button>;
}
```

`usePocketPing()` returns `{ open, close, toggle, trigger, identify, reset,
sendMessage, getIdentity, onEvent, offEvent }`. The returned object is
referentially stable, so it's safe in dependency arrays.

## Notes

- **Single instance.** `@pocketping/widget` is a *peer* dependency on purpose:
  the widget keeps a module-level singleton, so there must be exactly one copy
  in your app.
- **Next.js / RSC.** The package ships the `"use client"` directive, so you can
  import it from Server Components and render the provider inside a layout.
- **React 18 StrictMode** (dev double-mount) is handled: `destroy()` clears the
  widget before it re-initializes.

## License

MIT

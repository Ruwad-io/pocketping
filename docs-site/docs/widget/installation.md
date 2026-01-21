---
sidebar_position: 1
title: Installation
description: Add the PocketPing chat widget to your website
---

# Widget Installation

Add the PocketPing chat widget to your website. Choose the method that fits your stack.

```
┌─────────────────────────────────────────────────────────────────┐
│                    INSTALLATION OPTIONS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   CDN                 npm/yarn/pnpm        Framework-specific   │
│   ┌─────────────┐    ┌─────────────┐      ┌─────────────┐      │
│   │ 2 lines     │    │ Full control│      │ React/Next  │      │
│   │ Quick setup │    │ TypeScript  │      │ Vue/Nuxt    │      │
│   │ No build    │    │ Tree-shaking│      │ Angular     │      │
│   └─────────────┘    └─────────────┘      └─────────────┘      │
│                                                                 │
│   Best for:           Best for:           Best for:            │
│   Static sites        SPAs, Apps          Framework apps       │
│   Landing pages       Production          Type safety          │
│   Quick prototypes    Custom builds       Component lifecycle  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Option 1: CDN (Quickest)

Add these lines before the closing `</body>` tag:

```html title="index.html"
<!-- Step 1: Load the widget -->
<script src="https://cdn.jsdelivr.net/npm/@pocketping/widget@latest/dist/index.global.js"></script>

<!-- Step 2: Initialize -->
<script>
  PocketPing.init({
    projectId: 'proj_xxxxxxxxxxxxx',  // From dashboard
    operatorName: 'Support Team',
  });
</script>
```

That's it. Refresh your page and you'll see the chat bubble.

:::tip Auto-updates
Using `@latest` means you automatically get new features and bug fixes without changing anything.
:::

### Alternative CDN options

```html
<!-- unpkg -->
<script src="https://unpkg.com/@pocketping/widget@latest/dist/index.global.js"></script>

<!-- Pin to specific version (no auto-updates) -->
<script src="https://cdn.jsdelivr.net/npm/@pocketping/widget@0.1.0/dist/index.global.js"></script>
```

### SaaS vs Self-Hosted

```javascript
// SaaS users (app.pocketping.io)
PocketPing.init({
  projectId: 'proj_xxxxxxxxxxxxx',  // Get from dashboard
  operatorName: 'Support Team',
});

// Self-hosted users
PocketPing.init({
  endpoint: 'https://yoursite.com/pocketping',  // Your bridge server
  operatorName: 'Support Team',
});
```

---

## Option 2: npm / yarn / pnpm

Install the package:

```bash
# npm
npm install @pocketping/widget

# yarn
yarn add @pocketping/widget

# pnpm
pnpm add @pocketping/widget
```

Initialize in your JavaScript/TypeScript:

```typescript
import { PocketPing } from '@pocketping/widget';

PocketPing.init({
  projectId: 'proj_xxxxxxxxxxxxx',
  operatorName: 'Support Team',
  primaryColor: '#6366f1',
  theme: 'auto',
  position: 'bottom-right',
});
```

### TypeScript Support

Full TypeScript definitions included:

```typescript
import { PocketPing, PocketPingConfig } from '@pocketping/widget';

const config: PocketPingConfig = {
  projectId: 'proj_xxxxxxxxxxxxx',
  operatorName: 'Support Team',
  primaryColor: '#6366f1',
  theme: 'auto',
  position: 'bottom-right',
  welcomeMessage: 'Hi! How can we help?',
};

PocketPing.init(config);
```

---

## Framework Integrations

### React / Next.js

```tsx title="app/layout.tsx (App Router)"
'use client';

import { useEffect } from 'react';
import { PocketPing } from '@pocketping/widget';

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    // Initialize on mount
    PocketPing.init({
      projectId: 'proj_xxxxxxxxxxxxx',
      operatorName: 'Support Team',
      primaryColor: '#6366f1',
    });

    // Cleanup on unmount
    return () => {
      PocketPing.destroy();
    };
  }, []);

  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
```

```tsx title="pages/_app.tsx (Pages Router)"
import { useEffect } from 'react';
import { PocketPing } from '@pocketping/widget';
import type { AppProps } from 'next/app';

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    PocketPing.init({
      projectId: 'proj_xxxxxxxxxxxxx',
      operatorName: 'Support Team',
    });

    return () => PocketPing.destroy();
  }, []);

  return <Component {...pageProps} />;
}
```

### Vue.js / Nuxt

```vue title="App.vue (Vue 3)"
<script setup>
import { onMounted, onUnmounted } from 'vue';
import { PocketPing } from '@pocketping/widget';

onMounted(() => {
  PocketPing.init({
    projectId: 'proj_xxxxxxxxxxxxx',
    operatorName: 'Support Team',
    primaryColor: '#6366f1',
  });
});

onUnmounted(() => {
  PocketPing.destroy();
});
</script>
```

```typescript title="plugins/pocketping.client.ts (Nuxt 3)"
// Note: .client.ts ensures this only runs in browser
import { PocketPing } from '@pocketping/widget';

export default defineNuxtPlugin(() => {
  PocketPing.init({
    projectId: 'proj_xxxxxxxxxxxxx',
    operatorName: 'Support Team',
  });
});
```

### Angular

```typescript title="app.component.ts"
import { Component, OnInit, OnDestroy } from '@angular/core';
import { PocketPing } from '@pocketping/widget';

@Component({
  selector: 'app-root',
  template: '<router-outlet></router-outlet>',
})
export class AppComponent implements OnInit, OnDestroy {
  ngOnInit() {
    PocketPing.init({
      projectId: 'proj_xxxxxxxxxxxxx',
      operatorName: 'Support Team',
      primaryColor: '#6366f1',
    });
  }

  ngOnDestroy() {
    PocketPing.destroy();
  }
}
```

### Svelte / SvelteKit

```svelte title="+layout.svelte"
<script>
  import { onMount, onDestroy } from 'svelte';
  import { PocketPing } from '@pocketping/widget';
  import { browser } from '$app/environment';

  onMount(() => {
    if (browser) {
      PocketPing.init({
        projectId: 'proj_xxxxxxxxxxxxx',
        operatorName: 'Support Team',
      });
    }
  });

  onDestroy(() => {
    if (browser) {
      PocketPing.destroy();
    }
  });
</script>

<slot />
```

---

## Verify Installation

After adding the widget:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                      Your Website                               │
│                                                                 │
│                                                                 │
│                                                                 │
│                                                                 │
│                                               ┌───────────┐    │
│                                               │    💬     │    │
│                                               │  (click)  │    │
│                                               └───────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                                      ↑
                                          Chat bubble appears here
```

### Check the Console

Open DevTools (F12) → Console. You should see:

```
[PocketPing] Initialized successfully
[PocketPing] Connected to bridge server
```

### Test the Chat

1. Click the chat bubble
2. Type a message
3. If you've connected a bridge (Telegram/Discord/Slack), the message appears there
4. Reply from your messaging app
5. The reply shows in the widget instantly

---

## Troubleshooting

### Widget not appearing?

| Issue | Solution |
|-------|----------|
| Script not loading | Check Network tab for 404 errors |
| JavaScript error | Check Console tab for errors |
| Z-index issue | Widget may be behind other elements. Add `.pocketping-widget { z-index: 99999 !important; }` |
| CSS conflict | Check if any global styles affect `position: fixed` elements |

### Console shows error?

| Error | Cause | Solution |
|-------|-------|----------|
| `Invalid projectId` | Wrong or missing project ID | Check dashboard for correct ID |
| `Failed to connect` | Network issue or server down | Check internet connection |
| `CORS error` | Self-hosted backend CORS issue | Add your domain to allowed origins |

### CORS errors (self-hosted)?

If self-hosting, configure your bridge server to allow requests from your domain:

```typescript
// In your bridge server config
{
  cors: {
    origin: ['https://yoursite.com', 'http://localhost:3000'],
    credentials: true,
  }
}
```

### Widget appears but no connection?

```
┌─────────────────────────────────────────────────────────────────┐
│ Checklist:                                                       │
│                                                                 │
│ □ Project ID is correct (matches dashboard)                     │
│ □ Bridge server is running (if self-hosted)                     │
│ □ At least one bridge is connected (Telegram/Discord/Slack)     │
│ □ No firewall blocking WebSocket connections                    │
│ □ Browser allows third-party cookies (if using CDN)             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Conditional Loading

### Show only on certain pages

```javascript
// Only show on /pricing and /contact pages
if (['/pricing', '/contact'].includes(window.location.pathname)) {
  PocketPing.init({
    projectId: 'proj_xxxxxxxxxxxxx',
    operatorName: 'Support Team',
  });
}
```

### Show based on user role

```javascript
// Only show for non-logged-in users
if (!window.currentUser) {
  PocketPing.init({
    projectId: 'proj_xxxxxxxxxxxxx',
    operatorName: 'Support Team',
  });
}
```

### Lazy load after delay

```javascript
// Load widget 5 seconds after page load
setTimeout(() => {
  const script = document.createElement('script');
  script.src = 'https://cdn.pocketping.io/widget.js';
  script.onload = () => {
    PocketPing.init({
      projectId: 'proj_xxxxxxxxxxxxx',
      operatorName: 'Support Team',
    });
  };
  document.body.appendChild(script);
}, 5000);
```

---

## Next Steps

- **[Configuration](/widget/configuration)** - All available options (colors, messages, position)
- **[Custom Events](/widget/configuration#custom-events)** - Track user actions
- **[Connect Telegram](/bridges/telegram)** - Start receiving messages

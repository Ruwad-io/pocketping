---
sidebar_position: 1
title: Installation
description: Add the PocketPing chat widget to your website
---

# Widget Installation

Add the PocketPing chat widget to your website in minutes.

## CDN (Recommended)

The fastest way to add PocketPing to your site. Add this script before the closing `</body>` tag:

```html
<script src="https://cdn.pocketping.io/widget.js"></script>
<script>
  PocketPing.init({
    // SaaS users: use your project ID
    projectId: 'proj_xxxxxxxxxxxxx',

    // Self-hosted users: use your backend endpoint
    // endpoint: 'https://yoursite.com/pocketping',

    // Customize appearance
    operatorName: 'Support Team',
    primaryColor: '#6366f1',
  });
</script>
```

## npm / yarn / pnpm

For more control, install the package via your preferred package manager:

```bash
# npm
npm install @pocketping/widget

# yarn
yarn add @pocketping/widget

# pnpm
pnpm add @pocketping/widget
```

Then initialize in your JavaScript/TypeScript:

```typescript
import { PocketPing } from '@pocketping/widget';

// Initialize on page load
PocketPing.init({
  projectId: 'proj_xxxxxxxxxxxxx',
  operatorName: 'Support Team',
  primaryColor: '#6366f1',
  theme: 'auto', // 'light' | 'dark' | 'auto'
  position: 'bottom-right', // 'bottom-right' | 'bottom-left'
});
```

## React / Next.js

For React applications, initialize in your root component or layout:

```tsx title="app/layout.tsx"
'use client';

import { useEffect } from 'react';
import { PocketPing } from '@pocketping/widget';

export default function RootLayout({ children }) {
  useEffect(() => {
    PocketPing.init({
      projectId: 'proj_xxxxxxxxxxxxx',
      operatorName: 'Support Team',
      primaryColor: '#6366f1',
    });

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

## Vue.js

```javascript title="main.js"
import { PocketPing } from '@pocketping/widget';

// In your mounted hook or onMounted
PocketPing.init({
  projectId: 'proj_xxxxxxxxxxxxx',
  operatorName: 'Support Team',
  primaryColor: '#6366f1',
});
```

## Verify Installation

After adding the widget, you should see a chat bubble in the bottom-right corner of your site. Click it to open the chat interface.

Open your browser's developer console. You should see:

```
[PocketPing] Initialized successfully
```

## Troubleshooting

### Widget not appearing?

- Check that the script is loaded (Network tab in DevTools)
- Verify your project ID or endpoint is correct
- Check for JavaScript errors in the console
- Make sure no CSS is hiding the widget (z-index issues)

### CORS errors?

If self-hosting, make sure your backend allows requests from your website's domain. Add the appropriate CORS headers.

## Next Steps

- [Configuration](/widget/configuration) - All available options
- [Customization](/widget/customization) - Styling and theming

---
sidebar_position: 3
title: Customization
description: Style and theme the PocketPing widget
---

# Widget Customization

Customize the look and feel of the PocketPing widget to match your brand.

## Color Theming

### Primary Color

The primary color affects the header, send button, and visitor message bubbles:

```javascript
PocketPing.init({
  projectId: 'proj_xxx',
  primaryColor: '#6366f1', // Indigo
});
```

### Theme Mode

Control light/dark mode:

```javascript
PocketPing.init({
  projectId: 'proj_xxx',
  theme: 'auto', // 'light' | 'dark' | 'auto'
});
```

- `'light'` - Always use light theme
- `'dark'` - Always use dark theme
- `'auto'` - Follow system preference

## CSS Custom Properties

For advanced customization, override CSS variables:

```css
:root {
  --pocketping-primary: #6366f1;
  --pocketping-primary-hover: #4f46e5;
  --pocketping-text: #1f2937;
  --pocketping-text-muted: #6b7280;
  --pocketping-bg: #ffffff;
  --pocketping-bg-secondary: #f9fafb;
  --pocketping-border: #e5e7eb;
  --pocketping-radius: 12px;
  --pocketping-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1);
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  :root {
    --pocketping-text: #f9fafb;
    --pocketping-text-muted: #9ca3af;
    --pocketping-bg: #1f2937;
    --pocketping-bg-secondary: #111827;
    --pocketping-border: #374151;
  }
}
```

## Widget Size

Adjust the widget dimensions:

```css
#pocketping-widget {
  --pocketping-width: 380px;
  --pocketping-height: 600px;
  --pocketping-button-size: 60px;
}

/* Mobile responsive */
@media (max-width: 640px) {
  #pocketping-widget {
    --pocketping-width: 100%;
    --pocketping-height: 100%;
  }
}
```

## Custom Launcher Button

Hide the default button and create your own:

```javascript
PocketPing.init({
  projectId: 'proj_xxx',
  hideLauncher: true,
});

// Then trigger with your own button
document.getElementById('my-chat-button').addEventListener('click', () => {
  PocketPing.open();
});
```

## Positioning

### Corner Position

```javascript
PocketPing.init({
  projectId: 'proj_xxx',
  position: 'bottom-left', // 'bottom-right' | 'bottom-left'
});
```

### Custom Offset

```css
#pocketping-widget {
  --pocketping-offset-x: 20px;
  --pocketping-offset-y: 20px;
}
```

## Branding

### Operator Info

```javascript
PocketPing.init({
  projectId: 'proj_xxx',
  operatorName: 'Acme Support',
  operatorAvatar: 'https://example.com/avatar.png',
});
```

### Company Logo

```javascript
PocketPing.init({
  projectId: 'proj_xxx',
  logo: 'https://example.com/logo.svg',
});
```

## Animations

Disable animations for accessibility:

```css
#pocketping-widget {
  --pocketping-transition: none;
}

/* Or respect user preference */
@media (prefers-reduced-motion: reduce) {
  #pocketping-widget {
    --pocketping-transition: none;
  }
}
```

## Z-Index

If the widget conflicts with other elements:

```css
#pocketping-widget {
  z-index: 99999;
}
```

## Examples

### Minimal Style

```javascript
PocketPing.init({
  projectId: 'proj_xxx',
  primaryColor: '#000000',
  operatorName: 'Help',
});
```

### Colorful Brand

```javascript
PocketPing.init({
  projectId: 'proj_xxx',
  primaryColor: '#ec4899', // Pink
  operatorName: 'Support Team',
  operatorAvatar: 'https://example.com/team.png',
  welcomeMessage: 'Hey! 👋 How can we help?',
});
```

## Next Steps

- [Configuration](/widget/configuration) - All configuration options
- [SDKs](/sdk/nodejs) - Backend integration

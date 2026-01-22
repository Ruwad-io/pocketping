---
"@pocketping/widget": patch
---

Fix module resolution for bundlers (Next.js, webpack, etc.)

- Remove `browser` field that caused bundlers to use IIFE instead of ESM
- Add proper `exports` field for modern module resolution
- IIFE build still available at `@pocketping/widget/cdn` for direct script tag usage

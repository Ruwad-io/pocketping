# @pocketping/widget

## 0.3.4

### Patch Changes

- [`bbc804b`](https://github.com/Ruwad-io/pocketping/commit/bbc804bc45070401807f820572df91b300da15be) Thanks [@abonur](https://github.com/abonur)! - fix: align API endpoints with SaaS backend

  The widget now works with the PocketPing SaaS API endpoints:
  - /connect, /message, /typing, /read, /presence, /identify

## 0.3.3

### Patch Changes

- [`4eecf63`](https://github.com/Ruwad-io/pocketping/commit/4eecf636fce71bc2ea3a50f050904a41148d42cb) Thanks [@abonur](https://github.com/abonur)! - Update "Powered by PocketPing" link to pocketping.io

## 0.3.2

### Patch Changes

- [`9dc2004`](https://github.com/Ruwad-io/pocketping/commit/9dc20041522744ac09001a87582cf490ab2ac2e4) Thanks [@abonur](https://github.com/abonur)! - Fix module resolution for bundlers (Next.js, webpack, etc.)
  - Remove `browser` field that caused bundlers to use IIFE instead of ESM
  - Add proper `exports` field for modern module resolution
  - IIFE build still available at `@pocketping/widget/cdn` for direct script tag usage

## 0.3.1

### Patch Changes

- [`e0118eb`](https://github.com/Ruwad-io/pocketping/commit/e0118ebe4e895e9eb61427db7b847068f000fc3e) Thanks [@abonur](https://github.com/abonur)! - Rename auto-init attribute from `data-key` to `data-project-id`
  - More explicit and self-documenting
  - Matches the `projectId` config option

## 0.3.0

### Minor Changes

- Add `projectId` config option for SaaS users
  - Added `projectId` as an alternative to `endpoint` for SaaS users
  - Auto-init from script tag now supports `data-key` attribute (maps to projectId)
  - Endpoint is auto-resolved from projectId: `https://app.pocketping.io/api/widget/{projectId}`
  - Self-hosted users can still use `endpoint` directly

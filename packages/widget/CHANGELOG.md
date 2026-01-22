# @pocketping/widget

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

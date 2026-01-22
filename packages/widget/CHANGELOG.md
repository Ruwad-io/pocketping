# @pocketping/widget

## 0.3.0

### Minor Changes

- Add `projectId` config option for SaaS users
  - Added `projectId` as an alternative to `endpoint` for SaaS users
  - Auto-init from script tag now supports `data-key` attribute (maps to projectId)
  - Endpoint is auto-resolved from projectId: `https://app.pocketping.io/api/widget/{projectId}`
  - Self-hosted users can still use `endpoint` directly

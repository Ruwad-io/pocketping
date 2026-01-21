# ADR-001: Widget Auto-Update Strategy

## Status
Accepted

## Context

PocketPing has a widget that customers embed on their websites. We need to decide how updates are delivered to these widgets.

**Options considered:**

1. **Pinned versions** - Customers specify exact version (`@0.1.0`)
   - Pro: Full control, no surprises
   - Con: Customers never get updates, security fixes require manual action

2. **Auto-update via `@latest`** - CDN always serves latest version
   - Pro: Everyone gets updates automatically, faster iteration
   - Con: Breaking changes affect everyone, need good testing

3. **Major version pinning** - Customers pin to major (`@1`, `@2`)
   - Pro: Balance of stability and updates
   - Con: Complex, still requires customer action for major updates

## Decision

**We use `@latest` (Option 2) as the default and recommended approach.**

```html
<!-- Recommended: auto-updates -->
<script src="https://cdn.jsdelivr.net/npm/@pocketping/widget@latest/dist/index.global.js"></script>

<!-- Alternative: pinned version (for users who need stability) -->
<script src="https://cdn.jsdelivr.net/npm/@pocketping/widget@0.1.0/dist/index.global.js"></script>
```

## Rationale

1. **Startup agility** - We're early stage, need to iterate fast
2. **Security** - Fixes reach everyone automatically
3. **Simplicity** - No version fragmentation to support
4. **User experience** - Customers don't need to do anything to get improvements

## Consequences

### What this means for development:

1. **Test thoroughly before publishing** - Everyone gets the new version
2. **No need for complex backward compatibility** - All widgets update together
3. **Monitor after releases** - Watch for issues in the ~1-24h cache window
4. **Version header for debugging** - Widget sends `X-PocketPing-Version` header

### Breaking changes are OK:

Since everyone auto-updates, breaking changes are acceptable:
- Change endpoint paths
- Rename fields
- Remove deprecated features

Just ensure the backend is updated **before** the widget is published.

### Deployment order for breaking changes:

```
1. Deploy backend with support for NEW format
2. Publish widget with NEW format
3. (Optional) Remove OLD format support from backend after 48h
```

### CDN Cache timing:

- jsdelivr: ~1-24 hours to invalidate `@latest`
- unpkg: Similar
- Our CDN (cdn.pocketping.io): We control this, can be instant

## Alternatives for specific users

If a customer explicitly needs stability (rare), they can pin:

```html
<script src="https://cdn.jsdelivr.net/npm/@pocketping/widget@0.1.0/dist/index.global.js"></script>
```

But this is not recommended and not actively supported.

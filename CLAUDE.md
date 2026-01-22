# Claude Code Guidelines for PocketPing

This document contains guidelines for Claude Code when working on this repository.

## Project Structure

This monorepo contains:
- `packages/widget/` - Browser widget (~15KB)
- `packages/sdk-node/` - Node.js SDK
- `packages/sdk-python/` - Python SDK
- `packages/sdk-go/` - Go SDK
- `packages/sdk-php/` - PHP SDK
- `packages/sdk-ruby/` - Ruby SDK
- `packages/website/` - Documentation site

## PR Workflow

**Important:** All changes should go through Pull Requests with code review.

### Creating PRs
1. Create a feature branch from `main`
2. Make your changes
3. Create a PR with a clear description
4. Add `@codex` as a reviewer

### PR Template
```markdown
## Summary
<1-3 bullet points>

## Test plan
- [ ] Tests added/updated
- [ ] Manual testing done
- [ ] Documentation updated (if needed)

---
Generated with [Claude Code](https://claude.com/claude-code)
```

### Reviewers
- Always add `@codex` as reviewer for all PRs
- Wait for approval before merging

## Coding Standards

### TypeScript/JavaScript
- Use TypeScript for all new code
- Follow existing patterns in the codebase
- Run `pnpm lint` and `pnpm typecheck` before committing

### Python
- Use Python 3.10+ features
- Follow PEP 8 style guide
- Run `ruff check` and `mypy` before committing

### Go
- Follow standard Go conventions
- Run `go fmt` and `go vet` before committing

### Testing
- Add tests for new functionality
- Run `pnpm test` (or language-specific test command) before pushing
- Ensure CI passes before merging

## SDK Consistency

All SDKs should implement the same interface as defined in `SDK_SPEC.md`:
- `handleConnect()` - Handle widget connection
- `handleMessage()` - Handle messages
- `handleIdentify()` - Handle user identification
- `handleRead()` - Handle read receipts
- `handleEvent()` - Handle custom events
- `emitEvent()` / `broadcastEvent()` - Send events to widget

## Version Management

- Widget and SDKs follow semantic versioning
- Breaking changes require major version bump
- Update `CHANGELOG.md` for each release

## CI/CD

- All PRs run tests automatically via GitHub Actions
- Merging to `main` triggers automatic publishing (when version changes)
- Widget is published to npm and CDN

## Documentation

- SDK documentation lives in `pocketping-app/website/app/docs/sdk/`
- Update docs when adding new features
- Keep README files up to date

## Common Commands

```bash
# Development
pnpm install          # Install dependencies
pnpm dev              # Start development
pnpm build            # Build all packages
pnpm test             # Run tests
pnpm lint             # Lint code
pnpm typecheck        # Type check

# Individual packages
cd packages/widget && pnpm build
cd packages/sdk-node && pnpm test
```

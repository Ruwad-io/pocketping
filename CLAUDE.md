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
1. Create a feature branch from `main`: `git checkout -b feat/my-feature`
2. Make your changes and commit them
3. Push to remote: `git push -u origin feat/my-feature`
4. **IMMEDIATELY create a PR using `gh pr create`** - do NOT leave branches without PRs
5. Add appropriate reviewers

### Automatic PR Creation
When committing changes, Claude Code MUST:
1. Push the branch to remote
2. Create a PR using `gh pr create` with the template below
3. Never leave a branch without an associated PR

```bash
# Example workflow
git checkout -b feat/my-feature
# ... make changes ...
git add -A && git commit -m "feat: description"
git push -u origin feat/my-feature
gh pr create --title "feat: My Feature" --body "$(cat <<'EOF'
## Summary
- Change 1
- Change 2

## Test plan
- [ ] Tests pass
- [ ] Manual testing done

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

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
- Reviewers are automatically assigned via CODEOWNERS
- GitHub Copilot will auto-review PRs via code-review.yml workflow
- Wait for CI to pass and review approval before merging

### Addressing Automated Review Comments
After creating a PR, Claude Code MUST:
1. Wait for GitHub Copilot automated review to complete
2. Check review comments using `gh api repos/{owner}/{repo}/pulls/{pr}/comments`
3. Evaluate each comment for pertinence
4. Fix legitimate issues raised by the automated review
5. Push fixes
6. Reply to each addressed comment explaining the fix
7. **Resolve the review threads** using GraphQL API (required for merge)

```bash
# Check PR review comments
gh api repos/OWNER/REPO/pulls/123/comments --jq '.[] | {id: .id, body: .body, path: .path}'

# Reply to a comment
gh api repos/OWNER/REPO/pulls/123/comments/COMMENT_ID/replies -f body="✅ Fixed in commit abc123"

# Get review thread IDs to resolve
gh api graphql -f query='
query {
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: 123) {
      reviewThreads(first: 10) {
        nodes { id isResolved path }
      }
    }
  }
}'

# Resolve a review thread (REQUIRED for merge when "All comments must be resolved")
gh api graphql -f query='
mutation {
  resolveReviewThread(input: {threadId: "THREAD_ID"}) {
    thread { isResolved }
  }
}'
```

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

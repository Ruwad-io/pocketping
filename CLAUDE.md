# Claude Code Guidelines for PocketPing

This document contains guidelines for Claude Code when working on this repository.

---

## What is PocketPing?

PocketPing is an **open-source real-time chat widget** that connects website visitors to operators via messaging platforms (Telegram, Discord, Slack). It's designed to be lightweight (~15KB), privacy-respecting, and highly flexible.

### Key Features

| Feature | Description |
|---------|-------------|
| **Real-time Chat** | WebSocket-based bidirectional messaging between visitors and operators |
| **Bridge Notifications** | Forward messages to Telegram, Discord, and Slack |
| **Read Receipts** | Delivery/read status with `delivered` and `read` timestamps |
| **Message Edit/Delete** | Visitors can edit/delete their messages, synced to bridges |
| **File Attachments** | Upload and share files in conversations |
| **User Identity** | Track user info (email, name, custom fields) |
| **Custom Events** | Emit and track custom events from widgets |
| **AI Fallback** | Optional AI responses when operators are offline |
| **IP Filtering** | Blocklist/allowlist with CIDR support |
| **Version Management** | Widget version checking with deprecation warnings |

### Architecture: Three Deployment Modes

PocketPing est conçu pour être flexible. Tu peux utiliser le widget **sans le SaaS** de deux façons différentes:

---

#### MODE 1: SaaS (pocketping-app)

Le mode le plus simple. Tu utilises notre service hébergé.

```
┌────────────┐     ┌─────────────────────┐     ┌──────────────┐
│   Widget   │────▶│   PocketPing SaaS   │────▶│   Bridges    │
│ (ton site) │     │  (pocketping.io)    │     │ (Tg/Dc/Sl)   │
└────────────┘     └─────────────────────┘     └──────────────┘
```

**Quand utiliser:** Tu veux juste que ça marche, sans gérer d'infrastructure.

---

#### MODE 2: Self-Hosted avec SDK (Ton Backend + Ta DB)

Tu gères tout toi-même. Le SDK s'intègre dans **ton** backend existant.

```
┌────────────┐     ┌─────────────────────────────────────┐     ┌──────────────┐
│   Widget   │────▶│         TON BACKEND                 │────▶│   Bridges    │
│ (ton site) │     │  ┌─────────────────────────────┐    │     │ (Tg/Dc/Sl)   │
└────────────┘     │  │  SDK (Node/Python/Go/PHP/   │    │     └──────────────┘
                   │  │       Ruby)                 │    │
                   │  └─────────────────────────────┘    │
                   │  ┌─────────────────────────────┐    │
                   │  │    TA BASE DE DONNÉES       │    │
                   │  │  (PostgreSQL/MySQL/Redis/   │    │
                   │  │   MongoDB/ce que tu veux)   │    │
                   │  └─────────────────────────────┘    │
                   └─────────────────────────────────────┘
```

**Tu contrôles:**
- Tes routes API (`/connect`, `/message`, `/edit`, `/delete`, etc.)
- Ton stockage (sessions, messages, attachments)
- Ta logique métier (authentication, rate limiting, etc.)
- Tes bridges (Telegram, Discord, Slack)

**Quand utiliser:**
- Tu as déjà un backend (Node.js, Python, Go, PHP, Ruby)
- Tu veux garder les données chez toi
- Tu as besoin de personnalisation poussée

---

#### MODE 3: Self-Hosted avec Bridge-Server (Standalone)

Le bridge-server est un serveur **autonome** qui fait exactement ce que fait le SaaS, mais que tu héberges toi-même.

```
┌────────────┐     ┌─────────────────────────────────────┐     ┌──────────────┐
│   Widget   │────▶│        BRIDGE-SERVER (Go)           │────▶│   Bridges    │
│ (ton site) │     │  ┌─────────────────────────────┐    │     │ (Tg/Dc/Sl)   │
└────────────┘     │  │  Sessions + Messages        │    │     └──────────────┘
                   │  │  (in-memory ou Redis)       │    │
                   │  └─────────────────────────────┘    │
                   │  ┌─────────────────────────────┐    │
                   │  │  Telegram/Discord/Slack     │    │
                   │  │  bridges HTTP-only          │    │
                   │  └─────────────────────────────┘    │
                   └─────────────────────────────────────┘
```

**C'est quoi le bridge-server?**
- Un serveur Go standalone qui gère tout (sessions, messages, bridges)
- Communication HTTP-only avec les APIs de messagerie (pas de libs externes)
- Tu le déploies avec Docker, tu configures tes tokens, c'est parti
- Pas besoin d'écrire du code backend

**Quand utiliser:**
- Tu n'as pas de backend existant
- Tu veux du self-hosted sans coder
- Tu veux la même expérience que le SaaS, mais hébergée chez toi

---

#### Comparaison des modes

| | MODE 1: SaaS | MODE 2: SDK | MODE 3: Bridge-Server |
|---|---|---|---|
| **Hébergement** | Nous | Toi | Toi |
| **Backend requis** | Non | Oui (le tien) | Non |
| **Code à écrire** | Aucun | Routes API | Config seulement |
| **Base de données** | Nous | La tienne | In-memory/Redis |
| **Personnalisation** | Limitée | Totale | Moyenne |
| **Setup time** | 5 min | 30+ min | 15 min |

### Feature Parity Requirement

**CRITICAL**: All three deployment modes MUST have the same features. When implementing a new feature:

1. Implement in `pocketping-app` (SaaS) first
2. Update `SDK_SPEC.md` with the specification
3. Implement in all SDKs (Node, Python, Go, PHP, Ruby)
4. Implement in `bridge-server`
5. Update widget if needed
6. Update documentation

### Current Feature Status

| Feature | SaaS (app) | SDKs | Bridge-Server | Documented |
|---------|------------|------|---------------|------------|
| Connect/Sessions | ✅ | ✅ | ✅ | ✅ |
| Messages | ✅ | ✅ | ✅ | ✅ |
| Read Receipts | ✅ | ✅ | ✅ | ✅ |
| Custom Events | ✅ | ✅ | ✅ | ✅ |
| User Identity | ✅ | ✅ | ✅ | ✅ |
| AI Fallback | ✅ | ✅ | ✅ | ✅ |
| IP Filtering | ✅ | ✅ | ✅ | ✅ |
| Message Edit | ✅ | ✅ | ✅ | ✅ |
| Message Delete | ✅ | ✅ | ✅ | ✅ |
| File Attachments | ✅ | ✅ | ✅ | ✅ |

---

## Project Structure

This monorepo contains:
- `packages/widget/` - Browser widget (~15KB) - embeds on customer websites
- `packages/sdk-node/` - Node.js SDK for self-hosted backends
- `packages/sdk-python/` - Python SDK for self-hosted backends
- `packages/sdk-go/` - Go SDK for self-hosted backends
- `packages/sdk-php/` - PHP SDK for self-hosted backends
- `packages/sdk-ruby/` - Ruby SDK for self-hosted backends
- `packages/website/` - Documentation site
- `bridge-server/` - Standalone Go server with HTTP-only bridges (alternative to SDK + custom backend)

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
- **IMPORTANT**: Tests MUST be run via Docker using `make` commands (not directly)
- Ensure CI passes before merging

```bash
# Run all SDK tests via Docker
make test

# Run specific SDK tests
make test-node      # Node.js SDK tests
make test-python    # Python SDK tests
make test-go        # Go SDK tests
make test-php       # PHP SDK tests
make test-ruby      # Ruby SDK tests
```

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

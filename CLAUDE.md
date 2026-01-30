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
| **Incoming Messages** | Receive operator messages from bridges (WebhookHandler) |
| **Read Receipts** | Delivery/read status with `delivered` and `read` timestamps |
| **Message Edit/Delete** | Visitors can edit/delete their messages, synced to bridges |
| **File Attachments** | Upload and share files in both directions |
| **User Identity** | Track user info (email, name, custom fields) |
| **Custom Events** | Emit and track custom events from widgets |
| **AI Fallback** | Optional AI responses when operators are offline |
| **IP Filtering** | Blocklist/allowlist with CIDR support |
| **Version Management** | Widget version checking with deprecation warnings |

### Architecture: Three Deployment Modes

Le widget peut se connecter à **3 types de serveurs** différents:

```
┌────────────┐
│   Widget   │──────► Option 1: pocketping.io (SaaS)
│ (ton site) │──────► Option 2: bridge-server (Self-hosted standalone)
└────────────┘──────► Option 3: ton backend + SDK (Self-hosted custom)
```

Chaque option offre les **mêmes fonctionnalités** (messages bidirectionnels, attachments, edit/delete, etc.).

---

#### MODE 1: SaaS (pocketping-app)

Le mode le plus simple. Tu utilises notre service hébergé.

```
Widget  ◀──────────────▶  pocketping.io  ◀──────────────▶  Telegram/Discord/Slack
        (WebSocket/SSE)                        (HTTP)
```

**Quand utiliser:** Tu veux juste que ça marche, sans gérer d'infrastructure.

---

#### MODE 2: Self-Hosted avec SDK (Ton Backend + Ta DB)

Tu gères tout toi-même. Le **SDK est une librairie** que tu intègres dans ton backend existant.

```
Widget  ◀──────────────▶  TON BACKEND + SDK  ◀──────────────▶  Telegram/Discord/Slack
              (SSE)       (Express/FastAPI/    (HTTP)
                           Gin/Laravel/Rails)
```

Le SDK fournit:
- Les handlers: `handleConnect()`, `handleMessage()`, `handleEdit()`, `handleDelete()`
- Le `WebhookHandler` pour recevoir les réponses des opérateurs depuis Telegram/Discord/Slack
- Les bridges pour envoyer les notifications

**Tu contrôles:**
- Tes routes API (tu appelles les handlers du SDK dans tes routes)
- Ton stockage (PostgreSQL, MySQL, Redis, MongoDB...)
- Ta logique métier (auth, rate limiting, etc.)

**Quand utiliser:**
- Tu as déjà un backend
- Tu veux garder les données chez toi
- Tu as besoin de personnalisation poussée

---

#### MODE 3: Self-Hosted avec Bridge-Server (Standalone)

Le bridge-server est un serveur **Go prêt à l'emploi**. Tu le déploies avec Docker, tu configures tes tokens, c'est parti.

```
Widget  ◀──────────────▶  BRIDGE-SERVER  ◀──────────────▶  Telegram/Discord/Slack
              (SSE)        (Go, Docker)        (HTTP)
```

**C'est quoi le bridge-server?**
- Un serveur Go standalone (utilise sdk-go en interne)
- Zéro code à écrire, juste de la configuration
- WebhookHandler intégré pour les réponses des opérateurs
- Sessions en mémoire ou Redis

**Quand utiliser:**
- Tu n'as pas de backend existant
- Tu veux du self-hosted sans coder
- Tu veux la même expérience que le SaaS, mais hébergée chez toi

---

#### Comparaison des modes

| | pocketping.io | ton backend + SDK | bridge-server |
|---|---|---|---|
| **Widget se connecte à** | pocketping.io | Ton serveur | bridge-server |
| **Hébergement** | Nous | Toi | Toi |
| **Code à écrire** | Aucun | Routes + handlers | Config seulement |
| **Base de données** | Nous | La tienne | In-memory/Redis |
| **Personnalisation** | Limitée | Totale | Moyenne |

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
| Messages (outgoing) | ✅ | ✅ | ✅ | ✅ |
| **Messages (incoming)** | ✅ | ✅ | ✅ | ✅ |
| Read Receipts | ✅ | ✅ | ✅ | ✅ |
| Custom Events | ✅ | ✅ | ✅ | ✅ |
| User Identity | ✅ | ✅ | ✅ | ✅ |
| AI Fallback | ✅ | ✅ | ✅ | ✅ |
| IP Filtering | ✅ | ✅ | ✅ | ✅ |
| Message Edit | ✅ | ✅ | ✅ | ✅ |
| Message Delete | ✅ | ✅ | ✅ | ✅ |
| File Attachments | ✅ | ✅ | ✅ | ✅ |
| **Attachments (incoming)** | ✅ | ✅ | ✅ | ✅ |

### Bridge Platform Support Matrix

Chaque plateforme a des contraintes techniques différentes:

| Feature | Telegram | Slack | Discord |
|---------|----------|-------|---------|
| **Send messages** | ✅ Webhook | ✅ Webhook | ✅ Webhook |
| **Receive messages** | ✅ Webhook | ✅ Events API | ⚠️ Gateway only |
| **Receive media** | ✅ Webhook | ✅ Events API | ⚠️ Gateway only |
| **Threads/Topics** | ✅ Forum topics | ✅ Thread replies | ✅ Forum channels |

**Discord Gateway Limitation:**
- Discord ne permet PAS de recevoir les messages utilisateurs via webhooks
- Pour recevoir les messages Discord, il faut le **Gateway API** (WebSocket persistant)
- Le Gateway n'est PAS compatible avec les environnements serverless (Vercel, Netlify, etc.)

**Solutions Discord:**
1. **Bridge-server (Go)** - Peut implémenter Gateway (pas serverless)
2. **pocketping-app sur Railway/Fly.io** - Peut implémenter Gateway (pas serverless)
3. **Slash commands** - Alternative limitée (pas de média, UX moins naturelle)

### Deployment Environments

| Environnement | Type | Discord Gateway | Recommandé pour |
|---------------|------|-----------------|-----------------|
| **Vercel** | Serverless | ❌ Non supporté | Frontend, APIs simples |
| **Railway** | Container | ✅ Supporté | Full-stack, WebSocket |
| **Fly.io** | Container | ✅ Supporté | Full-stack, WebSocket |
| **Docker** | Container | ✅ Supporté | Self-hosted |
| **VPS** | VM | ✅ Supporté | Self-hosted |

**pocketping-app** est déployé sur **Railway** → Discord Gateway possible.
**bridge-server** est un binaire Go → Discord Gateway possible partout.

---

## Project Structure

This monorepo contains:
- `packages/widget/` - Browser widget (~15KB) - embeds on customer websites
- `packages/sdk-node/` - Node.js SDK for self-hosted backends
- `packages/sdk-python/` - Python SDK for self-hosted backends
- `packages/sdk-go/` - Go SDK for self-hosted backends
- `packages/sdk-php/` - PHP SDK for self-hosted backends
- `packages/sdk-ruby/` - Ruby SDK for self-hosted backends
- `packages/cli/` - CLI tool for PocketPing
- `packages/wordpress-plugin/` - WordPress plugin
- `bridge-server/` - Standalone Go server with HTTP-only bridges (alternative to SDK + custom backend)
- `docs-site/` - Documentation site (Docusaurus) - docs.pocketping.io
- `examples/` - Integration examples for various frameworks

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

- Documentation site is in `docs-site/` (Docusaurus)
- SDK documentation: `docs-site/docs/sdk/`
- Widget documentation: `docs-site/docs/widget/`
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

# Contributing to PocketPing

Thank you for wanting to contribute to PocketPing! This guide will help you get started.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [How to Contribute](#how-to-contribute)
- [Running Tests](#running-tests)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)

---

## Getting Started

### Prerequisites

- **Node.js** 20+ (for widget, sdk-node, and bridge-server)
- **pnpm** (package manager) - Install with `npm install -g pnpm`
- **Bun** (for bridge-server) - Install from [bun.sh](https://bun.sh)
- **Python 3.10+** (for SDK development)
- **Git**

### Quick Setup

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/pocketping.git
cd pocketping

# Add upstream remote (to sync with main repo later)
git remote add upstream https://github.com/Ruwad-io/pocketping.git

# 2. Install dependencies
pnpm install

# 3. Run tests to verify everything works
pnpm test
```

---

## Development Setup

### Widget Development

```bash
cd packages/widget

# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm build

# Watch mode (for development)
pnpm dev
```

### Bridge Server Development

```bash
cd bridge-server

# Install dependencies
bun install

# Copy environment file
cp .env.example .env
# Edit .env with your test credentials

# Run in development mode (with hot reload)
bun run dev
```

### Node.js SDK Development

```bash
cd packages/sdk-node

# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm build
```

### Python SDK Development

```bash
cd packages/sdk-python

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install in development mode
pip install -e ".[all,dev]"

# Run tests
pytest
```

### Test Backend (for integration testing)

```bash
# Clone the test backend
git clone https://github.com/Ruwad-io/pocketping-test-fastapi
cd pocketping-test-fastapi

# Install dependencies
pip install -r requirements.txt

# Configure
cp .env.example .env

# Run
uvicorn main:app --reload
```

---

## Project Structure

```
pocketping/
├── packages/
│   ├── widget/              # Chat widget (Preact + TypeScript)
│   │   ├── src/
│   │   │   ├── client.ts    # Core client logic
│   │   │   ├── components/  # Preact components
│   │   │   │   └── ChatWidget.tsx
│   │   │   ├── types.ts     # TypeScript definitions
│   │   │   └── index.ts     # Main entry point
│   │   └── tests/           # Unit tests (vitest)
│   │
│   ├── sdk-node/            # Node.js SDK (Express, Fastify, etc.)
│   │   ├── src/
│   │   │   ├── index.ts     # Main entry point
│   │   │   └── types.ts     # TypeScript definitions
│   │   └── tests/           # Unit tests
│   │
│   └── sdk-python/          # Python SDK
│       ├── src/pocketping/
│       │   ├── core.py      # Main PocketPing class
│       │   ├── bridges/     # Bridge implementations
│       │   ├── ai/          # AI provider implementations
│       │   └── fastapi.py   # FastAPI integration
│       └── tests/           # Unit tests (pytest)
│
├── bridge-server/           # Standalone bridge server (Bun + Hono)
│   ├── src/
│   │   ├── index.ts         # Server entry point
│   │   └── bridges/         # Bridge implementations
│   │       ├── telegram.ts
│   │       ├── discord.ts
│   │       └── slack.ts
│   └── Dockerfile
│
├── tests/
│   ├── mocks/               # Mock API servers for testing
│   │   ├── telegram-api.ts  # Mock Telegram Bot API
│   │   └── slack-api.ts     # Mock Slack API
│   ├── integration/         # Integration tests
│   └── e2e/                 # End-to-end tests (Playwright)
│
├── docs-site/               # Documentation site (Docusaurus)
├── assets/                  # Logo and branding assets
└── cloudflare-workers/      # CDN worker for widget distribution
```

---

## How to Contribute

### Reporting Bugs

1. **Search existing issues** to avoid duplicates
2. **Open a new issue** with:
   - Clear, descriptive title
   - Steps to reproduce
   - Expected vs actual behavior
   - Your environment (OS, Node version, browser, etc.)
   - Relevant logs or screenshots

### Suggesting Features

1. Open an issue with the `enhancement` label
2. Describe:
   - The problem you're trying to solve
   - Your proposed solution
   - Alternatives you've considered
3. Be open to discussion and feedback

### Types of Contributions We Love

- Bug fixes
- Documentation improvements
- Test coverage improvements
- New bridge implementations (WhatsApp, SMS, etc.)
- Performance improvements
- Accessibility improvements
- Translations

---

## Running Tests

### All Tests

```bash
# From root directory
pnpm test
```

### Widget Tests

```bash
cd packages/widget
pnpm test           # Run once
pnpm test -- --watch  # Watch mode
```

### Integration Tests

```bash
cd bridge-server
bun test
```

### E2E Tests

```bash
# Requires both backend and bridge-server running
pnpm test:e2e
```

### Python SDK Tests

```bash
cd packages/sdk-python
pytest
pytest --cov  # With coverage
```

---

## Code Style

### TypeScript/JavaScript

- We use TypeScript for all JavaScript code
- Format with Prettier (runs automatically on commit)
- Lint with ESLint: `pnpm lint`
- Use meaningful variable names
- Add comments for non-obvious logic

### Python

- Follow PEP 8
- Use type hints
- Format with Black: `black .`
- Lint with Ruff: `ruff check .`

### General Guidelines

- Keep functions small and focused
- Write tests for new functionality
- Update documentation when changing behavior
- No console.log in production code (use proper logging)

---

## Pull Request Process

### 1. Create a Branch

```bash
# Start from the latest main
git checkout main
git pull origin main

# Create your feature branch
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

### 2. Make Your Changes

- Write your code
- Add/update tests
- Update documentation if needed

### 3. Test Your Changes

```bash
pnpm test
pnpm lint
```

### 4. Commit

Use clear, conventional commit messages:

```bash
# Good examples
git commit -m "feat: add WhatsApp bridge support"
git commit -m "fix: resolve WebSocket reconnection issue"
git commit -m "docs: improve Telegram setup guide"
git commit -m "test: add integration tests for Slack bridge"

# Prefixes:
# feat:     New feature
# fix:      Bug fix
# docs:     Documentation only
# test:     Adding tests
# refactor: Code change that doesn't fix bug or add feature
# chore:    Maintenance tasks
```

### 5. Push and Open PR

```bash
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub.

### 6. PR Review

- Respond to feedback
- Make requested changes
- Once approved, it will be merged

---

## Adding a New Bridge

Want to add support for a new platform (WhatsApp, SMS, etc.)?

### 1. Bridge Server Implementation

Create a new file in `bridge-server/src/bridges/`:

```typescript
// bridge-server/src/bridges/whatsapp.ts
import type { BridgeConfig, BridgeCallbacks } from './types';

export interface WhatsAppConfig extends BridgeConfig {
  apiKey: string;
  phoneNumber: string;
}

export class WhatsAppBridge {
  constructor(config: WhatsAppConfig, callbacks: BridgeCallbacks) {
    // Initialize
  }

  async start(): Promise<void> {
    // Connect to WhatsApp API
  }

  async stop(): Promise<void> {
    // Disconnect
  }

  async onNewSession(session: Session): Promise<void> {
    // Send notification for new session
  }

  async onVisitorMessage(message: Message, session: Session): Promise<void> {
    // Forward visitor message
  }
}
```

### 2. Python SDK Implementation (Optional)

Create in `packages/sdk-python/src/pocketping/bridges/`:

```python
# whatsapp.py
from ..types import Bridge, Session, Message

class WhatsAppBridge(Bridge):
    def __init__(self, api_key: str, phone_number: str):
        self.api_key = api_key
        self.phone_number = phone_number

    async def start(self) -> None:
        # Connect
        pass

    async def on_new_session(self, session: Session) -> None:
        # Notify
        pass
```

### 3. Add Tests

Create `tests/integration/whatsapp-bridge.test.ts` with mock server.

### 4. Document

- Add setup instructions to README
- Add configuration example to .env.example

---

## Troubleshooting

### Tests fail with "X is not a function" after adding new methods

**Symptom:** After adding a new method to a class (e.g., `identify()` to `PocketPingClient`), tests fail with:
```
TypeError: client.identify is not a function
```

**Cause:** Stale compiled `.js` files in `src/` directories. When TypeScript compiles with `tsc --declaration`, it may leave `.js` files in `src/`. Vitest can pick up these old `.js` files instead of transforming the `.ts` source files, causing the new methods to be missing.

**Solution:**
```bash
# Run the clean script (automatically runs before build via prebuild)
pnpm clean

# Or manually delete stale files
find src -name '*.js' -o -name '*.js.map' | xargs rm -f
```

**Prevention:** The `prebuild` script now runs `clean` automatically before every build. The `.gitignore` already excludes these files, so they won't be committed.

### Vitest caching issues

If tests fail unexpectedly after code changes:
```bash
# Clear all vitest caches
rm -rf node_modules/.vite node_modules/.cache .vitest

# Rebuild and test
pnpm build && pnpm test
```

### Vitest/esbuild class duplication issue

**Symptom:** Static properties like `MockWebSocket.OPEN` are undefined, or mocks don't work as expected in tests.

**Cause:** There's a known issue with esbuild/vitest where importing a class from a `setupFile` creates **duplicate class instances**:
1. Vitest runs `setup.ts` as a setupFile (first execution)
2. When tests import from `./setup`, the module is processed again (second execution)
3. esbuild may use different import paths internally, creating two separate class definitions
4. Static properties set on one class copy don't exist on the other

**Solution:** Access mocks from `globalThis` instead of importing them:

```typescript
// ❌ DON'T import mocks from setup file
import { MockWebSocket, localStorageMock } from './setup';

// ✅ DO access mocks from globalThis (set in setupFile)
const MockWebSocket = globalThis.WebSocket as any;
const localStorageMock = globalThis.localStorage as any;
```

**References:**
- https://github.com/evanw/esbuild/issues/2195
- https://github.com/vitest-dev/vitest/issues/3328

See the comment at the top of `packages/widget/tests/client.test.ts` for detailed explanation.

---

## Questions?

- Open an issue on GitHub
- Check existing issues and discussions

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing! Every improvement helps make PocketPing better for everyone.

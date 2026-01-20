# PocketPing Testing Strategy

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Test Pyramid                              │
├─────────────────────────────────────────────────────────────────┤
│                         E2E Tests                                │
│                      (Playwright + Bots)                         │
│                    ┌─────────────────┐                          │
│                    │  Full Flows     │                          │
│                    └─────────────────┘                          │
├─────────────────────────────────────────────────────────────────┤
│                    Integration Tests                             │
│               (API + WebSocket + Bridges)                        │
│            ┌───────────────────────────────┐                    │
│            │  Component Communication      │                    │
│            └───────────────────────────────┘                    │
├─────────────────────────────────────────────────────────────────┤
│                       Unit Tests                                 │
│                  (Fast, Isolated, Many)                          │
│      ┌─────────────────────────────────────────────────┐        │
│      │  Functions, Classes, Pure Logic                 │        │
│      └─────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

## Components to Test

| Component | Location | Framework | Coverage Target |
|-----------|----------|-----------|-----------------|
| Widget | `packages/widget` | Vitest + Testing Library | 80% |
| SDK Python | `packages/sdk-python` | pytest + pytest-asyncio | 90% |
| Bridge Server | `bridge-server` | Bun test / Vitest | 85% |
| E2E | `tests/e2e` | Playwright | Critical paths |

---

## 1. Unit Tests

### Widget (`packages/widget`)

```bash
# Setup
cd packages/widget
bun add -d vitest @testing-library/preact jsdom
```

**Test files structure:**
```
packages/widget/
├── src/
│   ├── client.ts
│   ├── components/
│   └── types.ts
└── tests/
    ├── client.test.ts
    ├── components/
    │   └── ChatWidget.test.tsx
    └── setup.ts
```

**What to test:**
- `client.ts`: Message sending, WebSocket handling, session management
- `ChatWidget.tsx`: Rendering, user interactions, state updates
- `formatTime()`, `checkPageVisibility()`, etc.

### SDK Python (`packages/sdk-python`)

```bash
# Setup
cd packages/sdk-python
pip install pytest pytest-asyncio pytest-cov httpx-mock
```

**Test files structure:**
```
packages/sdk-python/
├── src/pocketping/
│   ├── core.py
│   ├── models.py
│   └── storage/
└── tests/
    ├── conftest.py
    ├── test_core.py
    ├── test_models.py
    ├── test_storage.py
    └── test_bridges/
        ├── test_telegram.py
        └── test_slack.py
```

**What to test:**
- Message handling logic
- Session management
- Storage operations (memory, redis)
- Model validation
- WebSocket broadcast logic

### Bridge Server (`bridge-server`)

```bash
# Setup (Bun has built-in test runner)
cd bridge-server
```

**Test files structure:**
```
bridge-server/
├── src/
│   ├── bridges/
│   ├── api/
│   └── config.ts
└── tests/
    ├── bridges/
    │   ├── telegram.test.ts
    │   ├── slack.test.ts
    │   └── discord.test.ts
    ├── api/
    │   └── routes.test.ts
    └── mocks/
        └── telegram-bot.ts
```

**What to test:**
- Event emission/handling
- Message formatting
- Session-thread mapping
- Command parsing

---

## 2. Integration Tests

### Widget ↔ SDK Communication

Test the HTTP and WebSocket communication between widget and backend.

```
tests/integration/
├── widget-sdk.test.ts      # Widget API calls
├── websocket.test.ts       # Real-time messaging
└── session-persistence.test.ts
```

### Bridge Server ↔ Backend

Test webhook delivery and event processing.

```
tests/integration/
├── bridge-webhook.test.ts  # Webhook delivery
├── multi-bridge-sync.test.ts  # Cross-bridge message sync
└── read-receipts.test.ts   # Delivered/read status flow
```

---

## 3. End-to-End Tests

### Setup with Playwright

```bash
# Setup
bun add -d @playwright/test
npx playwright install
```

**E2E Test Scenarios:**

```
tests/e2e/
├── visitor-flow.spec.ts     # Basic visitor experience
├── operator-flow.spec.ts    # Operator response flow
├── read-receipts.spec.ts    # Check marks progression
├── multi-bridge.spec.ts     # Cross-platform sync
└── persistence.spec.ts      # Session recovery
```

### Mock Bridges for E2E

Create mock implementations for Telegram/Slack/Discord APIs:

```
tests/e2e/mocks/
├── telegram-server.ts   # Mock Telegram Bot API
├── slack-server.ts      # Mock Slack API
└── discord-server.ts    # Mock Discord Gateway
```

---

## 4. Test Configuration Files

### `vitest.config.ts` (Widget)

```typescript
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['tests/**', '**/*.d.ts'],
    },
  },
});
```

### `pytest.ini` (SDK Python)

```ini
[pytest]
asyncio_mode = auto
testpaths = tests
addopts = -v --cov=src/pocketping --cov-report=html --cov-report=term
filterwarnings = ignore::DeprecationWarning
```

### `bunfig.toml` (Bridge Server)

```toml
[test]
coverage = true
coverageDir = "./coverage"
```

### `playwright.config.ts` (E2E)

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['github']],
  use: {
    baseURL: 'http://localhost:8000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:8000',
    reuseExistingServer: !process.env.CI,
  },
});
```

---

## 5. CI/CD Pipeline

### `.github/workflows/test.yml`

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        component: [widget, sdk-python, bridge-server]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Setup Python
        if: matrix.component == 'sdk-python'
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          if [ "${{ matrix.component }}" = "sdk-python" ]; then
            cd packages/sdk-python
            pip install -e ".[dev]"
          else
            cd packages/${{ matrix.component }} || cd ${{ matrix.component }}
            bun install
          fi

      - name: Run tests
        run: |
          if [ "${{ matrix.component }}" = "sdk-python" ]; then
            cd packages/sdk-python
            pytest
          else
            cd packages/${{ matrix.component }} || cd ${{ matrix.component }}
            bun test
          fi

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          flags: ${{ matrix.component }}

  e2e-tests:
    runs-on: ubuntu-latest
    needs: unit-tests

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - name: Install Playwright
        run: |
          bun install
          npx playwright install --with-deps

      - name: Start services
        run: |
          # Start backend
          cd pocketping-test-fastapi
          pip install -r requirements.txt
          uvicorn main:app --port 8000 &

          # Start bridge server (mock mode)
          cd ../bridge-server
          MOCK_BRIDGES=true bun run dev &

          # Wait for services
          sleep 5

      - name: Run E2E tests
        run: npx playwright test

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
```

---

## 6. Test Commands

Add to root `package.json`:

```json
{
  "scripts": {
    "test": "bun run test:unit && bun run test:integration",
    "test:unit": "bun run test:widget && bun run test:sdk && bun run test:bridge",
    "test:widget": "cd packages/widget && bun test",
    "test:sdk": "cd packages/sdk-python && pytest",
    "test:bridge": "cd bridge-server && bun test",
    "test:integration": "bun run tests/integration/run.ts",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:coverage": "bun run test:unit --coverage",
    "test:watch": "bun run test:widget --watch"
  }
}
```

---

## 7. Key Test Scenarios

### Critical Path Tests (Must Pass)

| # | Scenario | Type |
|---|----------|------|
| 1 | Visitor connects and gets session | Integration |
| 2 | Visitor sends message | Unit + Integration |
| 3 | Message appears in Telegram/Slack | E2E |
| 4 | Operator replies | E2E |
| 5 | Reply appears in widget | E2E |
| 6 | Read receipts (✓ → ✓✓ → ✓✓ blue) | E2E |
| 7 | Session persistence (refresh page) | Integration |
| 8 | Multi-bridge sync | Integration |
| 9 | Reconnection after disconnect | Unit + Integration |
| 10 | Widget theming (light/dark) | Unit |

### Edge Cases to Test

- [ ] Very long messages (>4096 chars)
- [ ] Special characters / emojis in messages
- [ ] Rapid message sending (rate limiting)
- [ ] Network disconnection/reconnection
- [ ] Multiple tabs open
- [ ] Session expiration
- [ ] Invalid session ID
- [ ] Bridge unavailable (graceful degradation)
- [ ] Concurrent operator responses

---

## 8. Mocking Strategy

### Telegram Bot API Mock

```typescript
// tests/mocks/telegram-server.ts
import { Hono } from 'hono';

export function createMockTelegramServer() {
  const app = new Hono();
  const messages: any[] = [];

  app.post('/bot:token/sendMessage', async (c) => {
    const body = await c.req.json();
    const msg = {
      message_id: Date.now(),
      chat: { id: body.chat_id },
      text: body.text,
      date: Math.floor(Date.now() / 1000),
    };
    messages.push(msg);
    return c.json({ ok: true, result: msg });
  });

  app.post('/bot:token/createForumTopic', async (c) => {
    return c.json({
      ok: true,
      result: { message_thread_id: Date.now() },
    });
  });

  return { app, messages };
}
```

### WebSocket Test Client

```typescript
// tests/helpers/ws-client.ts
export class TestWebSocketClient {
  private ws: WebSocket | null = null;
  public messages: any[] = [];

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = reject;
      this.ws.onmessage = (e) => {
        this.messages.push(JSON.parse(e.data));
      };
    });
  }

  async waitForMessage(type: string, timeout = 5000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const msg = this.messages.find(m => m.type === type);
      if (msg) return msg;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for message type: ${type}`);
  }

  close(): void {
    this.ws?.close();
  }
}
```

---

## Next Steps

1. **Start with Unit Tests** - Quick wins, catch bugs early
2. **Add Integration Tests** - Verify component communication
3. **Setup CI Pipeline** - Automate on every PR
4. **Add E2E Tests** - Cover critical user flows
5. **Monitor Coverage** - Aim for 80%+ on core logic

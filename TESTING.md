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
| Bridge Server | `bridge-server` | Go (`go test ./...`) | 85% |
| E2E | `tests/e2e` | Playwright | Critical paths |

> All test suites are run via Docker through the repo-wide `make test` flow (see CLAUDE.md).
> Per-component `make` targets exist too: `make test-go`, `make test-node`, `make test-python`, etc.

---

## Bridge E2E (Real Platforms)

We maintain a lightweight API-level harness for Slack/Discord that validates **real platform messages** against widget/bridge-server behavior.

See: `docs/TESTING_BRIDGES_E2E.md`

## 1. Unit Tests

### Widget (`packages/widget`)

```bash
# Setup
cd packages/widget
pnpm add -D vitest @testing-library/preact jsdom
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

The bridge-server is a Go binary, so it uses Go's built-in test runner.

```bash
# Setup
cd bridge-server
go mod download

# Run the tests
go test ./...

# With coverage
go test -cover ./...

# Or via Docker (repo-wide flow)
make test-go
```

**Test files structure:** Go tests live alongside the code they cover (`*_test.go`):
```
bridge-server/
├── cmd/
│   └── server/          # main package (entry point)
├── internal/
│   ├── bridges/
│   │   ├── telegram.go
│   │   ├── telegram_test.go
│   │   ├── slack.go
│   │   ├── slack_test.go
│   │   ├── discord.go
│   │   └── discord_test.go
│   └── api/
│       ├── routes.go
│       └── routes_test.go
└── go.mod
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
pnpm add -D @playwright/test
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

### Bridge Server (Go)

The bridge-server needs no extra test config — Go's toolchain handles it. Run with
coverage and emit a profile like so:

```bash
cd bridge-server
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out   # view the report
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
    command: 'pnpm dev',
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
  # Easiest path: run everything through Docker, matching local `make test`.
  all-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run all SDK + bridge-server tests via Docker
        run: make test

  # Or run components individually:
  unit-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        component: [widget, sdk-python, bridge-server]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node + pnpm
        if: matrix.component == 'widget'
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup Go
        if: matrix.component == 'bridge-server'
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'

      - name: Setup Python
        if: matrix.component == 'sdk-python'
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Run tests
        run: |
          case "${{ matrix.component }}" in
            sdk-python)
              cd packages/sdk-python
              pip install -e ".[dev]"
              pytest
              ;;
            bridge-server)
              cd bridge-server
              go test ./...
              ;;
            widget)
              corepack enable
              cd packages/widget
              pnpm install
              pnpm test
              ;;
          esac

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          flags: ${{ matrix.component }}

  e2e-tests:
    runs-on: ubuntu-latest
    needs: unit-tests

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: actions/setup-go@v5
        with:
          go-version: '1.21'

      - name: Install Playwright
        run: |
          corepack enable
          pnpm install
          npx playwright install --with-deps

      - name: Start services
        run: |
          # Start backend
          cd pocketping-test-fastapi
          pip install -r requirements.txt
          uvicorn main:app --port 8000 &

          # Start bridge server (mock mode)
          cd ../bridge-server
          MOCK_BRIDGES=true go run ./cmd/server &

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

The canonical entry point is the repo-wide Docker flow (see CLAUDE.md):

```bash
make test          # Run all SDK + bridge-server tests via Docker
make test-go       # Bridge-server + sdk-go (Go)
make test-node     # sdk-node
make test-python   # sdk-python
make test-php      # sdk-php
make test-ruby     # sdk-ruby
```

The bridge-server is Go, so it is tested with `go test ./...` (wrapped by
`make test-go`). The TypeScript packages keep their own npm scripts in
`package.json`:

```json
{
  "scripts": {
    "test:widget": "cd packages/widget && vitest run",
    "test:sdk-node": "cd packages/sdk-node && vitest run",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:watch": "cd packages/widget && vitest --watch"
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

### Telegram Bot API Mock (bridge-server, Go)

The bridge-server's Telegram bridge is exercised against an `httptest` server.
Point the bridge at the test server's base URL and assert on the captured requests:

```go
// internal/bridges/telegram_test.go
func newMockTelegramServer() (*httptest.Server, *[]map[string]any) {
	var messages []map[string]any
	mux := http.NewServeMux()

	mux.HandleFunc("/sendMessage", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		messages = append(messages, body)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"result": map[string]any{
				"message_id": time.Now().UnixNano(),
				"chat":       map[string]any{"id": body["chat_id"]},
				"text":       body["text"],
			},
		})
	})

	mux.HandleFunc("/createForumTopic", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":     true,
			"result": map[string]any{"message_thread_id": time.Now().UnixNano()},
		})
	})

	srv := httptest.NewServer(mux)
	return srv, &messages
}
```

### Widget Stream Test Client

Helper for widget-side tests. The widget connects over WebSocket or SSE depending on
deployment mode (the bridge-server uses SSE via `GET /api/events/stream`); this WebSocket
client covers the WS path:

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

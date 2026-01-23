# PocketPing SDK Specification v1.0

This document defines the standard architecture, features, and test requirements for all PocketPing SDK implementations.

**All contributors MUST follow this specification** to ensure consistency across SDKs.

---

## Developer Population Estimates (2025)

| Language | Estimated % of backend developers | Primary use case |
|----------|-----------------------------------|------------------|
| Node.js  | ~35% | Full-stack, serverless, APIs |
| Python   | ~30% | AI/ML, data, web backends |
| Go       | ~15% | Cloud infrastructure, microservices |
| PHP      | ~12% | Web apps, WordPress, Laravel |
| Ruby     | ~8%  | Rails, startups, rapid prototyping |

**Sources:**
- [Stack Overflow Developer Survey 2024](https://survey.stackoverflow.co/2024/)
- [GitHub State of the Octoverse 2024](https://github.blog/news-insights/octoverse/octoverse-2024/)
- [JetBrains Developer Ecosystem Survey 2024](https://www.jetbrains.com/lp/devecosystem-2024/)

---

## SDK vs Bridge Server

```
┌─────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│   Widget (JS)   │────▶│  Your Backend + SDK │────▶│   Bridge Server  │
│   (Frontend)    │     │  (Node/Python/Go/   │     │   (Standalone)   │
└─────────────────┘     │   PHP/Ruby)         │     └────────┬─────────┘
                        └─────────────────────┘              │
                                                    ┌────────┴─────────┐
                                                    ▼        ▼         ▼
                                              Telegram  Discord    Slack
```

- **SDKs** (sdk-node, sdk-python, sdk-go, sdk-php, sdk-ruby): Libraries for YOUR backend
- **Bridge Server**: Standalone Bun server that handles notifications to messaging platforms

The bridge-server does NOT use any SDK - it's a separate service.

---

## Architecture Principles

### 1. Single Entry Point

Every SDK must have **one main class** called `PocketPing` that is the entry point:

```
// Good
const pp = new PocketPing({ storage: memoryStorage });
await pp.handleConnect(request);

// Bad - Multiple entry points
const sessionManager = new SessionManager();
const messageHandler = new MessageHandler();
```

### 2. Dependency Injection

Always inject dependencies (storage, bridges, AI providers) - never hardcode:

```
// Good
PocketPing({ storage: myRedisStorage, bridges: [telegramBridge] })

// Bad
PocketPing()  // Uses hardcoded MemoryStorage internally
```

### 3. Async by Default

All I/O operations must be async:
- `handleConnect()` → async
- `handleMessage()` → async
- `storage.getSession()` → async
- Bridge methods → async

### 4. Error Handling

- **Throw/Raise** for programmer errors (invalid config, missing required fields)
- **Return null/None** for "not found" scenarios
- **Log warnings** for non-critical failures (bridge notification failed)

### 5. Naming Conventions

| Concept | JavaScript/TypeScript | Python | Go | PHP | Ruby |
|---------|----------------------|--------|-----|-----|------|
| Main class | `PocketPing` | `PocketPing` | `PocketPing` | `PocketPing` | `PocketPing` |
| Connect handler | `handleConnect()` | `handle_connect()` | `HandleConnect()` | `handleConnect()` | `handle_connect()` |
| Session model | `Session` | `Session` | `Session` | `Session` | `Session` |
| JSON key | `sessionId` | alias: `sessionId` | tag: `json:"sessionId"` | `#[Serialized('sessionId')]` | `:session_id` |

---

## Directory Structure

Each SDK must follow this structure:

```
packages/sdk-{language}/
├── src/                    # Source code
│   ├── core.{ext}          # Main PocketPing class
│   ├── models.{ext}        # Data models/types
│   ├── storage.{ext}       # Storage interface + MemoryStorage
│   ├── bridges/            # Bridge interface + implementations
│   └── ai/                 # AI provider interface (optional)
├── tests/                  # Test files
│   ├── test_core.{ext}     # Core functionality tests
│   ├── test_models.{ext}   # Model tests
│   ├── test_storage.{ext}  # Storage tests
│   ├── test_custom_events.{ext}  # Custom events tests
│   ├── test_identity.{ext} # User identity tests
│   └── test_version.{ext}  # Version management tests
├── README.md               # SDK documentation
├── CHANGELOG.md            # Version history
└── {package-config}        # package.json / pyproject.toml / go.mod / etc.
```

---

## Core Features (REQUIRED)

All SDKs MUST implement these features:

### 1. Session Management

```
// Connect endpoint handler
handle_connect(request: ConnectRequest) -> ConnectResponse

// Types
ConnectRequest {
  visitorId: string
  sessionId?: string
  metadata?: SessionMetadata
  identity?: UserIdentity
}

ConnectResponse {
  sessionId: string
  visitorId: string
  operatorOnline: boolean
  welcomeMessage?: string
  messages: Message[]
  trackedElements?: TrackedElement[]  // NEW: For SaaS auto-tracking
}
```

### 2. Message Handling

```
handle_message(request: SendMessageRequest) -> SendMessageResponse

SendMessageRequest {
  sessionId: string
  content: string (max 4000 chars)
  sender: 'visitor' | 'operator'
  replyTo?: string
}

SendMessageResponse {
  messageId: string
  timestamp: datetime
}
```

### 3. Read Receipts

```
handle_read(request: ReadRequest) -> ReadResponse

ReadRequest {
  sessionId: string
  messageIds: string[]
  status: 'delivered' | 'read'
}
```

### 4. User Identity

```
handle_identify(request: IdentifyRequest) -> IdentifyResponse

IdentifyRequest {
  sessionId: string
  identity: UserIdentity
}

UserIdentity {
  id: string (required)
  email?: string
  name?: string
  [custom fields]: any
}
```

### 5. Custom Events

```
// Handler registration
on_event(eventName: string, handler: Function) -> unsubscribe()
off_event(eventName: string, handler: Function)

// Event processing
handle_custom_event(event: CustomEvent, sessionId: string)

// Event emission
emit_event(sessionId: string, event: CustomEvent)
broadcast_event(event: CustomEvent)  // To all sessions

CustomEvent {
  name: string
  data?: object
  timestamp: datetime
  sessionId?: string
}
```

### 6. Tracked Elements (NEW - For SaaS)

```
TrackedElement {
  selector: string           // CSS selector
  event?: string             // 'click' | 'submit' | 'focus' | 'change' | 'mouseenter'
  name: string               // Event name
  widgetMessage?: string     // Opens widget with this message
  data?: object              // Extra data
}

TriggerOptions {
  widgetMessage?: string     // If set, opens widget
}
```

### 7. Version Management

```
check_widget_version(clientVersion: string) -> VersionCheckResult

VersionCheckResult {
  status: 'ok' | 'warning' | 'error'
  canContinue: boolean
  message?: string
  minVersion?: string
  latestVersion?: string
}
```

### 8. WebSocket Management

```
register_websocket(sessionId: string, websocket: WebSocket)
unregister_websocket(sessionId: string, websocket: WebSocket)
broadcast_to_session(sessionId: string, event: object)
```

### 9. Operator Functions

```
send_operator_message(sessionId, content, sourceBridge?, operatorName?) -> Message
set_operator_online(online: boolean)
is_operator_online() -> boolean
```

### 10. Bridge Integration

```
add_bridge(bridge: Bridge)

Bridge Interface {
  name: string
  init(callbacks) -> void
  on_new_session(session) -> void
  on_visitor_message(message, session) -> void
  on_operator_message(message, session) -> void
  on_message_read(messageIds, status, session) -> void
  on_custom_event(event, session) -> void
  on_identity_update(session) -> void
}
```

### 11. IP Filtering

```
// Configuration
IpFilterConfig {
  enabled?: boolean           // Default: false
  mode?: 'blocklist' | 'allowlist' | 'both'  // Default: 'blocklist'
  allowlist?: string[]        // IPs/CIDRs to allow
  blocklist?: string[]        // IPs/CIDRs to block
  customFilter?: (ip, request) -> boolean | null  // Custom filter function
  logBlocked?: boolean        // Default: true
  blockedStatusCode?: number  // Default: 403
  blockedMessage?: string     // Default: 'Forbidden'
}

// Filter result
IpFilterResult {
  allowed: boolean
  reason: 'blocklist' | 'allowlist' | 'not_in_allowlist' | 'custom' | 'default' | 'disabled'
  matchedRule?: string
}

// Functions
check_ip_filter(ip: string, config: IpFilterConfig) -> IpFilterResult
get_client_ip(request) -> string  // Extract IP from proxy headers
```

#### IP Filter Modes

| Mode | Behavior |
|------|----------|
| `blocklist` | Block matching IPs, allow all others |
| `allowlist` | Only allow matching IPs, block all others |
| `both` | Allowlist takes precedence, then blocklist is applied |

#### CIDR Support

All SDKs must support CIDR notation:
- Single IP: `192.168.1.1` (treated as `/32`)
- Range: `192.168.1.0/24` (256 addresses)
- Large range: `10.0.0.0/8` (16M addresses)
- All IPs: `0.0.0.0/0`

#### Custom Filter

The `customFilter` function allows dynamic IP filtering:
- Return `true` to allow
- Return `false` to block
- Return `null/undefined` to defer to list-based filtering

---

## Storage Interface (REQUIRED)

All SDKs must implement:

```
Storage Interface {
  // Session operations
  create_session(session: Session) -> void
  get_session(sessionId: string) -> Session | null
  update_session(session: Session) -> void
  delete_session(sessionId: string) -> void

  // Message operations
  save_message(message: Message) -> void
  get_messages(sessionId: string, after?: string, limit?: int) -> Message[]
  get_message(messageId: string) -> Message | null

  // Optional
  cleanup_old_sessions(olderThan: datetime) -> int
  get_session_by_visitor_id(visitorId: string) -> Session | null
}
```

A `MemoryStorage` implementation MUST be provided for development/testing.

---

## Test Requirements

### Minimum Test Coverage: 80%

### Required Test Categories

Each SDK MUST have tests for:

| Category | Test File | Min Tests |
|----------|-----------|-----------|
| Core | test_core | 20+ |
| Models | test_models | 10+ |
| Custom Events | test_custom_events | 15+ |
| Identity | test_identity | 6+ |
| Version | test_version | 15+ |
| Storage | test_storage | 8+ |
| **Total** | | **74+** |

### Test Naming Convention

```
test_{feature}_{scenario}_{expected_behavior}

Examples:
- test_connect_creates_new_session
- test_connect_reuses_existing_session
- test_message_updates_session_activity
- test_identify_requires_id
```

### Required Test Scenarios

#### Connect Tests
- [ ] Creates new session when no session_id
- [ ] Reuses existing session when session_id provided
- [ ] Returns existing messages
- [ ] Updates session metadata
- [ ] Returns tracked elements from response

#### Message Tests
- [ ] Handles visitor message
- [ ] Handles operator message
- [ ] Updates session activity
- [ ] Rejects invalid session
- [ ] Operator message disables AI

#### Read Receipt Tests
- [ ] Updates message status
- [ ] Sets delivered_at timestamp
- [ ] Sets read_at timestamp

#### WebSocket Tests
- [ ] Registers connection
- [ ] Unregisters connection
- [ ] Broadcasts to session

#### Custom Event Tests
- [ ] Registers event handler
- [ ] Unsubscribes from event
- [ ] Supports wildcard handlers
- [ ] Calls specific handlers
- [ ] Calls wildcard handlers
- [ ] Sets session_id on event
- [ ] Broadcasts to WebSocket
- [ ] Notifies bridges

#### Identity Tests
- [ ] Updates session identity
- [ ] Requires id field
- [ ] Rejects invalid session
- [ ] Notifies bridges
- [ ] Supports custom fields

#### Version Tests
- [ ] Returns OK for valid version
- [ ] Returns warning for outdated version
- [ ] Returns error for unsupported version
- [ ] Handles missing version header
- [ ] Parses semver correctly

---

## CI Configuration

### Multi-Version Testing

| Language | Versions to test | Rationale |
|----------|------------------|-----------|
| Node.js  | 18, 20, 22 | LTS versions + latest |
| Python   | 3.10, 3.11, 3.12 | Supported versions |
| Go       | 1.21, 1.22 | Two latest minor versions |
| PHP      | 8.1, 8.2, 8.3 | Supported versions |
| Ruby     | 3.1, 3.2, 3.3 | Supported versions |

### Why Multi-Version?

1. **Python**: Different async behaviors, type hint support
2. **Node.js**: ES module differences, new features
3. **Go**: Generics (1.18+), loop variable changes (1.22)
4. **PHP**: Type system improvements, JIT
5. **Ruby**: YJIT, pattern matching

### Recommended Matrix

```yaml
# In CI workflow
strategy:
  matrix:
    include:
      # Test oldest supported
      - version: "oldest"
      # Test latest stable
      - version: "latest"
      # Test latest (head/canary) for early warning
      - version: "edge"
        continue-on-error: true
```

---

## Package Publishing

| Language | Registry | Package Name |
|----------|----------|--------------|
| Node.js  | npm | `@pocketping/sdk-node` |
| Python   | PyPI | `pocketping` |
| Go       | Go Modules | `github.com/Ruwad-io/pocketping/sdk-go` |
| PHP      | Packagist | `pocketping/sdk` |
| Ruby     | RubyGems | `pocketping` |

---

## Documentation Requirements

Each SDK README must include:

1. **Installation** - Package manager command
2. **Quick Start** - Minimal working example
3. **Configuration** - All options documented
4. **API Reference** - All public methods
5. **Storage Adapters** - How to implement custom storage
6. **Bridge Integration** - How to add bridges
7. **Version Compatibility** - Min SDK versions, changelog link

---

## Error Handling

All SDKs must:

1. Throw/raise typed exceptions for invalid input
2. Return null/None for "not found" scenarios (not throw)
3. Log warnings for non-critical issues (e.g., bridge notification failures)
4. Include session_id in error context where applicable

---

## Changelog

- **v1.0** (2025-01): Initial specification
  - Added TrackedElement support
  - Added TriggerOptions
  - Standardized test requirements
  - Multi-language CI guidelines

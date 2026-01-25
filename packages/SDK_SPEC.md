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
                        ┌─────────────────────────────────────────────────────┐
                        │                  Bidirectional Flow                 │
                        │                                                     │
┌─────────────────┐     │  ┌─────────────────────┐     ┌──────────────────┐  │
│   Widget (JS)   │◀───▶│  │  Your Backend + SDK │◀───▶│  Bridges         │  │
│   (Frontend)    │     │  │  (Node/Python/Go/   │     │  (Telegram/      │  │
└─────────────────┘     │  │   PHP/Ruby)         │     │   Discord/Slack) │  │
                        │  └─────────────────────┘     └──────────────────┘  │
                        │                                                     │
                        │  OR (Standalone mode)                               │
                        │                                                     │
                        │  ┌─────────────────────┐     ┌──────────────────┐  │
                        │  │   Bridge Server     │◀───▶│  Bridges         │  │
                        │  │   (uses sdk-go)     │     │  (Telegram/      │  │
                        │  └─────────────────────┘     │   Discord/Slack) │  │
                        │                              └──────────────────┘  │
                        └─────────────────────────────────────────────────────┘
```

### Three Deployment Options

| Option | Description | When to use |
|--------|-------------|-------------|
| **SDKs** | Libraries for YOUR backend (Node/Python/Go/PHP/Ruby) | You have an existing backend |
| **Bridge Server** | Standalone Go server using sdk-go internally | No backend, just want it to work |
| **SaaS** | Hosted service (pocketping.io) | Zero infrastructure management |

### Feature Parity

**All three options provide the same features:**
- Outgoing: Messages from widget → Bridges (Telegram/Discord/Slack)
- **Incoming: Messages from Bridges → Widget** (NEW: via WebhookHandler)
- File attachments in both directions
- Message edit/delete sync
- Read receipts

The bridge-server now uses sdk-go internally for code reuse.

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
  on_visitor_message(message, session) -> BridgeMessageId | null  // Returns bridge message ID
  on_operator_message(message, session) -> void
  on_message_read(messageIds, status, session) -> void
  on_message_edit(messageId, newContent, bridgeMessageId) -> boolean  // Sync edit to bridge
  on_message_delete(messageId, bridgeMessageId) -> boolean            // Sync delete to bridge
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

### 12. Message Edit

Visitors can edit their own messages. Edits are synced to connected bridges.

```
handle_edit_message(request: EditMessageRequest) -> EditMessageResponse

EditMessageRequest {
  sessionId: string
  messageId: string
  content: string (max 4000 chars)
}

EditMessageResponse {
  messageId: string
  content: string
  editedAt: datetime
}
```

#### Edit Behavior:
- Only the message sender can edit their own messages
- Edited messages get an `editedAt` timestamp
- Edits are synced to bridges (Telegram `editMessageText`, Discord `PATCH`, Slack `chat.update`)
- Bridge message IDs must be stored for sync to work (see Storage Interface)

### 13. Message Delete

Visitors can delete their own messages (soft delete). Deletes are synced to connected bridges.

```
handle_delete_message(request: DeleteMessageRequest) -> DeleteMessageResponse

DeleteMessageRequest {
  sessionId: string
  messageId: string
}

DeleteMessageResponse {
  deleted: boolean
}
```

#### Delete Behavior:
- Only the message sender can delete their own messages
- Soft delete: set `deletedAt` timestamp (don't remove from storage)
- Deletes are synced to bridges (Telegram `deleteMessage`, Discord `DELETE`, Slack `chat.delete`)
- Bridge message IDs must be stored for sync to work

### 14. File Attachments

Messages can include file attachments (images, documents, etc.).

```
Attachment {
  id: string
  messageId?: string          // Linked after message creation
  filename: string
  mimeType: string
  size: number                // Bytes
  url: string                 // Public URL for download
  thumbnailUrl?: string       // For images/videos
  status: 'pending' | 'ready' | 'failed'
  createdAt: datetime
}

// Upload flow (presigned URL pattern)
handle_upload_request(request: UploadRequest) -> UploadResponse

UploadRequest {
  sessionId: string
  filename: string
  mimeType: string
  size: number
}

UploadResponse {
  attachmentId: string
  uploadUrl: string           // Presigned URL for direct upload
  expiresAt: datetime
}

// After upload completes
handle_upload_complete(attachmentId: string) -> Attachment
```

#### Attachment Behavior:
- Attachments are uploaded separately from messages (presigned URL pattern)
- `attachmentIds` are passed with the message to link them
- Bridges should display attachments inline (images) or as file links
- Storage must support attachment metadata (see Storage Interface)

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
  update_message(message: Message) -> void       // For edit/delete

  // Bridge message ID operations (for edit/delete sync)
  save_bridge_message_ids(messageId: string, bridgeIds: BridgeMessageIds) -> void
  get_bridge_message_ids(messageId: string) -> BridgeMessageIds | null

  // Attachment operations (optional - can use external storage)
  save_attachment(attachment: Attachment) -> void
  get_attachment(attachmentId: string) -> Attachment | null
  get_message_attachments(messageId: string) -> Attachment[]
  update_attachment(attachment: Attachment) -> void

  // Optional
  cleanup_old_sessions(olderThan: datetime) -> int
  get_session_by_visitor_id(visitorId: string) -> Session | null
}

BridgeMessageIds {
  telegramMessageId?: number
  discordMessageId?: string
  slackMessageTs?: string
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
| Edit/Delete | test_edit_delete | 10+ |
| Attachments | test_attachments | 8+ |
| **Total** | | **92+** |

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

#### Edit Message Tests
- [ ] Edits message content
- [ ] Sets editedAt timestamp
- [ ] Only sender can edit their message
- [ ] Rejects edit of non-existent message
- [ ] Rejects edit of deleted message
- [ ] Syncs edit to bridges
- [ ] Stores bridge message IDs on create

#### Delete Message Tests
- [ ] Soft deletes message (sets deletedAt)
- [ ] Only sender can delete their message
- [ ] Rejects delete of non-existent message
- [ ] Rejects delete of already deleted message
- [ ] Syncs delete to bridges

#### Attachment Tests
- [ ] Creates upload request with presigned URL
- [ ] Marks attachment as ready after upload
- [ ] Links attachments to message
- [ ] Returns attachments with message
- [ ] Rejects invalid mime types
- [ ] Rejects files over size limit
- [ ] Handles upload failure gracefully
- [ ] Syncs attachments to bridges

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

## Built-in Bridge Implementations

All SDKs SHOULD provide ready-to-use bridge implementations using HTTP APIs. This ensures consistency across languages and removes the need for third-party messaging libraries.

### Design Principles

1. **HTTP-only**: Use native HTTP clients (no external messaging libraries)
2. **Consistent API**: Same constructor parameters and behavior across languages
3. **Minimal Dependencies**: Only standard HTTP client for each language
4. **Edit/Delete Support**: All bridges must support message edit and delete sync

### Required Bridges

| Bridge | API Base URL | Auth Method |
|--------|--------------|-------------|
| Telegram | `https://api.telegram.org/bot{token}` | Bot Token in URL |
| Discord | `https://discord.com/api/v10` | Bot Token header or Webhook URL |
| Slack | `https://slack.com/api` | Bot Token header |

---

### 15. TelegramBridge

Sends notifications to a Telegram chat/group via Bot API.

```
TelegramBridge {
  constructor(botToken: string, chatId: string | number, options?: TelegramBridgeOptions)
}

TelegramBridgeOptions {
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'  // Default: 'HTML'
  disableNotification?: boolean                   // Default: false
  messageTemplate?: (message, session) -> string  // Custom format
  sessionTemplate?: (session) -> string           // New session format
}
```

#### Telegram API Calls

| Method | Telegram API | Purpose |
|--------|--------------|---------|
| `on_visitor_message` | `sendMessage` | Send visitor message to chat |
| `on_new_session` | `sendMessage` | Announce new session |
| `on_message_edit` | `editMessageText` | Sync edit to Telegram |
| `on_message_delete` | `deleteMessage` | Sync delete to Telegram |
| `on_typing` | `sendChatAction` | Show typing indicator |

#### Message Format (Default)

```
New session:
🆕 New chat session
👤 Visitor: {visitorId}
🌍 {country}, {city}
📍 {url}

Visitor message:
💬 {visitorId}:
{content}

Edited message:
✏️ {visitorId} (edited):
{content}
```

---

### 16. DiscordBridge

Sends notifications to a Discord channel via Bot API or Webhook.

```
DiscordBridge {
  // Option 1: Webhook (simple, no bot needed)
  constructor(webhookUrl: string, options?: DiscordBridgeOptions)

  // Option 2: Bot (for edit/delete support)
  constructor(botToken: string, channelId: string, options?: DiscordBridgeOptions)
}

DiscordBridgeOptions {
  username?: string                              // Webhook display name
  avatarUrl?: string                             // Webhook avatar
  embedColor?: number                            // Embed color (hex)
  messageTemplate?: (message, session) -> DiscordEmbed
}

DiscordEmbed {
  title?: string
  description?: string
  color?: number
  fields?: { name: string, value: string, inline?: boolean }[]
  footer?: { text: string }
  timestamp?: string
}
```

#### Discord API Calls

| Method | Discord API | Purpose |
|--------|-------------|---------|
| `on_visitor_message` | `POST /webhooks/{id}/{token}` or `POST /channels/{id}/messages` | Send message |
| `on_new_session` | Same as above | Announce session |
| `on_message_edit` | `PATCH /channels/{id}/messages/{mid}` | Sync edit (bot only) |
| `on_message_delete` | `DELETE /channels/{id}/messages/{mid}` | Sync delete (bot only) |

#### Webhook vs Bot Mode

| Feature | Webhook | Bot |
|---------|---------|-----|
| Send messages | ✅ | ✅ |
| Edit messages | ❌ | ✅ |
| Delete messages | ❌ | ✅ |
| Setup complexity | Simple | Requires bot creation |

---

### 17. SlackBridge

Sends notifications to a Slack channel via Bot API or Incoming Webhook.

```
SlackBridge {
  // Option 1: Webhook (simple, no bot needed)
  constructor(webhookUrl: string, options?: SlackBridgeOptions)

  // Option 2: Bot (for edit/delete support)
  constructor(botToken: string, channelId: string, options?: SlackBridgeOptions)
}

SlackBridgeOptions {
  username?: string                              // Display name
  iconEmoji?: string                             // e.g., ':speech_balloon:'
  iconUrl?: string                               // Avatar URL
  messageTemplate?: (message, session) -> SlackBlock[]
}

SlackBlock {
  type: 'section' | 'divider' | 'context' | 'header'
  text?: { type: 'mrkdwn' | 'plain_text', text: string }
  fields?: { type: 'mrkdwn', text: string }[]
}
```

#### Slack API Calls

| Method | Slack API | Purpose |
|--------|-----------|---------|
| `on_visitor_message` | Webhook or `chat.postMessage` | Send message |
| `on_new_session` | Same as above | Announce session |
| `on_message_edit` | `chat.update` | Sync edit (bot only) |
| `on_message_delete` | `chat.delete` | Sync delete (bot only) |

#### Webhook vs Bot Mode

| Feature | Webhook | Bot |
|---------|---------|-----|
| Send messages | ✅ | ✅ |
| Edit messages | ❌ | ✅ |
| Delete messages | ❌ | ✅ |
| Get message ts | ❌ | ✅ |
| Setup complexity | Simple | Requires app creation |

---

### Bridge Directory Structure

```
packages/sdk-{language}/
├── src/
│   ├── bridges/
│   │   ├── types.{ext}       # Bridge interface (exists)
│   │   ├── telegram.{ext}    # TelegramBridge implementation
│   │   ├── discord.{ext}     # DiscordBridge implementation
│   │   └── slack.{ext}       # SlackBridge implementation
│   ├── webhooks.{ext}        # WebhookHandler for incoming messages
```

---

### 18. WebhookHandler (Incoming Operator Messages)

All SDKs MUST provide a `WebhookHandler` class for receiving messages FROM bridges (Telegram, Discord, Slack) TO the widget. This enables bidirectional communication.

```
WebhookHandler {
  constructor(config: WebhookConfig)

  // HTTP handlers for webhook endpoints
  handleTelegramWebhook(payload) -> Response
  handleSlackWebhook(payload) -> Response
  handleDiscordWebhook(payload) -> Response
}

WebhookConfig {
  telegramBotToken?: string     // For downloading files from Telegram
  slackBotToken?: string        // For downloading files and getting user info
  discordBotToken?: string      // For future use
  onOperatorMessage: (sessionId, content, operatorName, sourceBridge, attachments) -> void
}

OperatorAttachment {
  filename: string
  mimeType: string
  size: number
  data: bytes                   // Raw file data
  bridgeFileId?: string         // Original ID from bridge
}
```

#### Telegram Webhook

Receives updates from Telegram Bot API via webhook.

| Field | How to extract |
|-------|----------------|
| `sessionId` | `message.message_thread_id` (topic ID) |
| `content` | `message.text` or `message.caption` |
| `operatorName` | `message.from.first_name` |
| `attachments` | `message.photo`, `message.document`, `message.audio`, `message.video`, `message.voice` |

File download: `GET /bot{token}/getFile?file_id={id}` → `GET /file/bot{token}/{file_path}`

#### Slack Webhook

Receives events via Slack Events API.

| Field | How to extract |
|-------|----------------|
| `sessionId` | `event.thread_ts` (thread timestamp) |
| `content` | `event.text` |
| `operatorName` | Fetch via `users.info` API |
| `attachments` | `event.files[]` (download with auth header) |

Must handle `url_verification` challenge: return `{ challenge: payload.challenge }`.

#### Discord Webhook

Receives interactions via Discord Interactions endpoint.

| Field | How to extract |
|-------|----------------|
| `sessionId` | `channel_id` (thread ID) |
| `content` | From slash command option `message` |
| `operatorName` | `member.user.username` or `user.username` |
| `attachments` | Discord Gateway `attachments[]` (direct download) |

Must handle PING verification: return `{ type: 1 }`.

#### WebhookHandler Usage Example

```javascript
// Node.js/Express
const { WebhookHandler } = require('@pocketping/sdk-node');

const handler = new WebhookHandler({
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  slackBotToken: process.env.SLACK_BOT_TOKEN,
  onOperatorMessage: async (sessionId, content, operatorName, sourceBridge, attachments) => {
    // Save message to database
    await db.messages.create({
      sessionId,
      content,
      sender: 'operator',
      operatorName,
      sourceBridge,
    });

    // Upload attachments
    for (const att of attachments) {
      await storage.upload(att.filename, att.data, att.mimeType);
    }

    // Notify widget via WebSocket/SSE
    broadcastToSession(sessionId, { type: 'message', ... });
  },
});

app.post('/webhooks/telegram', (req, res) => {
  const response = await handler.handleTelegramWebhook(req.body);
  res.json(response);
});
```

### Bridge Test Requirements

Each bridge implementation MUST have tests:

| Test Category | Min Tests |
|---------------|-----------|
| Constructor validation | 3 |
| on_visitor_message | 3 |
| on_new_session | 2 |
| on_message_edit | 3 |
| on_message_delete | 3 |
| Error handling | 3 |
| **Total per bridge** | **17+** |

Tests should mock HTTP calls (no real API calls in tests).

---

## Error Handling

All SDKs must:

1. Throw/raise typed exceptions for invalid input
2. Return null/None for "not found" scenarios (not throw)
3. Log warnings for non-critical issues (e.g., bridge notification failures)
4. Include session_id in error context where applicable

---

## Changelog

- **v1.3** (2025-01): Bidirectional Messaging (WebhookHandler)
  - Added WebhookHandler specification (section 18)
  - Incoming operator messages from Telegram/Discord/Slack → Widget
  - File attachment support in incoming messages
  - Bridge-server now uses sdk-go internally for code reuse
  - Updated architecture diagram to show bidirectional flow
  - Feature parity across SaaS, SDKs, and Bridge-Server

- **v1.2** (2025-01): Built-in Bridge Implementations
  - Added TelegramBridge specification (section 15)
  - Added DiscordBridge specification (section 16)
  - Added SlackBridge specification (section 17)
  - All bridges use HTTP APIs only (no third-party messaging libraries)
  - Webhook mode (simple) and Bot mode (full edit/delete support)
  - Added bridge test requirements

- **v1.1** (2025-01): Edit/Delete/Attachments
  - Added Message Edit (section 12)
  - Added Message Delete (section 13)
  - Added File Attachments (section 14)
  - Updated Bridge Interface with `on_message_edit` and `on_message_delete`
  - Updated Storage Interface with `update_message`, bridge ID storage, and attachment operations
  - Added test requirements for edit/delete/attachments

- **v1.0** (2025-01): Initial specification
  - Added TrackedElement support
  - Added TriggerOptions
  - Standardized test requirements
  - Multi-language CI guidelines

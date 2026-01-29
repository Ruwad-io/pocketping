# PocketPing Implementation Checklist

This checklist defines the **contract** that ALL SDKs and the Bridge Server must implement.
When adding a feature, update this checklist FIRST, then implement in all components.

---

## SessionMetadata Fields

All SDKs must support these metadata fields:

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `url` | string | Client | Current page URL |
| `referrer` | string | Client | Referrer URL |
| `pageTitle` | string | Client | Document title |
| `userAgent` | string | Client | Browser user agent |
| `timezone` | string | Client | e.g. "Europe/Paris" |
| `language` | string | Client | e.g. "fr-FR" |
| `screenResolution` | string | Client | e.g. "1920x1080" |
| `ip` | string | Server | Client IP address |
| `country` | string | Server | From IP geolocation (optional) |
| `city` | string | Server | From IP geolocation (optional) |
| `deviceType` | enum | Server | "desktop" / "mobile" / "tablet" |
| `browser` | string | Server | "Chrome" / "Firefox" / "Safari" / etc. |
| `os` | string | Server | "Windows" / "macOS" / "Linux" / "iOS" / "Android" |

### Implementation Status

| Component | url | referrer | pageTitle | userAgent | timezone | language | screenRes | ip | country | city | deviceType | browser | os |
|-----------|-----|----------|-----------|-----------|----------|----------|-----------|----|---------|----- |------------|---------|-----|
| SDK Python | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | ⬜ | ✅ | ✅ | ✅ |
| SDK Node | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | ⬜ | ✅ | ✅ | ✅ |
| Bridge Server | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | ⬜ | ✅ | ✅ | ✅ |
| Widget | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | N/A | N/A | N/A | N/A | N/A |

Legend: ✅ = Implemented | ⬜ = Not implemented | N/A = Not applicable

---

## Session Persistence

| Feature | Description |
|---------|-------------|
| `visitorId` persistence | Store in localStorage, reuse across sessions |
| `sessionId` persistence | Store in localStorage, send on reconnect |
| `getSessionByVisitorId()` | Find existing session by visitor ID |
| Metadata merge on reconnect | Update URL/pageTitle, preserve IP/country/city |

### Implementation Status

| Component | visitorId persist | sessionId persist | getSessionByVisitorId | Metadata merge |
|-----------|-------------------|-------------------|----------------------|----------------|
| SDK Python | N/A (server) | N/A (server) | ✅ | ✅ |
| SDK Node | N/A (server) | N/A (server) | ✅ | ✅ |
| Bridge Server | N/A | N/A | N/A | N/A |
| Widget | ✅ | ✅ | N/A (client) | N/A (client) |

---

## Server-Side Enrichment

SDKs that handle HTTP requests must:

| Feature | Description |
|---------|-------------|
| IP Extraction | Extract from `x-forwarded-for`, `x-real-ip`, or socket |
| User Agent Parsing | Parse UA string to extract device/browser/OS |

### Implementation Status

| Component | IP Extraction | UA Parsing |
|-----------|---------------|------------|
| SDK Python (FastAPI) | ✅ | ✅ |
| SDK Node (middleware) | ✅ | ✅ |
| Bridge Server | N/A (receives enriched data) | N/A |
| Widget | N/A (client) | N/A |

---

## Storage Interface

All SDKs must implement this storage interface:

```typescript
interface Storage {
  // Required
  createSession(session: Session): Promise<void>
  getSession(sessionId: string): Promise<Session | null>
  updateSession(session: Session): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  saveMessage(message: Message): Promise<void>
  getMessages(sessionId: string, after?: string, limit?: number): Promise<Message[]>
  getMessage(messageId: string): Promise<Message | null>

  // Optional
  getSessionByVisitorId?(visitorId: string): Promise<Session | null>
  cleanupOldSessions?(olderThan: Date): Promise<number>
}
```

### Implementation Status

| Component | createSession | getSession | updateSession | deleteSession | saveMessage | getMessages | getMessage | getSessionByVisitorId | cleanupOldSessions |
|-----------|---------------|------------|---------------|---------------|-------------|-------------|------------|----------------------|-------------------|
| SDK Python | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SDK Node | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Protocol Endpoints

All SDKs must implement these HTTP endpoints:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/connect` | Initialize or resume session |
| POST | `/message` | Send a message |
| GET | `/messages` | Get message history |
| POST | `/typing` | Send typing indicator |
| GET | `/presence` | Get operator status |
| POST | `/read` | Mark messages as read |
| WS | `/stream` | Real-time events (optional) |

### Implementation Status

| Component | /connect | /message | /messages | /typing | /presence | /read | /stream |
|-----------|----------|----------|-----------|---------|-----------|-------|---------|
| SDK Python | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SDK Node | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | ✅ |

---

## Read Receipts

Message delivery and read status tracking:

| Status | Value | Description | Icon |
|--------|-------|-------------|------|
| Sending | `sending` | Message being sent to server | ⏳ |
| Sent | `sent` | Message saved on server | ✓ |
| Delivered | `delivered` | Message received by widget | ✓✓ |
| Read | `read` | Message viewed by recipient | 👁️ |

### Message Type

```typescript
interface Message {
  id: string;
  sessionId: string;
  content: string;
  sender: 'visitor' | 'operator' | 'ai';
  timestamp: Date;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
  readAt?: Date;
  deliveredAt?: Date;
}
```

### Flow

1. **Visitor sends message**: status = `sent` after server saves
2. **Operator sends message**: status = `sent`, then widget sends `delivered` event
3. **Widget visible + focused**: widget sends `read` event for unread messages
4. **Bridges update**: reaction/message updated to reflect status

### Implementation Status

| Component | Message.status | /read endpoint | Send delivered | Send read | Display status |
|-----------|----------------|----------------|----------------|-----------|----------------|
| SDK Python | ✅ | ✅ | N/A | N/A | N/A |
| SDK Node | ✅ | ⬜ | N/A | N/A | N/A |
| Widget | ✅ | N/A | ⬜ | ⬜ | ⬜ |
| Telegram | N/A | N/A | N/A | N/A | ✅ |
| Discord | N/A | N/A | N/A | N/A | ✅ |
| Slack | N/A | N/A | N/A | N/A | ✅ |

---

## Bridge Features

| Feature | Description |
|---------|-------------|
| Forum Topics (Telegram) | Each conversation = 1 topic |
| Threads (Discord) | Each conversation = 1 thread |
| Threads (Slack) | Each conversation = 1 thread |
| Cross-bridge sync | Operator reply syncs to all bridges |
| Metadata display | Show visitor info in notifications |

### Implementation Status

| Bridge | SDK Python | SDK Node | Bridge Server |
|--------|------------|----------|---------------|
| Telegram (Topics) | ✅ | ⬜ | ✅ |
| Telegram (Legacy) | ✅ | ⬜ | ✅ |
| Discord (Threads) | ✅ | ⬜ | ✅ |
| Discord (Legacy) | ✅ | ⬜ | ✅ |
| Slack | ✅ | ⬜ | ✅ |
| Cross-bridge sync | ✅ | ⬜ | ✅ |

---

## Notification Display Fields

All bridges must display these fields in "New Conversation" notifications:

| Field | Icon | Format | Example |
|-------|------|--------|---------|
| `url` | 📍 | Page URL | `http://localhost:8000/pricing` |
| `referrer` | ↩️ | From URL | `https://google.com` |
| `ip` | 🌐 | IP address (monospace) | `127.0.0.1` |
| `deviceType` + `browser` + `os` | 💻/📱 | Combined | `Desktop • Chrome • macOS` |
| `language` | 🌍 | Language code | `fr-FR` |
| `timezone` | 🕐 | Timezone | `Europe/Paris` |
| `screenResolution` | 🖥️ | Resolution | `1920x1080` |

### Implementation Status

| Bridge | url | ip | device/browser/os | language | timezone | screen |
|--------|-----|----|--------------------|----------|----------|--------|
| Telegram (Forum) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Telegram (Legacy) | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| Discord (Threads) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Discord (Legacy) | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| Slack | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ |
| Bridge Server | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Widget Customization

The widget supports extensive customization options:

| Category | Options |
|----------|---------|
| Branding | `operatorName`, `operatorAvatar`, `logoUrl`, `headerTitle`, `headerSubtitle`, `welcomeMessage`, `placeholder` |
| Appearance | `theme`, `primaryColor`, `primaryTextColor`, `position`, `offset`, `borderRadius`, `fontFamily`, `zIndex`, `toggleIcon`, `customCSS` |
| Behavior | `showOnPages`, `hideOnPages`, `showDelay`, `autoOpenDelay`, `soundEnabled`, `showUnreadBadge`, `persistOpenState` |
| Callbacks | `onOpen`, `onClose`, `onMessage`, `onConnect`, `onError` |

### Implementation Status

| Feature | Widget | Documented |
|---------|--------|------------|
| Branding options | ✅ Types | ✅ |
| Appearance options | ✅ Types | ✅ |
| Behavior options | ✅ Types | ✅ |
| Callbacks | ✅ Types | ✅ |
| Toggle icons (preset) | ⬜ UI | ✅ |
| Custom CSS injection | ⬜ UI | ✅ |
| Page filtering | ⬜ UI | ✅ |
| Sound notifications | ⬜ UI | ✅ |
| Unread badge | ⬜ UI | ✅ |

> See [packages/widget/README.md](packages/widget/README.md) for full documentation.

---

## User-Agent Filtering

Block bots and automated requests from creating chat sessions:

| Feature | Description |
|---------|-------------|
| Default bot patterns | ~50 patterns for known bots (GoogleBot, curl, etc.) |
| Substring matching | Case-insensitive substring match |
| Regex matching | Patterns wrapped in `/` are regex (e.g., `/bot-\d+/`) |
| Three modes | `blocklist`, `allowlist`, `both` |
| Custom filter | Callback function for dynamic filtering |

### Implementation Status

| Component | Enabled | Modes | DefaultBots | Regex | CustomFilter | Logging |
|-----------|---------|-------|-------------|-------|--------------|---------|
| SDK Node | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SDK Python | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SDK Go | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SDK PHP | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SDK Ruby | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bridge Server | ✅ | ✅ | ✅ | ✅ | ⬜ | ✅ |
| SaaS (pocketping-app) | ✅ | ✅ | ✅ | ✅ | ⬜ | ✅ |

---

## Platform Integrations

Plugins and integrations for popular platforms:

| Platform | Type | Package/Plugin | Features |
|----------|------|----------------|----------|
| WordPress | Plugin | `pocketping` | Settings page, auto-inject widget |
| Shopify | App | TBD | Coming soon |
| Webflow | Embed | Manual | CDN script |

### Implementation Status

| Platform | Settings UI | Widget Injection | User Auth | E-commerce |
|----------|-------------|------------------|-----------|------------|
| WordPress | ✅ | ✅ | ⬜ | ⬜ |
| Shopify | ⬜ | ⬜ | ⬜ | ⬜ |

---

## How to Add a New Feature

1. **Update this checklist FIRST** - Add the feature to the relevant table
2. **Mark all components as ⬜** - Indicate not yet implemented
3. **Implement in each component** - Update to ✅ as you go
4. **Verify consistency** - Ensure same behavior across all SDKs

---

## Files to Update When Adding SessionMetadata Fields

```
packages/sdk-python/src/pocketping/models.py      # SessionMetadata class
packages/sdk-python/src/pocketping/fastapi.py     # Server-side enrichment
packages/sdk-node/src/types.ts                    # SessionMetadata interface
packages/sdk-node/src/pocketping.ts               # Server-side enrichment
bridge-server/src/types.ts                        # SessionMetadata interface
packages/widget/src/client.ts                     # Client-side metadata collection
```

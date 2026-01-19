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
| WS | `/stream` | Real-time events (optional) |

### Implementation Status

| Component | /connect | /message | /messages | /typing | /presence | /stream |
|-----------|----------|----------|-----------|---------|-----------|---------|
| SDK Python | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SDK Node | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

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

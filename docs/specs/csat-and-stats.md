# Spec: CSAT + Mini-Stats

Status: **Draft for review** · Owner: @abonur

Two small, high-value features that **reinforce** PocketPing's thesis ("answer from
your messaging app, no operator dashboard") instead of betraying it. Both reuse
machinery we already shipped (operator commands, the widget↔server SSE request
pattern, webhooks, the `/api/v1` + MCP surface, the CLI box renderer).

Guiding rule: **never require an operator dashboard to *use* a feature.** A SaaS
score panel is a nice-to-have on top, not the primary UX.

---

## Part 1 — CSAT (post-conversation rating)

### What it is
After a conversation, the **visitor rates it in the widget**; the result lands in
**your messaging-app thread**, fires a **webhook**, and is readable via **API/MCP**.

### Rating scale — DECISION
**5-point emoji** (😡 😕 😐 🙂 😍 → 1–5) + optional free-text comment.
- Computes the industry-standard **CSAT% = ratings ≥ 4 / total** (parity with
  Chatwoot/Intercom/Crisp).
- Visually light; one tap to answer, comment optional.
- (Alternative considered: 👍/👎. Simpler but loses the numeric score competitors
  report. Rejected.)

### Triggers — DECISION
1. **Operator command `!csat`** (manual) — add to the existing command registry
   (`lib/bridges/commands.ts`). You type `!csat` from Telegram/Slack → the widget
   shows the rating card. Fits "control from your messaging app" perfectly.
2. **Auto** (per-project setting `csatTrigger`): `off` | `on_disconnect` |
   `manual_only`. Default **`on_disconnect`** — ask only when the session **had at
   least one operator reply** (never ask an unanswered visitor). Debounced: one
   request per session, not re-asked if already answered.

### Data model (Prisma — `Project` + `Session`)
```prisma
model Project {
  // …
  csatEnabled   Boolean      @default(false)
  csatTrigger   CsatTrigger  @default(ON_DISCONNECT)
}
enum CsatTrigger { OFF ON_DISCONNECT MANUAL_ONLY }

model Session {
  // …
  csatPending     Boolean   @default(false)  // a request is awaiting an answer
  csatScore       Int?                        // 1..5
  csatComment     String?
  csatRequestedAt DateTime?
  csatRespondedAt DateTime?
}
```
No separate request table (unlike screenshots, which had an async capture/upload
lifecycle). CSAT is "show a form, store a number" → flags on `Session` are enough;
`csatPending` lets a reconnecting widget re-show the card.

### Flow
```
operator types !csat  (or session disconnects, answered, csatTrigger=on_disconnect)
   └─► server sets Session.csatPending=true, csatRequestedAt=now
        └─► SSE event `csat_request` → widget
             └─► widget shows rating card  (re-shown on reconnect while pending)
                  └─► visitor submits  → POST /api/widget/[projectId]/csat
                       { sessionId, score, comment? }
                       ├─ store score/comment, csatPending=false, csatRespondedAt=now
                       ├─ notify bridges  → thread: "⭐ 5/5 — '…'"
                       └─ dispatch webhook `csat_submitted`
```

### Widget UX
A compact card (reuse `pp-prechat-*` styles): heading "How was our help?", five
emoji faces, optional "Tell us more…" textarea, **Submit** / dismiss. Lives in the
widget package → **shared across all 3 deploy modes** automatically.

### Server endpoints (SaaS)
- `POST /api/widget/[projectId]/csat` — visitor submit (origin-validated, rate-limited).
- SSE `csat_request` emitted from the existing widget stream (alongside
  `screenshot_request`).

### Bridge notification
To the session's topic/thread: `⭐ {face} {score}/5 — "{comment}"` (or
`⭐ {score}/5` when no comment). One line, like the screenshot caption.

### Webhook
New event **`csat_submitted`**: `{ type, data: { sessionId, score, comment, respondedAt }, sentAt }`.
Add to `lib/webhooks.ts` `WebhookEventType`, the dashboard Webhooks event list, and
`docs-site/docs/webhooks.md`.

### API / MCP
- `/api/v1/sessions` + `/sessions/:id` serializers include `csat: { score, comment, at }`.
- `list_sessions` gains an optional `minCsat` / `unrated` filter (cheap).
- The aggregate CSAT% is surfaced via **stats** (Part 2), not a new MCP tool.

### Dashboard
- Project → Settings → a "Customer satisfaction (CSAT)" card: enable toggle +
  trigger select (off / on disconnect / manual only).
- The **score** shows in the stats panel (Part 2), not its own page.

### Deploy-mode parity (per CLAUDE.md)
| Piece | SaaS | bridge-server | SDK |
|---|---|---|---|
| Widget rating card | shared (widget pkg) | shared | shared |
| `csat_request` SSE | ✅ phase 1 | phase 2 | phase 3 (`emitCsatRequest`) |
| `/csat` ingest + store | ✅ phase 1 | phase 2 | phase 3 (`handleCsat`) |
| Bridge notif + webhook | ✅ phase 1 | phase 2 | n/a (customer owns) |
**Rollout: SaaS → bridge-server → SDKs** (same order the screenshot feature used;
screenshots shipped SaaS-only, so CSAT bridge-server/SDK parity is a follow-up, not
a launch blocker).

---

## Part 2 — Mini-stats

Small, honest numbers — **not** an analytics suite. One computation, four surfaces.

### Metrics (v1)
- **Conversations** (sessions) in period + sparkline.
- **Messages** in period.
- **Response rate** = % of sessions that received ≥1 operator reply.
- **Median first-response time** (visitor first msg → first operator msg).
- **Unanswered now** (open sessions with `unreadCount > 0`).
- **CSAT%** (≥4 ratings / responses) + response count.
- Optional breakdown **by bridge** (where replies came from) and **by project**.

### Computation
A single `computeStats(orgId|projectId, period)` over `Session`/`Message`
(`lib/stats.ts` in SaaS; mirrored in the bridge-server store). Period = `7d`|`30d`.
No charting dependency — render **inline SVG sparklines** (on-brand, ~lines of code).

### Surfaces — DECISION (one source, many views)
1. **`GET /api/v1/stats?projectId=&period=`** → JSON. The single source of truth;
   everything else renders this.
2. **SaaS dashboard** — a compact "Overview" panel: number cards + a sparkline.
   Lightweight, no new heavy deps.
3. **MCP tool `get_stats`** → returns the JSON. Agent: *"how's support doing this
   week?"* / *"which project has the worst CSAT?"*.
4. **CLI `pocketping stats`** — reads `POCKETPING_API_KEY` (+ `POCKETPING_API_URL`,
   like the MCP) and prints a table using the CLI's **existing box renderer**
   (`src/utils/ui.ts`). Works against SaaS or a self-hosted instance via the URL.

### SaaS vs self-hosted
- **SaaS**: `computeStats` over the central DB → `/api/v1/stats` → dashboard + MCP + CLI.
- **Self-host (bridge-server)**: expose `GET /stats` on the bridge-server (over its
  in-memory/Redis store) → consumable by the **same** CLI/MCP/API shape by pointing
  `POCKETPING_API_URL` at the instance. No dashboard needed — the CLI *is* the view.
- **Self-host (SDK)**: the customer owns the DB. Ship an SDK helper
  `getStats({ from, to })` they can wire into their own admin. We don't render it.

### Why this composition
- Reuses the **`/api/v1` + API-key auth** we just built (stats = one more endpoint).
- Reuses the **MCP** (one more read tool) and the **CLI box renderer**.
- Gives self-hosters real stats **without** us building a dashboard for them — the
  CLI/MCP are the cross-mode view. This is the PocketPing-shaped answer to "Chatwoot
  has reports."

---

## Rollout phases
1. **CSAT (SaaS)** — ✅ shipped. Schema, widget card, `!csat` + on-disconnect
   trigger, `/csat`, bridge notif, `csat_submitted` webhook, settings card.
2. **Stats (SaaS)** — ✅ shipped. `lib/stats.ts`, `/api/v1/stats`, dashboard panel,
   `get_stats` MCP tool, `pocketping stats` CLI.
3. **Self-host parity** —
   - **SDKs (Node, Python, Go, PHP, Ruby)** — ✅ shipped. Each gains `requestCsat`
     (push `csat_request`), `handleCsat` (store + bridge one-liner + `csat_submitted`
     webhook + `onCsat`), the `csat` widget route, and `getStats({from,to})` over an
     optional `listSessions` storage method.
   - **bridge-server** — 🟡 partial. The Go bridge-server is a **stateless relay**
     (messages-by-id only, no sessions/`createdAt`).
     - ✅ **`csat_submitted` relay** shipped: an incoming `csat_submitted` event on
       `/api/events` notifies the session's bridge thread (`⭐ {face} {score}/5 — "…"`)
       and forwards a `csat_submitted` events-webhook — same notification + payload as
       SaaS/SDK. The `csat_request` outgoing event type is also defined (emittable via
       `EmitEvent` over SSE).
     - ✅ **`!csat` operator command** shipped: a minimal operator-command parser
       (`internal/api/commands.go`) intercepts operator messages from a bridge thread;
       `!csat` emits a `csat_request` SSE event for that session (and is consumed, not
       relayed to the visitor). Unknown `!`-commands fall through to normal relay.
     - ⏳ **Still deferred**: `GET /stats` (needs a session store with `createdAt`,
       which the relay doesn't keep). A separate effort, not a port.

## Open questions (for review)
- CSAT scale: confirm **5-emoji** (vs thumbs)?
- Auto-trigger default: confirm **`on_disconnect`, answered-only**?
- Parity: ship **SaaS-first** (like screenshots) and treat bridge-server/SDK as a
  later phase — OK?
- `pocketping stats` in the CLI: good, or keep the CLI strictly setup-only and leave
  stats to MCP + dashboard?

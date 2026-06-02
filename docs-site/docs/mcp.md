---
title: MCP server
description: Manage and answer your PocketPing live chats from Claude, Cursor, or any Model Context Protocol client.
---

# MCP server

The **`@pocketping/mcp`** server connects PocketPing to any
[Model Context Protocol](https://modelcontextprotocol.io) client — Claude Desktop,
Cursor, and a growing list of AI tools — so your assistant can **triage your inbox and
actually reply to visitors**.

Unlike read-only support integrations, a PocketPing reply sent through the MCP fans out
to the **chat widget *and* every connected bridge** (Telegram/Discord/Slack) — your
assistant closes the loop, it doesn't just summarize.

## Setup

First, create an API key: dashboard → **Settings → API keys** → *Create key*. Copy it
(it's shown once).

### Hosted (recommended)

The fastest path — no install. Add a **custom connector** pointing at the hosted server
and authenticate with your key as a Bearer token.

- **Connector URL:** `https://app.pocketping.io/api/mcp`
- **Auth:** `Authorization: Bearer ppk_…`

For config-file clients (Claude Desktop, Cursor):

```json
{
  "mcpServers": {
    "pocketping": {
      "url": "https://app.pocketping.io/api/mcp",
      "headers": { "Authorization": "Bearer ppk_your_key_here" }
    }
  }
}
```

The endpoint speaks **Streamable HTTP** (the current MCP transport; legacy SSE is
disabled). Some clients — notably the Claude web connector UI — currently expect OAuth
rather than a Bearer header; use Cursor, Claude Desktop, the Claude API connector, or the
local option below until OAuth lands.

### Local (npx)

Prefer to run it on your machine, or self-hosting PocketPing? Use the
[`@pocketping/mcp`](https://www.npmjs.com/package/@pocketping/mcp) package over stdio:

```json
{
  "mcpServers": {
    "pocketping": {
      "command": "npx",
      "args": ["-y", "@pocketping/mcp"],
      "env": {
        "POCKETPING_API_KEY": "ppk_your_key_here",
        "POCKETPING_API_URL": "https://app.pocketping.io"
      }
    }
  }
}
```

Self-hosting? Point `POCKETPING_API_URL` at your own instance.

## Tools

| Tool | Read/write | What it does |
|---|---|---|
| `list_projects` | read | List your projects |
| `list_sessions` | read | List conversations — filter by `projectId`, `status`, `unanswered`, or a search `q` |
| `get_conversation` | read | Full transcript + visitor details for one session |
| `send_reply` | **write** | Send a real reply to a visitor (widget + all bridges) |

`send_reply` is the only write tool and is marked non-read-only, so well-behaved clients
ask you to confirm before it sends.

## Prompts

| Prompt | What it does |
|---|---|
| `triage_unanswered` | Summarize chats awaiting a reply and propose drafts |
| `draft_reply` | Draft (but not send) a reply for a specific conversation |

## Example

> **You:** Summarize my unanswered PocketPing chats and draft a reply to each.
>
> *The assistant calls `list_sessions(unanswered=true)`, then `get_conversation` on each,
> summarizes, and proposes drafts. You approve one, and it calls `send_reply` — the visitor
> sees it in the widget, and it lands in your Telegram/Slack thread too.*

## Security

- Keys are **organization-scoped**, **hashed at rest**, and **revocable** at any time from
  the dashboard (Settings → API keys).
- The server talks to the authenticated [`/api/v1`](/api) management API over HTTPS.
- Rate-limited to 600 requests/minute per key.

## Behind the scenes

Both modes expose the same tools. The hosted endpoint (`/api/mcp`) runs in-process; the
npx package is a thin stdio wrapper over the same [`/api/v1`](/api) management API. So
anything the MCP can do, your own scripts and agents can do too with the same API key.

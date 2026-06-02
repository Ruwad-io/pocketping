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

1. Create an API key: dashboard → **Settings → API keys** → *Create key*. Copy it (it's
   shown once).
2. Add the server to your MCP client.

**Claude Desktop / Cursor** — add to `claude_desktop_config.json` or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pocketping": {
      "command": "npx",
      "args": ["-y", "@pocketping/mcp"],
      "env": { "POCKETPING_API_KEY": "ppk_your_key_here" }
    }
  }
}
```

Self-hosting PocketPing? Point the server at your instance:

```json
"env": {
  "POCKETPING_API_KEY": "ppk_…",
  "POCKETPING_API_URL": "https://your-pocketping.example.com"
}
```

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

The MCP server is a thin stdio wrapper over the PocketPing management API. Every tool maps
to a `/api/v1` endpoint, so anything the MCP can do, your own scripts and agents can do too
with the same API key.

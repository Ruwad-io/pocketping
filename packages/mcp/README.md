# @pocketping/mcp

[![npm](https://img.shields.io/npm/v/@pocketping/mcp.svg)](https://www.npmjs.com/package/@pocketping/mcp)
[![license](https://img.shields.io/npm/l/@pocketping/mcp.svg)](https://github.com/Ruwad-io/pocketping/blob/main/LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server for
[PocketPing](https://pocketping.io) — **triage and answer your live chats from Claude,
Cursor, or any MCP client.**

Because a PocketPing reply fans out to the widget *and* every connected bridge
(Telegram/Discord/Slack), your AI assistant can actually close the loop with a visitor —
not just read transcripts.

## Setup

1. Create an API key in your PocketPing dashboard → **Settings → API keys**.
2. Add the server to your MCP client.

**Claude Desktop / Cursor** (`claude_desktop_config.json` or `.cursor/mcp.json`):

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

Self-hosting? Point the server at your instance with `POCKETPING_API_URL`
(defaults to `https://app.pocketping.io`).

## Tools

| Tool | What it does |
|---|---|
| `list_projects` | List your projects |
| `list_sessions` | List conversations — filter by project, status, `unanswered`, or a search `q` |
| `get_conversation` | Full transcript + visitor details for one session |
| `get_stats` | Mini support stats (conversations, response rate, CSAT%, …) |
| `get_project` | Read a project's settings (anti-bot / notification toggles, filters, CSAT) |
| `update_project` | **Update** a project's toggles — bot heuristics, `*NotifyPresence`, UA/IP filters, CSAT |
| `send_reply` | **Send a real reply to a visitor** (widget + all bridges) |

## Prompts

| Prompt | What it does |
|---|---|
| `triage_unanswered` | Summarize chats awaiting a reply and propose drafts |
| `draft_reply` | Draft (not send) a reply for a specific conversation |

## Try it

> "Use PocketPing to summarize my unanswered chats and draft a reply to each."

`send_reply` is the only write tool and is marked non-read-only; well-behaved clients
will ask you to confirm before it sends. Keys are org-scoped and revocable from the
dashboard.

## License

MIT

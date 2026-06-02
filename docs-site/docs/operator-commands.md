---
title: Operator commands
description: Trigger actions on a live chat right from Telegram, Discord or Slack by typing a !command — including on-demand screen capture.
---

# Operator commands

When you reply to a visitor from your bridge (Telegram, Discord or Slack), you can also
**run commands** by sending a message that starts with `!`. Commands are intercepted by
PocketPing and are never forwarded to the visitor.

```
!help
```

| Command | Aliases | What it does |
|---|---|---|
| `!screenshot` | `!ss` | Capture the visitor's current screen and post it in the chat |
| `!screenshotsilent` | `!sss` | Capture the visitor's screen **without** showing it in the widget chat |
| `!help` | `!h`, `!commands` | List the available commands |

:::info Availability
Operator commands run on the **hosted SaaS** (pocketping.io). The standalone
bridge-server doesn't ship them yet.
:::

## Screen capture (`!ss` / `!sss`)

Type `!ss` in the visitor's thread and PocketPing asks the widget to render the
visitor's **current viewport** to an image (via `html2canvas`) and upload it. The
operator who asked receives the screenshot back in the thread — handy for "I can't
see what you're seeing" support moments.

- `!ss` also posts the capture into the widget chat, so the visitor sees that a
  screenshot was taken.
- `!sss` is **silent** — the capture is sent to your bridge only and is not shown
  in the widget.

### Turning it on

Screen capture is **off by default**. Enable it per project:

**Dashboard → your project → Settings → Operator commands → Screen capture.**

### Your responsibilities (please read)

Capturing a visitor's screen processes their personal data, and the silent variant
does so without an on-screen indication. Before you enable it:

- **Disclose it.** Add screen capture to your privacy policy / notice.
- **Have a lawful basis.** Under GDPR/ePrivacy and similar laws this usually means
  visitor **consent**. Don't capture screens you have no basis to capture.
- **Minimise.** Use `!ss` (visible) rather than `!sss` unless you have a specific,
  documented reason for silent capture.

PocketPing gives you the switch; using it compliantly is your call as the site owner.

## Adding your own commands (self-hosted)

Operator commands are defined in a small registry, so adding one is a single object —
no dispatch wiring to touch:

```ts
// lib/bridges/commands.ts
const COMMANDS = [
  // …existing commands…
  {
    name: 'note',
    aliases: ['n'],
    summary: 'Attach a private note to this session',
    run: async ({ sessionId, args }) => {
      await saveNote(sessionId, args.join(' '))
      return { handled: true, reply: '📝 Note saved.' }
    },
  },
]
```

Each command receives `{ sessionId, operatorName, sourceBridge, args }` and returns
`{ handled, error?, reply? }`. The `reply` is sent back to the operator; `!help`
picks up your new command automatically.

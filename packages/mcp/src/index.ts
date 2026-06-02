#!/usr/bin/env node

import { createRequire } from 'module'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { PocketPingClient } from './client.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

const apiKey = process.env.POCKETPING_API_KEY
const baseUrl = (process.env.POCKETPING_API_URL || 'https://app.pocketping.io').replace(/\/$/, '')

if (!apiKey) {
  // stderr only — stdout is reserved for the JSON-RPC stream.
  console.error(
    'POCKETPING_API_KEY is not set. Create a key in your PocketPing dashboard ' +
      '(Settings → API keys) and pass it via the POCKETPING_API_KEY environment variable.'
  )
  process.exit(1)
}

const client = new PocketPingClient(apiKey, baseUrl)

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}
function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true }
}

const server = new McpServer({ name: 'pocketping', version })

server.registerTool(
  'list_projects',
  {
    title: 'List projects',
    description: 'List the PocketPing projects in your organization (id, name, domain, session count).',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      return ok(await client.listProjects())
    } catch (e) {
      return fail(e)
    }
  }
)

server.registerTool(
  'list_sessions',
  {
    title: 'List conversations',
    description:
      'List chat conversations. Use unanswered=true to see only chats awaiting an operator reply, ' +
      'or q to search visitor name/email and message text.',
    inputSchema: {
      projectId: z.string().optional().describe('Restrict to a single project'),
      status: z.enum(['active', 'closed', 'archived']).optional(),
      unanswered: z.boolean().optional().describe('Only conversations awaiting a reply'),
      q: z.string().optional().describe('Search visitor name/email and message content'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 25)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      return ok(await client.listSessions(args))
    } catch (e) {
      return fail(e)
    }
  }
)

server.registerTool(
  'get_conversation',
  {
    title: 'Get a conversation',
    description: 'Fetch a full conversation: visitor details and every message in order.',
    inputSchema: { sessionId: z.string().describe('The session id') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ sessionId }) => {
    try {
      return ok(await client.getConversation(sessionId))
    } catch (e) {
      return fail(e)
    }
  }
)

server.registerTool(
  'send_reply',
  {
    title: 'Reply to a visitor',
    description:
      'Send an operator reply to a visitor. This is a real, visitor-facing message: it appears in ' +
      'the chat widget and every connected bridge (Telegram/Discord/Slack). Confirm with the user ' +
      'before sending unless they explicitly asked you to reply.',
    inputSchema: {
      sessionId: z.string().describe('The session to reply in'),
      content: z.string().min(1).max(4000).describe('The message to send to the visitor'),
      operatorName: z.string().optional().describe('Display name for the reply (defaults to the project operator)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ sessionId, content, operatorName }) => {
    try {
      return ok(await client.reply(sessionId, content, operatorName))
    } catch (e) {
      return fail(e)
    }
  }
)

server.registerPrompt(
  'triage_unanswered',
  {
    title: 'Triage unanswered chats',
    description: 'Summarize the conversations currently awaiting a reply and suggest next actions.',
    argsSchema: { projectId: z.string().optional() },
  },
  ({ projectId }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Use list_sessions with unanswered=true${projectId ? ` and projectId="${projectId}"` : ''} ` +
            `to find chats awaiting a reply. For each, fetch the conversation, summarize what the ` +
            `visitor needs, flag anything urgent, and propose a draft reply. Do not send anything yet.`,
        },
      },
    ],
  })
)

server.registerPrompt(
  'draft_reply',
  {
    title: 'Draft a reply',
    description: 'Draft (but do not send) a reply for a specific conversation.',
    argsSchema: { sessionId: z.string() },
  },
  ({ sessionId }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Fetch conversation "${sessionId}" with get_conversation, then draft a helpful, concise ` +
            `reply in the visitor's language. Show me the draft and wait for my approval before using send_reply.`,
        },
      },
    ],
  })
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`PocketPing MCP server running (api: ${baseUrl})`)
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e)
  process.exit(1)
})

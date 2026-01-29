/**
 * Slack Bridge - Direct HTTP API integration
 * Community Edition - Simplified version
 */

import type { SessionInfo, AttachmentData, SlackConfig } from './types'

const SLACK_API = 'https://slack.com/api'

interface SlackResponse<T = unknown> {
  ok: boolean
  error?: string
  ts?: string
  channel?: string
  message?: T
  response_metadata?: { messages?: string[] }
}

export interface SlackConfig {
  botToken: string
  channelId: string
}

async function slackRequest<T>(
  botToken: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<SlackResponse<T>> {
  try {
    const response = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(params),
    })

    const data: SlackResponse<T> = await response.json()

    if (!data.ok) {
      console.error(`[Slack] API error on ${method}: ${data.error}`)
    }

    return data
  } catch (error) {
    console.error(`[Slack] Request failed: ${method}`, error)
    return { ok: false, error: 'request_failed' }
  }
}

interface SlackBlock {
  type: string
  text?: { type: string; text: string; emoji?: boolean }
  image_url?: string
  alt_text?: string
  title?: { type: string; text: string; emoji?: boolean }
  accessory?: unknown
  elements?: unknown[]
  fields?: { type: string; text: string }[]
}

/**
 * Create a thread for a new session
 */
export async function createThread(
  config: SlackConfig,
  session: SessionInfo
): Promise<string | null> {
  const welcomeBlocks = buildSessionBlocks(session)

  const result = await slackRequest(config.botToken, 'chat.postMessage', {
    channel: config.channelId,
    text: `🆕 New conversation from ${session.userName || session.userEmail || `visitor ${session.id.slice(0, 8)}`}`,
    blocks: welcomeBlocks,
  })

  if (!result.ok || !result.ts) return null
  return result.ts
}

/**
 * Send a message to a thread
 */
export async function sendMessageToThread(
  config: SlackConfig,
  threadTs: string,
  text: string
): Promise<string | null> {
  const result = await slackRequest(config.botToken, 'chat.postMessage', {
    channel: config.channelId,
    thread_ts: threadTs,
    text,
  })

  return result.ok ? (result.ts ?? null) : null
}

/**
 * Send a message with blocks to a thread
 */
export async function sendMessageWithBlocksToThread(
  config: SlackConfig,
  threadTs: string,
  text: string,
  blocks: SlackBlock[]
): Promise<string | null> {
  const result = await slackRequest(config.botToken, 'chat.postMessage', {
    channel: config.channelId,
    thread_ts: threadTs,
    text,
    blocks,
    unfurl_links: true,
    unfurl_media: true,
  })

  return result.ok ? (result.ts ?? null) : null
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function getFileEmoji(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.startsWith('audio/')) return '🎵'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType === 'application/pdf') return '📄'
  return '📎'
}

function buildAttachmentBlocks(attachments: AttachmentData[]): SlackBlock[] {
  const blocks: SlackBlock[] = []

  for (const attachment of attachments) {
    const { mimeType, url, filename, size } = attachment
    const sizeStr = formatFileSize(size)
    const emoji = getFileEmoji(mimeType)

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} <${url}|${filename}> (${sizeStr})`,
      },
    })
  }

  return blocks
}

/**
 * Check if a thread exists
 */
export async function threadExists(config: SlackConfig, threadTs: string): Promise<boolean> {
  const result = await slackRequest<{ messages: unknown[] }>(
    config.botToken,
    'conversations.history',
    {
      channel: config.channelId,
      latest: threadTs,
      oldest: threadTs,
      inclusive: true,
      limit: 1,
    }
  )

  if (!result.ok) return false

  const messages = (result as unknown as { messages?: unknown[] }).messages
  return !!(messages && messages.length > 0)
}

/**
 * Send visitor message to Slack
 */
export async function sendVisitorMessage(
  config: SlackConfig,
  threadTs: string,
  content: string,
  visitorName?: string,
  sessionInfo?: SessionInfo,
  attachments?: AttachmentData[],
  replyQuote?: string
): Promise<{ messageTs: string | null; newThreadTs?: string }> {
  const displayName = visitorName || 'Visitor'
  const hasContent = content && content.trim().length > 0
  const hasAttachments = attachments && attachments.length > 0

  const blocks: SlackBlock[] = []

  // Reply quote
  if (replyQuote) {
    const quoted = replyQuote.split('\n').map((line) => `> ${line}`).join('\n')
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: quoted },
    })
  }

  // Header with visitor name
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: hasContent ? `👤 *${displayName}:*\n\n${content}` : `👤 *${displayName}*`,
    },
  })

  // Attachments
  if (hasAttachments) {
    blocks.push(...buildAttachmentBlocks(attachments!))
  }

  const baseText = hasContent
    ? `👤 ${displayName}: ${content}`
    : `👤 ${displayName} sent ${attachments?.length || 0} file(s)`
  const fallbackText = replyQuote ? `> ${replyQuote}\n${baseText}` : baseText

  let newThreadTs: string | undefined
  let activeThreadTs = threadTs

  // Check if thread exists
  const exists = await threadExists(config, threadTs)
  if (!exists && sessionInfo) {
    const recreatedThreadTs = await createThread(config, sessionInfo)
    if (recreatedThreadTs) {
      newThreadTs = recreatedThreadTs
      activeThreadTs = recreatedThreadTs
    } else {
      return { messageTs: null }
    }
  }

  const messageTs = await sendMessageWithBlocksToThread(config, activeThreadTs, fallbackText, blocks)
  return { messageTs, newThreadTs }
}

/**
 * Edit a message in a thread
 */
export async function editMessageInThread(
  config: SlackConfig,
  messageTs: string,
  newContent: string,
  visitorName?: string
): Promise<boolean> {
  const displayName = visitorName || 'Visitor'

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `👤 *${displayName}:*\n\n${newContent}\n\n_✏️ edited_`,
      },
    },
  ]

  const result = await slackRequest(config.botToken, 'chat.update', {
    channel: config.channelId,
    ts: messageTs,
    text: `👤 ${displayName}: ${newContent} (edited)`,
    blocks,
  })

  return result.ok
}

/**
 * Delete a message in a thread
 */
export async function deleteMessageInThread(
  config: SlackConfig,
  messageTs: string
): Promise<boolean> {
  const result = await slackRequest(config.botToken, 'chat.delete', {
    channel: config.channelId,
    ts: messageTs,
  })

  return result.ok
}

/**
 * Add reaction to a message
 */
export async function addReaction(
  config: SlackConfig,
  threadTs: string,
  emoji: string
): Promise<boolean> {
  const result = await slackRequest(config.botToken, 'reactions.add', {
    channel: config.channelId,
    timestamp: threadTs,
    name: emoji.replace(/:/g, ''),
  })

  return result.ok
}

/**
 * Get bot info
 */
export async function getBotInfo(
  botToken: string
): Promise<{ user_id: string; user: string; team_id: string } | null> {
  const result = await slackRequest<{ user_id: string; user: string; team_id: string }>(
    botToken,
    'auth.test'
  )

  if (!result.ok) return null

  return {
    user_id: (result as unknown as { user_id: string }).user_id,
    user: (result as unknown as { user: string }).user,
    team_id: (result as unknown as { team_id: string }).team_id,
  }
}

/**
 * Get user info
 */
export async function getUserInfo(
  botToken: string,
  userId: string
): Promise<{ id: string; name: string; real_name?: string } | null> {
  const result = await slackRequest<{ user: { id: string; name: string; real_name?: string } }>(
    botToken,
    'users.info',
    { user: userId }
  )

  if (!result.ok) return null

  return (result as unknown as { user: { id: string; name: string; real_name?: string } }).user
}

// Helpers

function buildSessionBlocks(session: SessionInfo): SlackBlock[] {
  const blocks: SlackBlock[] = []

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '🆕 New conversation', emoji: true },
  })

  if (session.userName || session.userEmail || session.userPhone || session.userAgent) {
    const fields: { type: string; text: string }[] = []
    if (session.userName) fields.push({ type: 'mrkdwn', text: `*Name:*\n${session.userName}` })
    if (session.userEmail) fields.push({ type: 'mrkdwn', text: `*Email:*\n${session.userEmail}` })
    if (session.userPhone) fields.push({ type: 'mrkdwn', text: `*Phone:*\n${session.userPhone}` })
    if (session.userAgent) fields.push({ type: 'mrkdwn', text: `*Device:*\n${parseUserAgent(session.userAgent)}` })
    blocks.push({ type: 'section', fields })
  }

  const infoFields: { type: string; text: string }[] = [
    { type: 'mrkdwn', text: `*Session:*\n\`${session.id.slice(0, 8)}...\`` },
  ]

  if (session.url) infoFields.push({ type: 'mrkdwn', text: `*Page:*\n${session.url}` })

  const locationParts: string[] = []
  if (session.city) locationParts.push(session.city)
  if (session.country) locationParts.push(session.country)
  if (locationParts.length > 0) {
    infoFields.push({ type: 'mrkdwn', text: `*Location:*\n${locationParts.join(', ')}` })
  }

  blocks.push({ type: 'section', fields: infoFields.slice(0, 10) })
  blocks.push({ type: 'divider' })
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '_Reply in this thread to communicate with the visitor._' }],
  })

  return blocks
}

function parseUserAgent(ua: string): string {
  let browser = 'Unknown'
  if (ua.includes('Firefox/')) browser = 'Firefox'
  else if (ua.includes('Edg/')) browser = 'Edge'
  else if (ua.includes('Chrome/')) browser = 'Chrome'
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari'
  else if (ua.includes('Opera') || ua.includes('OPR/')) browser = 'Opera'

  let os = 'Unknown'
  if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Mac OS')) os = 'macOS'
  else if (ua.includes('Linux') && !ua.includes('Android')) os = 'Linux'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'

  return `${browser}/${os}`
}

// Webhook types
export interface SlackFile {
  id: string
  name: string
  mimetype: string
  size: number
  url_private: string
  url_private_download?: string
}

export interface SlackEvent {
  type: string
  event?: {
    type: string
    channel?: string
    user?: string
    text?: string
    ts?: string
    thread_ts?: string
    bot_id?: string
    files?: SlackFile[]
  }
  challenge?: string
}

export interface ParsedSlackEvent {
  type: 'challenge' | 'message' | 'unknown'
  challenge?: string
  channelId?: string
  userId?: string
  text?: string
  threadTs?: string
  isBot?: boolean
  files?: SlackFile[]
}

export function parseSlackEvent(event: SlackEvent): ParsedSlackEvent {
  if (event.type === 'url_verification' && event.challenge) {
    return { type: 'challenge', challenge: event.challenge }
  }

  if (event.type === 'event_callback' && event.event?.type === 'message') {
    const msg = event.event
    if (msg.bot_id) return { type: 'unknown' }
    if (!msg.thread_ts) return { type: 'unknown' }

    return {
      type: 'message',
      channelId: msg.channel,
      userId: msg.user,
      text: msg.text,
      threadTs: msg.thread_ts,
      isBot: !!msg.bot_id,
      files: msg.files,
    }
  }

  return { type: 'unknown' }
}

export async function downloadSlackFile(
  botToken: string,
  file: SlackFile
): Promise<{ buffer: Buffer; url: string } | null> {
  const downloadUrl = file.url_private_download || file.url_private

  try {
    const response = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${botToken}` },
    })

    if (!response.ok) return null

    const arrayBuffer = await response.arrayBuffer()
    return { buffer: Buffer.from(arrayBuffer), url: downloadUrl }
  } catch {
    return null
  }
}

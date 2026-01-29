/**
 * Discord Bridge - Direct HTTP API integration
 * Community Edition - Simplified version
 */

import type { SessionInfo, AttachmentData, DiscordConfig } from './types'

const DISCORD_API = 'https://discord.com/api/v10'

interface DiscordThread {
  id: string
  name: string
  type: number
}

interface DiscordMessage {
  id: string
  channel_id: string
  content: string
  author: {
    id: string
    username: string
    discriminator: string
  }
  timestamp: string
}

export interface DiscordConfig {
  botToken: string
  channelId: string
}

async function discordRequest<T>(
  botToken: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>
): Promise<T | null> {
  try {
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
    }

    if (body) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(`${DISCORD_API}${endpoint}`, options)

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      console.error(`[Discord] API error on ${method} ${endpoint}: ${response.status}`, error)
      return null
    }

    if (response.status === 204) {
      return {} as T
    }

    return await response.json()
  } catch (error) {
    console.error(`[Discord] Request failed: ${method} ${endpoint}`, error)
    return null
  }
}

interface DiscordEmbed {
  title?: string
  description?: string
  url?: string
  color?: number
  image?: { url: string }
  thumbnail?: { url: string }
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: { text: string }
}

/**
 * Create a thread for a new session
 */
export async function createThread(
  config: DiscordConfig,
  session: SessionInfo
): Promise<string | null> {
  let threadName: string
  if (session.userName) {
    threadName = `💬 ${session.userName.slice(0, 90)}`
  } else if (session.userEmail) {
    threadName = `💬 ${session.userEmail.split('@')[0].slice(0, 90)}`
  } else {
    const pageInfo = session.url?.split('/').pop()?.split('?')[0]?.slice(0, 50) || ''
    threadName = pageInfo
      ? `💬 ${session.id.slice(0, 8)} • ${pageInfo}`
      : `💬 Session ${session.id.slice(0, 8)}`
  }

  const thread = await discordRequest<DiscordThread>(
    config.botToken,
    'POST',
    `/channels/${config.channelId}/threads`,
    {
      name: threadName,
      type: 11, // PUBLIC_THREAD
      auto_archive_duration: 1440,
    }
  )

  if (!thread?.id) return null

  // Send welcome message
  const welcomeText = buildSessionInfo(session)
  await sendMessageToThread(config, thread.id, welcomeText)

  return thread.id
}

/**
 * Send a message to a thread
 */
export async function sendMessageToThread(
  config: DiscordConfig,
  threadId: string,
  content: string,
  replyToMessageId?: string
): Promise<DiscordMessage | null> {
  return discordRequest<DiscordMessage>(
    config.botToken,
    'POST',
    `/channels/${threadId}/messages`,
    {
      content,
      ...(replyToMessageId ? { message_reference: { message_id: replyToMessageId } } : {}),
    }
  )
}

/**
 * Send a message with embeds to a thread
 */
export async function sendMessageWithEmbedsToThread(
  config: DiscordConfig,
  threadId: string,
  content: string,
  embeds: DiscordEmbed[],
  replyToMessageId?: string
): Promise<DiscordMessage | null> {
  return discordRequest<DiscordMessage>(
    config.botToken,
    'POST',
    `/channels/${threadId}/messages`,
    {
      content,
      embeds,
      ...(replyToMessageId ? { message_reference: { message_id: replyToMessageId } } : {}),
    }
  )
}

function buildAttachmentEmbed(attachment: AttachmentData): DiscordEmbed | null {
  const { mimeType, url, filename, size } = attachment

  const sizeStr =
    size < 1024
      ? `${size} B`
      : size < 1024 * 1024
        ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / (1024 * 1024)).toFixed(1)} MB`

  if (mimeType.startsWith('image/')) {
    return {
      image: { url },
      footer: { text: `📎 ${filename} (${sizeStr})` },
      color: 0x5865f2,
    }
  }

  return null
}

function formatAttachmentLink(attachment: AttachmentData): string {
  const { mimeType, url, filename, size } = attachment

  const sizeStr =
    size < 1024
      ? `${size} B`
      : size < 1024 * 1024
        ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / (1024 * 1024)).toFixed(1)} MB`

  let emoji = '📎'
  if (mimeType.startsWith('audio/')) emoji = '🎵'
  else if (mimeType.startsWith('video/')) emoji = '🎬'
  else if (mimeType === 'application/pdf') emoji = '📄'

  return `${emoji} [${filename}](${url}) (${sizeStr})`
}

/**
 * Check if a thread exists
 */
export async function threadExists(config: DiscordConfig, threadId: string): Promise<boolean> {
  const result = await discordRequest<DiscordThread>(
    config.botToken,
    'GET',
    `/channels/${threadId}`
  )
  return !!result
}

/**
 * Send visitor message to Discord
 */
export async function sendVisitorMessage(
  config: DiscordConfig,
  threadId: string,
  content: string,
  visitorName?: string,
  sessionInfo?: SessionInfo,
  attachments?: AttachmentData[],
  replyToMessageId?: string
): Promise<{ message: DiscordMessage | null; newThreadId?: string }> {
  const displayName = visitorName || 'Visitor'
  const hasContent = content && content.trim().length > 0
  const hasAttachments = attachments && attachments.length > 0

  const embeds: DiscordEmbed[] = []
  const fileLinks: string[] = []

  if (hasAttachments) {
    for (const attachment of attachments!) {
      const embed = buildAttachmentEmbed(attachment)
      if (embed) {
        embeds.push(embed)
      } else {
        fileLinks.push(formatAttachmentLink(attachment))
      }
    }
  }

  let text = `👤 **${displayName}:**`
  if (hasContent) {
    text += `\n\n${content}`
  }
  if (fileLinks.length > 0) {
    text += '\n\n' + fileLinks.join('\n')
  }

  let newThreadId: string | undefined
  let activeThreadId = threadId

  // Check if thread exists
  const exists = await threadExists(config, threadId)
  if (!exists && sessionInfo) {
    const recreatedThreadId = await createThread(config, sessionInfo)
    if (recreatedThreadId) {
      newThreadId = recreatedThreadId
      activeThreadId = recreatedThreadId
    } else {
      return { message: null }
    }
  }

  let message: DiscordMessage | null
  if (embeds.length > 0) {
    message = await sendMessageWithEmbedsToThread(config, activeThreadId, text, embeds, replyToMessageId)
  } else {
    message = await sendMessageToThread(config, activeThreadId, text, replyToMessageId)
  }

  return { message, newThreadId }
}

/**
 * Edit a message in a thread
 */
export async function editMessageInThread(
  config: DiscordConfig,
  threadId: string,
  messageId: string,
  newContent: string,
  visitorName?: string
): Promise<DiscordMessage | null> {
  const displayName = visitorName || 'Visitor'
  const text = `👤 **${displayName}:**\n\n${newContent}\n\n*✏️ edited*`

  return discordRequest<DiscordMessage>(
    config.botToken,
    'PATCH',
    `/channels/${threadId}/messages/${messageId}`,
    { content: text }
  )
}

/**
 * Delete a message in a thread
 */
export async function deleteMessageInThread(
  config: DiscordConfig,
  threadId: string,
  messageId: string
): Promise<boolean> {
  const result = await discordRequest(
    config.botToken,
    'DELETE',
    `/channels/${threadId}/messages/${messageId}`
  )
  return result !== null
}

/**
 * Archive a thread
 */
export async function archiveThread(config: DiscordConfig, threadId: string): Promise<boolean> {
  const result = await discordRequest<DiscordThread>(
    config.botToken,
    'PATCH',
    `/channels/${threadId}`,
    { archived: true }
  )
  return result !== null
}

/**
 * Get bot info
 */
export async function getBotInfo(
  botToken: string
): Promise<{ id: string; username: string } | null> {
  return discordRequest<{ id: string; username: string }>(botToken, 'GET', '/users/@me')
}

/**
 * Add reaction to a message
 */
export async function addReaction(
  config: DiscordConfig,
  channelId: string,
  messageId: string,
  emoji: string
): Promise<boolean> {
  const encodedEmoji = encodeURIComponent(emoji)
  const result = await discordRequest(
    config.botToken,
    'PUT',
    `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`
  )
  return result !== null
}

// Helpers

function buildSessionInfo(session: SessionInfo): string {
  let text = `🆕 **New conversation**\n\n`

  if (session.userName || session.userEmail || session.userPhone || session.userAgent) {
    if (session.userName) text += `👤 **${session.userName}**\n`
    if (session.userEmail) text += `📧 ${session.userEmail}\n`
    if (session.userPhone) text += `📱 ${session.userPhone}\n`
    if (session.userAgent) text += `🌐 ${parseUserAgent(session.userAgent)}\n`
    text += '\n'
  }

  text += `Session: \`${session.id.slice(0, 8)}...\``

  if (session.url) text += `\n📍 Page: ${session.url}`
  if (session.referrer) text += `\n↩️ From: ${session.referrer}`

  const locationParts: string[] = []
  if (session.city) locationParts.push(session.city)
  if (session.country) locationParts.push(session.country)
  if (locationParts.length > 0) {
    text += `\n🌍 Location: ${locationParts.join(', ')}`
  }

  text += '\n\n*Reply here to communicate with the visitor.*'

  return text
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

// Gateway types
export interface DiscordAttachment {
  id: string
  filename: string
  content_type?: string
  size: number
  url: string
  proxy_url: string
}

export interface DiscordGatewayEvent {
  t: string
  d: {
    id?: string
    channel_id?: string
    content?: string
    author?: {
      id: string
      username: string
      bot?: boolean
    }
    thread?: {
      id: string
      parent_id: string
    }
    attachments?: DiscordAttachment[]
  }
}

export interface ParsedGatewayMessage {
  isValid: boolean
  channelId?: string
  threadId?: string
  content?: string
  authorId?: string
  authorName?: string
  isBot?: boolean
  attachments?: DiscordAttachment[]
}

export function parseGatewayMessage(event: DiscordGatewayEvent): ParsedGatewayMessage {
  if (event.t !== 'MESSAGE_CREATE') {
    return { isValid: false }
  }

  const data = event.d
  const hasContent = data.content && data.content.length > 0
  const hasAttachments = data.attachments && data.attachments.length > 0

  if (!hasContent && !hasAttachments) {
    return { isValid: false }
  }

  if (!data.channel_id) {
    return { isValid: false }
  }

  if (data.author?.bot) {
    return { isValid: false }
  }

  return {
    isValid: true,
    channelId: data.channel_id,
    threadId: data.thread?.id,
    content: data.content || '',
    authorId: data.author?.id,
    authorName: data.author?.username,
    isBot: data.author?.bot,
    attachments: data.attachments,
  }
}

export async function downloadDiscordFile(
  attachment: DiscordAttachment
): Promise<{ buffer: Buffer; url: string } | null> {
  const downloadUrl = attachment.proxy_url || attachment.url

  try {
    const response = await fetch(downloadUrl)

    if (!response.ok) return null

    const arrayBuffer = await response.arrayBuffer()
    return { buffer: Buffer.from(arrayBuffer), url: downloadUrl }
  } catch {
    return null
  }
}

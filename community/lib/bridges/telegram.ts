/**
 * Telegram Bridge - Direct HTTP API integration
 * Community Edition - Simplified version
 */

import type { SessionInfo, AttachmentData, TelegramConfig } from './types'

const TELEGRAM_API = 'https://api.telegram.org/bot'

// Domains that Telegram servers cannot access
const NON_PUBLIC_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?/,
  /^https?:\/\/[^/]+\.local(:\d+)?/,
  /^https?:\/\/[^/]+\.test(:\d+)?/,
  /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?/,
  /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?/,
]

function isPublicUrl(url: string): boolean {
  return !NON_PUBLIC_PATTERNS.some((pattern) => pattern.test(url))
}

interface TelegramResponse<T = unknown> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

interface ForumTopic {
  message_thread_id: number
  name: string
}

interface TelegramMessage {
  message_id: number
  message_thread_id?: number
  chat: { id: number }
  from?: { id: number; first_name: string; username?: string }
  text?: string
  caption?: string
}

export interface TelegramConfig {
  botToken: string
  chatId: string
}

async function telegramRequest<T>(
  botToken: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T | null> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })

    const data: TelegramResponse<T> = await response.json()

    if (!data.ok) {
      console.error(`[Telegram] API error on ${method}: ${data.error_code} - ${data.description}`)
      return null
    }

    return data.result ?? null
  } catch (error) {
    console.error(`[Telegram] Request failed: ${method}`, error)
    return null
  }
}

async function telegramUploadFile<T>(
  botToken: string,
  method: string,
  fileField: string,
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
  params: Record<string, unknown> = {}
): Promise<T | null> {
  try {
    const formData = new FormData()

    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    ) as ArrayBuffer
    const blob = new Blob([arrayBuffer], { type: mimeType })
    formData.append(fileField, blob, filename)

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value))
      }
    }

    const response = await fetch(`${TELEGRAM_API}${botToken}/${method}`, {
      method: 'POST',
      body: formData,
    })

    const data: TelegramResponse<T> = await response.json()

    if (!data.ok) {
      console.error(`[Telegram] Upload error on ${method}: ${data.error_code} - ${data.description}`)
      return null
    }

    return data.result ?? null
  } catch (error) {
    console.error(`[Telegram] Upload failed: ${method}`, error)
    return null
  }
}

async function fetchFileContent(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch {
    return null
  }
}

/**
 * Create a forum topic for a new session
 */
export async function createForumTopic(
  config: TelegramConfig,
  session: SessionInfo
): Promise<number | null> {
  let topicName: string
  if (session.userEmail) {
    topicName = `💬 ${session.userEmail.split('@')[0].slice(0, 20)}`
  } else {
    const pageInfo = session.url?.split('/').pop()?.split('?')[0]?.slice(0, 15) || ''
    topicName = pageInfo
      ? `💬 ${session.id.slice(0, 8)} • ${pageInfo}`
      : `💬 ${session.id.slice(0, 8)}`
  }

  const result = await telegramRequest<ForumTopic>(config.botToken, 'createForumTopic', {
    chat_id: config.chatId,
    name: topicName,
    icon_color: 0x6fb9f0,
  })

  if (!result) return null

  // Send welcome message
  const welcomeText = buildSessionInfo(session)
  await sendMessageToTopic(config, result.message_thread_id, welcomeText)

  return result.message_thread_id
}

/**
 * Send a message to a forum topic
 */
export async function sendMessageToTopic(
  config: TelegramConfig,
  topicId: number,
  text: string,
  parseMode: 'Markdown' | 'HTML' = 'Markdown',
  replyToMessageId?: number
): Promise<TelegramMessage | null> {
  if (!topicId || topicId <= 0) return null

  return telegramRequest<TelegramMessage>(config.botToken, 'sendMessage', {
    chat_id: config.chatId,
    message_thread_id: topicId,
    text,
    parse_mode: parseMode,
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
  })
}

/**
 * Send a photo to a topic
 */
export async function sendPhotoToTopic(
  config: TelegramConfig,
  topicId: number,
  photoUrl: string,
  caption?: string,
  filename?: string
): Promise<TelegramMessage | null> {
  if (isPublicUrl(photoUrl)) {
    return telegramRequest<TelegramMessage>(config.botToken, 'sendPhoto', {
      chat_id: config.chatId,
      message_thread_id: topicId,
      photo: photoUrl,
      caption,
      parse_mode: 'Markdown',
    })
  }

  const fileBuffer = await fetchFileContent(photoUrl)
  if (!fileBuffer) return null

  return telegramUploadFile<TelegramMessage>(
    config.botToken,
    'sendPhoto',
    'photo',
    fileBuffer,
    filename || 'photo.jpg',
    'image/jpeg',
    {
      chat_id: config.chatId,
      message_thread_id: topicId,
      caption,
      parse_mode: 'Markdown',
    }
  )
}

/**
 * Send a document to a topic
 */
export async function sendDocumentToTopic(
  config: TelegramConfig,
  topicId: number,
  documentUrl: string,
  filename: string,
  mimeType: string,
  caption?: string
): Promise<TelegramMessage | null> {
  if (isPublicUrl(documentUrl)) {
    return telegramRequest<TelegramMessage>(config.botToken, 'sendDocument', {
      chat_id: config.chatId,
      message_thread_id: topicId,
      document: documentUrl,
      caption,
      parse_mode: 'Markdown',
    })
  }

  const fileBuffer = await fetchFileContent(documentUrl)
  if (!fileBuffer) return null

  return telegramUploadFile<TelegramMessage>(
    config.botToken,
    'sendDocument',
    'document',
    fileBuffer,
    filename,
    mimeType,
    {
      chat_id: config.chatId,
      message_thread_id: topicId,
      caption,
      parse_mode: 'Markdown',
    }
  )
}

async function sendAttachmentToTopic(
  config: TelegramConfig,
  topicId: number,
  attachment: AttachmentData,
  caption?: string
): Promise<TelegramMessage | null> {
  const { mimeType, url, filename } = attachment

  if (mimeType.startsWith('image/')) {
    return sendPhotoToTopic(config, topicId, url, caption, filename)
  }
  return sendDocumentToTopic(config, topicId, url, filename, mimeType, caption)
}

/**
 * Send visitor message to Telegram
 */
export async function sendVisitorMessage(
  config: TelegramConfig,
  topicId: number,
  content: string,
  visitorName?: string,
  sessionInfo?: SessionInfo,
  attachments?: AttachmentData[],
  replyToTelegramMessageId?: number
): Promise<{ message: TelegramMessage | null; newTopicId?: number }> {
  const displayName = visitorName || 'Visitor'
  const hasContent = content && content.trim().length > 0
  const hasAttachments = attachments && attachments.length > 0

  let activeTopicId = topicId
  let newTopicId: number | undefined
  let sentMessage: TelegramMessage | null = null

  if (hasContent) {
    const text = `👤 *${escapeMarkdown(displayName)}:*\n\n${escapeMarkdown(content)}`
    const result = await sendMessageToTopic(config, topicId, text, 'Markdown', replyToTelegramMessageId)

    // Check if message went to General (topic was deleted)
    if (result && result.message_thread_id === undefined && sessionInfo) {
      const recreatedTopicId = await createForumTopic(config, sessionInfo)
      if (recreatedTopicId) {
        newTopicId = recreatedTopicId
        activeTopicId = recreatedTopicId
        sentMessage = await sendMessageToTopic(config, recreatedTopicId, text)
      }
    } else {
      sentMessage = result
    }
  }

  if (hasAttachments) {
    const visitorCaption = hasContent ? undefined : `👤 *${escapeMarkdown(displayName)}*`
    for (let i = 0; i < attachments.length; i++) {
      const caption = i === 0 ? visitorCaption : undefined
      await sendAttachmentToTopic(config, activeTopicId, attachments[i], caption)
    }
  }

  return { message: sentMessage, newTopicId }
}

/**
 * Edit a message
 */
export async function editMessageInTopic(
  config: TelegramConfig,
  messageId: number,
  newContent: string,
  visitorName?: string
): Promise<TelegramMessage | null> {
  const displayName = visitorName || 'Visitor'
  const text = `👤 *${escapeMarkdown(displayName)}:*\n\n${escapeMarkdown(newContent)}\n\n_✏️ edited_`

  return telegramRequest<TelegramMessage>(config.botToken, 'editMessageText', {
    chat_id: config.chatId,
    message_id: messageId,
    text,
    parse_mode: 'Markdown',
  })
}

/**
 * Delete a message
 */
export async function deleteMessageInTopic(
  config: TelegramConfig,
  messageId: number
): Promise<boolean> {
  const result = await telegramRequest<boolean>(config.botToken, 'deleteMessage', {
    chat_id: config.chatId,
    message_id: messageId,
  })
  return result === true
}

/**
 * Close a forum topic
 */
export async function closeForumTopic(config: TelegramConfig, topicId: number): Promise<boolean> {
  const result = await telegramRequest<boolean>(config.botToken, 'closeForumTopic', {
    chat_id: config.chatId,
    message_thread_id: topicId,
  })
  return result === true
}

/**
 * Set webhook
 */
export async function setWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken?: string
): Promise<boolean> {
  const params: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ['message', 'edited_message'],
  }
  if (secretToken) {
    params.secret_token = secretToken
  }
  const result = await telegramRequest<boolean>(botToken, 'setWebhook', params)
  return result === true
}

/**
 * Get bot info
 */
export async function getBotInfo(
  botToken: string
): Promise<{ id: number; username: string; first_name: string } | null> {
  return telegramRequest(botToken, 'getMe')
}

/**
 * Download file from Telegram
 */
export async function getFileUrl(botToken: string, fileId: string): Promise<string | null> {
  const result = await telegramRequest<{ file_path?: string }>(botToken, 'getFile', { file_id: fileId })
  if (!result?.file_path) return null
  return `https://api.telegram.org/file/bot${botToken}/${result.file_path}`
}

// Helpers

function buildSessionInfo(session: SessionInfo): string {
  let text = `🆕 *New conversation*\n\n`

  if (session.userEmail || session.userPhone) {
    if (session.userEmail) text += `📧 ${escapeMarkdown(session.userEmail)}\n`
    if (session.userPhone) text += `📱 ${escapeMarkdown(session.userPhone)}\n`
    text += '\n'
  }

  text += `Session: \`${session.id.slice(0, 8)}...\``
  if (session.url) text += `\n📍 Page: ${session.url}`
  text += '\n\n_Reply here to communicate with the visitor._'

  return text
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1')
}

// Webhook types
export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage & {
    photo?: Array<{ file_id: string; file_size?: number }>
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
    reply_to_message?: { message_id: number; text?: string }
  }
  edited_message?: TelegramMessage
}

export interface ParsedWebhookUpdate {
  type: 'message' | 'edit' | 'unknown'
  chatId: number
  topicId?: number
  text?: string
  operatorName?: string
  messageId?: number
  media?: { fileId: string; filename: string; mimeType: string; size?: number }
  replyToTelegramMessageId?: number
}

export function parseWebhookUpdate(update: TelegramUpdate): ParsedWebhookUpdate {
  if (update.message) {
    const msg = update.message
    if (msg.text?.startsWith('/')) {
      return { type: 'unknown', chatId: msg.chat.id }
    }

    const result: ParsedWebhookUpdate = {
      type: 'message',
      chatId: msg.chat.id,
      topicId: msg.message_thread_id,
      text: msg.text || msg.caption,
      operatorName: msg.from?.first_name,
      messageId: msg.message_id,
      replyToTelegramMessageId: msg.reply_to_message?.message_id,
    }

    if (msg.photo && msg.photo.length > 0) {
      const largestPhoto = msg.photo[msg.photo.length - 1]
      result.media = {
        fileId: largestPhoto.file_id,
        filename: `photo_${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        size: largestPhoto.file_size,
      }
    } else if (msg.document) {
      result.media = {
        fileId: msg.document.file_id,
        filename: msg.document.file_name || `document_${Date.now()}`,
        mimeType: msg.document.mime_type || 'application/octet-stream',
        size: msg.document.file_size,
      }
    }

    return result
  }

  if (update.edited_message) {
    const msg = update.edited_message
    return {
      type: 'edit',
      chatId: msg.chat.id,
      topicId: msg.message_thread_id,
      text: msg.text || msg.caption,
      operatorName: msg.from?.first_name,
      messageId: msg.message_id,
    }
  }

  return { type: 'unknown', chatId: 0 }
}

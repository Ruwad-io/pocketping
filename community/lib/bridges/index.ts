/**
 * Bridge Manager - Handles message routing to configured bridges
 * Community Edition
 */

import { prisma } from '../db'
import type { Session, Message, Attachment } from '@prisma/client'
import type { SessionInfo, AttachmentData } from './types'

import * as telegram from './telegram'
import * as slack from './slack'
import * as discord from './discord'

/**
 * Convert Prisma Session to SessionInfo for bridges
 */
function toSessionInfo(session: Session): SessionInfo {
  return {
    id: session.id,
    visitorId: session.visitorId,
    userEmail: session.userEmail,
    userPhone: session.userPhone,
    userAgent: session.userAgent,
    url: session.url,
    referrer: session.referrer,
    country: session.country,
    city: session.city,
  }
}

/**
 * Convert Prisma Attachments to AttachmentData for bridges
 */
function toAttachmentData(attachments: Attachment[]): AttachmentData[] {
  return attachments.map((a) => ({
    filename: a.filename,
    url: a.url,
    mimeType: a.mimeType,
    size: a.size,
  }))
}

/**
 * Send a new session notification to all configured bridges
 */
export async function notifyNewSession(session: Session): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: session.projectId },
  })

  if (!project) return

  const sessionInfo = toSessionInfo(session)

  // Telegram
  if (project.telegramBotToken && project.telegramChatId) {
    try {
      const topicId = await telegram.createForumTopic(
        { botToken: project.telegramBotToken, chatId: project.telegramChatId },
        sessionInfo
      )
      if (topicId) {
        await prisma.session.update({
          where: { id: session.id },
          data: { telegramTopicId: String(topicId) },
        })
      }
    } catch (error) {
      console.error('[Bridges] Telegram error:', error)
    }
  }

  // Slack
  if (project.slackBotToken && project.slackChannelId) {
    try {
      const threadTs = await slack.createThread(
        { botToken: project.slackBotToken, channelId: project.slackChannelId },
        sessionInfo
      )
      if (threadTs) {
        await prisma.session.update({
          where: { id: session.id },
          data: { slackThreadTs: threadTs },
        })
      }
    } catch (error) {
      console.error('[Bridges] Slack error:', error)
    }
  }

  // Discord
  if (project.discordChannelId) {
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (botToken) {
      try {
        const threadId = await discord.createThread(
          { botToken, channelId: project.discordChannelId },
          sessionInfo
        )
        if (threadId) {
          await prisma.session.update({
            where: { id: session.id },
            data: { discordThreadId: threadId },
          })
        }
      } catch (error) {
        console.error('[Bridges] Discord error:', error)
      }
    }
  }
}

/**
 * Send a visitor message to all configured bridges
 */
export async function sendVisitorMessageToBridges(
  message: Message & { attachments: Attachment[] },
  session: Session
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: session.projectId },
  })

  if (!project) return

  const sessionInfo = toSessionInfo(session)
  const attachments = toAttachmentData(message.attachments)
  const visitorName = session.userEmail?.split('@')[0] || session.visitorId.slice(0, 8)

  // Telegram
  if (project.telegramBotToken && project.telegramChatId && session.telegramTopicId) {
    try {
      const { message: tgMessage, newTopicId } = await telegram.sendVisitorMessage(
        { botToken: project.telegramBotToken, chatId: project.telegramChatId },
        parseInt(session.telegramTopicId, 10),
        message.content,
        visitorName,
        sessionInfo,
        attachments
      )

      // Update message with bridge IDs
      const updateData: { telegramMessageId?: number } = {}
      if (tgMessage?.message_id) {
        updateData.telegramMessageId = tgMessage.message_id
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.message.update({
          where: { id: message.id },
          data: updateData,
        })
      }

      // Update session if topic was recreated
      if (newTopicId) {
        await prisma.session.update({
          where: { id: session.id },
          data: { telegramTopicId: String(newTopicId) },
        })
      }
    } catch (error) {
      console.error('[Bridges] Telegram error:', error)
    }
  }

  // Slack
  if (project.slackBotToken && project.slackChannelId && session.slackThreadTs) {
    try {
      const { messageTs, newThreadTs } = await slack.sendVisitorMessage(
        { botToken: project.slackBotToken, channelId: project.slackChannelId },
        session.slackThreadTs,
        message.content,
        visitorName,
        sessionInfo,
        attachments
      )

      if (messageTs) {
        await prisma.message.update({
          where: { id: message.id },
          data: { slackMessageTs: messageTs },
        })
      }

      if (newThreadTs) {
        await prisma.session.update({
          where: { id: session.id },
          data: { slackThreadTs: newThreadTs },
        })
      }
    } catch (error) {
      console.error('[Bridges] Slack error:', error)
    }
  }

  // Discord
  if (project.discordChannelId && session.discordThreadId) {
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (botToken) {
      try {
        const { message: discordMsg, newThreadId } = await discord.sendVisitorMessage(
          { botToken, channelId: project.discordChannelId },
          session.discordThreadId,
          message.content,
          visitorName,
          sessionInfo,
          attachments
        )

        if (discordMsg?.id) {
          await prisma.message.update({
            where: { id: message.id },
            data: { discordMessageId: discordMsg.id },
          })
        }

        if (newThreadId) {
          await prisma.session.update({
            where: { id: session.id },
            data: { discordThreadId: newThreadId },
          })
        }
      } catch (error) {
        console.error('[Bridges] Discord error:', error)
      }
    }
  }
}

/**
 * Sync message edit to bridges
 */
export async function syncMessageEditToBridges(
  message: Message,
  session: Session,
  newContent: string
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: session.projectId },
  })

  if (!project) return

  const visitorName = session.userEmail?.split('@')[0] || session.visitorId.slice(0, 8)

  // Telegram
  if (project.telegramBotToken && message.telegramMessageId) {
    try {
      await telegram.editMessageInTopic(
        { botToken: project.telegramBotToken, chatId: project.telegramChatId! },
        message.telegramMessageId,
        newContent,
        visitorName
      )
    } catch (error) {
      console.error('[Bridges] Telegram edit error:', error)
    }
  }

  // Slack
  if (project.slackBotToken && message.slackMessageTs) {
    try {
      await slack.editMessageInThread(
        { botToken: project.slackBotToken, channelId: project.slackChannelId! },
        message.slackMessageTs,
        newContent,
        visitorName
      )
    } catch (error) {
      console.error('[Bridges] Slack edit error:', error)
    }
  }

  // Discord
  if (message.discordMessageId && session.discordThreadId) {
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (botToken) {
      try {
        await discord.editMessageInThread(
          { botToken, channelId: project.discordChannelId! },
          session.discordThreadId,
          message.discordMessageId,
          newContent,
          visitorName
        )
      } catch (error) {
        console.error('[Bridges] Discord edit error:', error)
      }
    }
  }
}

/**
 * Sync message delete to bridges
 */
export async function syncMessageDeleteToBridges(
  message: Message,
  session: Session
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: session.projectId },
  })

  if (!project) return

  // Telegram
  if (project.telegramBotToken && message.telegramMessageId) {
    try {
      await telegram.deleteMessageInTopic(
        { botToken: project.telegramBotToken, chatId: project.telegramChatId! },
        message.telegramMessageId
      )
    } catch (error) {
      console.error('[Bridges] Telegram delete error:', error)
    }
  }

  // Slack
  if (project.slackBotToken && message.slackMessageTs) {
    try {
      await slack.deleteMessageInThread(
        { botToken: project.slackBotToken, channelId: project.slackChannelId! },
        message.slackMessageTs
      )
    } catch (error) {
      console.error('[Bridges] Slack delete error:', error)
    }
  }

  // Discord
  if (message.discordMessageId && session.discordThreadId) {
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (botToken) {
      try {
        await discord.deleteMessageInThread(
          { botToken, channelId: project.discordChannelId! },
          session.discordThreadId,
          message.discordMessageId
        )
      } catch (error) {
        console.error('[Bridges] Discord delete error:', error)
      }
    }
  }
}

/**
 * Handle operator message - save to DB and sync to other bridges
 */
export async function handleOperatorMessage(params: {
  sessionId: string
  content: string
  operatorName: string
  sourceBridge: 'telegram' | 'discord' | 'slack'
  attachments?: AttachmentData[]
  replyToMessageId?: string
}): Promise<void> {
  const { sessionId, content, operatorName, sourceBridge, attachments = [], replyToMessageId } =
    params

  // Get session with project
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { project: true },
  })

  if (!session || !session.project) {
    console.error('[Bridges] Session or project not found:', sessionId)
    return
  }

  const project = session.project

  // Save message to DB
  const message = await prisma.message.create({
    data: {
      sessionId,
      projectId: project.id,
      content,
      sender: 'OPERATOR',
      operatorName,
      sourceBridge,
      replyToId: replyToMessageId,
    },
  })

  // Update session lastActivity
  await prisma.session.update({
    where: { id: sessionId },
    data: { lastActivity: new Date(), unreadCount: 0 },
  })

  // Fetch quoted message if replying
  let quotedMessage: {
    content: string
    sender: string
    attachments: Array<{ filename: string; mimeType: string }>
  } | null = null
  if (replyToMessageId) {
    try {
      const originalMessage = await prisma.message.findUnique({
        where: { id: replyToMessageId },
        select: {
          content: true,
          sender: true,
          attachments: { select: { filename: true, mimeType: true } },
        },
      })
      if (originalMessage) {
        quotedMessage = originalMessage
      }
    } catch (error) {
      console.error('[Bridges] Failed to fetch quoted message:', error)
    }
  }

  // Format quote with attachment info
  const formatQuote = (quote: {
    content: string
    sender: string
    attachments: Array<{ filename: string; mimeType: string }>
  }) => {
    const sender = quote.sender === 'VISITOR' ? '👤 Visitor' : '💬 Operator'

    // Build attachment summary
    let attachmentSummary = ''
    if (quote.attachments.length > 0) {
      const imageCount = quote.attachments.filter((a) => a.mimeType.startsWith('image/')).length
      const fileCount = quote.attachments.length - imageCount
      const parts: string[] = []
      if (imageCount > 0) parts.push(`🖼️ ${imageCount} image${imageCount > 1 ? 's' : ''}`)
      if (fileCount > 0) parts.push(`📎 ${fileCount} file${fileCount > 1 ? 's' : ''}`)
      attachmentSummary = ` [${parts.join(', ')}]`
    }

    // Handle empty content (attachment-only message)
    let displayContent = quote.content
    if (!displayContent && quote.attachments.length > 0) {
      displayContent = '(attachment)'
    }

    const truncated =
      displayContent.length > 100 ? displayContent.slice(0, 100) + '...' : displayContent
    return `> ${sender}${attachmentSummary}: ${truncated}`
  }

  // Format attachment links for cross-bridge sync
  const formatAttachmentLinks = (
    atts: AttachmentData[],
    format: 'telegram' | 'discord' | 'slack'
  ) => {
    if (atts.length === 0) return ''
    const links = atts.map((att) => {
      const emoji = att.mimeType.startsWith('image/') ? '🖼️' : '📎'
      if (format === 'telegram') {
        return `${emoji} [${att.filename}](${att.url})`
      } else if (format === 'discord') {
        return `${emoji} [${att.filename}](${att.url})`
      } else {
        return `${emoji} <${att.url}|${att.filename}>`
      }
    })
    return '\n\n' + links.join('\n')
  }

  // Sync to Telegram if source is not Telegram
  if (
    sourceBridge !== 'telegram' &&
    project.telegramBotToken &&
    project.telegramChatId &&
    session.telegramTopicId
  ) {
    try {
      const quoteBlock = quotedMessage ? `${formatQuote(quotedMessage)}\n\n` : ''
      const attachmentLinks = formatAttachmentLinks(attachments, 'telegram')
      const text = `📨 *${operatorName}* _via ${sourceBridge}_\n\n${quoteBlock}${content}${attachmentLinks}`
      await telegram.sendMessageToTopic(
        { botToken: project.telegramBotToken, chatId: project.telegramChatId },
        parseInt(session.telegramTopicId),
        text
      )
    } catch (error) {
      console.error('[Bridges] Telegram sync error:', error)
    }
  }

  // Sync to Discord if source is not Discord
  if (sourceBridge !== 'discord' && project.discordChannelId && session.discordThreadId) {
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (botToken) {
      try {
        const quoteBlock = quotedMessage ? `${formatQuote(quotedMessage)}\n\n` : ''
        const attachmentLinks = formatAttachmentLinks(attachments, 'discord')
        const text = `📨 **${operatorName}** _via ${sourceBridge}_\n\n${quoteBlock}${content}${attachmentLinks}`
        await discord.sendMessageToThread(
          { botToken, channelId: project.discordChannelId },
          session.discordThreadId,
          text
        )
      } catch (error) {
        console.error('[Bridges] Discord sync error:', error)
      }
    }
  }

  // Sync to Slack if source is not Slack
  if (
    sourceBridge !== 'slack' &&
    project.slackBotToken &&
    project.slackChannelId &&
    session.slackThreadTs
  ) {
    try {
      const quoteBlock = quotedMessage ? `${formatQuote(quotedMessage)}\n\n` : ''
      const attachmentLinks = formatAttachmentLinks(attachments, 'slack')
      const text = `📨 *${operatorName}* _via ${sourceBridge}_\n\n${quoteBlock}${content}${attachmentLinks}`
      await slack.sendMessageToThread(
        { botToken: project.slackBotToken, channelId: project.slackChannelId },
        session.slackThreadTs,
        text
      )
    } catch (error) {
      console.error('[Bridges] Slack sync error:', error)
    }
  }

  console.log(`[Bridges] Operator message from ${sourceBridge} synced to other bridges`)
}

/**
 * Send AI response to all configured bridges
 */
export async function sendAIMessageToBridges(
  messageId: string,
  session: Session,
  content: string
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: session.projectId },
  })

  if (!project) return

  const sessionInfo = toSessionInfo(session)
  const bridgeMessageIds: {
    telegramMessageId?: number
    discordMessageId?: string
    slackMessageTs?: string
  } = {}

  // Telegram
  if (project.telegramBotToken && project.telegramChatId) {
    try {
      let topicId = session.telegramTopicId ? parseInt(session.telegramTopicId) : null

      // Create topic on-demand if it doesn't exist
      if (!topicId) {
        topicId = await telegram.createForumTopic(
          { botToken: project.telegramBotToken, chatId: project.telegramChatId },
          sessionInfo
        )
        if (topicId) {
          await prisma.session.update({
            where: { id: session.id },
            data: { telegramTopicId: String(topicId) },
          })
        }
      }

      if (topicId) {
        const text = `🤖 *AI*\n\n${content}`
        const result = await telegram.sendMessageToTopic(
          { botToken: project.telegramBotToken, chatId: project.telegramChatId },
          topicId,
          text
        )
        if (result?.message_id) {
          bridgeMessageIds.telegramMessageId = result.message_id
        }
      }
    } catch (error) {
      console.error('[Bridges] Telegram AI message error:', error)
    }
  }

  // Discord
  if (project.discordChannelId) {
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (botToken) {
      try {
        let threadId = session.discordThreadId

        // Create thread on-demand if it doesn't exist
        if (!threadId) {
          threadId = await discord.createThread(
            { botToken, channelId: project.discordChannelId },
            sessionInfo
          )
          if (threadId) {
            await prisma.session.update({
              where: { id: session.id },
              data: { discordThreadId: threadId },
            })
          }
        }

        if (threadId) {
          const text = `🤖 **AI**\n\n${content}`
          const result = await discord.sendMessageToThread(
            { botToken, channelId: project.discordChannelId },
            threadId,
            text
          )
          if (result?.id) {
            bridgeMessageIds.discordMessageId = result.id
          }
        }
      } catch (error) {
        console.error('[Bridges] Discord AI message error:', error)
      }
    }
  }

  // Slack
  if (project.slackBotToken && project.slackChannelId) {
    try {
      let threadTs = session.slackThreadTs

      // Create thread on-demand if it doesn't exist
      if (!threadTs) {
        threadTs = await slack.createThread(
          { botToken: project.slackBotToken, channelId: project.slackChannelId },
          sessionInfo
        )
        if (threadTs) {
          await prisma.session.update({
            where: { id: session.id },
            data: { slackThreadTs: threadTs },
          })
        }
      }

      if (threadTs) {
        const text = `🤖 *AI*\n\n${content}`
        const result = await slack.sendMessageToThread(
          { botToken: project.slackBotToken, channelId: project.slackChannelId },
          threadTs,
          text
        )
        if (result) {
          bridgeMessageIds.slackMessageTs = result
        }
      }
    } catch (error) {
      console.error('[Bridges] Slack AI message error:', error)
    }
  }

  // Update message with bridge message IDs
  if (Object.keys(bridgeMessageIds).length > 0) {
    await prisma.message.update({
      where: { id: messageId },
      data: bridgeMessageIds,
    })
  }

  console.log('[Bridges] AI message sent to bridges')
}

/**
 * Notify all configured bridges when a visitor disconnects
 */
export async function notifyVisitorDisconnect(
  session: Session & {
    project?: {
      telegramBotToken: string | null
      telegramChatId: string | null
      slackBotToken: string | null
      slackChannelId: string | null
      discordChannelId: string | null
    } | null
  },
  message: string
): Promise<void> {
  const project = session.project || await prisma.project.findUnique({
    where: { id: session.projectId },
  })

  if (!project) return

  // Telegram
  if (project.telegramBotToken && project.telegramChatId && session.telegramTopicId) {
    try {
      await telegram.sendMessageToTopic(
        { botToken: project.telegramBotToken, chatId: project.telegramChatId },
        parseInt(session.telegramTopicId),
        message
      )
    } catch (error) {
      console.error('[Bridges] Telegram disconnect notification error:', error)
    }
  }

  // Slack
  if (project.slackBotToken && project.slackChannelId && session.slackThreadTs) {
    try {
      await slack.sendMessageToThread(
        { botToken: project.slackBotToken, channelId: project.slackChannelId },
        session.slackThreadTs,
        message
      )
    } catch (error) {
      console.error('[Bridges] Slack disconnect notification error:', error)
    }
  }

  // Discord
  if (process.env.DISCORD_BOT_TOKEN && project.discordChannelId && session.discordThreadId) {
    try {
      await discord.sendMessageToThread(
        { botToken: process.env.DISCORD_BOT_TOKEN, channelId: project.discordChannelId },
        session.discordThreadId,
        message
      )
    } catch (error) {
      console.error('[Bridges] Discord disconnect notification error:', error)
    }
  }
}

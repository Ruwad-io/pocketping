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

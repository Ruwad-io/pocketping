/**
 * Discord Gateway Service
 * Community Edition
 *
 * Initializes and manages Discord Gateways for projects that have Discord enabled.
 * This runs as a background service when ENABLE_DISCORD_GATEWAY=true.
 */

import { prisma } from './db'
import {
  DiscordGateway,
  DiscordGatewayConfig,
  startGateway,
  stopGateway,
  stopAllGateways,
  type DiscordGatewayAttachment,
} from './bridges/discord-gateway'
import { downloadDiscordFile, type DiscordAttachment } from './bridges/discord'
import { emitToSession } from './sse'

const NS = 'DiscordGatewayService'

function log(message: string, data?: unknown) {
  console.log(`🔷 [${NS}] ${message}`, data !== undefined ? data : '')
}

function logError(message: string, error?: unknown) {
  console.error(`❌ [${NS}] ${message}`, error !== undefined ? error : '')
}

/**
 * Initialize Discord Gateways for all projects with Discord configured
 */
export async function initializeDiscordGateways(): Promise<void> {
  log('Initializing Discord Gateways...')

  // Shared bot token from environment
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken) {
    log('DISCORD_BOT_TOKEN not set - Discord Gateway disabled')
    return
  }

  try {
    // Get all projects with Discord channel configured
    const projects = await prisma.project.findMany({
      where: {
        discordChannelId: { not: null },
      },
      select: {
        id: true,
        name: true,
        discordChannelId: true,
      },
    })

    log(`Found ${projects.length} projects with Discord configured`)

    for (const project of projects) {
      if (!project.discordChannelId) {
        continue
      }

      try {
        await startProjectGateway(project.id, botToken, project.discordChannelId)
        log(`Gateway started for project: ${project.name} (${project.id})`)
      } catch (error) {
        logError(`Failed to start gateway for project ${project.id}:`, error)
      }
    }

    log(`Discord Gateways initialized: ${projects.length} gateways running`)

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      log('Shutting down Discord Gateways...')
      stopAllGateways()
    })

    process.on('SIGTERM', () => {
      log('Shutting down Discord Gateways...')
      stopAllGateways()
    })
  } catch (error) {
    logError('Failed to initialize Discord Gateways:', error)
  }
}

/**
 * Start a Discord Gateway for a specific project
 */
export async function startProjectGateway(
  projectId: string,
  botToken: string,
  channelId: string
): Promise<DiscordGateway> {
  log(`Starting gateway for project ${projectId}`)

  const allowedBotIds = (process.env.BRIDGE_TEST_BOT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  const config: DiscordGatewayConfig = {
    botToken,
    channelId,
    allowedBotIds,
    onOperatorMessage: async (params) => {
      try {
        await handleDiscordMessage(projectId, params)
      } catch (error) {
        logError(`Error handling Discord message:`, error)
      }
    },
    onOperatorMessageEdit: async (params) => {
      try {
        await handleDiscordMessageEdit(projectId, params)
      } catch (error) {
        logError(`Error handling Discord message edit:`, error)
      }
    },
    onOperatorMessageDelete: async (params) => {
      try {
        await handleDiscordMessageDelete(projectId, params)
      } catch (error) {
        logError(`Error handling Discord message delete:`, error)
      }
    },
  }

  return startGateway(projectId, config)
}

/**
 * Stop the Discord Gateway for a specific project
 */
export function stopProjectGateway(projectId: string): void {
  log(`Stopping gateway for project ${projectId}`)
  stopGateway(projectId)
}

/**
 * Handle incoming Discord message from Gateway
 */
async function handleDiscordMessage(
  projectId: string,
  params: {
    threadId: string
    content: string
    operatorName: string
    attachments: DiscordGatewayAttachment[]
    messageId: string
    replyToMessageId?: string
  }
): Promise<void> {
  console.log(`📥 [DiscordGatewayService] Message received in project ${projectId}, thread ${params.threadId}, from ${params.operatorName}`)
  log(`Message received in project ${projectId}, thread ${params.threadId}`)

  // Find session by Discord thread ID
  const session = await prisma.session.findFirst({
    where: {
      projectId,
      discordThreadId: params.threadId,
    },
    select: { id: true },
  })

  if (!session) {
    log(`No session found for Discord thread ${params.threadId}`)
    return
  }

  // Download attachments
  const attachmentData: Array<{
    filename: string
    mimeType: string
    size: number
    url: string
    data: Buffer
    bridgeFileId?: string
  }> = []

  for (const att of params.attachments) {
    const discordAtt: DiscordAttachment = {
      id: att.id,
      filename: att.filename,
      content_type: att.contentType,
      size: att.size,
      url: att.url,
      proxy_url: att.proxyUrl,
    }

    const downloaded = await downloadDiscordFile(discordAtt)
    if (downloaded) {
      attachmentData.push({
        filename: att.filename,
        mimeType: att.contentType,
        size: att.size,
        url: downloaded.url,
        data: downloaded.buffer,
        bridgeFileId: att.id,
      })
    }
  }

  // Find the internal message ID if this is a reply
  let replyToId: string | undefined
  if (params.replyToMessageId) {
    const originalMessage = await prisma.message.findFirst({
      where: {
        sessionId: session.id,
        discordMessageId: params.replyToMessageId,
      },
      select: { id: true },
    })
    if (originalMessage) {
      replyToId = originalMessage.id
    }
  }

  // Create the message in database
  const message = await prisma.message.create({
    data: {
      sessionId: session.id,
      content: params.content,
      sender: 'OPERATOR',
      discordMessageId: params.messageId,
      replyToId,
      attachments: attachmentData.length
        ? {
            create: attachmentData.map((att) => ({
              filename: att.filename,
              mimeType: att.mimeType,
              size: att.size,
              url: att.url,
              status: 'READY',
            })),
          }
        : undefined,
    },
    include: {
      attachments: true,
      replyTo: {
        select: {
          id: true,
          content: true,
          sender: true,
        },
      },
    },
  })

  // Update session last activity
  const now = new Date()
  await prisma.session.update({
    where: { id: session.id },
    data: {
      lastActivity: now,
      lastOperatorActivity: now,
      operatorOnline: true,
    },
  })

  // Emit to SSE clients
  emitToSession(session.id, {
    type: 'message',
    data: {
      id: message.id,
      content: message.content,
      sender: message.sender,
      createdAt: message.createdAt,
      attachments: message.attachments,
      replyTo: message.replyTo,
    },
  })

  log(`Discord message handled for session ${session.id}`)
}

async function handleDiscordMessageEdit(
  projectId: string,
  params: {
    threadId: string
    messageId: string
    content: string
    editedAt?: Date
  }
): Promise<void> {
  log(`Discord message edit received in project ${projectId}, thread ${params.threadId}`)

  const session = await prisma.session.findFirst({
    where: {
      projectId,
      discordThreadId: params.threadId,
    },
    select: { id: true },
  })

  if (!session) {
    log(`No session found for Discord thread ${params.threadId}`)
    return
  }

  const existingMessage = await prisma.message.findFirst({
    where: {
      sessionId: session.id,
      discordMessageId: params.messageId,
    },
    select: { id: true },
  })

  if (!existingMessage) {
    return
  }

  const updatedMessage = await prisma.message.update({
    where: { id: existingMessage.id },
    data: {
      content: params.content,
      editedAt: params.editedAt ?? new Date(),
    },
  })

  // Emit edit event to SSE clients
  emitToSession(session.id, {
    type: 'message_edit',
    data: {
      id: updatedMessage.id,
      content: updatedMessage.content,
      editedAt: updatedMessage.editedAt,
    },
  })

  log(`Discord message edit saved for session ${session.id}`)
}

async function handleDiscordMessageDelete(
  projectId: string,
  params: {
    threadId: string
    messageId: string
    deletedAt?: Date
  }
): Promise<void> {
  log(`Discord message delete received in project ${projectId}, thread ${params.threadId}`)

  const session = await prisma.session.findFirst({
    where: {
      projectId,
      discordThreadId: params.threadId,
    },
    select: { id: true },
  })

  if (!session) {
    log(`No session found for Discord thread ${params.threadId}`)
    return
  }

  const existingMessage = await prisma.message.findFirst({
    where: {
      sessionId: session.id,
      discordMessageId: params.messageId,
    },
    select: { id: true },
  })

  if (!existingMessage) {
    return
  }

  await prisma.message.update({
    where: { id: existingMessage.id },
    data: {
      deletedAt: params.deletedAt ?? new Date(),
    },
  })

  // Emit delete event to SSE clients
  emitToSession(session.id, {
    type: 'message_delete',
    data: {
      id: existingMessage.id,
      deletedAt: params.deletedAt ?? new Date(),
    },
  })

  log(`Discord message delete saved for session ${session.id}`)
}

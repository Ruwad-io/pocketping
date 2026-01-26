import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { extractApiKey, validateSecretKey } from '@/lib/auth'

/**
 * GET /api/admin/settings
 * Get project settings (requires secret key)
 */
export async function GET(request: NextRequest) {
  const apiKey = extractApiKey(request)
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 401 })
  }

  const auth = await validateSecretKey(apiKey)
  if (!auth) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({
    where: { id: auth.project.id },
    select: {
      id: true,
      name: true,
      operatorName: true,
      operatorAvatar: true,
      primaryColor: true,
      welcomeMessage: true,
      // Telegram
      telegramBotToken: true,
      telegramChatId: true,
      // Discord
      discordChannelId: true,
      discordGuildId: true,
      discordGuildName: true,
      // Slack
      slackBotToken: true,
      slackChannelId: true,
      slackTeamId: true,
      slackTeamName: true,
      // AI
      aiEnabled: true,
      aiProvider: true,
      aiModel: true,
      // Pre-chat form
      preChatFormEnabled: true,
      preChatFormRequired: true,
      preChatFormTiming: true,
      preChatFormFields: true,
    },
  })

  return NextResponse.json(project)
}

/**
 * PATCH /api/admin/settings
 * Update project settings (requires secret key)
 */
export async function PATCH(request: NextRequest) {
  const apiKey = extractApiKey(request)
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 401 })
  }

  const auth = await validateSecretKey(apiKey)
  if (!auth) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  }

  try {
    const body = await request.json()

    // Allowed fields to update
    const allowedFields = [
      'name',
      'operatorName',
      'operatorAvatar',
      'primaryColor',
      'welcomeMessage',
      // Telegram
      'telegramBotToken',
      'telegramChatId',
      // Discord
      'discordChannelId',
      'discordGuildId',
      'discordGuildName',
      // Slack
      'slackBotToken',
      'slackChannelId',
      'slackTeamId',
      'slackTeamName',
      // AI
      'aiEnabled',
      'aiProvider',
      'aiApiKey',
      'aiModel',
      'aiSystemPrompt',
      'aiTakeoverDelay',
      // Pre-chat form
      'preChatFormEnabled',
      'preChatFormRequired',
      'preChatFormTiming',
      'preChatFormFields',
    ]

    const updateData: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    const project = await prisma.project.update({
      where: { id: auth.project.id },
      data: updateData,
    })

    return NextResponse.json({ success: true, id: project.id })
  } catch (error) {
    console.error('[Admin] Settings update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

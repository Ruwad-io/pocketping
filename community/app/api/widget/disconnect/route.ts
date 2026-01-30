import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { extractApiKey, validatePublicKey } from '@/lib/auth'
import { notifyVisitorDisconnect } from '@/lib/bridges'

/**
 * POST /api/widget/disconnect
 * Notify bridges when visitor leaves the page
 */
export async function POST(request: NextRequest) {
  const apiKey = extractApiKey(request)
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 401 })
  }

  const auth = await validatePublicKey(apiKey)
  if (!auth) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { sessionId, duration, reason } = body

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    // Verify session belongs to project
    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        projectId: auth.project.id,
      },
      include: {
        project: {
          select: {
            telegramBotToken: true,
            telegramChatId: true,
            slackBotToken: true,
            slackChannelId: true,
            discordChannelId: true,
          },
        },
      },
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Calculate session duration if not provided
    const sessionDuration = duration ?? Math.round((Date.now() - session.createdAt.getTime()) / 1000)

    // Format duration for display
    const formatDuration = (seconds: number): string => {
      if (seconds < 60) return `${seconds}s`
      if (seconds < 3600) return `${Math.floor(seconds / 60)} min`
      const hours = Math.floor(seconds / 3600)
      const mins = Math.floor((seconds % 3600) / 60)
      return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`
    }

    const visitorName = session.userEmail?.split('@')[0] || 'Visitor'
    const durationText = formatDuration(sessionDuration)
    const message = `👋 ${visitorName} left (was here for ${durationText})`

    // Notify all configured bridges (async, don't wait)
    notifyVisitorDisconnect(session, message).catch((err) => {
      console.error('[Widget] Failed to notify disconnect:', err)
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Widget] Disconnect error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

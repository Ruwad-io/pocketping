import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { parseSlackEvent, getUserInfo, downloadSlackFile, type SlackEvent } from '@/lib/bridges/slack'
import { emitToSession } from '@/lib/sse'

/**
 * POST /api/webhooks/slack
 * Receive events from Slack
 */
export async function POST(request: NextRequest) {
  try {
    const event: SlackEvent = await request.json()
    const parsed = parseSlackEvent(event)

    // Handle URL verification challenge
    if (parsed.type === 'challenge') {
      return NextResponse.json({ challenge: parsed.challenge })
    }

    if (parsed.type !== 'message') {
      return NextResponse.json({ ok: true })
    }

    // Find session by thread timestamp
    if (!parsed.threadTs) {
      return NextResponse.json({ ok: true })
    }

    const session = await prisma.session.findFirst({
      where: { slackThreadTs: parsed.threadTs },
      include: { project: true },
    })

    if (!session || !session.project.slackBotToken) {
      return NextResponse.json({ ok: true })
    }

    // Get operator name
    let operatorName = 'Operator'
    if (parsed.userId && !parsed.userId.startsWith('USLACKBOT')) {
      try {
        const userInfo = await getUserInfo(session.project.slackBotToken, parsed.userId)
        if (userInfo) {
          operatorName = userInfo.real_name || userInfo.name
        }
      } catch (error) {
        console.error('[Slack Webhook] Failed to get user info:', error)
      }
    }

    let content = parsed.text || ''

    // Handle file attachments
    if (parsed.files && parsed.files.length > 0) {
      for (const file of parsed.files) {
        const downloaded = await downloadSlackFile(session.project.slackBotToken, file)
        if (downloaded) {
          content = content
            ? `${content}\n\n📎 ${file.name}: ${downloaded.url}`
            : `📎 ${file.name}: ${downloaded.url}`
        }
      }
    }

    if (!content) {
      return NextResponse.json({ ok: true })
    }

    // Create operator message
    const message = await prisma.message.create({
      data: {
        sessionId: session.id,
        content,
        sender: 'OPERATOR',
      },
    })

    // Update session
    await prisma.session.update({
      where: { id: session.id },
      data: {
        lastActivity: new Date(),
        operatorOnline: true,
      },
    })

    // Emit to SSE
    emitToSession(session.id, {
      type: 'message',
      data: {
        id: message.id,
        content: message.content,
        sender: message.sender,
        createdAt: message.createdAt,
        operatorName,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Slack Webhook] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

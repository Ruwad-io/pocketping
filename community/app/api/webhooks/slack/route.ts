import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/db'
import { parseSlackEvent, getUserInfo, downloadSlackFile, type SlackEvent } from '@/lib/bridges/slack'
import { emitToSession } from '@/lib/sse'

const SLACK_SIGNATURE_TOLERANCE_SECONDS = 60 * 5

function verifySlackSignature(request: NextRequest, rawBody: string, signingSecret: string): boolean {
  const signature = request.headers.get('x-slack-signature')
  const timestamp = request.headers.get('x-slack-request-timestamp')

  if (!signature || !timestamp) return false

  const timestampNumber = Number(timestamp)
  if (!Number.isFinite(timestampNumber)) return false

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestampNumber) > SLACK_SIGNATURE_TOLERANCE_SECONDS) {
    return false
  }

  const baseString = `v0:${timestamp}:${rawBody}`
  const expectedSignature = `v0=${createHmac('sha256', signingSecret).update(baseString).digest('hex')}`

  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (signatureBuffer.length !== expectedBuffer.length) return false

  return timingSafeEqual(signatureBuffer, expectedBuffer)
}

/**
 * POST /api/webhooks/slack
 * Receive events from Slack
 */
export async function POST(request: NextRequest) {
  try {
    const signingSecret = process.env.SLACK_SIGNING_SECRET
    if (!signingSecret) {
      console.error('[Slack Webhook] SLACK_SIGNING_SECRET not configured')
      return NextResponse.json({ error: 'Slack signing secret not configured' }, { status: 500 })
    }

    const rawBody = await request.text()
    if (!verifySlackSignature(request, rawBody, signingSecret)) {
      return NextResponse.json({ error: 'Invalid Slack signature' }, { status: 401 })
    }

    const event: SlackEvent = JSON.parse(rawBody)
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
    const now = new Date()
    await prisma.session.update({
      where: { id: session.id },
      data: {
        lastActivity: now,
        lastOperatorActivity: now,
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

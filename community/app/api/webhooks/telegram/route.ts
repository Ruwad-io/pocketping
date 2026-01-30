import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { parseWebhookUpdate, getFileUrl, type TelegramUpdate } from '@/lib/bridges/telegram'
import { emitToSession } from '@/lib/sse'

/**
 * POST /api/webhooks/telegram
 * Receive updates from Telegram
 */
export async function POST(request: NextRequest) {
  try {
    // Verify secret token if configured
    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET
    if (secretToken) {
      const headerToken = request.headers.get('x-telegram-bot-api-secret-token')
      if (headerToken !== secretToken) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const update: TelegramUpdate = await request.json()
    const parsed = parseWebhookUpdate(update)

    if (parsed.type === 'unknown') {
      return NextResponse.json({ ok: true })
    }

    // Find session by topic ID
    if (!parsed.topicId) {
      return NextResponse.json({ ok: true })
    }

    const session = await prisma.session.findFirst({
      where: { telegramTopicId: String(parsed.topicId) },
      include: { project: true },
    })

    if (!session) {
      return NextResponse.json({ ok: true })
    }

    if (parsed.type === 'message') {
      // Handle operator message
      let content = parsed.text || ''

      // Handle media
      if (parsed.media) {
        const fileUrl = await getFileUrl(session.project.telegramBotToken!, parsed.media.fileId)
        if (fileUrl) {
          // For now, append file URL to content
          content = content
            ? `${content}\n\n📎 ${parsed.media.filename}: ${fileUrl}`
            : `📎 ${parsed.media.filename}: ${fileUrl}`
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
          telegramMessageId: parsed.messageId,
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
          operatorName: parsed.operatorName,
        },
      })
    } else if (parsed.type === 'edit') {
      // Handle message edit
      if (!parsed.messageId || !parsed.text) {
        return NextResponse.json({ ok: true })
      }

      const message = await prisma.message.findFirst({
        where: {
          sessionId: session.id,
          telegramMessageId: parsed.messageId,
        },
      })

      if (message) {
        await prisma.message.update({
          where: { id: message.id },
          data: {
            content: parsed.text,
            editedAt: new Date(),
          },
        })

        emitToSession(session.id, {
          type: 'message_edited',
          data: {
            id: message.id,
            content: parsed.text,
          },
        })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Telegram Webhook] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// Handle GET for webhook verification
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}

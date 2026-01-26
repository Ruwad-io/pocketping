import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { extractApiKey, validatePublicKey } from '@/lib/auth'
import { sendVisitorMessageToBridges } from '@/lib/bridges'

/**
 * POST /api/widget/messages
 * Send a message from visitor
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
    const { sessionId, content, attachments, replyToId } = body

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    if (!content && (!attachments || attachments.length === 0)) {
      return NextResponse.json({ error: 'content or attachments required' }, { status: 400 })
    }

    // Verify session belongs to project
    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        projectId: auth.project.id,
      },
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Create message
    const message = await prisma.message.create({
      data: {
        sessionId,
        content: content || '',
        sender: 'VISITOR',
        replyToId,
        attachments: attachments
          ? {
              create: attachments.map((a: { filename: string; mimeType: string; size: number; url: string }) => ({
                filename: a.filename,
                mimeType: a.mimeType,
                size: a.size,
                url: a.url,
                status: 'READY',
              })),
            }
          : undefined,
      },
      include: {
        attachments: true,
      },
    })

    // Update session activity
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        lastActivity: new Date(),
        unreadCount: { increment: 1 },
      },
    })

    // Send to bridges (async)
    sendVisitorMessageToBridges(message, session).catch((err) => {
      console.error('[Widget] Failed to send to bridges:', err)
    })

    return NextResponse.json({
      id: message.id,
      content: message.content,
      sender: message.sender,
      createdAt: message.createdAt,
      attachments: message.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        url: a.url,
      })),
    })
  } catch (error) {
    console.error('[Widget] Message error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/widget/messages
 * Get messages for a session
 */
export async function GET(request: NextRequest) {
  const apiKey = extractApiKey(request)
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 401 })
  }

  const auth = await validatePublicKey(apiKey)
  if (!auth) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const after = searchParams.get('after')

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    // Verify session belongs to project
    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        projectId: auth.project.id,
      },
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Get messages
    const messages = await prisma.message.findMany({
      where: {
        sessionId,
        deletedAt: null,
        ...(after ? { createdAt: { gt: new Date(after) } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { attachments: true },
    })

    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m.id,
        content: m.content,
        sender: m.sender,
        createdAt: m.createdAt,
        editedAt: m.editedAt,
        replyToId: m.replyToId,
        attachments: m.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          url: a.url,
          thumbnailUrl: a.thumbnailUrl,
        })),
      })),
    })
  } catch (error) {
    console.error('[Widget] Get messages error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

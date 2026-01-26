import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { extractApiKey, validatePublicKey } from '@/lib/auth'
import { notifyNewSession } from '@/lib/bridges'

/**
 * POST /api/widget/init
 * Initialize a chat session
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
    const { visitorId, url, referrer, userAgent } = body

    if (!visitorId) {
      return NextResponse.json({ error: 'visitorId is required' }, { status: 400 })
    }

    // Get IP and geo info from headers
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      null

    // Check for existing active session
    let session = await prisma.session.findFirst({
      where: {
        projectId: auth.project.id,
        visitorId,
        status: 'ACTIVE',
      },
      include: {
        messages: {
          take: 50,
          orderBy: { createdAt: 'asc' },
          include: { attachments: true },
        },
      },
    })

    if (!session) {
      // Create new session
      session = await prisma.session.create({
        data: {
          projectId: auth.project.id,
          visitorId,
          url,
          referrer,
          userAgent,
          ip,
        },
        include: {
          messages: {
            take: 50,
            orderBy: { createdAt: 'asc' },
            include: { attachments: true },
          },
        },
      })

      // Notify bridges (async, don't wait)
      notifyNewSession(session).catch((err) => {
        console.error('[Widget] Failed to notify bridges:', err)
      })
    }

    // Get project config for widget
    const project = await prisma.project.findUnique({
      where: { id: auth.project.id },
      select: {
        operatorName: true,
        operatorAvatar: true,
        primaryColor: true,
        welcomeMessage: true,
        preChatFormEnabled: true,
        preChatFormRequired: true,
        preChatFormTiming: true,
        preChatFormFields: true,
      },
    })

    return NextResponse.json({
      sessionId: session.id,
      messages: session.messages.map((m) => ({
        id: m.id,
        content: m.content,
        sender: m.sender,
        createdAt: m.createdAt,
        attachments: m.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          url: a.url,
          thumbnailUrl: a.thumbnailUrl,
        })),
      })),
      config: {
        operatorName: project?.operatorName,
        operatorAvatar: project?.operatorAvatar,
        primaryColor: project?.primaryColor,
        welcomeMessage: project?.welcomeMessage,
        preChatForm: project?.preChatFormEnabled
          ? {
              required: project.preChatFormRequired,
              timing: project.preChatFormTiming,
              fields: project.preChatFormFields,
            }
          : null,
      },
    })
  } catch (error) {
    console.error('[Widget] Init error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

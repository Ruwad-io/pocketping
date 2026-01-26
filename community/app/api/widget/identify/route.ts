import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { extractApiKey, validatePublicKey } from '@/lib/auth'

/**
 * POST /api/widget/identify
 * Update visitor identity (pre-chat form data)
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
    const { sessionId, email, phone, phoneCountry } = body

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

    // Update session with identity
    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: {
        userEmail: email || undefined,
        userPhone: phone || undefined,
        userPhoneCountry: phoneCountry || undefined,
      },
    })

    return NextResponse.json({
      success: true,
      sessionId: updated.id,
    })
  } catch (error) {
    console.error('[Widget] Identify error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

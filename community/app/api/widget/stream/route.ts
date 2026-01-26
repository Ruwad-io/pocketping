import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { extractApiKey, validatePublicKey } from '@/lib/auth'
import { addClient, removeClient } from '@/lib/sse'

/**
 * GET /api/widget/stream
 * SSE endpoint for real-time updates
 */
export async function GET(request: NextRequest) {
  const apiKey = extractApiKey(request)
  if (!apiKey) {
    return new Response('Unauthorized', { status: 401 })
  }

  const auth = await validatePublicKey(apiKey)
  if (!auth) {
    return new Response('Invalid API key', { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return new Response('sessionId required', { status: 400 })
  }

  // Verify session belongs to project
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      projectId: auth.project.id,
    },
  })

  if (!session) {
    return new Response('Session not found', { status: 404 })
  }

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      const encoder = new TextEncoder()
      controller.enqueue(encoder.encode('event: connected\ndata: {}\n\n'))

      // Add client to session
      addClient(sessionId, controller)

      // Keep-alive ping every 30 seconds
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          clearInterval(pingInterval)
        }
      }, 30000)

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        clearInterval(pingInterval)
        removeClient(sessionId, controller)
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    },
    cancel() {
      // Stream cancelled
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

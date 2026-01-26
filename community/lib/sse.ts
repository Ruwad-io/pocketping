/**
 * Server-Sent Events (SSE) Manager
 * Simple in-memory implementation for real-time updates
 */

type SSEClient = {
  sessionId: string
  controller: ReadableStreamDefaultController
}

const clients: Map<string, SSEClient[]> = new Map()

/**
 * Add a client to the session
 */
export function addClient(sessionId: string, controller: ReadableStreamDefaultController) {
  const sessionClients = clients.get(sessionId) || []
  sessionClients.push({ sessionId, controller })
  clients.set(sessionId, sessionClients)
}

/**
 * Remove a client from the session
 */
export function removeClient(sessionId: string, controller: ReadableStreamDefaultController) {
  const sessionClients = clients.get(sessionId)
  if (!sessionClients) return

  const index = sessionClients.findIndex((c) => c.controller === controller)
  if (index !== -1) {
    sessionClients.splice(index, 1)
  }

  if (sessionClients.length === 0) {
    clients.delete(sessionId)
  } else {
    clients.set(sessionId, sessionClients)
  }
}

/**
 * Emit an event to all clients of a session
 */
export function emitToSession(sessionId: string, event: { type: string; data: unknown }) {
  const sessionClients = clients.get(sessionId)
  if (!sessionClients) return

  const message = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
  const encoder = new TextEncoder()
  const data = encoder.encode(message)

  for (const client of sessionClients) {
    try {
      client.controller.enqueue(data)
    } catch {
      // Client disconnected, will be cleaned up
    }
  }
}

/**
 * Get count of active clients for a session
 */
export function getClientCount(sessionId: string): number {
  return clients.get(sessionId)?.length || 0
}

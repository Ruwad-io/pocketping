import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './db'

/**
 * API Key Authentication for Community Edition
 *
 * Two types of keys:
 * - publicKey: For widget (client-side, read-only operations)
 * - secretKey: For admin operations (server-side)
 */

export interface AuthContext {
  project: {
    id: string
    name: string
    publicKey: string
    secretKey: string
    // AI settings
    aiEnabled: boolean
    aiProvider: string | null
    aiApiKey: string | null
    aiModel: string | null
    aiSystemPrompt: string | null
    aiTakeoverDelay: number
  }
}

/**
 * Validate public API key (for widget endpoints)
 */
export async function validatePublicKey(key: string): Promise<AuthContext | null> {
  if (!key) return null

  const project = await prisma.project.findUnique({
    where: { publicKey: key },
    select: {
      id: true,
      name: true,
      publicKey: true,
      secretKey: true,
      aiEnabled: true,
      aiProvider: true,
      aiApiKey: true,
      aiModel: true,
      aiSystemPrompt: true,
      aiTakeoverDelay: true,
    },
  })

  if (!project) return null

  return { project }
}

/**
 * Validate secret API key (for admin endpoints)
 */
export async function validateSecretKey(key: string): Promise<AuthContext | null> {
  if (!key) return null

  const project = await prisma.project.findUnique({
    where: { secretKey: key },
    select: {
      id: true,
      name: true,
      publicKey: true,
      secretKey: true,
      aiEnabled: true,
      aiProvider: true,
      aiApiKey: true,
      aiModel: true,
      aiSystemPrompt: true,
      aiTakeoverDelay: true,
    },
  })

  if (!project) return null

  return { project }
}

/**
 * Extract API key from request
 * Supports: Authorization: Bearer <key> or X-API-Key: <key>
 */
export function extractApiKey(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  return request.headers.get('x-api-key')
}

/**
 * Middleware helper for public key auth
 */
export async function withPublicAuth(
  request: NextRequest,
  handler: (ctx: AuthContext) => Promise<NextResponse>
): Promise<NextResponse> {
  const key = extractApiKey(request)
  if (!key) {
    return NextResponse.json(
      { error: 'Missing API key' },
      { status: 401 }
    )
  }

  const ctx = await validatePublicKey(key)
  if (!ctx) {
    return NextResponse.json(
      { error: 'Invalid API key' },
      { status: 401 }
    )
  }

  return handler(ctx)
}

/**
 * Middleware helper for secret key auth
 */
export async function withSecretAuth(
  request: NextRequest,
  handler: (ctx: AuthContext) => Promise<NextResponse>
): Promise<NextResponse> {
  const key = extractApiKey(request)
  if (!key) {
    return NextResponse.json(
      { error: 'Missing API key' },
      { status: 401 }
    )
  }

  const ctx = await validateSecretKey(key)
  if (!ctx) {
    return NextResponse.json(
      { error: 'Invalid API key' },
      { status: 401 }
    )
  }

  return handler(ctx)
}

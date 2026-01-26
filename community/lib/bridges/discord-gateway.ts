/**
 * Discord Gateway - Persistent WebSocket connection for receiving messages
 * Community Edition
 *
 * This enables real-time message receiving from Discord operators.
 * Only works on persistent hosting (Docker, VPS) - NOT serverless.
 */

import WebSocket from 'ws'

const NS = 'DiscordGateway'
const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json'

// Gateway opcodes
const OP_DISPATCH = 0
const OP_HEARTBEAT = 1
const OP_IDENTIFY = 2
const OP_RESUME = 6
const OP_RECONNECT = 7
const OP_INVALID_SESSION = 9
const OP_HELLO = 10
const OP_HEARTBEAT_ACK = 11

// Intents
const INTENT_GUILDS = 1 << 0
const INTENT_GUILD_MESSAGES = 1 << 9
const INTENT_MESSAGE_CONTENT = 1 << 15

export interface DiscordGatewayConfig {
  botToken: string
  channelId: string // Forum channel ID for threads
  allowedBotIds?: string[]
  onOperatorMessage: (params: {
    threadId: string
    content: string
    operatorName: string
    attachments: DiscordGatewayAttachment[]
    messageId: string
    replyToMessageId?: string
  }) => void | Promise<void>
  onOperatorMessageEdit?: (params: {
    threadId: string
    messageId: string
    content: string
    editedAt?: Date
  }) => void | Promise<void>
  onOperatorMessageDelete?: (params: {
    threadId: string
    messageId: string
    deletedAt?: Date
  }) => void | Promise<void>
}

export interface DiscordGatewayAttachment {
  id: string
  filename: string
  contentType: string
  size: number
  url: string
  proxyUrl: string
}

interface GatewayPayload {
  op: number
  d?: unknown
  s?: number | null
  t?: string | null
}

interface HelloPayload {
  heartbeat_interval: number
}

interface ReadyPayload {
  session_id: string
  resume_gateway_url: string
}

interface MessageCreatePayload {
  id: string
  channel_id: string
  content: string
  author: {
    id: string
    username: string
    bot?: boolean
  }
  attachments?: Array<{
    id: string
    filename: string
    content_type?: string
    size: number
    url: string
    proxy_url: string
  }>
  message_reference?: {
    message_id?: string
    channel_id?: string
    guild_id?: string
  }
}

interface MessageUpdatePayload {
  id: string
  channel_id: string
  content?: string
  edited_timestamp?: string
  author?: {
    id: string
    username: string
    bot?: boolean
  }
}

interface MessageDeletePayload {
  id: string
  channel_id: string
  guild_id?: string
}

export class DiscordGateway {
  private config: DiscordGatewayConfig
  private ws: WebSocket | null = null
  private sessionId: string | null = null
  private resumeUrl: string | null = null
  private sequence: number | null = null
  private heartbeatInterval: number | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private lastHeartbeatAck: boolean = true
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private isConnecting = false
  private isClosing = false

  constructor(config: DiscordGatewayConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      console.log('⚠️ [DiscordGateway] Already connected or connecting')
      return
    }

    this.isConnecting = true
    this.isClosing = false

    try {
      const url = this.resumeUrl || DISCORD_GATEWAY_URL
      console.log(`🔌 [DiscordGateway] Connecting to Discord Gateway...`)

      this.ws = new WebSocket(url)

      this.ws.on('open', () => {
        console.log('🟢 [DiscordGateway] WebSocket connected')
        this.reconnectAttempts = 0
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const payload = JSON.parse(data.toString()) as GatewayPayload
          this.handlePayload(payload)
        } catch (err) {
          console.error('🔴 [DiscordGateway] Failed to parse message:', err)
        }
      })

      this.ws.on('close', (code: number, reason: Buffer) => {
        console.log(`🔶 [DiscordGateway] WebSocket closed: ${code} - ${reason.toString()}`)
        this.stopHeartbeat()
        this.ws = null
        this.isConnecting = false

        if (!this.isClosing) {
          this.attemptReconnect()
        }
      })

      this.ws.on('error', (err: Error) => {
        console.error('🔴 [DiscordGateway] WebSocket error:', err.message)
      })
    } catch (err) {
      console.error('🔴 [DiscordGateway] Connection failed:', err)
      this.isConnecting = false
      this.attemptReconnect()
    }
  }

  close(): void {
    console.log('🔷 [DiscordGateway] Closing gateway connection')
    this.isClosing = true
    this.stopHeartbeat()

    if (this.ws) {
      this.ws.close(1000, 'Normal closure')
      this.ws = null
    }

    this.sessionId = null
    this.resumeUrl = null
    this.sequence = null
  }

  private handlePayload(payload: GatewayPayload): void {
    if (payload.s !== null && payload.s !== undefined) {
      this.sequence = payload.s
    }

    switch (payload.op) {
      case OP_HELLO:
        this.handleHello(payload.d as HelloPayload)
        break

      case OP_HEARTBEAT:
        this.sendHeartbeat()
        break

      case OP_HEARTBEAT_ACK:
        this.lastHeartbeatAck = true
        break

      case OP_RECONNECT:
        console.log('🔷 [DiscordGateway] Received reconnect request')
        this.reconnect()
        break

      case OP_INVALID_SESSION:
        const canResume = payload.d as boolean
        console.log(`🔷 [DiscordGateway] Invalid session, can resume: ${canResume}`)
        if (!canResume) {
          this.sessionId = null
          this.resumeUrl = null
          this.sequence = null
        }
        setTimeout(() => this.identify(), 5000)
        break

      case OP_DISPATCH:
        this.handleDispatch(payload.t!, payload.d)
        break
    }
  }

  private handleHello(data: HelloPayload): void {
    console.log(`🔷 [DiscordGateway] Hello received, heartbeat interval: ${data.heartbeat_interval}ms`)
    this.heartbeatInterval = data.heartbeat_interval
    this.startHeartbeat()

    if (this.sessionId && this.sequence !== null) {
      this.resume()
    } else {
      this.identify()
    }
  }

  private handleDispatch(eventType: string, data: unknown): void {
    switch (eventType) {
      case 'READY':
        const ready = data as ReadyPayload
        this.sessionId = ready.session_id
        this.resumeUrl = ready.resume_gateway_url
        this.isConnecting = false
        console.log(`✅ [DiscordGateway] Connected with session: ${this.sessionId}`)
        break

      case 'RESUMED':
        this.isConnecting = false
        console.log('✅ [DiscordGateway] Session resumed')
        break

      case 'MESSAGE_CREATE':
        this.handleMessageCreate(data as MessageCreatePayload)
        break
      case 'MESSAGE_UPDATE':
        this.handleMessageUpdate(data as MessageUpdatePayload)
        break
      case 'MESSAGE_DELETE':
        this.handleMessageDelete(data as MessageDeletePayload)
        break
    }
  }

  private handleMessageCreate(msg: MessageCreatePayload): void {
    // Skip bot messages
    if (msg.author.bot && !this.isAllowedBot(msg.author.id)) {
      console.log(`⏭️ [DiscordGateway] Skipping bot message from ${msg.author.username}`)
      return
    }

    console.log(`📩 [DiscordGateway] Message received in channel ${msg.channel_id} from ${msg.author.username}: "${msg.content.substring(0, 50)}..."`)

    // Convert attachments
    const attachments: DiscordGatewayAttachment[] = (msg.attachments || []).map((att) => ({
      id: att.id,
      filename: att.filename,
      contentType: att.content_type || 'application/octet-stream',
      size: att.size,
      url: att.url,
      proxyUrl: att.proxy_url,
    }))

    // Get reply reference if present
    const replyToMessageId = msg.message_reference?.message_id

    // Call the callback
    try {
      this.config.onOperatorMessage({
        threadId: msg.channel_id,
        content: msg.content,
        operatorName: msg.author.username,
        attachments,
        messageId: msg.id,
        replyToMessageId,
      })
    } catch (err) {
      console.error('🔴 [DiscordGateway] Error in onOperatorMessage callback:', err)
    }
  }

  private handleMessageUpdate(msg: MessageUpdatePayload): void {
    if (msg.author?.bot && !this.isAllowedBot(msg.author.id)) {
      return
    }

    if (!this.config.onOperatorMessageEdit) {
      return
    }

    if (msg.content === undefined) {
      return
    }

    try {
      this.config.onOperatorMessageEdit({
        threadId: msg.channel_id,
        messageId: msg.id,
        content: msg.content ?? '',
        editedAt: msg.edited_timestamp ? new Date(msg.edited_timestamp) : undefined,
      })
    } catch (err) {
      console.error('🔴 [DiscordGateway] Error in onOperatorMessageEdit callback:', err)
    }
  }

  private handleMessageDelete(msg: MessageDeletePayload): void {
    if (!this.config.onOperatorMessageDelete) {
      return
    }

    try {
      this.config.onOperatorMessageDelete({
        threadId: msg.channel_id,
        messageId: msg.id,
        deletedAt: new Date(),
      })
    } catch (err) {
      console.error('🔴 [DiscordGateway] Error in onOperatorMessageDelete callback:', err)
    }
  }

  private isAllowedBot(botId?: string): boolean {
    if (!botId) return false
    return this.config.allowedBotIds?.includes(botId) ?? false
  }

  private identify(): void {
    console.log('🔷 [DiscordGateway] Sending IDENTIFY')
    this.send({
      op: OP_IDENTIFY,
      d: {
        token: this.config.botToken,
        intents: INTENT_GUILDS | INTENT_GUILD_MESSAGES | INTENT_MESSAGE_CONTENT,
        properties: {
          os: 'linux',
          browser: 'pocketping-community',
          device: 'pocketping-community',
        },
      },
    })
  }

  private resume(): void {
    console.log('🔷 [DiscordGateway] Sending RESUME')
    this.send({
      op: OP_RESUME,
      d: {
        token: this.config.botToken,
        session_id: this.sessionId,
        seq: this.sequence,
      },
    })
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()

    if (!this.heartbeatInterval) return

    this.lastHeartbeatAck = true
    this.heartbeatTimer = setInterval(() => {
      if (!this.lastHeartbeatAck) {
        console.log('⚠️ [DiscordGateway] Heartbeat timeout, reconnecting...')
        this.reconnect()
        return
      }

      this.lastHeartbeatAck = false
      this.sendHeartbeat()
    }, this.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private sendHeartbeat(): void {
    this.send({
      op: OP_HEARTBEAT,
      d: this.sequence,
    })
  }

  private send(payload: GatewayPayload): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('⚠️ [DiscordGateway] Cannot send, WebSocket not open')
      return
    }

    this.ws.send(JSON.stringify(payload))
  }

  private reconnect(): void {
    this.stopHeartbeat()

    if (this.ws) {
      this.ws.close(4000, 'Reconnecting')
      this.ws = null
    }

    setTimeout(() => this.connect(), 5000)
  }

  private attemptReconnect(): void {
    if (this.isClosing || this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`🔴 [DiscordGateway] Max reconnect attempts (${this.maxReconnectAttempts}) reached`)
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    console.log(`🔷 [DiscordGateway] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    setTimeout(() => this.connect(), delay)
  }
}

// Global gateway manager
const activeGateways = new Map<string, DiscordGateway>()

export function startGateway(projectId: string, config: DiscordGatewayConfig): DiscordGateway {
  const existing = activeGateways.get(projectId)
  if (existing) {
    existing.close()
  }

  const gateway = new DiscordGateway(config)
  activeGateways.set(projectId, gateway)
  gateway.connect()

  return gateway
}

export function stopGateway(projectId: string): void {
  const gateway = activeGateways.get(projectId)
  if (gateway) {
    gateway.close()
    activeGateways.delete(projectId)
  }
}

export function getGateway(projectId: string): DiscordGateway | undefined {
  return activeGateways.get(projectId)
}

export function stopAllGateways(): void {
  for (const gateway of activeGateways.values()) {
    gateway.close()
  }
  activeGateways.clear()
}

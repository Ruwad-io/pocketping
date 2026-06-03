/** Thin client for the PocketPing management API (`/api/v1`). */
export class PocketPingClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {}

  private async request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })

    const text = await res.text()
    let data: unknown
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { raw: text }
    }

    if (!res.ok) {
      const message =
        (data as { error?: string })?.error ?? `Request failed with HTTP ${res.status}`
      throw new Error(message)
    }
    return data as T
  }

  me() {
    return this.request('/me')
  }

  listProjects() {
    return this.request('/projects')
  }

  listSessions(params: {
    projectId?: string
    status?: string
    unanswered?: boolean
    q?: string
    limit?: number
  }) {
    const qs = new URLSearchParams()
    if (params.projectId) qs.set('projectId', params.projectId)
    if (params.status) qs.set('status', params.status)
    if (params.unanswered) qs.set('unanswered', 'true')
    if (params.q) qs.set('q', params.q)
    if (params.limit) qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return this.request(`/sessions${suffix}`)
  }

  getConversation(sessionId: string) {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}`)
  }

  reply(sessionId: string, content: string, operatorName?: string) {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ content, operatorName }),
    })
  }

  getStats(params: { projectId?: string; period?: string }) {
    const qs = new URLSearchParams()
    if (params.projectId) qs.set('projectId', params.projectId)
    if (params.period) qs.set('period', params.period)
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return this.request(`/stats${suffix}`)
  }
}

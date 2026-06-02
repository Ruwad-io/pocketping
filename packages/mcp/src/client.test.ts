import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PocketPingClient } from './client.js'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) } as Response
}

const client = new PocketPingClient('ppk_test', 'https://app.pocketping.io')

describe('PocketPingClient', () => {
  it('sends the Bearer key and hits /api/v1', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ organization: { id: 'org_1' } }))
    await client.me()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://app.pocketping.io/api/v1/me')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ppk_test')
  })

  it('builds the sessions query string from params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ sessions: [] }))
    await client.listSessions({ unanswered: true, projectId: 'p1', limit: 10 })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/sessions?')
    expect(url).toContain('unanswered=true')
    expect(url).toContain('projectId=p1')
    expect(url).toContain('limit=10')
  })

  it('omits the query string when no params are given', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ sessions: [] }))
    await client.listSessions({})
    expect(fetchMock.mock.calls[0][0]).toBe('https://app.pocketping.io/api/v1/sessions')
  })

  it('POSTs a reply with content and operatorName', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    await client.reply('s1', 'hello', 'Sam')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://app.pocketping.io/api/v1/sessions/s1/reply')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hello', operatorName: 'Sam' })
  })

  it('url-encodes the session id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await client.getConversation('a/b c')
    expect(fetchMock.mock.calls[0][0]).toBe('https://app.pocketping.io/api/v1/sessions/a%2Fb%20c')
  })

  it('throws the API error message on non-2xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Session not found' }, false, 404))
    await expect(client.getConversation('nope')).rejects.toThrow('Session not found')
  })
})

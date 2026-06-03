import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { stats } from './stats.js'

const fetchMock = vi.fn()
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

const SAMPLE = {
  period: '7d',
  conversations: 12,
  conversationsSparkline: [0, 1, 2, 3, 1, 4, 1],
  messages: 40,
  responseRate: 0.75,
  medianFirstResponseSeconds: 90,
  unansweredNow: 2,
  csat: { percent: 0.8, average: 4.2, responses: 5 },
  truncated: false,
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body), json: async () => body } as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  logSpy.mockClear()
  process.env.POCKETPING_API_KEY = 'ppk_test'
  delete process.env.POCKETPING_API_URL
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.POCKETPING_API_KEY
})

describe('stats command', () => {
  it('throws a helpful error when the API key is missing', async () => {
    delete process.env.POCKETPING_API_KEY
    await expect(stats({})).rejects.toThrow(/POCKETPING_API_KEY/)
  })

  it('calls /api/v1/stats with the default period and Bearer key', async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE))
    await stats({})
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://app.pocketping.io/api/v1/stats?period=7d')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ppk_test')
  })

  it('passes project and period, and honors a custom API URL', async () => {
    process.env.POCKETPING_API_URL = 'https://self.example.com/'
    fetchMock.mockResolvedValue(jsonResponse({ ...SAMPLE, period: '30d' }))
    await stats({ project: 'p1', period: '30d' })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe('https://self.example.com/api/v1/stats?period=30d&projectId=p1')
  })

  it('prints raw JSON with --json', async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE))
    await stats({ json: true })
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(SAMPLE, null, 2))
  })

  it('rejects an invalid --period instead of coercing', async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE))
    await expect(stats({ period: '14d' })).rejects.toThrow(/Invalid --period.*7d or 30d/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces the API error message on non-2xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Invalid or missing API key.' }, false, 401))
    await expect(stats({})).rejects.toThrow('Invalid or missing API key.')
  })
})

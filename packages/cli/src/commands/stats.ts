import chalk from 'chalk'
import { loadEnv } from '../utils/env.js'
import { box, COLORS, banner } from '../utils/ui.js'

const DEFAULT_API_URL = 'https://app.pocketping.io'

interface Stats {
  period: string
  conversations: number
  conversationsSparkline: number[]
  messages: number
  responseRate: number
  medianFirstResponseSeconds: number | null
  unansweredNow: number
  csat: { percent: number | null; average: number | null; responses: number }
  byProject?: Array<{ projectName: string; conversations: number; csatPercent: number | null }>
  truncated: boolean
}

export interface StatsOptions {
  project?: string
  period?: string
  json?: boolean
}

/** Unicode block sparkline from a numeric series. */
function sparkline(data: number[]): string {
  if (data.length === 0) return ''
  const blocks = '▁▂▃▄▅▆▇█'
  const max = Math.max(...data, 1)
  return data.map((v) => blocks[Math.min(blocks.length - 1, Math.round((v / max) * (blocks.length - 1)))]).join('')
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`
}

function pct(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

/**
 * `pocketping stats` — print mini support stats from the management API.
 *
 * Reads POCKETPING_API_KEY (required) and POCKETPING_API_URL (defaults to the
 * hosted SaaS; point it at a self-hosted instance to read its stats). Works
 * against any deployment exposing the `/api/v1/stats` shape.
 */
export async function stats(options: StatsOptions = {}): Promise<void> {
  const env = await loadEnv()
  const apiKey = process.env.POCKETPING_API_KEY || env.POCKETPING_API_KEY
  const apiUrl = (process.env.POCKETPING_API_URL || env.POCKETPING_API_URL || DEFAULT_API_URL).replace(
    /\/$/,
    ''
  )

  if (!apiKey) {
    throw new Error(
      'POCKETPING_API_KEY is not set. Create an API key in your dashboard ' +
        '(Settings → API keys) and export POCKETPING_API_KEY=ppk_…'
    )
  }

  const period = options.period === '30d' ? '30d' : '7d'
  const qs = new URLSearchParams({ period })
  if (options.project) qs.set('projectId', options.project)

  const res = await fetch(`${apiUrl}/api/v1/stats?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = `Request failed with HTTP ${res.status}`
    try {
      message = (JSON.parse(text) as { error?: string }).error || message
    } catch {
      /* keep default */
    }
    throw new Error(message)
  }

  const data = (await res.json()) as Stats

  if (options.json) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  const spark = sparkline(data.conversationsSparkline)
  const lines = [
    `${chalk.dim('Conversations')}      ${chalk.bold(String(data.conversations))}  ${chalk.hex(COLORS.brand)(spark)}`,
    `${chalk.dim('Messages')}           ${chalk.bold(String(data.messages))}`,
    `${chalk.dim('Response rate')}      ${chalk.bold(pct(data.responseRate))}`,
    `${chalk.dim('Median 1st reply')}   ${chalk.bold(formatDuration(data.medianFirstResponseSeconds))}`,
    `${chalk.dim('Unanswered now')}     ${chalk.bold(String(data.unansweredNow))}`,
    `${chalk.dim('CSAT')}               ${chalk.bold(pct(data.csat.percent))}  ${chalk.dim(
      data.csat.responses > 0 ? `(${data.csat.responses} rated)` : '(no ratings)'
    )}`,
  ]

  if (data.byProject && data.byProject.length > 1) {
    lines.push(chalk.dim('─'.repeat(20)))
    for (const p of data.byProject.slice(0, 6)) {
      lines.push(
        `${chalk.dim(p.projectName.slice(0, 18).padEnd(18))} ${String(p.conversations).padStart(4)}  ${chalk.dim(
          'CSAT'
        )} ${pct(p.csatPercent)}`
      )
    }
  }

  if (data.truncated) {
    lines.push(chalk.yellow('⚠ partial — too many conversations to scan fully'))
  }

  console.log('\n' + banner() + '\n')
  console.log(box(`Support stats · ${period}`, lines))
  console.log()
}

import * as p from '@clack/prompts'
import chalk from 'chalk'
import { loadEnv } from '../utils/env.js'
import { box, COLORS, banner } from '../utils/ui.js'
import {
  validateDiscordToken,
  validateDiscordChannel,
  validateSlackToken,
  validateSlackChannel,
  validateTelegramToken,
  validateTelegramChat,
} from '../utils/validate.js'

interface CheckResult {
  name: string
  status: 'ok' | 'warn' | 'error' | 'skip'
  message: string
}

interface BridgeReport {
  bridge: string
  color: string
  checks: CheckResult[]
}

async function checkDiscord(env: Record<string, string>): Promise<BridgeReport> {
  const checks: CheckResult[] = []
  if (!env.DISCORD_BOT_TOKEN) {
    checks.push({ name: 'Configuration', status: 'skip', message: 'Not configured' })
    return { bridge: 'Discord', color: COLORS.discord, checks }
  }

  const token = await validateDiscordToken(env.DISCORD_BOT_TOKEN)
  if (!token.valid) {
    checks.push({ name: 'Bot Token', status: 'error', message: token.error || 'Invalid token' })
    return { bridge: 'Discord', color: COLORS.discord, checks }
  }
  checks.push({ name: 'Bot Token', status: 'ok', message: `Valid — ${token.botName}` })

  if (!env.DISCORD_CHANNEL_ID) {
    checks.push({ name: 'Channel', status: 'warn', message: 'DISCORD_CHANNEL_ID not set' })
  } else {
    const channel = await validateDiscordChannel(env.DISCORD_BOT_TOKEN, env.DISCORD_CHANNEL_ID)
    checks.push(
      channel.valid
        ? { name: 'Channel', status: 'ok', message: `#${channel.channelName} (${channel.channelType})` }
        : { name: 'Channel', status: 'error', message: channel.error || 'Invalid channel' }
    )
  }
  return { bridge: 'Discord', color: COLORS.discord, checks }
}

async function checkSlack(env: Record<string, string>): Promise<BridgeReport> {
  const checks: CheckResult[] = []
  if (!env.SLACK_BOT_TOKEN) {
    checks.push({ name: 'Configuration', status: 'skip', message: 'Not configured' })
    return { bridge: 'Slack', color: COLORS.slack, checks }
  }

  const token = await validateSlackToken(env.SLACK_BOT_TOKEN)
  if (!token.valid) {
    checks.push({ name: 'Bot Token', status: 'error', message: token.error || 'Invalid token' })
    return { bridge: 'Slack', color: COLORS.slack, checks }
  }
  checks.push({ name: 'Bot Token', status: 'ok', message: `Valid — ${token.teamName}` })

  if (!env.SLACK_CHANNEL_ID) {
    checks.push({ name: 'Channel', status: 'warn', message: 'SLACK_CHANNEL_ID not set' })
  } else {
    const channel = await validateSlackChannel(env.SLACK_BOT_TOKEN, env.SLACK_CHANNEL_ID)
    checks.push(
      channel.valid
        ? { name: 'Channel', status: 'ok', message: `#${channel.channelName}${channel.isPrivate ? ' (private)' : ''}` }
        : { name: 'Channel', status: 'error', message: channel.error || 'Invalid channel' }
    )
  }
  return { bridge: 'Slack', color: COLORS.slack, checks }
}

async function checkTelegram(env: Record<string, string>): Promise<BridgeReport> {
  const checks: CheckResult[] = []
  if (!env.TELEGRAM_BOT_TOKEN) {
    checks.push({ name: 'Configuration', status: 'skip', message: 'Not configured' })
    return { bridge: 'Telegram', color: COLORS.telegram, checks }
  }

  const token = await validateTelegramToken(env.TELEGRAM_BOT_TOKEN)
  if (!token.valid) {
    checks.push({ name: 'Bot Token', status: 'error', message: token.error || 'Invalid token' })
    return { bridge: 'Telegram', color: COLORS.telegram, checks }
  }
  checks.push({ name: 'Bot Token', status: 'ok', message: `Valid — @${token.botUsername}` })

  if (!env.TELEGRAM_CHAT_ID) {
    checks.push({ name: 'Chat', status: 'warn', message: 'TELEGRAM_CHAT_ID not set' })
  } else {
    const chat = await validateTelegramChat(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID)
    if (!chat.valid) {
      checks.push({ name: 'Chat', status: 'error', message: chat.error || 'Invalid chat' })
    } else {
      checks.push(
        chat.isForum
          ? { name: 'Chat', status: 'ok', message: `${chat.chatTitle} (Forum)` }
          : { name: 'Chat', status: 'warn', message: `${chat.chatTitle} — Topics not enabled` }
      )
    }
  }
  return { bridge: 'Telegram', color: COLORS.telegram, checks }
}

function icon(status: CheckResult['status']): string {
  switch (status) {
    case 'ok':
      return chalk.green('✓')
    case 'warn':
      return chalk.yellow('⚠')
    case 'error':
      return chalk.red('✗')
    default:
      return chalk.gray('○')
  }
}

function paintMessage(check: CheckResult): string {
  switch (check.status) {
    case 'error':
      return chalk.red(check.message)
    case 'warn':
      return chalk.yellow(check.message)
    case 'skip':
      return chalk.gray(check.message)
    default:
      return check.message
  }
}

export async function doctor() {
  console.clear()
  p.intro(chalk.bgHex(COLORS.brand).white(' PocketPing Doctor '))
  console.log(banner() + '\n')

  const env = await loadEnv()

  const s = p.spinner()
  s.start('Checking your bridges…')

  // All three bridges are validated concurrently — no reason to wait serially
  // on three independent sets of network round-trips.
  const reports = await Promise.all([checkDiscord(env), checkSlack(env), checkTelegram(env)])

  s.stop('Checks complete')
  console.log('')

  for (const { bridge, color, checks } of reports) {
    const lines = checks.map((c) => `${icon(c.status)} ${chalk.bold(c.name)}: ${paintMessage(c)}`)
    console.log(box(bridge, lines, color))
    console.log('')
  }

  const configured = reports.filter((r) => !r.checks.some((c) => c.status === 'skip')).length
  const hasErrors = reports.some((r) => r.checks.some((c) => c.status === 'error'))
  const hasWarnings = reports.some((r) => r.checks.some((c) => c.status === 'warn'))

  if (hasErrors) {
    p.outro(
      chalk.red(`${configured}/3 bridges configured, with errors.`) +
        '\nRun ' + chalk.cyan('npx @pocketping/cli init') + ' to fix them.'
    )
    process.exitCode = 1
  } else if (configured === 0) {
    p.outro(
      chalk.gray('No bridges configured yet.') +
        '\nRun ' + chalk.cyan('npx @pocketping/cli init') + ' to get started.'
    )
  } else if (hasWarnings) {
    p.outro(chalk.yellow(`${configured}/3 bridges configured, with warnings.`))
  } else {
    p.outro(chalk.green(`${configured}/3 bridges configured and healthy!`))
  }
}

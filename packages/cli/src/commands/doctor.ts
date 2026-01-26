import * as p from '@clack/prompts'
import chalk from 'chalk'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
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

export async function doctor() {
  console.clear()

  p.intro(chalk.bgHex('#6366f1').white(' PocketPing Doctor '))

  p.log.info('Checking your PocketPing configuration...\n')

  // Load .env file
  const envPath = join(process.cwd(), '.env')
  let envVars: Record<string, string> = {}

  if (existsSync(envPath)) {
    const content = await readFile(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.+)$/)
      if (match) {
        envVars[match[1]] = match[2]
      }
    }
  }

  const results: { bridge: string; checks: CheckResult[] }[] = []

  // Check Discord
  const discordChecks: CheckResult[] = []

  if (envVars.DISCORD_BOT_TOKEN) {
    const s = p.spinner()
    s.start('Checking Discord...')

    const tokenResult = await validateDiscordToken(envVars.DISCORD_BOT_TOKEN)

    if (tokenResult.valid) {
      discordChecks.push({
        name: 'Bot Token',
        status: 'ok',
        message: `Valid - ${tokenResult.botName}`,
      })

      if (envVars.DISCORD_CHANNEL_ID) {
        const channelResult = await validateDiscordChannel(
          envVars.DISCORD_BOT_TOKEN,
          envVars.DISCORD_CHANNEL_ID
        )

        if (channelResult.valid) {
          discordChecks.push({
            name: 'Channel',
            status: 'ok',
            message: `#${channelResult.channelName} (${channelResult.channelType})`,
          })
        } else {
          discordChecks.push({
            name: 'Channel',
            status: 'error',
            message: channelResult.error || 'Invalid channel',
          })
        }
      } else {
        discordChecks.push({
          name: 'Channel',
          status: 'warn',
          message: 'DISCORD_CHANNEL_ID not set',
        })
      }
    } else {
      discordChecks.push({
        name: 'Bot Token',
        status: 'error',
        message: tokenResult.error || 'Invalid token',
      })
    }

    s.stop('Discord checked')
  } else {
    discordChecks.push({
      name: 'Configuration',
      status: 'skip',
      message: 'Not configured',
    })
  }

  results.push({ bridge: 'Discord', checks: discordChecks })

  // Check Slack
  const slackChecks: CheckResult[] = []

  if (envVars.SLACK_BOT_TOKEN) {
    const s = p.spinner()
    s.start('Checking Slack...')

    const tokenResult = await validateSlackToken(envVars.SLACK_BOT_TOKEN)

    if (tokenResult.valid) {
      slackChecks.push({
        name: 'Bot Token',
        status: 'ok',
        message: `Valid - ${tokenResult.teamName}`,
      })

      if (envVars.SLACK_CHANNEL_ID) {
        const channelResult = await validateSlackChannel(
          envVars.SLACK_BOT_TOKEN,
          envVars.SLACK_CHANNEL_ID
        )

        if (channelResult.valid) {
          slackChecks.push({
            name: 'Channel',
            status: 'ok',
            message: `#${channelResult.channelName}${channelResult.isPrivate ? ' (private)' : ''}`,
          })
        } else {
          slackChecks.push({
            name: 'Channel',
            status: 'error',
            message: channelResult.error || 'Invalid channel',
          })
        }
      } else {
        slackChecks.push({
          name: 'Channel',
          status: 'warn',
          message: 'SLACK_CHANNEL_ID not set',
        })
      }
    } else {
      slackChecks.push({
        name: 'Bot Token',
        status: 'error',
        message: tokenResult.error || 'Invalid token',
      })
    }

    s.stop('Slack checked')
  } else {
    slackChecks.push({
      name: 'Configuration',
      status: 'skip',
      message: 'Not configured',
    })
  }

  results.push({ bridge: 'Slack', checks: slackChecks })

  // Check Telegram
  const telegramChecks: CheckResult[] = []

  if (envVars.TELEGRAM_BOT_TOKEN) {
    const s = p.spinner()
    s.start('Checking Telegram...')

    const tokenResult = await validateTelegramToken(envVars.TELEGRAM_BOT_TOKEN)

    if (tokenResult.valid) {
      telegramChecks.push({
        name: 'Bot Token',
        status: 'ok',
        message: `Valid - @${tokenResult.botUsername}`,
      })

      if (envVars.TELEGRAM_CHAT_ID) {
        const chatResult = await validateTelegramChat(
          envVars.TELEGRAM_BOT_TOKEN,
          envVars.TELEGRAM_CHAT_ID
        )

        if (chatResult.valid) {
          telegramChecks.push({
            name: 'Chat',
            status: chatResult.isForum ? 'ok' : 'warn',
            message: chatResult.isForum
              ? `${chatResult.chatTitle} (Forum)`
              : `${chatResult.chatTitle} - Topics not enabled`,
          })
        } else {
          telegramChecks.push({
            name: 'Chat',
            status: 'error',
            message: chatResult.error || 'Invalid chat',
          })
        }
      } else {
        telegramChecks.push({
          name: 'Chat',
          status: 'warn',
          message: 'TELEGRAM_CHAT_ID not set',
        })
      }
    } else {
      telegramChecks.push({
        name: 'Bot Token',
        status: 'error',
        message: tokenResult.error || 'Invalid token',
      })
    }

    s.stop('Telegram checked')
  } else {
    telegramChecks.push({
      name: 'Configuration',
      status: 'skip',
      message: 'Not configured',
    })
  }

  results.push({ bridge: 'Telegram', checks: telegramChecks })

  // Display results
  console.log('')

  for (const { bridge, checks } of results) {
    const bridgeColor =
      bridge === 'Discord' ? '#5865F2' : bridge === 'Slack' ? '#4A154B' : '#0088cc'

    console.log(chalk.hex(bridgeColor).bold(`┌─ ${bridge} ─────────────────────────────────────────┐`))

    for (const check of checks) {
      const icon =
        check.status === 'ok'
          ? chalk.green('✓')
          : check.status === 'warn'
          ? chalk.yellow('⚠')
          : check.status === 'error'
          ? chalk.red('✗')
          : chalk.gray('○')

      const message =
        check.status === 'error' ? chalk.red(check.message) :
        check.status === 'warn' ? chalk.yellow(check.message) :
        check.status === 'skip' ? chalk.gray(check.message) :
        check.message

      console.log(`  ${icon} ${check.name}: ${message}`)
    }

    console.log(chalk.hex(bridgeColor)('└──────────────────────────────────────────────────┘'))
    console.log('')
  }

  // Summary
  const configured = results.filter(
    (r) => !r.checks.some((c) => c.status === 'skip')
  ).length

  const hasErrors = results.some((r) => r.checks.some((c) => c.status === 'error'))
  const hasWarnings = results.some((r) => r.checks.some((c) => c.status === 'warn'))

  if (hasErrors) {
    p.outro(
      chalk.red(`${configured}/3 bridges configured with errors.`) +
        '\nRun ' +
        chalk.cyan('npx @pocketping/cli init') +
        ' to fix issues.'
    )
  } else if (hasWarnings) {
    p.outro(
      chalk.yellow(`${configured}/3 bridges configured with warnings.`) +
        '\nSome optional configuration is missing.'
    )
  } else if (configured === 0) {
    p.outro(
      chalk.gray('No bridges configured.') +
        '\nRun ' +
        chalk.cyan('npx @pocketping/cli init') +
        ' to get started.'
    )
  } else {
    p.outro(chalk.green(`${configured}/3 bridges configured and healthy!`))
  }
}

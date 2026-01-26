import * as p from '@clack/prompts'
import chalk from 'chalk'
import open from 'open'
import { validateSlackToken, validateSlackChannel } from '../utils/validate.js'

export async function setupSlack(): Promise<Record<string, string> | null> {
  p.log.info(chalk.hex('#4A154B')(`
┌─────────────────────────────────────────────────────────┐
│  💼 SLACK SETUP                                         │
└─────────────────────────────────────────────────────────┘
`))

  // Step 1: Create Slack App
  p.log.message(`
${chalk.bold('Step 1: Create a Slack App')}

  1. Go to ${chalk.cyan('https://api.slack.com/apps')}
  2. Click ${chalk.bold('"Create New App"')} → ${chalk.bold('"From scratch"')}
  3. Name your app (e.g., "PocketPing Support")
  4. Select your workspace → ${chalk.bold('"Create App"')}
`)

  const openSlackApi = await p.confirm({
    message: 'Open Slack API in browser?',
    initialValue: true,
  })

  if (p.isCancel(openSlackApi)) return null

  if (openSlackApi) {
    await open('https://api.slack.com/apps')
  }

  // Step 2: Configure Scopes
  p.log.message(`
${chalk.bold('Step 2: Add Bot Scopes')}

  1. Go to ${chalk.bold('OAuth & Permissions')} in the sidebar
  2. Scroll to ${chalk.bold('"Bot Token Scopes"')}
  3. Add these scopes:
     ${chalk.green('•')} chat:write
     ${chalk.green('•')} channels:read
     ${chalk.green('•')} channels:join
     ${chalk.green('•')} channels:history
     ${chalk.green('•')} groups:read
     ${chalk.green('•')} groups:history
     ${chalk.green('•')} users:read
`)

  await p.confirm({
    message: 'Have you added the bot scopes?',
    initialValue: true,
  })

  // Step 3: Install to Workspace
  p.log.message(`
${chalk.bold('Step 3: Install to Workspace')}

  1. Click ${chalk.bold('"Install to Workspace"')} button
  2. Review permissions and click ${chalk.bold('"Allow"')}
  3. Copy the ${chalk.bold('"Bot User OAuth Token"')} (starts with xoxb-)
`)

  const botToken = await p.password({
    message: 'Paste your Bot User OAuth Token (xoxb-...):',
    validate: (value) => {
      if (!value) return 'Bot token is required'
      if (!value.startsWith('xoxb-')) return 'Token should start with xoxb-'
      return undefined
    },
  })

  if (p.isCancel(botToken)) return null

  // Validate token
  const s = p.spinner()
  s.start('Validating token...')

  const tokenResult = await validateSlackToken(botToken)

  if (!tokenResult.valid) {
    s.stop('Invalid token')
    p.log.error(tokenResult.error || 'Could not validate token')
    return null
  }

  s.stop(`Token valid! Connected to: ${chalk.cyan(tokenResult.teamName)}`)

  // Step 4: Get Channel
  p.log.message(`
${chalk.bold('Step 4: Get Channel ID')}

  1. Right-click on your channel in Slack
  2. Click ${chalk.bold('"View channel details"')}
  3. Scroll down to find the ${chalk.bold('Channel ID')}
     (starts with C for public, G for private)

  ${chalk.yellow('Tip:')} For public channels, the bot will auto-join.
  For private channels, first invite the bot: /invite @YourBotName
`)

  const channelId = await p.text({
    message: 'Enter your Channel ID:',
    placeholder: 'C1234567890',
    validate: (value) => {
      if (!value) return 'Channel ID is required'
      if (!/^[CG][A-Z0-9]{8,}$/.test(value)) return 'Invalid channel ID format'
      return undefined
    },
  })

  if (p.isCancel(channelId)) return null

  // Validate channel
  s.start('Validating channel...')

  const channelResult = await validateSlackChannel(botToken, channelId)

  if (!channelResult.valid) {
    s.stop('Invalid channel')
    p.log.error(channelResult.error || 'Could not validate channel')
    return null
  }

  s.stop(`Channel found: ${chalk.cyan('#' + channelResult.channelName)}`)

  // Step 5: Event Subscriptions
  p.log.message(`
${chalk.bold('Step 5: Enable Events (for receiving messages)')}

  1. Go to ${chalk.bold('Event Subscriptions')} in the sidebar
  2. Turn on ${chalk.bold('"Enable Events"')}
  3. Set Request URL to your webhook endpoint:
     ${chalk.cyan('https://your-server.com/api/webhooks/slack')}
  4. Subscribe to bot events:
     ${chalk.green('•')} message.channels
     ${chalk.green('•')} message.groups
  5. Save Changes

  ${chalk.yellow('Note:')} You can configure this later when you deploy.
`)

  return {
    SLACK_BOT_TOKEN: botToken,
    SLACK_CHANNEL_ID: channelId,
  }
}

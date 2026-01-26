import * as p from '@clack/prompts'
import chalk from 'chalk'
import open from 'open'
import { validateDiscordToken, validateDiscordChannel } from '../utils/validate.js'

export async function setupDiscord(): Promise<Record<string, string> | null> {
  p.log.info(chalk.hex('#5865F2')(`
┌─────────────────────────────────────────────────────────┐
│  📱 DISCORD SETUP                                       │
└─────────────────────────────────────────────────────────┘
`))

  // Step 1: Create Bot
  p.log.message(`
${chalk.bold('Step 1: Create Discord Application')}

  1. Go to ${chalk.cyan('https://discord.com/developers/applications')}
  2. Click ${chalk.bold('"New Application"')} → Name it (e.g., "My Support Bot")
  3. Go to ${chalk.bold('Bot')} tab → ${chalk.bold('"Add Bot"')} → ${chalk.bold('"Yes, do it!"')}
  4. Under ${chalk.bold('Privileged Gateway Intents')}, enable:
     ${chalk.green('✓')} MESSAGE CONTENT INTENT
  5. Click ${chalk.bold('"Reset Token"')} → Copy the token
`)

  const openPortal = await p.confirm({
    message: 'Open Discord Developer Portal in browser?',
    initialValue: true,
  })

  if (p.isCancel(openPortal)) return null

  if (openPortal) {
    await open('https://discord.com/developers/applications')
  }

  const botToken = await p.password({
    message: 'Paste your Discord Bot Token:',
    validate: (value) => {
      if (!value) return 'Bot token is required'
      if (!value.includes('.')) return 'Invalid token format'
      return undefined
    },
  })

  if (p.isCancel(botToken)) return null

  // Validate token
  const s = p.spinner()
  s.start('Validating token...')

  const tokenResult = await validateDiscordToken(botToken)

  if (!tokenResult.valid) {
    s.stop('Invalid token')
    p.log.error(tokenResult.error || 'Could not validate token')
    return null
  }

  s.stop(`Token valid! Bot: ${chalk.cyan(tokenResult.botName)}`)

  // Step 2: Invite Bot
  p.log.message(`
${chalk.bold('Step 2: Invite Bot to Server')}

  Use the URL below to invite your bot to a Discord server.
  Select the server where you want to receive support messages.
`)

  const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${tokenResult.clientId}&permissions=326417514560&scope=bot`

  const openInvite = await p.confirm({
    message: 'Open bot invite URL in browser?',
    initialValue: true,
  })

  if (p.isCancel(openInvite)) return null

  if (openInvite) {
    await open(inviteUrl)
  } else {
    p.log.info(`Invite URL: ${chalk.cyan(inviteUrl)}`)
  }

  await p.confirm({
    message: 'Have you added the bot to your server?',
    initialValue: true,
  })

  // Step 3: Channel Type
  const channelType = await p.select({
    message: 'Which channel type do you want to use?',
    options: [
      {
        value: 'forum',
        label: 'Forum Channel (recommended)',
        hint: 'Each chat = new thread, organized view',
      },
      {
        value: 'text',
        label: 'Text Channel',
        hint: 'All chats in one channel, uses threads',
      },
    ],
  })

  if (p.isCancel(channelType)) return null

  // Step 4: Get Channel ID
  p.log.message(`
${chalk.bold('Step 3: Get Channel ID')}

  1. Enable ${chalk.bold('Developer Mode')} in Discord:
     User Settings → App Settings → Advanced → ${chalk.green('Developer Mode ON')}
  2. Right-click on your ${channelType === 'forum' ? 'forum' : 'text'} channel
  3. Click ${chalk.bold('"Copy Channel ID"')}
`)

  const channelId = await p.text({
    message: `Enter your ${channelType === 'forum' ? 'Forum' : 'Text'} Channel ID:`,
    placeholder: '1234567890123456789',
    validate: (value) => {
      if (!value) return 'Channel ID is required'
      if (!/^\d{17,20}$/.test(value)) return 'Invalid channel ID format'
      return undefined
    },
  })

  if (p.isCancel(channelId)) return null

  // Validate channel
  s.start('Validating channel...')

  const channelResult = await validateDiscordChannel(botToken, channelId)

  if (!channelResult.valid) {
    s.stop('Invalid channel')
    p.log.error(channelResult.error || 'Could not validate channel')
    return null
  }

  s.stop(`Channel found: ${chalk.cyan('#' + channelResult.channelName)} (${channelResult.channelType})`)

  return {
    DISCORD_BOT_TOKEN: botToken,
    DISCORD_CHANNEL_ID: channelId,
  }
}

import * as p from '@clack/prompts'
import chalk from 'chalk'
import open from 'open'
import { validateTelegramToken, validateTelegramChat } from '../utils/validate.js'

export async function setupTelegram(): Promise<Record<string, string> | null> {
  p.log.info(chalk.hex('#0088cc')(`
┌─────────────────────────────────────────────────────────┐
│  ✈️  TELEGRAM SETUP                                     │
└─────────────────────────────────────────────────────────┘
`))

  // Step 1: Create Bot
  p.log.message(`
${chalk.bold('Step 1: Create a Telegram Bot')}

  1. Open ${chalk.cyan('@BotFather')} in Telegram
  2. Send ${chalk.bold('/newbot')}
  3. Choose a name (e.g., "My Support Bot")
  4. Choose a username (must end in "bot", e.g., "mysupport_bot")
  5. Copy the ${chalk.bold('Bot Token')} you receive
`)

  const openBotFather = await p.confirm({
    message: 'Open @BotFather in browser?',
    initialValue: true,
  })

  if (p.isCancel(openBotFather)) return null

  if (openBotFather) {
    await open('https://t.me/BotFather')
  }

  const botToken = await p.password({
    message: 'Paste your Bot Token:',
    placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
    validate: (value) => {
      if (!value) return 'Bot token is required'
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(value)) return 'Invalid token format'
      return undefined
    },
  })

  if (p.isCancel(botToken)) return null

  // Validate token
  const s = p.spinner()
  s.start('Validating token...')

  const tokenResult = await validateTelegramToken(botToken)

  if (!tokenResult.valid) {
    s.stop('Invalid token')
    p.log.error(tokenResult.error || 'Could not validate token')
    return null
  }

  s.stop(`Token valid! Bot: ${chalk.cyan('@' + tokenResult.botUsername)}`)

  // Step 2: Create Forum Group
  p.log.message(`
${chalk.bold('Step 2: Create a Forum Group')}

  1. Create a new Telegram group
  2. Go to ${chalk.bold('Group Settings')} → ${chalk.bold('Topics')} → ${chalk.green('Enable')}
  3. Add your bot to the group
  4. Make bot an ${chalk.bold('Admin')} with these permissions:
     ${chalk.green('•')} Manage Topics
     ${chalk.green('•')} Post Messages
     ${chalk.green('•')} Edit Messages
     ${chalk.green('•')} Delete Messages

  ${chalk.yellow('Tip:')} To get the Chat ID, add ${chalk.cyan('@getidsbot')} to your group.
`)

  const openGetIds = await p.confirm({
    message: 'Open @getidsbot to get Chat ID?',
    initialValue: true,
  })

  if (p.isCancel(openGetIds)) return null

  if (openGetIds) {
    await open('https://t.me/getidsbot')
  }

  const chatId = await p.text({
    message: 'Enter your Forum Chat ID:',
    placeholder: '-1001234567890',
    validate: (value) => {
      if (!value) return 'Chat ID is required'
      if (!/^-100\d{10,}$/.test(value)) return 'Chat ID should start with -100'
      return undefined
    },
  })

  if (p.isCancel(chatId)) return null

  // Validate chat
  s.start('Validating chat...')

  const chatResult = await validateTelegramChat(botToken, chatId)

  if (!chatResult.valid) {
    s.stop('Invalid chat')
    p.log.error(chatResult.error || 'Could not validate chat')
    return null
  }

  if (!chatResult.isForum) {
    s.stop('Not a forum')
    p.log.warn('This group does not have Topics enabled. Enable Topics in group settings.')

    const continueAnyway = await p.confirm({
      message: 'Continue anyway?',
      initialValue: false,
    })

    if (p.isCancel(continueAnyway) || !continueAnyway) {
      return null
    }
  } else {
    s.stop(`Forum found: ${chalk.cyan(chatResult.chatTitle)}`)
  }

  return {
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_CHAT_ID: chatId,
  }
}

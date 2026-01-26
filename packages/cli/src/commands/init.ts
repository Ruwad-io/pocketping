import * as p from '@clack/prompts'
import chalk from 'chalk'
import { setupDiscord } from '../prompts/discord.js'
import { setupSlack } from '../prompts/slack.js'
import { setupTelegram } from '../prompts/telegram.js'
import { saveEnvFile, generateConfigExample } from '../utils/env.js'

type BridgeType = 'discord' | 'slack' | 'telegram'

const BRIDGES: Record<BridgeType, { name: string; color: string; setup: () => Promise<Record<string, string> | null> }> = {
  discord: {
    name: 'Discord',
    color: '#5865F2',
    setup: setupDiscord,
  },
  slack: {
    name: 'Slack',
    color: '#4A154B',
    setup: setupSlack,
  },
  telegram: {
    name: 'Telegram',
    color: '#0088cc',
    setup: setupTelegram,
  },
}

export async function init(bridge?: string) {
  console.clear()

  p.intro(chalk.bgHex('#6366f1').white(' PocketPing Setup Wizard '))

  let selectedBridges: BridgeType[]

  if (bridge && bridge in BRIDGES) {
    // Single bridge specified
    selectedBridges = [bridge as BridgeType]
  } else {
    // Interactive selection
    const bridgeSelection = await p.multiselect({
      message: 'Which bridges do you want to set up?',
      options: [
        { value: 'discord', label: 'Discord', hint: 'Forum threads for team conversations' },
        { value: 'slack', label: 'Slack', hint: 'Channel threads for enterprise teams' },
        { value: 'telegram', label: 'Telegram', hint: 'Forum topics for organized chats' },
      ],
      required: true,
    })

    if (p.isCancel(bridgeSelection)) {
      p.cancel('Setup cancelled.')
      process.exit(0)
    }

    selectedBridges = bridgeSelection as BridgeType[]
  }

  const allEnvVars: Record<string, string> = {}

  for (const bridgeKey of selectedBridges) {
    const bridgeConfig = BRIDGES[bridgeKey]

    p.log.step(chalk.hex(bridgeConfig.color)(`Setting up ${bridgeConfig.name}...`))

    const envVars = await bridgeConfig.setup()

    if (envVars === null) {
      p.log.warn(`Skipped ${bridgeConfig.name} setup`)
      continue
    }

    Object.assign(allEnvVars, envVars)
    p.log.success(`${bridgeConfig.name} configured!`)
  }

  if (Object.keys(allEnvVars).length === 0) {
    p.cancel('No bridges configured.')
    process.exit(0)
  }

  // Save to .env file
  const s = p.spinner()
  s.start('Saving configuration...')

  try {
    await saveEnvFile(allEnvVars)
    await generateConfigExample(selectedBridges)
    s.stop('Configuration saved!')
  } catch (error) {
    s.stop('Failed to save configuration')
    p.log.error(String(error))
    process.exit(1)
  }

  // Summary
  p.note(
    Object.entries(allEnvVars)
      .map(([key, value]) => `${key}=${key.includes('TOKEN') ? '****' : value}`)
      .join('\n'),
    'Added to .env'
  )

  p.outro(chalk.green('Setup complete!') + '\n\n' +
    'Next steps:\n' +
    '  1. Review your .env file\n' +
    '  2. Check pocketping.config.example.ts for usage\n' +
    '  3. Run ' + chalk.cyan('npx @pocketping/cli doctor') + ' to verify'
  )
}

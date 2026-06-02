#!/usr/bin/env node

import { createRequire } from 'module'
import { Command } from 'commander'
import chalk from 'chalk'
import { init } from './commands/init.js'
import { doctor } from './commands/doctor.js'
import { banner, COLORS } from './utils/ui.js'

// Read version from package.json at runtime so it always matches the published
// release (semantic-release rewrites package.json, not this file).
const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

const program = new Command()

program
  .name('pocketping')
  .description(`${banner()}\n\n  Set up and verify your PocketPing bridges (Telegram, Discord, Slack).`)
  .version(version, '-v, --version', 'Show the installed version')
  .showHelpAfterError(chalk.dim('(run `pocketping --help` for usage)'))
  .configureOutput({
    outputError: (str, write) => write(chalk.red(str)),
  })

program
  .command('init')
  .description('Set up PocketPing bridges interactively')
  .argument('[bridge]', 'Specific bridge to set up (discord, slack, telegram)')
  .action((bridge?: string) => run(() => init(bridge)))

program
  .command('doctor')
  .description('Check that your configured bridges are reachable and healthy')
  .action(() => run(doctor))

// No sub-command → show the branded help screen instead of silence.
if (process.argv.length <= 2) {
  program.outputHelp()
  process.exit(0)
}

program.parse()

/**
 * Run an async command with a single, friendly error boundary. Ctrl-C inside a
 * clack prompt surfaces as a cancellation rather than a stack trace.
 */
async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('\n' + chalk.hex(COLORS.brand)('●') + chalk.red(' Something went wrong: ') + message)
    process.exit(1)
  }
}

#!/usr/bin/env node

import { Command } from 'commander'
import { init } from './commands/init.js'
import { doctor } from './commands/doctor.js'

const program = new Command()

program
  .name('pocketping')
  .description('CLI tool for setting up PocketPing bridges')
  .version('0.1.0')

program
  .command('init')
  .description('Set up PocketPing bridges interactively')
  .argument('[bridge]', 'Specific bridge to set up (discord, slack, telegram)')
  .action(init)

program
  .command('doctor')
  .description('Check your PocketPing configuration')
  .action(doctor)

program.parse()

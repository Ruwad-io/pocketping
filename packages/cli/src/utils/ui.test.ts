import { describe, it, expect } from 'vitest'
import chalk from 'chalk'
import { visibleWidth, box } from './ui.js'

describe('visibleWidth', () => {
  it('counts plain characters', () => {
    expect(visibleWidth('hello')).toBe(5)
  })

  it('ignores ANSI color codes', () => {
    expect(visibleWidth(chalk.red('hello'))).toBe(5)
  })

  it('counts emoji as two columns', () => {
    expect(visibleWidth('✈️')).toBeGreaterThanOrEqual(2)
  })
})

describe('box', () => {
  it('produces top and bottom borders of equal visible width', () => {
    const lines = box('Telegram', ['short', 'a much longer line here'], '#0088cc').split('\n')
    const top = lines[0]
    const bottom = lines[lines.length - 1]
    expect(visibleWidth(top)).toBe(visibleWidth(bottom))
  })

  it('every rendered line shares the same visible width', () => {
    const lines = box('X', ['one', 'two two', 'three three three']).split('\n')
    const widths = new Set(lines.map(visibleWidth))
    expect(widths.size).toBe(1)
  })
})

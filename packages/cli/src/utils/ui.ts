import chalk from 'chalk'

/** Brand colors, reused across prompts and output. */
export const COLORS = {
  brand: '#6366f1',
  discord: '#5865F2',
  slack: '#4A154B',
  telegram: '#0088cc',
} as const

/**
 * Visible length of a string, ignoring ANSI color escapes and counting
 * common wide emoji as two columns — so box borders actually line up.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g
export function visibleWidth(str: string): number {
  const plain = str.replace(ANSI, '')
  let width = 0
  for (const ch of plain) {
    const code = ch.codePointAt(0) ?? 0
    // Emoji / wide CJK ranges render as two columns in most terminals.
    width += code > 0x1f000 || (code >= 0x1100 && code <= 0x115f) ? 2 : 1
  }
  return width
}

/**
 * Render a clean, content-fitted box. Unlike a fixed-width template, the top
 * and bottom borders always match the longest line, so nothing overhangs.
 */
export function box(title: string, lines: string[], hex: string = COLORS.brand): string {
  const paint = chalk.hex(hex)
  const titleW = visibleWidth(title)
  // `span` is the visible width between the two vertical bars. Every line
  // (top, body, bottom) then renders to exactly `span + 2` columns.
  const span = Math.max(titleW + 3, ...lines.map((l) => visibleWidth(l) + 1), 24)

  const top = paint(`┌─ ${chalk.bold(title)} ${'─'.repeat(span - titleW - 3)}┐`)
  const body = lines.map((l) => {
    const pad = ' '.repeat(span - visibleWidth(l) - 1)
    return `${paint('│')} ${l}${pad}${paint('│')}`
  })
  const bottom = paint(`└${'─'.repeat(span)}┘`)
  return [top, ...body, bottom].join('\n')
}

/** Small wordmark shown at the top of interactive commands. */
export function banner(): string {
  const p = chalk.hex(COLORS.brand)
  return `${p('●')} ${chalk.bold('PocketPing')} ${chalk.dim('· phone-first live chat')}`
}

/** True when stdin/stdout can drive an interactive prompt. */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

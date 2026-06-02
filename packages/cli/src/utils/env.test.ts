import { describe, it, expect } from 'vitest'
import { parseEnvContent } from './env.js'

describe('parseEnvContent', () => {
  it('parses simple KEY=value pairs', () => {
    expect(parseEnvContent('FOO=bar\nBAZ=qux')).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('ignores blank lines and comments', () => {
    const content = '# a comment\n\nFOO=bar\n   # indented comment\nBAZ=qux'
    expect(parseEnvContent(content)).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('strips an `export ` prefix', () => {
    expect(parseEnvContent('export TELEGRAM_BOT_TOKEN=123:abc')).toEqual({
      TELEGRAM_BOT_TOKEN: '123:abc',
    })
  })

  it('keeps values that contain `=` (base64, query strings)', () => {
    expect(parseEnvContent('SECRET=aGVsbG8=world==')).toEqual({ SECRET: 'aGVsbG8=world==' })
  })

  it('unquotes single- and double-quoted values', () => {
    expect(parseEnvContent('A="hello world"\nB=\'spaced value\'')).toEqual({
      A: 'hello world',
      B: 'spaced value',
    })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseEnvContent('  FOO = bar  ')).toEqual({ FOO: 'bar' })
  })

  it('skips malformed keys', () => {
    expect(parseEnvContent('1INVALID=x\nlower-case=y\nVALID=z')).toEqual({ VALID: 'z' })
  })
})

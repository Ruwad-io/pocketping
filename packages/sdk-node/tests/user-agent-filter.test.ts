import { describe, expect, it, vi } from 'vitest';
import {
  checkUaFilter,
  DEFAULT_BOT_PATTERNS,
  isBot,
  matchesAnyPattern,
  shouldAllowUa,
} from '../src/utils/user-agent-filter';

describe('user-agent-filter', () => {
  describe('matchesAnyPattern', () => {
    it('matches substring patterns case-insensitively', () => {
      expect(matchesAnyPattern('Mozilla GoogleBot/2.1', ['googlebot'])).toBe('googlebot');
      expect(matchesAnyPattern('Mozilla', ['googlebot'])).toBeUndefined();
    });

    it('matches regex patterns wrapped in slashes', () => {
      expect(matchesAnyPattern('agent bot-42 here', ['/bot-\\d+/'])).toBe('/bot-\\d+/');
      expect(matchesAnyPattern('no match', ['/bot-\\d+/'])).toBeUndefined();
    });

    it('ignores invalid regex patterns gracefully', () => {
      // unbalanced group -> extractRegex returns null
      expect(matchesAnyPattern('whatever', ['/(unclosed/'])).toBeUndefined();
    });

    it('treats too-short slash strings as substrings, not regex', () => {
      // '//' has length 2 -> not a regex, substring match of '//'
      expect(matchesAnyPattern('a//b', ['//'])).toBe('//');
    });
  });

  describe('isBot', () => {
    it('detects known bots', () => {
      expect(isBot('curl/8.0')).toBe(true);
      expect(isBot('Mozilla/5.0 (Macintosh) Safari')).toBe(false);
    });
  });

  describe('shouldAllowUa', () => {
    it('blocklist mode flags default bots vs custom blocklist matches', () => {
      const defaultBot = shouldAllowUa('Googlebot/2.1', { mode: 'blocklist' });
      expect(defaultBot.allowed).toBe(false);
      expect(defaultBot.reason).toBe('default_bot');

      const custom = shouldAllowUa('EvilScanner/1.0', {
        mode: 'blocklist',
        blocklist: ['evilscanner'],
      });
      expect(custom.allowed).toBe(false);
      expect(custom.reason).toBe('blocklist');
    });

    it('blocklist mode allows non-bot UAs', () => {
      const r = shouldAllowUa('Mozilla/5.0 (Windows) Firefox/120', {
        mode: 'blocklist',
        useDefaultBots: true,
      });
      expect(r.allowed).toBe(true);
      expect(r.reason).toBe('default');
    });

    it('allowlist mode only allows matching UAs', () => {
      const allowed = shouldAllowUa('MyApp/1.0', { mode: 'allowlist', allowlist: ['myapp'] });
      expect(allowed.allowed).toBe(true);
      expect(allowed.reason).toBe('allowlist');

      const blocked = shouldAllowUa('Other/1.0', { mode: 'allowlist', allowlist: ['myapp'] });
      expect(blocked.allowed).toBe(false);
      expect(blocked.reason).toBe('not_in_allowlist');
    });

    it('both mode: allowlist precedence, then blocklist, then default', () => {
      const cfg = {
        mode: 'both' as const,
        allowlist: ['gooduser'],
        blocklist: ['baduser'],
      };
      expect(shouldAllowUa('GoodUser/1', cfg).reason).toBe('allowlist');
      const blocked = shouldAllowUa('BadUser/1', cfg);
      expect(blocked.allowed).toBe(false);
      expect(blocked.reason).toBe('blocklist');
      // default bot still caught in both mode
      const bot = shouldAllowUa('Googlebot/2.1', cfg);
      expect(bot.allowed).toBe(false);
      expect(bot.reason).toBe('default_bot');
      // ordinary UA passes
      expect(shouldAllowUa('Mozilla Firefox', cfg).reason).toBe('default');
    });

    it('unknown mode allows by default', () => {
      const r = shouldAllowUa('anything', { mode: 'weird' as never });
      expect(r.allowed).toBe(true);
      expect(r.reason).toBe('default');
    });

    it('respects useDefaultBots: false', () => {
      const r = shouldAllowUa('Googlebot/2.1', { mode: 'blocklist', useDefaultBots: false });
      expect(r.allowed).toBe(true);
    });
  });

  describe('checkUaFilter', () => {
    const req = { path: '/connect' };

    it('allows when no user-agent', async () => {
      const r = await checkUaFilter(undefined, { enabled: true }, req);
      expect(r.allowed).toBe(true);
    });

    it('allows when disabled', async () => {
      const r = await checkUaFilter('Googlebot', { enabled: false }, req);
      expect(r.allowed).toBe(true);
    });

    it('honors a custom filter returning true/false/undefined', async () => {
      const allow = await checkUaFilter('x', { enabled: true, customFilter: () => true }, req);
      expect(allow).toEqual({ allowed: true, reason: 'custom' });

      const block = await checkUaFilter('x', { enabled: true, customFilter: () => false }, req);
      expect(block).toEqual({ allowed: false, reason: 'custom' });

      // undefined -> fall through to list-based filtering (Googlebot blocked)
      const fall = await checkUaFilter(
        'Googlebot',
        { enabled: true, customFilter: () => undefined },
        req
      );
      expect(fall.allowed).toBe(false);
    });

    it('supports async custom filters', async () => {
      const r = await checkUaFilter(
        'x',
        { enabled: true, customFilter: async () => false },
        req
      );
      expect(r.allowed).toBe(false);
    });
  });

  it('exposes a sizeable default bot pattern list', () => {
    expect(DEFAULT_BOT_PATTERNS.length).toBeGreaterThan(50);
    expect(DEFAULT_BOT_PATTERNS).toContain('googlebot');
  });

  it('logger config fields are optional (smoke)', () => {
    const logger = vi.fn();
    // sanity: shouldAllowUa does not invoke logger directly, but config accepts it
    const r = shouldAllowUa('Mozilla', { logger });
    expect(r.allowed).toBe(true);
  });
});

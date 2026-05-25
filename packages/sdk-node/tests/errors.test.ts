import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PocketPingSetupError, SETUP_GUIDES } from '../src/errors';

describe('PocketPingSetupError', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('builds a descriptive message and default docs URL, printing the guide', () => {
    const err = new PocketPingSetupError({
      bridge: 'Telegram',
      missing: 'botToken',
      guide: 'Step 1\nStep 2',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PocketPingSetupError');
    expect(err.message).toContain('Telegram configuration error: botToken is required');
    expect(err.bridge).toBe('Telegram');
    expect(err.missing).toBe('botToken');
    expect(err.docsUrl).toBe('https://pocketping.io/docs/telegram');
    // constructor prints the formatted guide
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('uses a custom docs URL when provided', () => {
    const err = new PocketPingSetupError({
      bridge: 'Discord',
      missing: 'webhookUrl',
      guide: 'guide text',
      docsUrl: 'https://example.com/custom',
    });
    expect(err.docsUrl).toBe('https://example.com/custom');
  });

  it('getFormattedGuide includes the guide lines and quick-fix command', () => {
    const err = new PocketPingSetupError({
      bridge: 'Slack',
      missing: 'channelId',
      guide: 'Line A\nLine B',
    });
    const out = err.getFormattedGuide();
    expect(out).toContain('Slack Setup Required');
    expect(out).toContain('Line A');
    expect(out).toContain('Line B');
    expect(out).toContain('npx @pocketping/cli init slack');
  });

  it('exposes setup guides for all bridges', () => {
    expect(SETUP_GUIDES.telegram.botToken).toContain('BotFather');
    expect(SETUP_GUIDES.discord.webhookUrl).toContain('Webhook');
    expect(SETUP_GUIDES.slack.botToken).toContain('xoxb-');
  });
});

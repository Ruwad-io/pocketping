import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { AnthropicProvider } from '../src/ai/anthropic';
import { GeminiProvider } from '../src/ai/gemini';
import { OpenAIProvider } from '../src/ai/openai';
import type { Message } from '../src/types';

const visitor = (content: string): Message => ({
  id: 'm',
  sessionId: 's',
  content,
  sender: 'visitor',
  timestamp: new Date(),
});

describe('AI provider error + availability branches', () => {
  let mockFetch: Mock;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  // ── OpenAI ──
  it('OpenAI throws on non-ok responses', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(new OpenAIProvider({ apiKey: 'k' }).generateResponse([visitor('hi')])).rejects.toThrow(
      'OpenAI API error: 429'
    );
  });

  it('OpenAI respects a custom baseUrl and reports availability', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [] }) });
    const p = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://proxy/v9' });
    await p.generateResponse([visitor('hi')]);
    expect(mockFetch.mock.calls[0][0]).toBe('https://proxy/v9/chat/completions');

    mockFetch.mockResolvedValueOnce({ ok: true });
    expect(await p.isAvailable()).toBe(true);
    expect(mockFetch.mock.calls.at(-1)![0]).toBe('https://proxy/v9/models');

    mockFetch.mockRejectedValueOnce(new Error('net'));
    expect(await p.isAvailable()).toBe(false);
  });

  // ── Anthropic ──
  it('Anthropic throws on non-ok responses and isAvailable depends on apiKey', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(
      new AnthropicProvider({ apiKey: 'k' }).generateResponse([visitor('hi')])
    ).rejects.toThrow('Anthropic API error: 500');

    expect(await new AnthropicProvider({ apiKey: 'k' }).isAvailable()).toBe(true);
    expect(await new AnthropicProvider({ apiKey: '' }).isAvailable()).toBe(false);
  });

  it('Anthropic returns empty string when content is missing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    expect(await new AnthropicProvider({ apiKey: 'k' }).generateResponse([visitor('hi')])).toBe('');
  });

  // ── Gemini ──
  it('Gemini throws on non-ok responses', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });
    await expect(new GeminiProvider({ apiKey: 'k' }).generateResponse([visitor('hi')])).rejects.toThrow(
      'Gemini API error: 400'
    );
  });

  it('Gemini returns empty string when candidates missing and reports availability', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const p = new GeminiProvider({ apiKey: 'k' });
    expect(await p.generateResponse([visitor('hi')])).toBe('');

    mockFetch.mockResolvedValueOnce({ ok: true });
    expect(await p.isAvailable()).toBe(true);

    mockFetch.mockRejectedValueOnce(new Error('net'));
    expect(await p.isAvailable()).toBe(false);
  });

  it('Gemini does not prepend system prompt when first message is not a user', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const p = new GeminiProvider({ apiKey: 'k' });
    await p.generateResponse([{ ...visitor('answer'), sender: 'operator' }], 'sys');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.contents[0].role).toBe('model');
    expect(body.contents[0].parts[0].text).toBe('answer');
  });

  it('uses default models when none specified', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await new GeminiProvider({ apiKey: 'k' }).generateResponse([visitor('hi')]);
    expect(mockFetch.mock.calls[0][0]).toContain('gemini-1.5-flash');
  });
});

describe('AI fallback takeover timing (real src via index)', () => {
  it('does not take over before the delay, then does after', async () => {
    const { PocketPing } = await import('../src/index');
    let calls = 0;
    const provider = {
      name: 'fake',
      async generateResponse() {
        calls++;
        return 'hi';
      },
      async isAvailable() {
        return true;
      },
    };
    const pp = new PocketPing({ ai: { provider }, aiTakeoverDelay: 1000 });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });
    // operator activity now -> not due
    await pp.handleMessage({ sessionId, content: 'op', sender: 'operator' });
    await pp.handleMessage({ sessionId, content: 'visitor', sender: 'visitor' });
    expect(calls).toBe(0);

    // No-operator session -> takeover due immediately
    const pp2 = new PocketPing({ ai: { provider }, aiTakeoverDelay: 1000 });
    const { sessionId: sid2 } = await pp2.handleConnect({ visitorId: 'v2' });
    await pp2.handleMessage({ sessionId: sid2, content: 'hello?', sender: 'visitor' });
    expect(calls).toBe(1);
  });
});

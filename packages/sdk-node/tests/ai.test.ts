import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { AnthropicProvider } from '../src/ai/anthropic';
import { GeminiProvider } from '../src/ai/gemini';
import { OpenAIProvider } from '../src/ai/openai';
import type { AIProvider } from '../src/ai/types';
import { PocketPing } from '../src/pocketping';
import type { Message } from '../src/types';

// ============================================================================
// Helpers
// ============================================================================

const visitorMsg = (content: string, overrides: Partial<Message> = {}): Message => ({
  id: `m-${Math.random().toString(36).slice(2)}`,
  sessionId: 'session-1',
  content,
  sender: 'visitor',
  timestamp: new Date('2024-01-15T10:30:00Z'),
  ...overrides,
});

/** Tiny in-test fake provider used to exercise the fallback wiring. */
class FakeProvider implements AIProvider {
  name = 'fake';
  reply: string;
  available: boolean;
  shouldThrow: boolean;
  calls: Array<{ messages: Message[]; systemPrompt?: string }> = [];

  constructor(reply = 'AI says hi', opts: { available?: boolean; shouldThrow?: boolean } = {}) {
    this.reply = reply;
    this.available = opts.available ?? true;
    this.shouldThrow = opts.shouldThrow ?? false;
  }

  async generateResponse(messages: Message[], systemPrompt?: string): Promise<string> {
    this.calls.push({ messages, systemPrompt });
    if (this.shouldThrow) throw new Error('provider boom');
    return this.reply;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }
}

const okResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as Response;

// ============================================================================
// Providers (mocked fetch)
// ============================================================================

describe('AI Providers', () => {
  let mockFetch: Mock;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. OpenAIProvider builds correct request and parses choices[0].message.content
  it('OpenAIProvider builds the correct request and parses the response', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ choices: [{ message: { content: 'hello from openai' } }] })
    );

    const provider = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4o-mini' });
    const reply = await provider.generateResponse(
      [visitorMsg('hi'), { ...visitorMsg('previous answer'), sender: 'operator' }],
      'be nice'
    );

    expect(reply).toBe('hello from openai');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.max_tokens).toBe(1000);
    expect(body.temperature).toBe(0.7);
    // system first, then visitor->user, operator->assistant
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be nice' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(body.messages[2]).toEqual({ role: 'assistant', content: 'previous answer' });
  });

  it('OpenAIProvider returns empty string when content is missing', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ choices: [{ message: {} }] }));
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    expect(await provider.generateResponse([visitorMsg('hi')])).toBe('');
  });

  // 2. AnthropicProvider builds correct request and parses content[0].text
  it('AnthropicProvider builds the correct request and parses the response', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ content: [{ text: 'hi from claude' }] }));

    const provider = new AnthropicProvider({ apiKey: 'ak-test' });
    const reply = await provider.generateResponse(
      [visitorMsg('hi'), { ...visitorMsg('answer'), sender: 'operator' }],
      'support prompt'
    );

    expect(reply).toBe('hi from claude');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('ak-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.max_tokens).toBe(1000);
    // system goes in the top-level field, NOT in the messages array
    expect(body.system).toBe('support prompt');
    expect(body.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'answer' },
    ]);
  });

  it('AnthropicProvider uses default system prompt and is available with apiKey', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ content: [{ text: 'x' }] }));
    const provider = new AnthropicProvider({ apiKey: 'ak-test' });
    await provider.generateResponse([visitorMsg('hi')]);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system).toBe('You are a helpful customer support assistant.');
    expect(await provider.isAvailable()).toBe(true);
  });

  // 3. GeminiProvider builds correct request and parses candidates[0].content.parts[0].text
  it('GeminiProvider builds the correct request and parses the response', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ candidates: [{ content: { parts: [{ text: 'hi from gemini' }] } }] })
    );

    const provider = new GeminiProvider({ apiKey: 'gk-test', model: 'gemini-1.5-flash' });
    const reply = await provider.generateResponse(
      [visitorMsg('hi'), { ...visitorMsg('answer'), sender: 'operator' }],
      'system text'
    );

    expect(reply).toBe('hi from gemini');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=gk-test'
    );

    const body = JSON.parse(init.body);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 1000, temperature: 0.7 });
    // visitor->user, operator->model; system prompt prepended to first user part
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toBe('system text\n\nUser: hi');
    expect(body.contents[1].role).toBe('model');
    expect(body.contents[1].parts[0].text).toBe('answer');
  });
});

// ============================================================================
// Fallback wiring (tiny in-test fake provider)
// ============================================================================

describe('AI Fallback wiring', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const aiMessages = async (pp: PocketPing, sessionId: string): Promise<Message[]> => {
    const msgs = await pp.getStorage().getMessages(sessionId);
    return msgs.filter((m) => m.sender === 'ai');
  };

  // 4. Fallback triggers: delay=0, operator offline, fake provider -> AI message stored
  it('triggers an AI reply when operator is offline and takeover is due', async () => {
    const provider = new FakeProvider('AI says hi');
    const pp = new PocketPing({
      ai: { provider, systemPrompt: 'be helpful' },
      aiTakeoverDelay: 0,
    });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });

    await pp.handleMessage({ sessionId, content: 'anyone there?', sender: 'visitor' });

    const ai = await aiMessages(pp, sessionId);
    expect(ai).toHaveLength(1);
    expect(ai[0].content).toBe('AI says hi');
    expect(ai[0].sender).toBe('ai');

    // provider received the conversation + system prompt
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].systemPrompt).toBe('be helpful');

    const session = await pp.getSession(sessionId);
    expect(session?.aiActive).toBe(true);
  });

  // 5. No fallback when operator online
  it('does not trigger AI when an operator is online', async () => {
    const provider = new FakeProvider('AI says hi');
    const pp = new PocketPing({ ai: { provider }, aiTakeoverDelay: 0 });
    pp.setOperatorOnline(true);
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });

    await pp.handleMessage({ sessionId, content: 'anyone there?', sender: 'visitor' });

    expect(await aiMessages(pp, sessionId)).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  // 6. Operator message disables AI
  it('disables AI for the session when an operator replies', async () => {
    const provider = new FakeProvider('AI says hi');
    const pp = new PocketPing({ ai: { provider }, aiTakeoverDelay: 0 });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });

    // Visitor message -> AI takes over
    await pp.handleMessage({ sessionId, content: 'hi', sender: 'visitor' });
    expect((await pp.getSession(sessionId))?.aiActive).toBe(true);

    // Operator replies -> AI disabled
    await pp.handleMessage({ sessionId, content: 'I got it', sender: 'operator' });
    expect((await pp.getSession(sessionId))?.aiActive).toBe(false);
  });

  // 7. No fallback when takeover is not yet due (recent operator activity)
  it('does not trigger AI before the takeover delay elapses', async () => {
    const provider = new FakeProvider('AI says hi');
    const pp = new PocketPing({ ai: { provider }, aiTakeoverDelay: 300 });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });

    // Recent operator activity recorded
    await pp.handleMessage({ sessionId, content: 'hello', sender: 'operator' });
    // Visitor follows up immediately -> not due yet
    await pp.handleMessage({ sessionId, content: 'thanks, one more thing', sender: 'visitor' });

    expect(await aiMessages(pp, sessionId)).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  // 8. Provider error is handled gracefully (no crash, no AI message)
  it('handles provider errors gracefully without crashing message handling', async () => {
    const provider = new FakeProvider('whatever', { shouldThrow: true });
    const pp = new PocketPing({ ai: { provider }, aiTakeoverDelay: 0 });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });

    const res = await pp.handleMessage({ sessionId, content: 'hi', sender: 'visitor' });

    expect(res.messageId).toBeTruthy(); // visitor message still handled
    expect(await aiMessages(pp, sessionId)).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  // Empty reply -> no AI message stored
  it('does not store an AI message when the provider returns an empty reply', async () => {
    const provider = new FakeProvider('');
    const pp = new PocketPing({ ai: { provider }, aiTakeoverDelay: 0 });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });

    await pp.handleMessage({ sessionId, content: 'hi', sender: 'visitor' });

    expect(await aiMessages(pp, sessionId)).toHaveLength(0);
  });

  // No provider configured -> no AI behaviour
  it('does nothing when no AI provider is configured', async () => {
    const pp = new PocketPing({ aiTakeoverDelay: 0 });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });

    await pp.handleMessage({ sessionId, content: 'hi', sender: 'visitor' });

    expect(await aiMessages(pp, sessionId)).toHaveLength(0);
    const presence = await pp.handlePresence();
    expect(presence.aiEnabled).toBe(false);
  });

  // presence reports aiEnabled / aiActiveAfter
  it('reports aiEnabled and aiActiveAfter from presence', async () => {
    const provider = new FakeProvider();
    const pp = new PocketPing({ ai: { provider }, aiTakeoverDelay: 120 });

    const presence = await pp.handlePresence();
    expect(presence.aiEnabled).toBe(true);
    expect(presence.aiActiveAfter).toBe(120);
  });

  // AI reply is surfaced to bridges via the operator-message path
  it('notifies bridges of the AI reply via the operator-message path', async () => {
    const provider = new FakeProvider('AI says hi');
    const opMessages: Array<{ content: string; sourceBridge?: string; operatorName?: string }> = [];
    const bridge = {
      name: 'recording',
      onOperatorMessage(
        message: Message,
        _session: unknown,
        sourceBridge?: string,
        operatorName?: string
      ) {
        opMessages.push({ content: message.content, sourceBridge, operatorName });
      },
    };
    const pp = new PocketPing({ ai: { provider }, aiTakeoverDelay: 0, bridges: [bridge] });
    const { sessionId } = await pp.handleConnect({ visitorId: 'v1' });

    await pp.handleMessage({ sessionId, content: 'hi', sender: 'visitor' });

    expect(opMessages).toEqual([
      { content: 'AI says hi', sourceBridge: 'ai', operatorName: 'AI' },
    ]);
  });

  // string provider config resolves to a concrete provider
  it('resolves a string provider name into a concrete provider', async () => {
    const pp = new PocketPing({ ai: { provider: 'openai', apiKey: 'sk-test' } });
    const presence = await pp.handlePresence();
    expect(presence.aiEnabled).toBe(true);
  });
});

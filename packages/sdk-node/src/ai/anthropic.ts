import type { Message } from '../types';
import type { AIProvider } from './types';

export interface AnthropicProviderConfig {
  apiKey: string;
  model?: string;
}

export class AnthropicProvider implements AIProvider {
  name = 'anthropic';

  private apiKey: string;
  private model: string;

  constructor(config: AnthropicProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'claude-sonnet-4-20250514';
  }

  async generateResponse(messages: Message[], systemPrompt?: string): Promise<string> {
    const anthropicMessages: Array<{ role: string; content: string }> = [];

    for (const msg of messages) {
      const role = msg.sender === 'visitor' ? 'user' : 'assistant';
      anthropicMessages.push({ role, content: msg.content });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1000,
        system: systemPrompt ?? 'You are a helpful customer support assistant.',
        messages: anthropicMessages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text ?? '';
  }

  async isAvailable(): Promise<boolean> {
    // Anthropic doesn't have a simple health check endpoint
    // We just assume it's available if we have an API key
    return !!this.apiKey;
  }
}

import type { AIProvider } from './types';
import type { Message } from '../types';

export interface GeminiProviderConfig {
  apiKey: string;
  model?: string;
}

export class GeminiProvider implements AIProvider {
  name = 'gemini';

  private apiKey: string;
  private model: string;

  constructor(config: GeminiProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'gemini-1.5-flash';
  }

  async generateResponse(messages: Message[], systemPrompt?: string): Promise<string> {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    for (const msg of messages) {
      const role = msg.sender === 'visitor' ? 'user' : 'model';
      contents.push({
        role,
        parts: [{ text: msg.content }],
      });
    }

    // Prepend system prompt to first user message if provided
    if (systemPrompt && contents.length > 0 && contents[0].role === 'user') {
      contents[0].parts[0].text = `${systemPrompt}\n\nUser: ${contents[0].parts[0].text}`;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.7,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}

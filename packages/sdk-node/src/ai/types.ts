import type { Message } from '../types';

/**
 * AI provider interface.
 * Implement this to add support for OpenAI, Gemini, Claude, or local models.
 */
export interface AIProvider {
  /** Provider name */
  name: string;

  /** Generate a response to the conversation */
  generateResponse(
    messages: Message[],
    systemPrompt?: string
  ): Promise<string>;

  /** Check if the provider is available */
  isAvailable(): Promise<boolean>;
}

export interface AIConfig {
  provider: AIProvider;
  systemPrompt?: string;
  fallbackAfter?: number; // seconds before AI takes over
}

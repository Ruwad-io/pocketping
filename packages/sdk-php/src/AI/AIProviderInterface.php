<?php

declare(strict_types=1);

namespace PocketPing\AI;

use PocketPing\Models\Message;

/**
 * Interface implemented by AI providers used for the offline-takeover fallback.
 *
 * Providers turn a session's message history into a single assistant reply.
 */
interface AIProviderInterface
{
    /**
     * The provider name (e.g. "openai", "anthropic", "gemini").
     */
    public function name(): string;

    /**
     * Generate an assistant reply from the conversation history.
     *
     * @param Message[] $messages The conversation history, oldest first.
     * @param string|null $systemPrompt Optional system prompt to steer the assistant.
     * @return string The assistant reply (empty string if the model returned nothing).
     */
    public function generateResponse(array $messages, ?string $systemPrompt = null): string;

    /**
     * Whether the provider is configured and reachable.
     */
    public function isAvailable(): bool;
}

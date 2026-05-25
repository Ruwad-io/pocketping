<?php

declare(strict_types=1);

namespace PocketPing\AI;

use PocketPing\Http\CurlHttpClient;
use PocketPing\Http\HttpClientInterface;
use PocketPing\Models\Message;
use PocketPing\Models\Sender;

/**
 * AI provider backed by the Anthropic Messages API.
 */
final class AnthropicProvider implements AIProviderInterface
{
    public const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
    public const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
    public const DEFAULT_SYSTEM_PROMPT = 'You are a helpful customer support assistant.';

    private readonly string $apiKey;
    private readonly string $model;
    private readonly string $baseUrl;
    private readonly HttpClientInterface $httpClient;

    public function __construct(
        string $apiKey,
        string $model = self::DEFAULT_MODEL,
        string $baseUrl = self::DEFAULT_BASE_URL,
        ?HttpClientInterface $httpClient = null,
    ) {
        $this->apiKey = $apiKey;
        $this->model = $model;
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->httpClient = $httpClient ?? new CurlHttpClient();
    }

    public function name(): string
    {
        return 'anthropic';
    }

    public function generateResponse(array $messages, ?string $systemPrompt = null): string
    {
        // System prompt is sent in the top-level `system` field, never in the array.
        $anthropicMessages = [];
        foreach ($messages as $msg) {
            $role = $msg->sender === Sender::VISITOR ? 'user' : 'assistant';
            $anthropicMessages[] = ['role' => $role, 'content' => $msg->content];
        }

        $response = $this->httpClient->post(
            "{$this->baseUrl}/messages",
            [
                'model' => $this->model,
                'max_tokens' => 1000,
                'system' => $systemPrompt ?? self::DEFAULT_SYSTEM_PROMPT,
                'messages' => $anthropicMessages,
            ],
            [
                'x-api-key' => $this->apiKey,
                'anthropic-version' => '2023-06-01',
            ],
        );

        if ($response['error'] !== null || $response['httpCode'] < 200 || $response['httpCode'] >= 300) {
            throw new \RuntimeException(
                sprintf('Anthropic API error: %s', $response['error'] ?? "HTTP {$response['httpCode']}")
            );
        }

        $data = json_decode((string) $response['body'], true);
        if (!is_array($data)) {
            return '';
        }

        return (string) ($data['content'][0]['text'] ?? '');
    }

    public function isAvailable(): bool
    {
        // Anthropic has no simple health endpoint; assume available if an API key is set.
        return $this->apiKey !== '';
    }
}

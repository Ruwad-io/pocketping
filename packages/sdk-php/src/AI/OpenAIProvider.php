<?php

declare(strict_types=1);

namespace PocketPing\AI;

use PocketPing\Http\CurlHttpClient;
use PocketPing\Http\HttpClientInterface;
use PocketPing\Models\Message;
use PocketPing\Models\Sender;

/**
 * AI provider backed by the OpenAI Chat Completions API.
 */
final class OpenAIProvider implements AIProviderInterface
{
    public const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
    public const DEFAULT_MODEL = 'gpt-4o-mini';

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
        return 'openai';
    }

    public function generateResponse(array $messages, ?string $systemPrompt = null): string
    {
        $chatMessages = [];

        if ($systemPrompt !== null && $systemPrompt !== '') {
            $chatMessages[] = ['role' => 'system', 'content' => $systemPrompt];
        }

        foreach ($messages as $msg) {
            $role = $msg->sender === Sender::VISITOR ? 'user' : 'assistant';
            $chatMessages[] = ['role' => $role, 'content' => $msg->content];
        }

        $response = $this->httpClient->post(
            "{$this->baseUrl}/chat/completions",
            [
                'model' => $this->model,
                'messages' => $chatMessages,
                'max_tokens' => 1000,
                'temperature' => 0.7,
            ],
            [
                'Authorization' => "Bearer {$this->apiKey}",
            ],
        );

        if ($response['error'] !== null || $response['httpCode'] < 200 || $response['httpCode'] >= 300) {
            throw new \RuntimeException(
                sprintf('OpenAI API error: %s', $response['error'] ?? "HTTP {$response['httpCode']}")
            );
        }

        $data = json_decode((string) $response['body'], true);
        if (!is_array($data)) {
            return '';
        }

        return (string) ($data['choices'][0]['message']['content'] ?? '');
    }

    public function isAvailable(): bool
    {
        if ($this->apiKey === '') {
            return false;
        }

        $response = $this->httpClient->get(
            "{$this->baseUrl}/models",
            ['Authorization' => "Bearer {$this->apiKey}"],
        );

        return $response['error'] === null
            && $response['httpCode'] >= 200
            && $response['httpCode'] < 300;
    }
}

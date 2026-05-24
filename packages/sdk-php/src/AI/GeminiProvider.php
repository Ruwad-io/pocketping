<?php

declare(strict_types=1);

namespace PocketPing\AI;

use PocketPing\Http\CurlHttpClient;
use PocketPing\Http\HttpClientInterface;
use PocketPing\Models\Message;
use PocketPing\Models\Sender;

/**
 * AI provider backed by the Google Gemini generateContent API.
 */
final class GeminiProvider implements AIProviderInterface
{
    public const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
    public const DEFAULT_MODEL = 'gemini-1.5-flash';

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
        return 'gemini';
    }

    public function generateResponse(array $messages, ?string $systemPrompt = null): string
    {
        $contents = [];
        foreach ($messages as $msg) {
            $role = $msg->sender === Sender::VISITOR ? 'user' : 'model';
            $contents[] = [
                'role' => $role,
                'parts' => [['text' => $msg->content]],
            ];
        }

        // Prepend the system prompt to the first user message, if any.
        if ($systemPrompt !== null && $systemPrompt !== '' && $contents !== [] && $contents[0]['role'] === 'user') {
            $contents[0]['parts'][0]['text'] = "{$systemPrompt}\n\nUser: {$contents[0]['parts'][0]['text']}";
        }

        $url = "{$this->baseUrl}/models/{$this->model}:generateContent?key={$this->apiKey}";

        $response = $this->httpClient->post(
            $url,
            [
                'contents' => $contents,
                'generationConfig' => [
                    'maxOutputTokens' => 1000,
                    'temperature' => 0.7,
                ],
            ],
        );

        if ($response['error'] !== null || $response['httpCode'] < 200 || $response['httpCode'] >= 300) {
            throw new \RuntimeException(
                sprintf('Gemini API error: %s', $response['error'] ?? "HTTP {$response['httpCode']}")
            );
        }

        $data = json_decode((string) $response['body'], true);
        if (!is_array($data)) {
            return '';
        }

        return (string) ($data['candidates'][0]['content']['parts'][0]['text'] ?? '');
    }

    public function isAvailable(): bool
    {
        if ($this->apiKey === '') {
            return false;
        }

        $response = $this->httpClient->get("{$this->baseUrl}/models?key={$this->apiKey}");

        return $response['error'] === null
            && $response['httpCode'] >= 200
            && $response['httpCode'] < 300;
    }
}

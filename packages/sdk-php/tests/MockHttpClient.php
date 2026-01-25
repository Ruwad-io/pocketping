<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PocketPing\Http\HttpClientInterface;

/**
 * Mock HTTP client for testing bridges.
 */
class MockHttpClient implements HttpClientInterface
{
    /** @var array<array{method: string, url: string, data: array, headers: array}> */
    public array $requests = [];

    /** @var array{body: string|null, httpCode: int, error: string|null} */
    public array $nextResponse = [
        'body' => '{"ok": true}',
        'httpCode' => 200,
        'error' => null,
    ];

    /** @var array<array{body: string|null, httpCode: int, error: string|null}> */
    public array $responseQueue = [];

    public function post(string $url, array $data, array $headers = []): array
    {
        $this->requests[] = [
            'method' => 'POST',
            'url' => $url,
            'data' => $data,
            'headers' => $headers,
        ];
        return $this->getNextResponse();
    }

    public function patch(string $url, array $data, array $headers = []): array
    {
        $this->requests[] = [
            'method' => 'PATCH',
            'url' => $url,
            'data' => $data,
            'headers' => $headers,
        ];
        return $this->getNextResponse();
    }

    public function delete(string $url, array $headers = []): array
    {
        $this->requests[] = [
            'method' => 'DELETE',
            'url' => $url,
            'data' => [],
            'headers' => $headers,
        ];
        return $this->getNextResponse();
    }

    public function getLastRequest(): ?array
    {
        return $this->requests[count($this->requests) - 1] ?? null;
    }

    public function reset(): void
    {
        $this->requests = [];
        $this->responseQueue = [];
        $this->nextResponse = [
            'body' => '{"ok": true}',
            'httpCode' => 200,
            'error' => null,
        ];
    }

    /**
     * Queue multiple responses (FIFO).
     */
    public function queueResponse(string $body, int $httpCode = 200, ?string $error = null): void
    {
        $this->responseQueue[] = [
            'body' => $body,
            'httpCode' => $httpCode,
            'error' => $error,
        ];
    }

    private function getNextResponse(): array
    {
        if (!empty($this->responseQueue)) {
            return array_shift($this->responseQueue);
        }
        return $this->nextResponse;
    }
}

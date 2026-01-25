<?php

declare(strict_types=1);

namespace PocketPing\Http;

/**
 * HTTP client interface for making API requests.
 * Allows dependency injection and easy mocking in tests.
 */
interface HttpClientInterface
{
    /**
     * Make a POST request.
     *
     * @param string $url The URL to request
     * @param array<string, mixed> $data The request body data
     * @param array<string, string> $headers Additional headers
     * @return array{body: string|null, httpCode: int, error: string|null}
     */
    public function post(string $url, array $data, array $headers = []): array;

    /**
     * Make a PATCH request.
     *
     * @param string $url The URL to request
     * @param array<string, mixed> $data The request body data
     * @param array<string, string> $headers Additional headers
     * @return array{body: string|null, httpCode: int, error: string|null}
     */
    public function patch(string $url, array $data, array $headers = []): array;

    /**
     * Make a DELETE request.
     *
     * @param string $url The URL to request
     * @param array<string, string> $headers Additional headers
     * @return array{body: string|null, httpCode: int, error: string|null}
     */
    public function delete(string $url, array $headers = []): array;
}

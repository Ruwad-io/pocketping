<?php

declare(strict_types=1);

namespace PocketPing\Http;

/**
 * cURL-based HTTP client implementation.
 */
class CurlHttpClient implements HttpClientInterface
{
    private readonly int $timeout;
    private readonly int $connectTimeout;

    public function __construct(
        int $timeout = 30,
        int $connectTimeout = 10
    ) {
        $this->timeout = $timeout;
        $this->connectTimeout = $connectTimeout;
    }

    /**
     * {@inheritdoc}
     */
    public function post(string $url, array $data, array $headers = []): array
    {
        return $this->request('POST', $url, $data, $headers);
    }

    /**
     * {@inheritdoc}
     */
    public function patch(string $url, array $data, array $headers = []): array
    {
        return $this->request('PATCH', $url, $data, $headers);
    }

    /**
     * {@inheritdoc}
     */
    public function delete(string $url, array $headers = []): array
    {
        return $this->request('DELETE', $url, null, $headers);
    }

    /**
     * Make an HTTP request.
     *
     * @param string $method HTTP method
     * @param string $url The URL to request
     * @param array<string, mixed>|null $data The request body data
     * @param array<string, string> $headers Additional headers
     * @return array{body: string|null, httpCode: int, error: string|null}
     */
    private function request(string $method, string $url, ?array $data, array $headers): array
    {
        $ch = curl_init();

        $curlHeaders = ['Content-Type: application/json'];
        foreach ($headers as $name => $value) {
            $curlHeaders[] = "{$name}: {$value}";
        }

        $options = [
            CURLOPT_URL => $url,
            CURLOPT_HTTPHEADER => $curlHeaders,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => $this->connectTimeout,
        ];

        switch ($method) {
            case 'POST':
                $options[CURLOPT_POST] = true;
                if ($data !== null) {
                    $options[CURLOPT_POSTFIELDS] = json_encode($data);
                }
                break;
            case 'PATCH':
                $options[CURLOPT_CUSTOMREQUEST] = 'PATCH';
                if ($data !== null) {
                    $options[CURLOPT_POSTFIELDS] = json_encode($data);
                }
                break;
            case 'DELETE':
                $options[CURLOPT_CUSTOMREQUEST] = 'DELETE';
                break;
        }

        curl_setopt_array($ch, $options);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        return [
            'body' => $response === false ? null : $response,
            'httpCode' => $httpCode,
            'error' => $curlError !== '' ? $curlError : null,
        ];
    }
}

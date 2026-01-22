<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Custom event for bidirectional communication.
 */
final class CustomEvent implements \JsonSerializable
{
    /**
     * @param string $name Event name (e.g., 'clicked_pricing', 'show_offer')
     * @param array<string, mixed>|null $data Event payload
     * @param \DateTimeImmutable $timestamp Timestamp of the event
     * @param string|null $sessionId Session ID (populated by SDK when event comes from widget)
     */
    public function __construct(
        public readonly string $name,
        public readonly ?array $data = null,
        public \DateTimeImmutable $timestamp = new \DateTimeImmutable(),
        public ?string $sessionId = null,
    ) {
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $timestamp = isset($data['timestamp'])
            ? (is_string($data['timestamp'])
                ? new \DateTimeImmutable($data['timestamp'])
                : \DateTimeImmutable::createFromInterface($data['timestamp']))
            : new \DateTimeImmutable();

        return new self(
            name: (string) ($data['name'] ?? throw new \InvalidArgumentException('CustomEvent requires name')),
            data: $data['data'] ?? null,
            timestamp: $timestamp,
            sessionId: isset($data['sessionId']) ? (string) $data['sessionId'] : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $result = [
            'name' => $this->name,
            'timestamp' => $this->timestamp->format(\DateTimeInterface::ATOM),
        ];

        if ($this->data !== null) {
            $result['data'] = $this->data;
        }

        if ($this->sessionId !== null) {
            $result['sessionId'] = $this->sessionId;
        }

        return $result;
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    /**
     * Create a copy with session ID set.
     */
    public function withSessionId(string $sessionId): self
    {
        $clone = clone $this;
        $clone->sessionId = $sessionId;
        return $clone;
    }
}

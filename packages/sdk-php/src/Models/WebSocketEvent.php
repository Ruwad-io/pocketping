<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * WebSocket event structure.
 */
final class WebSocketEvent implements \JsonSerializable
{
    /**
     * @param string $type Event type (e.g., 'message', 'typing', 'presence')
     * @param array<string, mixed> $data Event data
     */
    public function __construct(
        public readonly string $type,
        public readonly array $data,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'type' => $this->type,
            'data' => $this->data,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    /**
     * Get JSON representation.
     */
    public function toJson(): string
    {
        return json_encode($this->toArray(), JSON_THROW_ON_ERROR);
    }
}

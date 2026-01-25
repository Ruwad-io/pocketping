<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Request to delete a message.
 */
final class DeleteMessageRequest implements \JsonSerializable
{
    /**
     * @param string $sessionId Session ID
     * @param string $messageId Message ID to delete
     */
    public function __construct(
        public readonly string $sessionId,
        public readonly string $messageId,
    ) {
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            sessionId: (string) ($data['sessionId'] ?? throw new \InvalidArgumentException('DeleteMessageRequest requires sessionId')),
            messageId: (string) ($data['messageId'] ?? throw new \InvalidArgumentException('DeleteMessageRequest requires messageId')),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'sessionId' => $this->sessionId,
            'messageId' => $this->messageId,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}

<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Request to mark messages as read/delivered.
 */
final class ReadRequest implements \JsonSerializable
{
    /**
     * @param string $sessionId Session ID
     * @param string[] $messageIds Message IDs to mark
     * @param MessageStatus $status Status to set
     */
    public function __construct(
        public readonly string $sessionId,
        public readonly array $messageIds,
        public readonly MessageStatus $status = MessageStatus::READ,
    ) {
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $status = $data['status'] ?? MessageStatus::READ;

        return new self(
            sessionId: (string) ($data['sessionId'] ?? throw new \InvalidArgumentException('ReadRequest requires sessionId')),
            messageIds: array_map('strval', $data['messageIds'] ?? throw new \InvalidArgumentException('ReadRequest requires messageIds')),
            status: is_string($status) ? MessageStatus::from($status) : $status,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'sessionId' => $this->sessionId,
            'messageIds' => $this->messageIds,
            'status' => $this->status->value,
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

<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Response after deleting a message.
 */
final class DeleteMessageResponse implements \JsonSerializable
{
    /**
     * @param bool $deleted Whether the message was deleted
     */
    public function __construct(
        public readonly bool $deleted,
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
            deleted: (bool) ($data['deleted'] ?? false),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'deleted' => $this->deleted,
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

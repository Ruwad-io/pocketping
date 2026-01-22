<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Response after marking messages as read.
 */
final class ReadResponse implements \JsonSerializable
{
    public function __construct(
        public readonly int $updated,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'updated' => $this->updated,
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

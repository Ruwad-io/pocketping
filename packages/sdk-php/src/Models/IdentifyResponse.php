<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Response after identifying a user.
 */
final class IdentifyResponse implements \JsonSerializable
{
    public function __construct(
        public readonly bool $ok = true,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'ok' => $this->ok,
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

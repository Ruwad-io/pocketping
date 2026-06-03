<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Response after a visitor submits a CSAT rating.
 */
final class CsatResponse implements \JsonSerializable
{
    /**
     * @param bool $ok Whether the request succeeded
     * @param bool $alreadyRated True when a rating was already recorded (idempotent no-op)
     */
    public function __construct(
        public readonly bool $ok = true,
        public readonly bool $alreadyRated = false,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = ['ok' => $this->ok];
        if ($this->alreadyRated) {
            $data['alreadyRated'] = true;
        }

        return $data;
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}

<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Response for presence check.
 */
final class PresenceResponse implements \JsonSerializable
{
    /**
     * @param bool $online Whether operator is online
     * @param array<array{id: string, name: string, avatar?: string}>|null $operators Online operators
     * @param bool $aiEnabled Whether AI is enabled
     * @param int|null $aiActiveAfter Seconds until AI activates
     */
    public function __construct(
        public readonly bool $online,
        public readonly ?array $operators = null,
        public readonly bool $aiEnabled = false,
        public readonly ?int $aiActiveAfter = null,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = [
            'online' => $this->online,
            'aiEnabled' => $this->aiEnabled,
        ];

        if ($this->operators !== null) {
            $data['operators'] = $this->operators;
        }

        if ($this->aiActiveAfter !== null) {
            $data['aiActiveAfter'] = $this->aiActiveAfter;
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

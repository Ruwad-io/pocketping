<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Request to identify a user.
 */
final class IdentifyRequest implements \JsonSerializable
{
    public function __construct(
        public readonly string $sessionId,
        public readonly UserIdentity $identity,
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
            sessionId: (string) ($data['sessionId'] ?? throw new \InvalidArgumentException('IdentifyRequest requires sessionId')),
            identity: is_array($data['identity'] ?? null)
                ? UserIdentity::fromArray($data['identity'])
                : throw new \InvalidArgumentException('IdentifyRequest requires identity'),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'sessionId' => $this->sessionId,
            'identity' => $this->identity->toArray(),
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

<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Request to connect/create a session.
 */
final class ConnectRequest implements \JsonSerializable
{
    public function __construct(
        public readonly string $visitorId,
        public readonly ?string $sessionId = null,
        public readonly ?SessionMetadata $metadata = null,
        public readonly ?UserIdentity $identity = null,
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
            visitorId: (string) ($data['visitorId'] ?? throw new \InvalidArgumentException('ConnectRequest requires visitorId')),
            sessionId: isset($data['sessionId']) ? (string) $data['sessionId'] : null,
            metadata: isset($data['metadata']) && is_array($data['metadata'])
                ? SessionMetadata::fromArray($data['metadata'])
                : null,
            identity: isset($data['identity']) && is_array($data['identity'])
                ? UserIdentity::fromArray($data['identity'])
                : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = ['visitorId' => $this->visitorId];

        if ($this->sessionId !== null) {
            $data['sessionId'] = $this->sessionId;
        }

        if ($this->metadata !== null) {
            $data['metadata'] = $this->metadata->toArray();
        }

        if ($this->identity !== null) {
            $data['identity'] = $this->identity->toArray();
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

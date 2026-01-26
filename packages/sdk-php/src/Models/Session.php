<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * A chat session with a visitor.
 */
final class Session implements \JsonSerializable
{
    public function __construct(
        public readonly string $id,
        public readonly string $visitorId,
        public \DateTimeImmutable $createdAt,
        public \DateTimeImmutable $lastActivity,
        public bool $operatorOnline = false,
        public bool $aiActive = false,
        public ?SessionMetadata $metadata = null,
        public ?UserIdentity $identity = null,
        /** User phone from pre-chat form (E.164 format: +33612345678) */
        public ?string $userPhone = null,
        /** User phone country code (ISO: FR, US, etc.) */
        public ?string $userPhoneCountry = null,
    ) {
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $id = $data['id'] ?? throw new \InvalidArgumentException('Session requires id field');
        $visitorId = $data['visitorId'] ?? throw new \InvalidArgumentException('Session requires visitorId field');

        $createdAt = isset($data['createdAt'])
            ? (is_string($data['createdAt'])
                ? new \DateTimeImmutable($data['createdAt'])
                : \DateTimeImmutable::createFromInterface($data['createdAt']))
            : new \DateTimeImmutable();

        $lastActivity = isset($data['lastActivity'])
            ? (is_string($data['lastActivity'])
                ? new \DateTimeImmutable($data['lastActivity'])
                : \DateTimeImmutable::createFromInterface($data['lastActivity']))
            : new \DateTimeImmutable();

        return new self(
            id: (string) $id,
            visitorId: (string) $visitorId,
            createdAt: $createdAt,
            lastActivity: $lastActivity,
            operatorOnline: (bool) ($data['operatorOnline'] ?? false),
            aiActive: (bool) ($data['aiActive'] ?? false),
            metadata: isset($data['metadata']) && is_array($data['metadata'])
                ? SessionMetadata::fromArray($data['metadata'])
                : null,
            identity: isset($data['identity']) && is_array($data['identity'])
                ? UserIdentity::fromArray($data['identity'])
                : null,
            userPhone: isset($data['userPhone']) ? (string) $data['userPhone'] : null,
            userPhoneCountry: isset($data['userPhoneCountry']) ? (string) $data['userPhoneCountry'] : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'visitorId' => $this->visitorId,
            'createdAt' => $this->createdAt->format(\DateTimeInterface::ATOM),
            'lastActivity' => $this->lastActivity->format(\DateTimeInterface::ATOM),
            'operatorOnline' => $this->operatorOnline,
            'aiActive' => $this->aiActive,
            'metadata' => $this->metadata?->toArray(),
            'identity' => $this->identity?->toArray(),
            'userPhone' => $this->userPhone,
            'userPhoneCountry' => $this->userPhoneCountry,
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
     * Update last activity timestamp.
     */
    public function touchActivity(): self
    {
        $clone = clone $this;
        $clone->lastActivity = new \DateTimeImmutable();
        return $clone;
    }

    /**
     * Update with new metadata.
     */
    public function withMetadata(?SessionMetadata $metadata): self
    {
        $clone = clone $this;
        $clone->metadata = $metadata;
        return $clone;
    }

    /**
     * Update with new identity.
     */
    public function withIdentity(?UserIdentity $identity): self
    {
        $clone = clone $this;
        $clone->identity = $identity;
        return $clone;
    }

    /**
     * Update AI active status.
     */
    public function withAiActive(bool $aiActive): self
    {
        $clone = clone $this;
        $clone->aiActive = $aiActive;
        return $clone;
    }
}

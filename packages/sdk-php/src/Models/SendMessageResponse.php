<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Response after sending a message.
 */
final class SendMessageResponse implements \JsonSerializable
{
    public function __construct(
        public readonly string $messageId,
        public readonly \DateTimeImmutable $timestamp,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'messageId' => $this->messageId,
            'timestamp' => $this->timestamp->format(\DateTimeInterface::ATOM),
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

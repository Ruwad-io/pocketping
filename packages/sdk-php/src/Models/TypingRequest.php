<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Request to send typing indicator.
 */
final class TypingRequest implements \JsonSerializable
{
    public function __construct(
        public readonly string $sessionId,
        public readonly Sender $sender,
        public readonly bool $isTyping = true,
    ) {
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $sender = $data['sender'] ?? throw new \InvalidArgumentException('TypingRequest requires sender');

        return new self(
            sessionId: (string) ($data['sessionId'] ?? throw new \InvalidArgumentException('TypingRequest requires sessionId')),
            sender: is_string($sender) ? Sender::from($sender) : $sender,
            isTyping: (bool) ($data['isTyping'] ?? true),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'sessionId' => $this->sessionId,
            'sender' => $this->sender->value,
            'isTyping' => $this->isTyping,
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

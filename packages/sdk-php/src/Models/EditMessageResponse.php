<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Response after editing a message.
 */
final class EditMessageResponse implements \JsonSerializable
{
    /**
     * @param array{id: string, content: string, editedAt: string} $message Edited message data
     */
    public function __construct(
        public readonly array $message,
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
            message: $data['message'] ?? throw new \InvalidArgumentException('EditMessageResponse requires message'),
        );
    }

    /**
     * Get the edited message ID.
     */
    public function getMessageId(): string
    {
        return $this->message['id'];
    }

    /**
     * Get the new content.
     */
    public function getContent(): string
    {
        return $this->message['content'];
    }

    /**
     * Get the edit timestamp.
     */
    public function getEditedAt(): \DateTimeImmutable
    {
        return new \DateTimeImmutable($this->message['editedAt']);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'message' => $this->message,
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

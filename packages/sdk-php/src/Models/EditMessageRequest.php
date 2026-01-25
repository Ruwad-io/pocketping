<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Request to edit a message.
 */
final class EditMessageRequest implements \JsonSerializable
{
    public const MAX_CONTENT_LENGTH = 4000;

    /**
     * @param string $sessionId Session ID
     * @param string $messageId Message ID to edit
     * @param string $content New message content
     */
    public function __construct(
        public readonly string $sessionId,
        public readonly string $messageId,
        public readonly string $content,
    ) {
        if (mb_strlen($content) > self::MAX_CONTENT_LENGTH) {
            throw new \InvalidArgumentException(
                sprintf('Content exceeds maximum length of %d characters', self::MAX_CONTENT_LENGTH)
            );
        }
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            sessionId: (string) ($data['sessionId'] ?? throw new \InvalidArgumentException('EditMessageRequest requires sessionId')),
            messageId: (string) ($data['messageId'] ?? throw new \InvalidArgumentException('EditMessageRequest requires messageId')),
            content: (string) ($data['content'] ?? throw new \InvalidArgumentException('EditMessageRequest requires content')),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'sessionId' => $this->sessionId,
            'messageId' => $this->messageId,
            'content' => $this->content,
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

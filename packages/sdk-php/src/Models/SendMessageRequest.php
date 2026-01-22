<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Request to send a message.
 */
final class SendMessageRequest implements \JsonSerializable
{
    public const MAX_CONTENT_LENGTH = 4000;

    public function __construct(
        public readonly string $sessionId,
        public readonly string $content,
        public readonly Sender $sender,
        public readonly ?string $replyTo = null,
    ) {
        if (mb_strlen($this->content) > self::MAX_CONTENT_LENGTH) {
            throw new \InvalidArgumentException(
                sprintf('Message content exceeds maximum length of %d characters', self::MAX_CONTENT_LENGTH)
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
        $sender = $data['sender'] ?? throw new \InvalidArgumentException('SendMessageRequest requires sender');

        return new self(
            sessionId: (string) ($data['sessionId'] ?? throw new \InvalidArgumentException('SendMessageRequest requires sessionId')),
            content: (string) ($data['content'] ?? throw new \InvalidArgumentException('SendMessageRequest requires content')),
            sender: is_string($sender) ? Sender::from($sender) : $sender,
            replyTo: isset($data['replyTo']) ? (string) $data['replyTo'] : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = [
            'sessionId' => $this->sessionId,
            'content' => $this->content,
            'sender' => $this->sender->value,
        ];

        if ($this->replyTo !== null) {
            $data['replyTo'] = $this->replyTo;
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

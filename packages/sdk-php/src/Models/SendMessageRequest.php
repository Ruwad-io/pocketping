<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Request to send a message.
 */
final class SendMessageRequest implements \JsonSerializable
{
    public const MAX_CONTENT_LENGTH = 4000;

    /**
     * @param list<string>|null $attachmentIds IDs of attachments to include with the message
     * @param list<Attachment>|null $attachments Inline attachments (for operator messages from bridges)
     */
    public function __construct(
        public readonly string $sessionId,
        public readonly string $content,
        public readonly Sender $sender,
        public readonly ?string $replyTo = null,
        public readonly ?array $attachmentIds = null,
        public readonly ?array $attachments = null,
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

        // Parse attachments
        $attachments = null;
        if (isset($data['attachments']) && is_array($data['attachments'])) {
            $attachments = array_map(
                fn ($att) => is_array($att) ? Attachment::fromArray($att) : $att,
                $data['attachments']
            );
        }

        return new self(
            sessionId: (string) ($data['sessionId'] ?? throw new \InvalidArgumentException('SendMessageRequest requires sessionId')),
            content: (string) ($data['content'] ?? throw new \InvalidArgumentException('SendMessageRequest requires content')),
            sender: is_string($sender) ? Sender::from($sender) : $sender,
            replyTo: isset($data['replyTo']) ? (string) $data['replyTo'] : null,
            attachmentIds: $data['attachmentIds'] ?? null,
            attachments: $attachments,
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

        if ($this->attachmentIds !== null) {
            $data['attachmentIds'] = $this->attachmentIds;
        }

        if ($this->attachments !== null) {
            $data['attachments'] = array_map(
                fn ($att) => $att instanceof Attachment ? $att->toArray() : $att,
                $this->attachments
            );
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

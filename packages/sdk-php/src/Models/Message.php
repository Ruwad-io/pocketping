<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * A chat message.
 */
final class Message implements \JsonSerializable
{
    /**
     * @param array<string, mixed>|null $messageMetadata Additional message metadata
     */
    public function __construct(
        public readonly string $id,
        public readonly string $sessionId,
        public readonly string $content,
        public readonly Sender $sender,
        public \DateTimeImmutable $timestamp,
        public readonly ?string $replyTo = null,
        public readonly ?array $messageMetadata = null,
        public MessageStatus $status = MessageStatus::SENT,
        public ?\DateTimeImmutable $deliveredAt = null,
        public ?\DateTimeImmutable $readAt = null,
    ) {
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $id = $data['id'] ?? throw new \InvalidArgumentException('Message requires id field');
        $sessionId = $data['sessionId'] ?? throw new \InvalidArgumentException('Message requires sessionId field');
        $content = $data['content'] ?? throw new \InvalidArgumentException('Message requires content field');
        $sender = $data['sender'] ?? throw new \InvalidArgumentException('Message requires sender field');

        $timestamp = isset($data['timestamp'])
            ? (is_string($data['timestamp'])
                ? new \DateTimeImmutable($data['timestamp'])
                : \DateTimeImmutable::createFromInterface($data['timestamp']))
            : new \DateTimeImmutable();

        $deliveredAt = null;
        if (isset($data['deliveredAt'])) {
            $deliveredAt = is_string($data['deliveredAt'])
                ? new \DateTimeImmutable($data['deliveredAt'])
                : \DateTimeImmutable::createFromInterface($data['deliveredAt']);
        }

        $readAt = null;
        if (isset($data['readAt'])) {
            $readAt = is_string($data['readAt'])
                ? new \DateTimeImmutable($data['readAt'])
                : \DateTimeImmutable::createFromInterface($data['readAt']);
        }

        return new self(
            id: (string) $id,
            sessionId: (string) $sessionId,
            content: (string) $content,
            sender: is_string($sender) ? Sender::from($sender) : $sender,
            timestamp: $timestamp,
            replyTo: isset($data['replyTo']) ? (string) $data['replyTo'] : null,
            messageMetadata: $data['metadata'] ?? null,
            status: isset($data['status'])
                ? (is_string($data['status']) ? MessageStatus::from($data['status']) : $data['status'])
                : MessageStatus::SENT,
            deliveredAt: $deliveredAt,
            readAt: $readAt,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = [
            'id' => $this->id,
            'sessionId' => $this->sessionId,
            'content' => $this->content,
            'sender' => $this->sender->value,
            'timestamp' => $this->timestamp->format(\DateTimeInterface::ATOM),
            'status' => $this->status->value,
        ];

        if ($this->replyTo !== null) {
            $data['replyTo'] = $this->replyTo;
        }

        if ($this->messageMetadata !== null) {
            $data['metadata'] = $this->messageMetadata;
        }

        if ($this->deliveredAt !== null) {
            $data['deliveredAt'] = $this->deliveredAt->format(\DateTimeInterface::ATOM);
        }

        if ($this->readAt !== null) {
            $data['readAt'] = $this->readAt->format(\DateTimeInterface::ATOM);
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

    /**
     * Update message status.
     */
    public function withStatus(MessageStatus $status): self
    {
        $clone = clone $this;
        $clone->status = $status;
        return $clone;
    }

    /**
     * Update delivered timestamp.
     */
    public function withDeliveredAt(\DateTimeImmutable $deliveredAt): self
    {
        $clone = clone $this;
        $clone->deliveredAt = $deliveredAt;
        return $clone;
    }

    /**
     * Update read timestamp.
     */
    public function withReadAt(\DateTimeImmutable $readAt): self
    {
        $clone = clone $this;
        $clone->readAt = $readAt;
        return $clone;
    }
}

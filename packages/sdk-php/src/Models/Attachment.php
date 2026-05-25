<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * File attachment in a message.
 */
final class Attachment implements \JsonSerializable
{
    public function __construct(
        /** Unique attachment identifier */
        public readonly string $id,
        /** Original filename */
        public readonly string $filename,
        /** MIME type (e.g., 'image/jpeg', 'application/pdf') */
        public readonly string $mimeType,
        /** File size in bytes */
        public readonly int $size,
        /** URL to access the file */
        public readonly string $url,
        /** Message ID this attachment is linked to (null until linked) */
        public readonly ?string $messageId = null,
        /** Thumbnail URL (for images/videos) */
        public readonly ?string $thumbnailUrl = null,
        /** Upload status */
        public readonly AttachmentStatus $status = AttachmentStatus::READY,
        /** When the attachment was created */
        public readonly ?\DateTimeImmutable $createdAt = null,
        /** Source of the upload */
        public readonly ?UploadSource $uploadedFrom = null,
        /** External file ID (from Telegram/Discord/Slack) */
        public readonly ?string $bridgeFileId = null,
    ) {
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $id = $data['id'] ?? throw new \InvalidArgumentException('Attachment requires id field');
        $filename = $data['filename'] ?? throw new \InvalidArgumentException('Attachment requires filename field');
        $mimeType = $data['mimeType'] ?? throw new \InvalidArgumentException('Attachment requires mimeType field');
        $size = $data['size'] ?? throw new \InvalidArgumentException('Attachment requires size field');
        $url = $data['url'] ?? throw new \InvalidArgumentException('Attachment requires url field');

        $createdAt = null;
        if (isset($data['createdAt'])) {
            $createdAt = is_string($data['createdAt'])
                ? new \DateTimeImmutable($data['createdAt'])
                : \DateTimeImmutable::createFromInterface($data['createdAt']);
        }

        return new self(
            id: (string) $id,
            filename: (string) $filename,
            mimeType: (string) $mimeType,
            size: (int) $size,
            url: (string) $url,
            messageId: isset($data['messageId']) ? (string) $data['messageId'] : null,
            thumbnailUrl: isset($data['thumbnailUrl']) ? (string) $data['thumbnailUrl'] : null,
            status: isset($data['status'])
                ? (is_string($data['status']) ? AttachmentStatus::from($data['status']) : $data['status'])
                : AttachmentStatus::READY,
            createdAt: $createdAt,
            uploadedFrom: isset($data['uploadedFrom'])
                ? (is_string($data['uploadedFrom']) ? UploadSource::from($data['uploadedFrom']) : $data['uploadedFrom'])
                : null,
            bridgeFileId: isset($data['bridgeFileId']) ? (string) $data['bridgeFileId'] : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = [
            'id' => $this->id,
            'filename' => $this->filename,
            'mimeType' => $this->mimeType,
            'size' => $this->size,
            'url' => $this->url,
            'status' => $this->status->value,
        ];

        if ($this->messageId !== null) {
            $data['messageId'] = $this->messageId;
        }

        if ($this->thumbnailUrl !== null) {
            $data['thumbnailUrl'] = $this->thumbnailUrl;
        }

        if ($this->createdAt !== null) {
            $data['createdAt'] = $this->createdAt->format(\DateTimeInterface::ATOM);
        }

        if ($this->uploadedFrom !== null) {
            $data['uploadedFrom'] = $this->uploadedFrom->value;
        }

        if ($this->bridgeFileId !== null) {
            $data['bridgeFileId'] = $this->bridgeFileId;
        }

        return $data;
    }

    /**
     * Return a copy linked to the given message ID.
     */
    public function withMessageId(?string $messageId): self
    {
        $clone = clone $this;
        return new self(
            id: $clone->id,
            filename: $clone->filename,
            mimeType: $clone->mimeType,
            size: $clone->size,
            url: $clone->url,
            messageId: $messageId,
            thumbnailUrl: $clone->thumbnailUrl,
            status: $clone->status,
            createdAt: $clone->createdAt,
            uploadedFrom: $clone->uploadedFrom,
            bridgeFileId: $clone->bridgeFileId,
        );
    }

    /**
     * Return a copy with the given status.
     */
    public function withStatus(AttachmentStatus $status): self
    {
        return new self(
            id: $this->id,
            filename: $this->filename,
            mimeType: $this->mimeType,
            size: $this->size,
            url: $this->url,
            messageId: $this->messageId,
            thumbnailUrl: $this->thumbnailUrl,
            status: $status,
            createdAt: $this->createdAt,
            uploadedFrom: $this->uploadedFrom,
            bridgeFileId: $this->bridgeFileId,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}

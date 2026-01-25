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
        /** Thumbnail URL (for images/videos) */
        public readonly ?string $thumbnailUrl = null,
        /** Upload status */
        public readonly AttachmentStatus $status = AttachmentStatus::READY,
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

        return new self(
            id: (string) $id,
            filename: (string) $filename,
            mimeType: (string) $mimeType,
            size: (int) $size,
            url: (string) $url,
            thumbnailUrl: isset($data['thumbnailUrl']) ? (string) $data['thumbnailUrl'] : null,
            status: isset($data['status'])
                ? (is_string($data['status']) ? AttachmentStatus::from($data['status']) : $data['status'])
                : AttachmentStatus::READY,
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

        if ($this->thumbnailUrl !== null) {
            $data['thumbnailUrl'] = $this->thumbnailUrl;
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
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}

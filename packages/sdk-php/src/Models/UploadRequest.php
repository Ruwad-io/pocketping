<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Request to obtain a presigned upload URL for a file attachment.
 */
final class UploadRequest implements \JsonSerializable
{
    public function __construct(
        /** Session the attachment belongs to */
        public readonly string $sessionId,
        /** Original filename */
        public readonly string $filename,
        /** MIME type of the file */
        public readonly string $mimeType,
        /** File size in bytes */
        public readonly int $size,
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
            sessionId: (string) ($data['sessionId'] ?? throw new \InvalidArgumentException('UploadRequest requires sessionId')),
            filename: (string) ($data['filename'] ?? throw new \InvalidArgumentException('UploadRequest requires filename')),
            mimeType: (string) ($data['mimeType'] ?? throw new \InvalidArgumentException('UploadRequest requires mimeType')),
            size: (int) ($data['size'] ?? throw new \InvalidArgumentException('UploadRequest requires size')),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'sessionId' => $this->sessionId,
            'filename' => $this->filename,
            'mimeType' => $this->mimeType,
            'size' => $this->size,
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

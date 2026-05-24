<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Response containing a presigned upload URL for a file attachment.
 */
final class UploadResponse implements \JsonSerializable
{
    public function __construct(
        /** ID of the created attachment */
        public readonly string $attachmentId,
        /** Presigned URL for direct upload */
        public readonly string $uploadUrl,
        /** When the presigned URL expires */
        public readonly \DateTimeImmutable $expiresAt,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'attachmentId' => $this->attachmentId,
            'uploadUrl' => $this->uploadUrl,
            'expiresAt' => $this->expiresAt->format(\DateTimeInterface::ATOM),
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

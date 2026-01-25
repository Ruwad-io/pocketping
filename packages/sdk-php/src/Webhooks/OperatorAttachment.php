<?php

declare(strict_types=1);

namespace PocketPing\Webhooks;

/**
 * Attachment from an operator message received via webhook.
 */
class OperatorAttachment
{
    public function __construct(
        public readonly string $filename,
        public readonly string $mimeType,
        public readonly int $size,
        public readonly string $data,
        public readonly ?string $bridgeFileId = null,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'filename' => $this->filename,
            'mimeType' => $this->mimeType,
            'size' => $this->size,
            'bridgeFileId' => $this->bridgeFileId,
        ];
    }
}

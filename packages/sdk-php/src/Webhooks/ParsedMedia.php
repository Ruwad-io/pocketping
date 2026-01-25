<?php

declare(strict_types=1);

namespace PocketPing\Webhooks;

/**
 * Parsed media information from a Telegram message.
 *
 * @internal
 */
class ParsedMedia
{
    public function __construct(
        public readonly string $fileId,
        public readonly string $filename,
        public readonly string $mimeType,
        public readonly int $size,
    ) {}
}

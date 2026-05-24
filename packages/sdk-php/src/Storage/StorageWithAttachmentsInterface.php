<?php

declare(strict_types=1);

namespace PocketPing\Storage;

use PocketPing\Models\Attachment;

/**
 * Extended storage interface with file attachment support.
 * Implement this interface to support the file attachment upload flow.
 */
interface StorageWithAttachmentsInterface extends StorageInterface
{
    /**
     * Save an attachment.
     */
    public function saveAttachment(Attachment $attachment): void;

    /**
     * Get an attachment by ID.
     */
    public function getAttachment(string $attachmentId): ?Attachment;

    /**
     * Get all attachments linked to a message.
     *
     * @return Attachment[]
     */
    public function getMessageAttachments(string $messageId): array;

    /**
     * Update an existing attachment (e.g., status or message link).
     */
    public function updateAttachment(Attachment $attachment): void;
}

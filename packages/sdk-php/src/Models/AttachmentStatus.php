<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Upload status of an attachment.
 */
enum AttachmentStatus: string
{
    case PENDING = 'pending';
    case UPLOADING = 'uploading';
    case READY = 'ready';
    case FAILED = 'failed';
}

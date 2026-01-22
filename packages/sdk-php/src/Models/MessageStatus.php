<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Message delivery status.
 */
enum MessageStatus: string
{
    case SENDING = 'sending';
    case SENT = 'sent';
    case DELIVERED = 'delivered';
    case READ = 'read';
}

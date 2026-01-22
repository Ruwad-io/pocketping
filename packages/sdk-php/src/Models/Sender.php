<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Message sender type.
 */
enum Sender: string
{
    case VISITOR = 'visitor';
    case OPERATOR = 'operator';
    case AI = 'ai';
}

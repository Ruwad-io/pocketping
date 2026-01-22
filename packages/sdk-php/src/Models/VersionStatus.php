<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Widget version compatibility status.
 */
enum VersionStatus: string
{
    case OK = 'ok';
    case OUTDATED = 'outdated';
    case DEPRECATED = 'deprecated';
    case UNSUPPORTED = 'unsupported';
}

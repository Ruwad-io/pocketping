<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Source of an attachment upload.
 */
enum UploadSource: string
{
    case WIDGET = 'widget';
    case TELEGRAM = 'telegram';
    case DISCORD = 'discord';
    case SLACK = 'slack';
    case API = 'api';
}

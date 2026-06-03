<?php

declare(strict_types=1);

namespace PocketPing\Storage;

use PocketPing\Models\Session;

/**
 * Extended storage interface that can list sessions.
 *
 * Required by {@see \PocketPing\PocketPing::getStats()}; the bundled
 * MemoryStorage implements it. Custom storage adapters that don't implement
 * this interface can't use stats.
 */
interface StorageWithListSessionsInterface extends StorageInterface
{
    /**
     * List sessions, optionally only those created since a given date.
     *
     * @param \DateTimeInterface|null $since Only return sessions created at or after this date
     * @return Session[]
     */
    public function listSessions(?\DateTimeInterface $since = null): array;
}

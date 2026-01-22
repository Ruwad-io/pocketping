<?php

declare(strict_types=1);

namespace PocketPing\Storage;

use PocketPing\Models\Message;
use PocketPing\Models\Session;

/**
 * Storage interface for PocketPing sessions and messages.
 */
interface StorageInterface
{
    /**
     * Create a new session.
     */
    public function createSession(Session $session): void;

    /**
     * Get a session by ID.
     */
    public function getSession(string $sessionId): ?Session;

    /**
     * Update an existing session.
     */
    public function updateSession(Session $session): void;

    /**
     * Delete a session.
     */
    public function deleteSession(string $sessionId): void;

    /**
     * Save a message.
     */
    public function saveMessage(Message $message): void;

    /**
     * Get messages for a session.
     *
     * @param string $sessionId Session ID
     * @param string|null $after Message ID to start after (for pagination)
     * @param int $limit Maximum number of messages to return
     * @return Message[]
     */
    public function getMessages(string $sessionId, ?string $after = null, int $limit = 50): array;

    /**
     * Get a message by ID.
     */
    public function getMessage(string $messageId): ?Message;

    /**
     * Clean up old sessions.
     *
     * @param \DateTimeInterface $olderThan Sessions older than this will be deleted
     * @return int Number of sessions deleted
     */
    public function cleanupOldSessions(\DateTimeInterface $olderThan): int;

    /**
     * Get the most recent session for a visitor.
     */
    public function getSessionByVisitorId(string $visitorId): ?Session;
}

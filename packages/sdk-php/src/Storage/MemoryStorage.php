<?php

declare(strict_types=1);

namespace PocketPing\Storage;

use PocketPing\Models\BridgeMessageIds;
use PocketPing\Models\Message;
use PocketPing\Models\Session;

/**
 * In-memory storage adapter. Useful for development and testing.
 */
final class MemoryStorage implements StorageWithBridgeIdsInterface
{
    /** @var array<string, Session> */
    private array $sessions = [];

    /** @var array<string, Message[]> */
    private array $messages = [];

    /** @var array<string, Message> */
    private array $messageById = [];

    /** @var array<string, BridgeMessageIds> */
    private array $bridgeMessageIds = [];

    /**
     * Create a new session.
     */
    public function createSession(Session $session): void
    {
        $this->sessions[$session->id] = $session;
        $this->messages[$session->id] = [];
    }

    /**
     * Get a session by ID.
     */
    public function getSession(string $sessionId): ?Session
    {
        return $this->sessions[$sessionId] ?? null;
    }

    /**
     * Update an existing session.
     */
    public function updateSession(Session $session): void
    {
        $this->sessions[$session->id] = $session;
    }

    /**
     * Delete a session.
     */
    public function deleteSession(string $sessionId): void
    {
        // Remove messages first
        if (isset($this->messages[$sessionId])) {
            foreach ($this->messages[$sessionId] as $message) {
                unset($this->messageById[$message->id]);
            }
            unset($this->messages[$sessionId]);
        }

        unset($this->sessions[$sessionId]);
    }

    /**
     * Save a message.
     */
    public function saveMessage(Message $message): void
    {
        if (!isset($this->messages[$message->sessionId])) {
            $this->messages[$message->sessionId] = [];
        }

        // Check if message already exists (update case)
        $existingIndex = null;
        foreach ($this->messages[$message->sessionId] as $index => $existing) {
            if ($existing->id === $message->id) {
                $existingIndex = $index;
                break;
            }
        }

        if ($existingIndex !== null) {
            $this->messages[$message->sessionId][$existingIndex] = $message;
        } else {
            $this->messages[$message->sessionId][] = $message;
        }

        $this->messageById[$message->id] = $message;
    }

    /**
     * Get messages for a session.
     *
     * @param string $sessionId Session ID
     * @param string|null $after Message ID to start after (for pagination)
     * @param int $limit Maximum number of messages to return
     * @return Message[]
     */
    public function getMessages(string $sessionId, ?string $after = null, int $limit = 50): array
    {
        $messages = $this->messages[$sessionId] ?? [];

        if ($after !== null) {
            $startIndex = 0;
            foreach ($messages as $index => $message) {
                if ($message->id === $after) {
                    $startIndex = $index + 1;
                    break;
                }
            }
            $messages = array_slice($messages, $startIndex);
        }

        return array_slice($messages, 0, $limit);
    }

    /**
     * Get a message by ID.
     */
    public function getMessage(string $messageId): ?Message
    {
        return $this->messageById[$messageId] ?? null;
    }

    /**
     * Clean up old sessions.
     *
     * @param \DateTimeInterface $olderThan Sessions older than this will be deleted
     * @return int Number of sessions deleted
     */
    public function cleanupOldSessions(\DateTimeInterface $olderThan): int
    {
        $count = 0;
        $toDelete = [];

        foreach ($this->sessions as $sessionId => $session) {
            if ($session->lastActivity < $olderThan) {
                $toDelete[] = $sessionId;
                $count++;
            }
        }

        foreach ($toDelete as $sessionId) {
            $this->deleteSession($sessionId);
        }

        return $count;
    }

    /**
     * Get the most recent session for a visitor.
     */
    public function getSessionByVisitorId(string $visitorId): ?Session
    {
        $visitorSessions = array_filter(
            $this->sessions,
            fn(Session $session) => $session->visitorId === $visitorId
        );

        if (empty($visitorSessions)) {
            return null;
        }

        // Return most recent by last_activity
        usort(
            $visitorSessions,
            fn(Session $a, Session $b) => $b->lastActivity <=> $a->lastActivity
        );

        return $visitorSessions[0];
    }

    /**
     * Get all sessions. Useful for admin/debug.
     *
     * @return Session[]
     */
    public function getAllSessions(): array
    {
        return array_values($this->sessions);
    }

    /**
     * Get total session count.
     */
    public function getSessionCount(): int
    {
        return count($this->sessions);
    }

    /**
     * Update an existing message (for edit/delete).
     */
    public function updateMessage(Message $message): void
    {
        if (!isset($this->messageById[$message->id])) {
            return;
        }

        // Update in messageById
        $this->messageById[$message->id] = $message;

        // Update in the session's messages array
        if (isset($this->messages[$message->sessionId])) {
            foreach ($this->messages[$message->sessionId] as $index => $existing) {
                if ($existing->id === $message->id) {
                    $this->messages[$message->sessionId][$index] = $message;
                    break;
                }
            }
        }
    }

    /**
     * Save platform-specific message IDs for a message.
     */
    public function saveBridgeMessageIds(string $messageId, BridgeMessageIds $bridgeIds): void
    {
        $existing = $this->bridgeMessageIds[$messageId] ?? null;
        if ($existing !== null) {
            $this->bridgeMessageIds[$messageId] = $existing->mergeWith($bridgeIds);
        } else {
            $this->bridgeMessageIds[$messageId] = $bridgeIds;
        }
    }

    /**
     * Get platform-specific message IDs for a message.
     */
    public function getBridgeMessageIds(string $messageId): ?BridgeMessageIds
    {
        return $this->bridgeMessageIds[$messageId] ?? null;
    }
}

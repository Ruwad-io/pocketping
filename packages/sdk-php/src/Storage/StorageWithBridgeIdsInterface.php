<?php

declare(strict_types=1);

namespace PocketPing\Storage;

use PocketPing\Models\BridgeMessageIds;
use PocketPing\Models\Message;

/**
 * Extended storage interface with bridge message ID support.
 * Implement this interface to support edit/delete synchronization with bridges.
 */
interface StorageWithBridgeIdsInterface extends StorageInterface
{
    /**
     * Update an existing message (for edit/delete).
     */
    public function updateMessage(Message $message): void;

    /**
     * Save platform-specific message IDs for a message.
     */
    public function saveBridgeMessageIds(string $messageId, BridgeMessageIds $bridgeIds): void;

    /**
     * Get platform-specific message IDs for a message.
     */
    public function getBridgeMessageIds(string $messageId): ?BridgeMessageIds;
}

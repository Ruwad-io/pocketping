<?php

declare(strict_types=1);

namespace PocketPing\Bridges;

use PocketPing\Models\BridgeMessageIds;

/**
 * Extended bridge interface with edit/delete support.
 * Implement this interface to support direct message editing/deletion in the platform.
 */
interface BridgeWithEditDeleteInterface extends BridgeInterface
{
    /**
     * Called when a message is edited.
     * Returns BridgeMessageIds with the platform-specific message ID.
     *
     * @param string $sessionId Session ID
     * @param string $messageId PocketPing message ID
     * @param string $content New message content
     * @param \DateTimeInterface $editedAt When the message was edited
     * @return BridgeMessageIds|null Platform-specific message IDs, or null if not applicable
     */
    public function onMessageEdit(
        string $sessionId,
        string $messageId,
        string $content,
        \DateTimeInterface $editedAt
    ): ?BridgeMessageIds;

    /**
     * Called when a message is deleted.
     *
     * @param string $sessionId Session ID
     * @param string $messageId PocketPing message ID
     * @param \DateTimeInterface $deletedAt When the message was deleted
     */
    public function onMessageDelete(
        string $sessionId,
        string $messageId,
        \DateTimeInterface $deletedAt
    ): void;
}

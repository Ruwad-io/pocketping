<?php

declare(strict_types=1);

namespace PocketPing\Bridges;

use PocketPing\Models\CustomEvent;
use PocketPing\Models\Message;
use PocketPing\Models\MessageStatus;
use PocketPing\Models\Session;
use PocketPing\PocketPing;

/**
 * Abstract base class for bridges with default empty implementations.
 */
abstract class AbstractBridge implements BridgeInterface
{
    protected ?PocketPing $pocketPing = null;

    /**
     * Called when the bridge is added to PocketPing.
     */
    public function init(PocketPing $pocketPing): void
    {
        $this->pocketPing = $pocketPing;
    }

    /**
     * Called when a new chat session is created.
     */
    public function onNewSession(Session $session): void
    {
        // Override in subclass
    }

    /**
     * Called when a visitor sends a message.
     */
    public function onVisitorMessage(Message $message, Session $session): void
    {
        // Override in subclass
    }

    /**
     * Called when an operator sends a message (for cross-bridge sync).
     */
    public function onOperatorMessage(
        Message $message,
        Session $session,
        string $sourceBridge,
        ?string $operatorName = null
    ): void {
        // Override in subclass
    }

    /**
     * Called when message read status changes.
     *
     * @param string[] $messageIds
     */
    public function onMessageRead(
        string $sessionId,
        array $messageIds,
        MessageStatus $status,
        Session $session
    ): void {
        // Override in subclass
    }

    /**
     * Called when a custom event is received.
     */
    public function onCustomEvent(CustomEvent $event, Session $session): void
    {
        // Override in subclass
    }

    /**
     * Called when user identity is updated.
     */
    public function onIdentityUpdate(Session $session): void
    {
        // Override in subclass
    }

    /**
     * Called when visitor starts/stops typing.
     */
    public function onTyping(string $sessionId, bool $isTyping): void
    {
        // Override in subclass
    }

    /**
     * Called when AI takes over a conversation.
     */
    public function onAiTakeover(Session $session, string $reason): void
    {
        // Override in subclass
    }

    /**
     * Cleanup when bridge is removed.
     */
    public function destroy(): void
    {
        $this->pocketPing = null;
    }
}

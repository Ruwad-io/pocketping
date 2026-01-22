<?php

declare(strict_types=1);

namespace PocketPing\Bridges;

use PocketPing\Models\CustomEvent;
use PocketPing\Models\Message;
use PocketPing\Models\MessageStatus;
use PocketPing\Models\Session;
use PocketPing\PocketPing;

/**
 * Bridge interface for notification channels (Telegram, Discord, Slack, etc.).
 */
interface BridgeInterface
{
    /**
     * Get the unique name for this bridge.
     */
    public function getName(): string;

    /**
     * Called when the bridge is added to PocketPing.
     */
    public function init(PocketPing $pocketPing): void;

    /**
     * Called when a new chat session is created.
     */
    public function onNewSession(Session $session): void;

    /**
     * Called when a visitor sends a message.
     */
    public function onVisitorMessage(Message $message, Session $session): void;

    /**
     * Called when an operator sends a message (for cross-bridge sync).
     */
    public function onOperatorMessage(
        Message $message,
        Session $session,
        string $sourceBridge,
        ?string $operatorName = null
    ): void;

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
    ): void;

    /**
     * Called when a custom event is received.
     */
    public function onCustomEvent(CustomEvent $event, Session $session): void;

    /**
     * Called when user identity is updated.
     */
    public function onIdentityUpdate(Session $session): void;

    /**
     * Called when visitor starts/stops typing.
     */
    public function onTyping(string $sessionId, bool $isTyping): void;

    /**
     * Called when AI takes over a conversation.
     */
    public function onAiTakeover(Session $session, string $reason): void;

    /**
     * Cleanup when bridge is removed.
     */
    public function destroy(): void;
}

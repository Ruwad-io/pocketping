<?php

declare(strict_types=1);

namespace PocketPing\Webhooks;

/**
 * Configuration for webhook handlers.
 */
class WebhookConfig
{
    /**
     * @param string|null $telegramBotToken Telegram bot token for downloading files
     * @param string|null $slackBotToken Slack bot token for downloading files and getting user info
     * @param string|null $discordBotToken Discord bot token (for future use)
     * @param callable(string, string, string, string, OperatorAttachment[], int|null): void|null $onOperatorMessage
     *        Callback when operator sends a message. Arguments:
     *        - $sessionId: The session/topic/thread ID
     *        - $content: The message content
     *        - $operatorName: The operator's name
     *        - $sourceBridge: 'telegram', 'slack', or 'discord'
     *        - $attachments: Array of OperatorAttachment objects
     *        - $replyToBridgeMessageId: The bridge message ID being replied to (Telegram message_id, null if not a reply)
     * @param callable(string, string, string, string, OperatorAttachment[], int|null, string): void|null $onOperatorMessageWithIds
     *        Callback when operator sends a message with bridge message ID.
     * @param callable(string, string, string, string): void|null $onOperatorMessageEdit
     *        Callback when operator edits a message. Arguments:
     *        - $sessionId, $bridgeMessageId, $content, $sourceBridge
     * @param callable(string, string, string): void|null $onOperatorMessageDelete
     *        Callback when operator deletes a message. Arguments:
     *        - $sessionId, $bridgeMessageId, $sourceBridge
     * @param string[]|null $allowedBotIds
     *        Optional allowlist of bot IDs for test messages
     */
    public function __construct(
        public readonly ?string $telegramBotToken = null,
        public readonly ?string $slackBotToken = null,
        public readonly ?string $discordBotToken = null,
        /** @var callable(string, string, string, string, OperatorAttachment[], int|null): void|null */
        public $onOperatorMessage = null,
        /** @var callable(string, string, string, string, OperatorAttachment[], int|null, string): void|null */
        public $onOperatorMessageWithIds = null,
        /** @var callable(string, string, string, string): void|null */
        public $onOperatorMessageEdit = null,
        /** @var callable(string, string, string): void|null */
        public $onOperatorMessageDelete = null,
        /** @var string[]|null */
        public ?array $allowedBotIds = null,
    ) {}
}

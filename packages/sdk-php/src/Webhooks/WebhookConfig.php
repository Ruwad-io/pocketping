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
     * @param callable(string, string, string, string, OperatorAttachment[]): void|null $onOperatorMessage
     *        Callback when operator sends a message. Arguments:
     *        - $sessionId: The session/topic/thread ID
     *        - $content: The message content
     *        - $operatorName: The operator's name
     *        - $sourceBridge: 'telegram', 'slack', or 'discord'
     *        - $attachments: Array of OperatorAttachment objects
     */
    public function __construct(
        public readonly ?string $telegramBotToken = null,
        public readonly ?string $slackBotToken = null,
        public readonly ?string $discordBotToken = null,
        /** @var callable(string, string, string, string, OperatorAttachment[]): void|null */
        public $onOperatorMessage = null,
    ) {}
}

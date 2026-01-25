<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Webhooks\WebhookConfig;
use PocketPing\Webhooks\WebhookHandler;

class WebhookHandlerTest extends TestCase
{
    public function testTelegramEditedMessageTriggersEditCallback(): void
    {
        $called = [];
        $config = new WebhookConfig(
            telegramBotToken: 'test-token',
            onOperatorMessageEdit: function (
                string $sessionId,
                string $bridgeMessageId,
                string $content,
                string $sourceBridge
            ) use (&$called): void {
                $called = [$sessionId, $bridgeMessageId, $content, $sourceBridge];
            }
        );

        $handler = new WebhookHandler($config);
        $payload = [
            'edited_message' => [
                'message_id' => 123,
                'message_thread_id' => 456,
                'text' => 'Updated message',
            ],
        ];

        $response = $handler->handleTelegramWebhook($payload);

        $this->assertEquals(['ok' => true], $response);
        $this->assertSame(['456', '123', 'Updated message', 'telegram'], $called);
    }

    public function testTelegramDeleteCommandTriggersDeleteCallback(): void
    {
        $called = [];
        $config = new WebhookConfig(
            telegramBotToken: 'test-token',
            onOperatorMessageDelete: function (
                string $sessionId,
                string $bridgeMessageId,
                string $sourceBridge
            ) use (&$called): void {
                $called = [$sessionId, $bridgeMessageId, $sourceBridge];
            }
        );

        $handler = new WebhookHandler($config);
        $payload = [
            'message' => [
                'message_id' => 200,
                'message_thread_id' => 456,
                'text' => '/delete',
                'reply_to_message' => ['message_id' => 999],
            ],
        ];

        $response = $handler->handleTelegramWebhook($payload);

        $this->assertEquals(['ok' => true], $response);
        $this->assertSame(['456', '999', 'telegram'], $called);
    }

    public function testTelegramReactionTriggersDeleteCallback(): void
    {
        $called = [];
        $config = new WebhookConfig(
            telegramBotToken: 'test-token',
            onOperatorMessageDelete: function (
                string $sessionId,
                string $bridgeMessageId,
                string $sourceBridge
            ) use (&$called): void {
                $called = [$sessionId, $bridgeMessageId, $sourceBridge];
            }
        );

        $handler = new WebhookHandler($config);
        $payload = [
            'message_reaction' => [
                'message_id' => 999,
                'message_thread_id' => 456,
                'new_reaction' => [
                    ['type' => 'emoji', 'emoji' => '🗑️'],
                ],
            ],
        ];

        $response = $handler->handleTelegramWebhook($payload);

        $this->assertEquals(['ok' => true], $response);
        $this->assertSame(['456', '999', 'telegram'], $called);
    }
}

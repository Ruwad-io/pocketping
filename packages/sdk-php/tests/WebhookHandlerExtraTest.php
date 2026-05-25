<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Webhooks\OperatorAttachment;
use PocketPing\Webhooks\WebhookConfig;
use PocketPing\Webhooks\WebhookHandler;

/**
 * Exhaustive coverage of WebhookHandler incoming-parse paths for
 * Telegram, Slack, and Discord, including media download branches.
 */
class WebhookHandlerExtraTest extends TestCase
{
    /**
     * Inject a mock HTTP client into the handler's private $httpClient property.
     */
    private function injectClient(WebhookHandler $handler, MockHttpClient $client): void
    {
        $ref = new \ReflectionClass($handler);
        $prop = $ref->getProperty('httpClient');
        $prop->setAccessible(true);
        $prop->setValue($handler, $client);
    }

    // ─────────────────────────────────────────────────────────────────
    // Configuration guards
    // ─────────────────────────────────────────────────────────────────

    public function testTelegramNotConfiguredReturnsError(): void
    {
        $handler = new WebhookHandler(new WebhookConfig());
        $this->assertSame(['error' => 'Telegram not configured'], $handler->handleTelegramWebhook(['message' => []]));
    }

    public function testSlackNotConfiguredReturnsError(): void
    {
        $handler = new WebhookHandler(new WebhookConfig());
        $this->assertSame(['error' => 'Slack not configured'], $handler->handleSlackWebhook(['type' => 'event_callback']));
    }

    // ─────────────────────────────────────────────────────────────────
    // Telegram: message variations
    // ─────────────────────────────────────────────────────────────────

    public function testTelegramPlainTextMessageInvokesCallbacks(): void
    {
        $received = null;
        $withIds = null;
        $config = new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessage: function (...$args) use (&$received): void {
                $received = $args;
            },
            onOperatorMessageWithIds: function (...$args) use (&$withIds): void {
                $withIds = $args;
            },
        );
        $handler = new WebhookHandler($config);

        $response = $handler->handleTelegramWebhook([
            'message' => [
                'message_id' => 555,
                'message_thread_id' => 42,
                'text' => 'Hi visitor',
                'from' => ['first_name' => 'Alice'],
                'reply_to_message' => ['message_id' => 100],
            ],
        ]);

        $this->assertSame(['ok' => true], $response);
        $this->assertSame('42', $received[0]);
        $this->assertSame('Hi visitor', $received[1]);
        $this->assertSame('Alice', $received[2]);
        $this->assertSame('telegram', $received[3]);
        $this->assertSame([], $received[4]);
        $this->assertSame(100, $received[5]);
        // withIds variant gets the bridge message id appended.
        $this->assertSame('555', $withIds[6]);
    }

    public function testTelegramCaptionUsedWhenNoText(): void
    {
        $received = null;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessage: function (...$args) use (&$received): void {
                $received = $args;
            },
        ));

        $handler->handleTelegramWebhook([
            'message' => [
                'message_id' => 1,
                'message_thread_id' => 7,
                'caption' => 'caption text',
            ],
        ]);

        $this->assertSame('caption text', $received[1]);
    }

    public function testTelegramSkipsSlashCommands(): void
    {
        $called = false;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessage: function () use (&$called): void {
                $called = true;
            },
        ));

        $resp = $handler->handleTelegramWebhook([
            'message' => ['message_thread_id' => 1, 'text' => '/start'],
        ]);

        $this->assertSame(['ok' => true], $resp);
        $this->assertFalse($called);
    }

    public function testTelegramReturnsOkWhenNoMessage(): void
    {
        $handler = new WebhookHandler(new WebhookConfig(telegramBotToken: 'tok'));
        $this->assertSame(['ok' => true], $handler->handleTelegramWebhook(['update_id' => 1]));
    }

    public function testTelegramSkipsWhenNoTopicId(): void
    {
        $called = false;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessage: function () use (&$called): void {
                $called = true;
            },
        ));

        $handler->handleTelegramWebhook([
            'message' => ['message_id' => 1, 'text' => 'no topic'],
        ]);

        $this->assertFalse($called);
    }

    public function testTelegramSkipsWhenNoContentNoMedia(): void
    {
        $called = false;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessage: function () use (&$called): void {
                $called = true;
            },
        ));

        $handler->handleTelegramWebhook([
            'message' => ['message_id' => 1, 'message_thread_id' => 5, 'text' => ''],
        ]);

        $this->assertFalse($called);
    }

    public function testTelegramEditedMessageWithCaption(): void
    {
        $edited = null;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessageEdit: function (...$args) use (&$edited): void {
                $edited = $args;
            },
        ));

        $handler->handleTelegramWebhook([
            'edited_message' => [
                'message_id' => 9,
                'message_thread_id' => 3,
                'caption' => 'edited caption',
            ],
        ]);

        $this->assertSame(['3', '9', 'edited caption', 'telegram'], $edited);
    }

    public function testTelegramEditedSlashCommandIgnored(): void
    {
        $called = false;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessageEdit: function () use (&$called): void {
                $called = true;
            },
        ));

        $handler->handleTelegramWebhook([
            'edited_message' => ['message_id' => 9, 'message_thread_id' => 3, 'text' => '/cmd'],
        ]);

        $this->assertFalse($called);
    }

    public function testTelegramEditedEmptyIgnored(): void
    {
        $called = false;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessageEdit: function () use (&$called): void {
                $called = true;
            },
        ));

        $handler->handleTelegramWebhook([
            'edited_message' => ['message_id' => 9, 'message_thread_id' => 3, 'text' => ''],
        ]);

        $this->assertFalse($called);
    }

    public function testTelegramEditedNoTopicIgnored(): void
    {
        $called = false;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessageEdit: function () use (&$called): void {
                $called = true;
            },
        ));

        $handler->handleTelegramWebhook([
            'edited_message' => ['message_id' => 9, 'text' => 'no topic'],
        ]);

        $this->assertFalse($called);
    }

    public function testTelegramReactionWithoutTrashEmojiDoesNotDelete(): void
    {
        $called = false;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessageDelete: function () use (&$called): void {
                $called = true;
            },
        ));

        $handler->handleTelegramWebhook([
            'message_reaction' => [
                'message_id' => 1,
                'message_thread_id' => 2,
                'new_reaction' => [['type' => 'emoji', 'emoji' => '👍']],
            ],
        ]);

        $this->assertFalse($called);
    }

    // ─────────────────────────────────────────────────────────────────
    // Telegram: media download paths (via injected HTTP client)
    // ─────────────────────────────────────────────────────────────────

    public function testTelegramPhotoDownloadsAndAttaches(): void
    {
        $received = null;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessage: function (...$args) use (&$received): void {
                $received = $args;
            },
        ));

        $http = new MockHttpClient();
        // First the getFile call, then the file download.
        $http->queueResponse(json_encode(['ok' => true, 'result' => ['file_path' => 'photos/file_1.jpg']]));
        $http->queueResponse('BINARYDATA');
        $this->injectClient($handler, $http);

        $handler->handleTelegramWebhook([
            'message' => [
                'message_id' => 1,
                'message_thread_id' => 8,
                'photo' => [
                    ['file_id' => 'small', 'file_size' => 100],
                    ['file_id' => 'large', 'file_size' => 2000],
                ],
            ],
        ]);

        /** @var OperatorAttachment[] $attachments */
        $attachments = $received[4];
        $this->assertCount(1, $attachments);
        $this->assertSame('BINARYDATA', $attachments[0]->data);
        $this->assertSame('image/jpeg', $attachments[0]->mimeType);
        $this->assertSame('large', $attachments[0]->bridgeFileId);
    }

    public function testTelegramDocumentMedia(): void
    {
        $received = null;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessage: function (...$args) use (&$received): void {
                $received = $args;
            },
        ));

        $http = new MockHttpClient();
        $http->queueResponse(json_encode(['ok' => true, 'result' => ['file_path' => 'docs/d.pdf']]));
        $http->queueResponse('PDFDATA');
        $this->injectClient($handler, $http);

        $handler->handleTelegramWebhook([
            'message' => [
                'message_id' => 1,
                'message_thread_id' => 8,
                'document' => ['file_id' => 'doc1', 'file_name' => 'report.pdf', 'mime_type' => 'application/pdf', 'file_size' => 500],
            ],
        ]);

        $this->assertSame('report.pdf', $received[4][0]->filename);
    }

    public function testTelegramAudioVideoVoiceMedia(): void
    {
        foreach (['audio', 'video', 'voice'] as $kind) {
            $received = null;
            $handler = new WebhookHandler(new WebhookConfig(
                telegramBotToken: 'tok',
                onOperatorMessage: function (...$args) use (&$received): void {
                    $received = $args;
                },
            ));
            $http = new MockHttpClient();
            $http->queueResponse(json_encode(['ok' => true, 'result' => ['file_path' => "f/{$kind}"]]));
            $http->queueResponse('DATA');
            $this->injectClient($handler, $http);

            $handler->handleTelegramWebhook([
                'message' => [
                    'message_id' => 1,
                    'message_thread_id' => 8,
                    $kind => ['file_id' => "id-{$kind}", 'file_size' => 10],
                ],
            ]);

            $this->assertCount(1, $received[4], "media kind {$kind}");
        }
    }

    public function testTelegramFileDownloadFailureProducesNoAttachment(): void
    {
        $received = null;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessage: function (...$args) use (&$received): void {
                $received = $args;
            },
        ));

        $http = new MockHttpClient();
        // getFile fails (non-200) => download returns null.
        $http->queueResponse('error', 500);
        $this->injectClient($handler, $http);

        $handler->handleTelegramWebhook([
            'message' => [
                'message_id' => 1,
                'message_thread_id' => 8,
                'photo' => [['file_id' => 'x', 'file_size' => 1]],
            ],
        ]);

        $this->assertSame([], $received[4]);
    }

    public function testTelegramFileDownloadHandlesGetFileNotOk(): void
    {
        $received = null;
        $handler = new WebhookHandler(new WebhookConfig(
            telegramBotToken: 'tok',
            onOperatorMessage: function (...$args) use (&$received): void {
                $received = $args;
            },
        ));

        $http = new MockHttpClient();
        $http->queueResponse(json_encode(['ok' => false]));
        $this->injectClient($handler, $http);

        $handler->handleTelegramWebhook([
            'message' => [
                'message_id' => 1,
                'message_thread_id' => 8,
                'photo' => [['file_id' => 'x', 'file_size' => 1]],
            ],
        ]);

        $this->assertSame([], $received[4]);
    }

    // ─────────────────────────────────────────────────────────────────
    // Slack
    // ─────────────────────────────────────────────────────────────────

    public function testSlackUrlVerificationChallenge(): void
    {
        $handler = new WebhookHandler(new WebhookConfig(slackBotToken: 'xoxb'));
        $resp = $handler->handleSlackWebhook(['type' => 'url_verification', 'challenge' => 'abc123']);
        $this->assertSame(['challenge' => 'abc123'], $resp);
    }

    public function testSlackNonMessageEventReturnsOk(): void
    {
        $handler = new WebhookHandler(new WebhookConfig(slackBotToken: 'xoxb'));
        $resp = $handler->handleSlackWebhook([
            'type' => 'event_callback',
            'event' => ['type' => 'reaction_added'],
        ]);
        $this->assertSame(['ok' => true], $resp);
    }

    public function testSlackPlainMessageInvokesCallback(): void
    {
        $received = null;
        $withIds = null;
        $handler = new WebhookHandler(new WebhookConfig(
            slackBotToken: 'xoxb',
            onOperatorMessage: function (...$args) use (&$received): void {
                $received = $args;
            },
            onOperatorMessageWithIds: function (...$args) use (&$withIds): void {
                $withIds = $args;
            },
        ));

        // user lookup will be attempted; queue a users.info response then nothing else needed.
        $http = new MockHttpClient();
        $http->queueResponse(json_encode(['ok' => true, 'user' => ['real_name' => 'Bob Operator']]));
        $this->injectClient($handler, $http);

        $resp = $handler->handleSlackWebhook([
            'type' => 'event_callback',
            'event' => [
                'type' => 'message',
                'thread_ts' => '111.222',
                'ts' => '333.444',
                'text' => 'Hello from Slack',
                'user' => 'U123',
            ],
        ]);

        $this->assertSame(['ok' => true], $resp);
        $this->assertSame('111.222', $received[0]);
        $this->assertSame('Hello from Slack', $received[1]);
        $this->assertSame('Bob Operator', $received[2]);
        $this->assertSame('slack', $received[3]);
        $this->assertSame('333.444', $withIds[6]);
    }

    public function testSlackMessageWithFileDownloads(): void
    {
        $received = null;
        $handler = new WebhookHandler(new WebhookConfig(
            slackBotToken: 'xoxb',
            onOperatorMessage: function (...$args) use (&$received): void {
                $received = $args;
            },
        ));

        $http = new MockHttpClient();
        // file download then users.info
        $http->queueResponse('FILEBYTES');
        $http->queueResponse(json_encode(['ok' => true, 'user' => ['name' => 'slackuser']]));
        $this->injectClient($handler, $http);

        $handler->handleSlackWebhook([
            'type' => 'event_callback',
            'event' => [
                'type' => 'message',
                'thread_ts' => '111.222',
                'ts' => '333.444',
                'text' => '',
                'user' => 'U123',
                'files' => [
                    ['id' => 'F1', 'name' => 'a.png', 'mimetype' => 'image/png', 'size' => 9, 'url_private_download' => 'https://files/a'],
                ],
            ],
        ]);

        /** @var OperatorAttachment[] $attachments */
        $attachments = $received[4];
        $this->assertCount(1, $attachments);
        $this->assertSame('a.png', $attachments[0]->filename);
        $this->assertSame('FILEBYTES', $attachments[0]->data);
    }

    public function testSlackFileDownloadFailureSkipsAttachment(): void
    {
        $received = null;
        $handler = new WebhookHandler(new WebhookConfig(
            slackBotToken: 'xoxb',
            onOperatorMessage: function (...$args) use (&$received): void {
                $received = $args;
            },
        ));

        $http = new MockHttpClient();
        $http->queueResponse('err', 403); // file download fails
        $http->queueResponse(json_encode(['ok' => true, 'user' => ['name' => 'x']]));
        $this->injectClient($handler, $http);

        $handler->handleSlackWebhook([
            'type' => 'event_callback',
            'event' => [
                'type' => 'message',
                'thread_ts' => '1.2',
                'ts' => '3.4',
                'text' => 'with file',
                'user' => 'U1',
                'files' => [['id' => 'F1', 'name' => 'x', 'url_private_download' => 'https://f/x']],
            ],
        ]);

        $this->assertSame([], $received[4]);
    }

    public function testSlackMessageChangedTriggersEdit(): void
    {
        $edited = null;
        $handler = new WebhookHandler(new WebhookConfig(
            slackBotToken: 'xoxb',
            onOperatorMessageEdit: function (...$args) use (&$edited): void {
                $edited = $args;
            },
        ));

        $handler->handleSlackWebhook([
            'type' => 'event_callback',
            'event' => [
                'type' => 'message',
                'subtype' => 'message_changed',
                'message' => ['thread_ts' => '1.1', 'ts' => '2.2', 'text' => 'new text'],
            ],
        ]);

        $this->assertSame(['1.1', '2.2', 'new text', 'slack'], $edited);
    }

    public function testSlackMessageChangedRespectsBotAllowlist(): void
    {
        $called = false;
        $handler = new WebhookHandler(new WebhookConfig(
            slackBotToken: 'xoxb',
            onOperatorMessageEdit: function () use (&$called): void {
                $called = true;
            },
            allowedBotIds: ['BALLOWED'],
        ));

        // bot_id not in allowlist => skipped.
        $handler->handleSlackWebhook([
            'type' => 'event_callback',
            'event' => [
                'type' => 'message',
                'subtype' => 'message_changed',
                'message' => ['thread_ts' => '1.1', 'ts' => '2.2', 'text' => 'x', 'bot_id' => 'BOTHER'],
            ],
        ]);

        $this->assertFalse($called);
    }

    public function testSlackMessageDeletedTriggersDelete(): void
    {
        $deleted = null;
        $handler = new WebhookHandler(new WebhookConfig(
            slackBotToken: 'xoxb',
            onOperatorMessageDelete: function (...$args) use (&$deleted): void {
                $deleted = $args;
            },
        ));

        $handler->handleSlackWebhook([
            'type' => 'event_callback',
            'event' => [
                'type' => 'message',
                'subtype' => 'message_deleted',
                'deleted_ts' => '5.5',
                'previous_message' => ['thread_ts' => '1.1', 'ts' => '5.5'],
            ],
        ]);

        $this->assertSame(['1.1', '5.5', 'slack'], $deleted);
    }

    public function testSlackUserNameLookupFailureFallsBackToOperator(): void
    {
        $received = null;
        $handler = new WebhookHandler(new WebhookConfig(
            slackBotToken: 'xoxb',
            onOperatorMessage: function (...$args) use (&$received): void {
                $received = $args;
            },
        ));

        $http = new MockHttpClient();
        $http->queueResponse(json_encode(['ok' => false]));
        $this->injectClient($handler, $http);

        $handler->handleSlackWebhook([
            'type' => 'event_callback',
            'event' => [
                'type' => 'message',
                'thread_ts' => '1.1',
                'ts' => '2.2',
                'text' => 'hi',
                'user' => 'U1',
            ],
        ]);

        $this->assertSame('Operator', $received[2]);
    }

    // ─────────────────────────────────────────────────────────────────
    // Discord
    // ─────────────────────────────────────────────────────────────────

    public function testDiscordPingReturnsPong(): void
    {
        $handler = new WebhookHandler(new WebhookConfig());
        $this->assertSame(['type' => 1], $handler->handleDiscordWebhook(['type' => 1]));
    }

    public function testDiscordReplyCommandInvokesCallback(): void
    {
        $received = null;
        $handler = new WebhookHandler(new WebhookConfig(
            onOperatorMessage: function (...$args) use (&$received): void {
                $received = $args;
            },
        ));

        $resp = $handler->handleDiscordWebhook([
            'type' => 2,
            'channel_id' => 'chan-1',
            'member' => ['user' => ['username' => 'discordop']],
            'data' => [
                'name' => 'reply',
                'options' => [['name' => 'message', 'value' => 'Discord reply']],
            ],
        ]);

        $this->assertSame(4, $resp['type']);
        $this->assertSame('chan-1', $received[0]);
        $this->assertSame('Discord reply', $received[1]);
        $this->assertSame('discordop', $received[2]);
        $this->assertSame('discord', $received[3]);
    }

    public function testDiscordUnknownCommandReturnsPong(): void
    {
        $handler = new WebhookHandler(new WebhookConfig());
        $resp = $handler->handleDiscordWebhook([
            'type' => 2,
            'channel_id' => 'c',
            'data' => ['name' => 'other', 'options' => []],
        ]);
        $this->assertSame(['type' => 1], $resp);
    }

    public function testDiscordReplyWithoutMessageOptionReturnsPong(): void
    {
        $handler = new WebhookHandler(new WebhookConfig());
        $resp = $handler->handleDiscordWebhook([
            'type' => 2,
            'channel_id' => 'c',
            'data' => ['name' => 'reply', 'options' => [['name' => 'other', 'value' => 'x']]],
        ]);
        $this->assertSame(['type' => 1], $resp);
    }

    public function testOperatorAttachmentToArray(): void
    {
        $att = new OperatorAttachment(
            filename: 'file.png',
            mimeType: 'image/png',
            size: 123,
            data: 'RAW',
            bridgeFileId: 'bf-1',
        );
        $arr = $att->toArray();
        $this->assertSame('file.png', $arr['filename']);
        $this->assertSame('image/png', $arr['mimeType']);
        $this->assertSame(123, $arr['size']);
        $this->assertSame('bf-1', $arr['bridgeFileId']);
        // Raw data is intentionally excluded from the array.
        $this->assertArrayNotHasKey('data', $arr);
    }
}

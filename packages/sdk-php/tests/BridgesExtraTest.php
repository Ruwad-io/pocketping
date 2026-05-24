<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Bridges\DiscordBridge;
use PocketPing\Bridges\SlackBridge;
use PocketPing\Bridges\TelegramBridge;
use PocketPing\Exceptions\SetupException;
use PocketPing\Models\BridgeMessageIds;
use PocketPing\Models\CustomEvent;
use PocketPing\Models\Message;
use PocketPing\Models\Sender;
use PocketPing\Models\Session;
use PocketPing\Models\SessionMetadata;
use PocketPing\Models\UserIdentity;
use PocketPing\PocketPing;
use PocketPing\Storage\MemoryStorage;

/**
 * Coverage for bridge methods not exercised by the per-bridge tests:
 * custom events, identity updates, AI takeover, operator messages,
 * user-agent parsing, edit failure paths, reply linkage, and
 * setup-exception validation.
 */
class BridgesExtraTest extends TestCase
{
    private MockHttpClient $http;
    private MemoryStorage $storage;

    protected function setUp(): void
    {
        $this->http = new MockHttpClient();
        $this->storage = new MemoryStorage();
    }

    private function okJson(string $body = '{"id":"999","ok":true,"ts":"1.2","result":{"message_id":42}}'): void
    {
        $this->http->nextResponse = ['body' => $body, 'httpCode' => 200, 'error' => null];
    }

    private function session(?UserIdentity $identity = null, ?SessionMetadata $meta = null): Session
    {
        return new Session(
            id: 'sess-1',
            visitorId: 'vis-1',
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
            metadata: $meta,
            identity: $identity,
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // SetupException validation paths
    // ─────────────────────────────────────────────────────────────────

    public function testTelegramRejectsEmptyToken(): void
    {
        $this->expectException(SetupException::class);
        new TelegramBridge(botToken: '', chatId: '1', httpClient: $this->http);
    }

    public function testTelegramRejectsMalformedToken(): void
    {
        $this->expectException(SetupException::class);
        new TelegramBridge(botToken: 'not-a-token', chatId: '1', httpClient: $this->http);
    }

    public function testDiscordWebhookRejectsEmptyUrl(): void
    {
        $this->expectException(SetupException::class);
        DiscordBridge::webhook('', httpClient: $this->http);
    }

    public function testDiscordWebhookRejectsInvalidUrl(): void
    {
        $this->expectException(SetupException::class);
        DiscordBridge::webhook('https://evil.example/webhook', httpClient: $this->http);
    }

    public function testDiscordBotRejectsEmptyToken(): void
    {
        $this->expectException(SetupException::class);
        DiscordBridge::bot('', 'channel', httpClient: $this->http);
    }

    public function testDiscordBotRejectsEmptyChannel(): void
    {
        $this->expectException(SetupException::class);
        DiscordBridge::bot('token', '', httpClient: $this->http);
    }

    public function testSlackWebhookRejectsInvalidUrl(): void
    {
        $this->expectException(SetupException::class);
        SlackBridge::webhook('https://evil.example/hook', httpClient: $this->http);
    }

    public function testSlackBotRejectsBadTokenPrefix(): void
    {
        $this->expectException(SetupException::class);
        SlackBridge::bot('bad-token', 'C1', httpClient: $this->http);
    }

    public function testSlackBotRejectsEmptyChannel(): void
    {
        $this->expectException(SetupException::class);
        SlackBridge::bot('xoxb-ok', '', httpClient: $this->http);
    }

    public function testSetupExceptionAccessors(): void
    {
        try {
            new TelegramBridge(botToken: '', chatId: '1', httpClient: $this->http);
            $this->fail('expected SetupException');
        } catch (SetupException $e) {
            $this->assertSame('Telegram', $e->getBridge());
            $this->assertSame('bot_token', $e->getMissing());
            $this->assertNotSame('', $e->getGuide());
            $this->assertStringContainsString('pocketping.io/docs/telegram', $e->getDocsUrl());
            $this->assertStringContainsString('Setup Required', $e->getFormattedGuide());
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Telegram: events / identity / takeover / operator / UA parsing
    // ─────────────────────────────────────────────────────────────────

    private function telegram(): TelegramBridge
    {
        $this->okJson();
        return new TelegramBridge(
            botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
            chatId: '1',
            httpClient: $this->http,
        );
    }

    public function testTelegramCustomEventWithData(): void
    {
        $bridge = $this->telegram();
        $bridge->onCustomEvent(new CustomEvent('checkout', ['total' => 50]), $this->session());
        $request = $this->http->getLastRequest();
        $this->assertStringContainsString('checkout', $request['data']['text']);
        $this->assertStringContainsString('total', $request['data']['text']);
    }

    public function testTelegramIdentityUpdateWithAllFields(): void
    {
        $bridge = $this->telegram();
        $session = new Session(
            id: 's',
            visitorId: 'v',
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
            identity: new UserIdentity(id: 'u-1', email: 'a@b.c', name: 'Jane'),
            userPhone: '+33600000000',
        );
        $bridge->onIdentityUpdate($session);
        $text = $this->http->getLastRequest()['data']['text'];
        $this->assertStringContainsString('Jane', $text);
        $this->assertStringContainsString('a@b.c', $text);
        $this->assertStringContainsString('+33600000000', $text);
    }

    public function testTelegramAiTakeover(): void
    {
        $bridge = $this->telegram();
        $bridge->onAiTakeover($this->session(), 'no operator');
        $this->assertStringContainsString('AI Takeover', $this->http->getLastRequest()['data']['text']);
    }

    public function testTelegramNewSessionWithUserAgentBrowserOsParsing(): void
    {
        $bridge = $this->telegram();
        $session = $this->session(meta: new SessionMetadata(
            userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/120.0',
        ));
        $bridge->onNewSession($session);
        $text = $this->http->getLastRequest()['data']['text'];
        $this->assertStringContainsString('Firefox/Windows', $text);
    }

    public function testTelegramVisitorNameFallsBackToVisitorId(): void
    {
        $bridge = $this->telegram();
        $bridge->onVisitorMessage(
            new Message('m', 'sess-1', 'hi', Sender::VISITOR, new \DateTimeImmutable()),
            $this->session(),
        );
        $this->assertStringContainsString('vis-1', $this->http->getLastRequest()['data']['text']);
    }

    public function testTelegramReplyLinkageUsesStoredBridgeId(): void
    {
        $bridge = $this->telegram();
        new PocketPing(storage: $this->storage, bridges: [$bridge]); // init() injects storage
        $this->storage->saveBridgeMessageIds('m-0', new BridgeMessageIds(telegramMessageId: 77));

        $msg = new Message('m-1', 'sess-1', 'reply', Sender::VISITOR, new \DateTimeImmutable(), replyTo: 'm-0');
        $bridge->onVisitorMessage($msg, $this->session());

        $this->assertSame(77, $this->http->getLastRequest()['data']['reply_to_message_id']);
    }

    public function testTelegramEditFailureReturnsNull(): void
    {
        $bridge = $this->telegram();
        new PocketPing(storage: $this->storage, bridges: [$bridge]);
        $this->storage->saveBridgeMessageIds('m-1', new BridgeMessageIds(telegramMessageId: 5));

        $this->http->nextResponse = [
            'body' => json_encode(['ok' => false, 'description' => 'nope']),
            'httpCode' => 400,
            'error' => null,
        ];

        $result = $bridge->onMessageEdit('sess-1', 'm-1', 'new', new \DateTimeImmutable());
        $this->assertNull($result);
    }

    // ─────────────────────────────────────────────────────────────────
    // Discord: events / identity / takeover / operator / UA parsing
    // ─────────────────────────────────────────────────────────────────

    private function discordWebhook(): DiscordBridge
    {
        $this->okJson();
        return DiscordBridge::webhook('https://discord.com/api/webhooks/123/abc', httpClient: $this->http);
    }

    public function testDiscordCustomEventWithData(): void
    {
        $bridge = $this->discordWebhook();
        $bridge->onCustomEvent(new CustomEvent('signup', ['plan' => 'pro']), $this->session());
        $embed = $this->http->getLastRequest()['data']['embeds'][0];
        $this->assertStringContainsString('signup', $embed['title']);
    }

    public function testDiscordIdentityUpdateWithAllFields(): void
    {
        $bridge = $this->discordWebhook();
        $session = new Session(
            id: 's',
            visitorId: 'v',
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
            identity: new UserIdentity(id: 'u-1', email: 'a@b.c', name: 'Jane'),
            userPhone: '+33600000000',
        );
        $bridge->onIdentityUpdate($session);
        $embed = $this->http->getLastRequest()['data']['embeds'][0];
        $values = array_map(fn ($f) => $f['value'], $embed['fields']);
        $this->assertContains('Jane', $values);
        $this->assertContains('a@b.c', $values);
        $this->assertContains('+33600000000', $values);
    }

    public function testDiscordIdentityUpdateNoIdentityIsNoOp(): void
    {
        $bridge = $this->discordWebhook();
        $bridge->onIdentityUpdate($this->session());
        $this->assertEmpty($this->http->requests);
    }

    public function testDiscordAiTakeover(): void
    {
        $bridge = $this->discordWebhook();
        $bridge->onAiTakeover($this->session(), 'no operator');
        $this->assertStringContainsString('AI Takeover', $this->http->getLastRequest()['data']['embeds'][0]['title']);
    }

    public function testDiscordOperatorMessageFromOtherBridge(): void
    {
        $bridge = $this->discordWebhook();
        $msg = new Message('m', 'sess-1', 'op reply', Sender::OPERATOR, new \DateTimeImmutable());
        $bridge->onOperatorMessage($msg, $this->session(), 'telegram', 'Sam');
        $this->assertStringContainsString('Sam', $this->http->getLastRequest()['data']['content']);
    }

    public function testDiscordNewSessionParsesEdgeUserAgents(): void
    {
        $bridge = $this->discordWebhook();
        // Safari on macOS, plus phone fields.
        $session = new Session(
            id: 's',
            visitorId: 'v',
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
            metadata: new SessionMetadata(userAgent: 'Mozilla/5.0 (Macintosh; Mac OS X) Safari/537.36'),
            userPhone: '+1555',
        );
        $bridge->onNewSession($session);
        $embed = $this->http->getLastRequest()['data']['embeds'][0];
        $deviceField = array_values(array_filter($embed['fields'], fn ($f) => str_contains($f['name'], 'Device')))[0];
        $this->assertStringContainsString('Safari/macOS', $deviceField['value']);
    }

    public function testDiscordVisitorMessageWithAttachmentsAndIdentityName(): void
    {
        $bridge = $this->discordWebhook();
        $session = $this->session(identity: new UserIdentity(id: 'u', name: 'Bob'));
        $msg = new Message(
            id: 'm',
            sessionId: 'sess-1',
            content: 'see file',
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
            attachments: [
                new \PocketPing\Models\Attachment('a', 'f.png', 'image/png', 1, 'u'),
            ],
        );
        $bridge->onVisitorMessage($msg, $session);
        $content = $this->http->getLastRequest()['data']['content'];
        $this->assertStringContainsString('Bob', $content);
        $this->assertStringContainsString('attachment', $content);
    }

    public function testDiscordVisitorNameFallsBackToEmail(): void
    {
        $bridge = $this->discordWebhook();
        $session = $this->session(identity: new UserIdentity(id: 'u', email: 'only@email.com'));
        $bridge->onVisitorMessage(
            new Message('m', 'sess-1', 'hi', Sender::VISITOR, new \DateTimeImmutable()),
            $session,
        );
        $this->assertStringContainsString('only@email.com', $this->http->getLastRequest()['data']['content']);
    }

    public function testDiscordBotEditFailureReturnsNull(): void
    {
        $bridge = DiscordBridge::bot('token', 'chan', httpClient: $this->http);
        new PocketPing(storage: $this->storage, bridges: [$bridge]);
        $this->storage->saveBridgeMessageIds('m-1', new BridgeMessageIds(discordMessageId: 'd-1'));

        $this->http->nextResponse = [
            'body' => json_encode(['message' => 'fail']),
            'httpCode' => 400,
            'error' => null,
        ];
        $result = $bridge->onMessageEdit('sess-1', 'm-1', 'new', new \DateTimeImmutable());
        $this->assertNull($result);
    }

    public function testDiscordEditWithoutStoredIdReturnsNull(): void
    {
        $bridge = DiscordBridge::bot('token', 'chan', httpClient: $this->http);
        new PocketPing(storage: $this->storage, bridges: [$bridge]);
        $result = $bridge->onMessageEdit('sess-1', 'unknown', 'new', new \DateTimeImmutable());
        $this->assertNull($result);
    }

    public function testDiscordDeleteWithoutStoredIdIsNoOp(): void
    {
        $bridge = DiscordBridge::bot('token', 'chan', httpClient: $this->http);
        new PocketPing(storage: $this->storage, bridges: [$bridge]);
        $bridge->onMessageDelete('sess-1', 'unknown', new \DateTimeImmutable());
        $this->assertEmpty($this->http->requests);
    }

    // ─────────────────────────────────────────────────────────────────
    // Slack extras: operator message reply quote, AI takeover already covered
    // ─────────────────────────────────────────────────────────────────

    public function testSlackReplyQuoteRendersDeletedAndPreview(): void
    {
        $this->okJson('{"ok":true,"ts":"1.2"}');
        $bridge = SlackBridge::bot('xoxb-tok', 'C1', httpClient: $this->http);
        new PocketPing(storage: $this->storage, bridges: [$bridge]);
        $this->storage->createSession($this->session());

        // Reply target exists.
        $target = new Message('m-0', 'sess-1', str_repeat('long ', 40), Sender::VISITOR, new \DateTimeImmutable());
        $this->storage->saveMessage($target);

        $reply = new Message('m-1', 'sess-1', 'my reply', Sender::VISITOR, new \DateTimeImmutable(), replyTo: 'm-0');
        $bridge->onVisitorMessage($reply, $this->session());

        $text = $this->http->getLastRequest()['data']['text'];
        $this->assertStringContainsString('>', $text); // quote bar
    }

    public function testSlackReplyQuoteLabelsOperatorTargetAsSupport(): void
    {
        // Regression: buildReplyQuote matched the Sender enum against string
        // literals ('operator'/'ai'), so it always fell through to 'Visitor'.
        $this->okJson('{"ok":true,"ts":"1.2"}');
        $bridge = SlackBridge::bot('xoxb-tok', 'C1', httpClient: $this->http);
        new PocketPing(storage: $this->storage, bridges: [$bridge]);
        $this->storage->createSession($this->session());

        $target = new Message('m-0', 'sess-1', 'How can I help?', Sender::OPERATOR, new \DateTimeImmutable());
        $this->storage->saveMessage($target);

        $reply = new Message('m-1', 'sess-1', 'my reply', Sender::VISITOR, new \DateTimeImmutable(), replyTo: 'm-0');
        $bridge->onVisitorMessage($reply, $this->session());

        $text = $this->http->getLastRequest()['data']['text'];
        $this->assertStringContainsString('*Support*', $text);
    }

    public function testSlackReplyQuoteWhenTargetMissing(): void
    {
        $this->okJson('{"ok":true,"ts":"1.2"}');
        $bridge = SlackBridge::bot('xoxb-tok', 'C1', httpClient: $this->http);
        new PocketPing(storage: $this->storage, bridges: [$bridge]);
        $this->storage->createSession($this->session());

        $reply = new Message('m-1', 'sess-1', 'reply', Sender::VISITOR, new \DateTimeImmutable(), replyTo: 'missing');
        // Should not throw; quote silently omitted.
        $bridge->onVisitorMessage($reply, $this->session());
        $this->assertCount(1, $this->http->requests);
    }

    public function testSlackBotEditFailureReturnsNull(): void
    {
        $bridge = SlackBridge::bot('xoxb-tok', 'C1', httpClient: $this->http);
        new PocketPing(storage: $this->storage, bridges: [$bridge]);
        $this->storage->saveBridgeMessageIds('m-1', new BridgeMessageIds(slackMessageTs: '1.2'));

        $this->http->nextResponse = [
            'body' => json_encode(['ok' => false, 'error' => 'cant_update']),
            'httpCode' => 200,
            'error' => null,
        ];
        $result = $bridge->onMessageEdit('sess-1', 'm-1', 'new', new \DateTimeImmutable());
        $this->assertNull($result);
    }

    public function testSlackEditWithoutStoredIdReturnsNull(): void
    {
        $bridge = SlackBridge::bot('xoxb-tok', 'C1', httpClient: $this->http);
        new PocketPing(storage: $this->storage, bridges: [$bridge]);
        $result = $bridge->onMessageEdit('sess-1', 'unknown', 'new', new \DateTimeImmutable());
        $this->assertNull($result);
    }

    public function testSlackDeleteWithoutStoredIdIsNoOp(): void
    {
        $bridge = SlackBridge::bot('xoxb-tok', 'C1', httpClient: $this->http);
        new PocketPing(storage: $this->storage, bridges: [$bridge]);
        $bridge->onMessageDelete('sess-1', 'unknown', new \DateTimeImmutable());
        $this->assertEmpty($this->http->requests);
    }

    public function testSlackMessageReadIsNoOp(): void
    {
        $bridge = SlackBridge::webhook('https://hooks.slack.com/x', httpClient: $this->http);
        $bridge->onMessageRead('sess-1', ['m'], \PocketPing\Models\MessageStatus::READ, $this->session());
        $this->assertEmpty($this->http->requests);
    }

    public function testDiscordMessageReadIsNoOp(): void
    {
        $bridge = $this->discordWebhook();
        $bridge->onMessageRead('sess-1', ['m'], \PocketPing\Models\MessageStatus::READ, $this->session());
        $this->assertEmpty($this->http->requests);
    }

    public function testTelegramMessageReadIsNoOp(): void
    {
        $bridge = $this->telegram();
        $bridge->onMessageRead('sess-1', ['m'], \PocketPing\Models\MessageStatus::READ, $this->session());
        $this->assertEmpty($this->http->requests);
    }

    // ─────────────────────────────────────────────────────────────────
    // AbstractBridge defaults + destroy
    // ─────────────────────────────────────────────────────────────────

    public function testAbstractBridgeDestroyClearsReference(): void
    {
        $bridge = $this->telegram();
        $pp = new PocketPing(storage: $this->storage, bridges: [$bridge]);
        $bridge->destroy();
        // After destroy, edit lookups have no storage -> returns null.
        $result = $bridge->onMessageEdit('s', 'm', 'c', new \DateTimeImmutable());
        $this->assertNull($result);
    }
}

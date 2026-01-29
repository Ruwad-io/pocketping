<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Bridges\SlackBridge;
use PocketPing\Models\BridgeMessageIds;
use PocketPing\Models\CustomEvent;
use PocketPing\Models\Message;
use PocketPing\Models\Sender;
use PocketPing\Models\Session;
use PocketPing\Models\SessionMetadata;
use PocketPing\Models\UserIdentity;
use PocketPing\PocketPing;
use PocketPing\Storage\MemoryStorage;

class SlackBridgeTest extends TestCase
{
    private MockHttpClient $httpClient;
    private MemoryStorage $storage;
    private PocketPing $pocketPing;

    protected function setUp(): void
    {
        $this->httpClient = new MockHttpClient();
        $this->storage = new MemoryStorage();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Constructor Validation Tests (Webhook Mode)
    // ─────────────────────────────────────────────────────────────────────

    public function testCreatesWebhookBridgeWithRequiredParams(): void
    {
        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $this->assertEquals('slack', $bridge->getName());
    }

    public function testWebhookBridgeUsesDefaultOptions(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'ok',
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id);
        $bridge->onVisitorMessage($message, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertArrayNotHasKey('username', $request['data']);
        $this->assertArrayNotHasKey('icon_emoji', $request['data']);
    }

    public function testWebhookBridgeAcceptsCustomOptions(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'ok',
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            username: 'PocketPing',
            iconEmoji: ':robot_face:',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id);
        $bridge->onVisitorMessage($message, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertEquals('PocketPing', $request['data']['username']);
        $this->assertEquals(':robot_face:', $request['data']['icon_emoji']);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Constructor Validation Tests (Bot Mode)
    // ─────────────────────────────────────────────────────────────────────

    public function testCreatesBotBridgeWithRequiredParams(): void
    {
        $bridge = SlackBridge::bot(
            botToken: 'xoxb-test-token',
            channelId: 'C123456789',
            httpClient: $this->httpClient,
        );

        $this->assertEquals('slack', $bridge->getName());
    }

    public function testBotBridgeSendsAuthorizationHeader(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => true, 'ts' => '1234567890.123456']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::bot(
            botToken: 'xoxb-my-secret-token',
            channelId: 'C123456789',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id);
        $bridge->onVisitorMessage($message, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertEquals('Bearer xoxb-my-secret-token', $request['headers']['Authorization']);
    }

    // ─────────────────────────────────────────────────────────────────────
    // onVisitorMessage Tests
    // ─────────────────────────────────────────────────────────────────────

    public function testOnVisitorMessageSendsMessageToWebhook(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'ok',
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id);

        $bridge->onVisitorMessage($message, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertEquals('POST', $request['method']);
        $this->assertStringContainsString('hooks.slack.com', $request['url']);
        $this->assertStringContainsString('Hello, World!', $request['data']['text']);
    }

    public function testOnVisitorMessageSendsMessageViaBot(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => true, 'ts' => '1234567890.123456']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::bot(
            botToken: 'xoxb-test-token',
            channelId: 'C123456789',
            httpClient: $this->httpClient,
        );
        $this->initBridge($bridge);

        $session = $this->createSession();
        $this->storage->createSession($session);
        $message = $this->createMessage($session->id);

        $bridge->onVisitorMessage($message, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertStringContainsString('chat.postMessage', $request['url']);
        $this->assertEquals('C123456789', $request['data']['channel']);
    }

    public function testOnVisitorMessageStoresMessageTimestamp(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => true, 'ts' => '1234567890.123456']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::bot(
            botToken: 'xoxb-test-token',
            channelId: 'C123456789',
            httpClient: $this->httpClient,
        );
        $this->initBridge($bridge);

        $session = $this->createSession();
        $this->storage->createSession($session);
        $message = $this->createMessage($session->id);

        $bridge->onVisitorMessage($message, $session);

        $bridgeIds = $this->storage->getBridgeMessageIds($message->id);
        $this->assertNotNull($bridgeIds);
        $this->assertEquals('1234567890.123456', $bridgeIds->slackMessageTs);
    }

    public function testOnVisitorMessageHandlesApiErrorsGracefully(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'invalid_token',
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id);

        // Should not throw
        $bridge->onVisitorMessage($message, $session);

        $this->assertCount(1, $this->httpClient->requests);
    }

    // ─────────────────────────────────────────────────────────────────────
    // onNewSession Tests
    // ─────────────────────────────────────────────────────────────────────

    public function testOnNewSessionSendsBlocks(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'ok',
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $bridge->onNewSession($session);

        $request = $this->httpClient->getLastRequest();
        $this->assertArrayHasKey('blocks', $request['data']);
        $this->assertNotEmpty($request['data']['blocks']);
    }

    public function testOnNewSessionFormatsSessionInfoCorrectly(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'ok',
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = new Session(
            id: 'session-1',
            visitorId: 'visitor-1',
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
            metadata: new SessionMetadata(url: 'https://example.com/page'),
            identity: new UserIdentity(id: 'user-1', email: 'alice@example.com'),
        );

        $bridge->onNewSession($session);

        $request = $this->httpClient->getLastRequest();
        // Check that fallback text contains email (used as visitor display)
        $this->assertStringContainsString('alice@example.com', $request['data']['text']);
    }

    // ─────────────────────────────────────────────────────────────────────
    // onMessageEdit Tests (Bot Mode Only)
    // ─────────────────────────────────────────────────────────────────────

    public function testOnMessageEditCallsUpdateApiInBotMode(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => true, 'ts' => '1234567890.123456']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::bot(
            botToken: 'xoxb-test-token',
            channelId: 'C123456789',
            httpClient: $this->httpClient,
        );
        $this->initBridge($bridge);

        $session = $this->createSession();
        $this->storage->createSession($session);
        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(slackMessageTs: '1234567890.123456'));

        $bridge->onMessageEdit(
            sessionId: $session->id,
            messageId: 'msg-1',
            content: 'Updated content',
            editedAt: new \DateTimeImmutable(),
        );

        $request = $this->httpClient->getLastRequest();
        $this->assertStringContainsString('chat.update', $request['url']);
        $this->assertEquals('1234567890.123456', $request['data']['ts']);
    }

    public function testOnMessageEditReturnsNullInWebhookMode(): void
    {
        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $result = $bridge->onMessageEdit(
            sessionId: 'session-1',
            messageId: 'msg-1',
            content: 'Updated content',
            editedAt: new \DateTimeImmutable(),
        );

        $this->assertNull($result);
        $this->assertEmpty($this->httpClient->requests);
    }

    public function testOnMessageEditReturnsBridgeIdsOnSuccess(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => true, 'ts' => '1234567890.123456']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::bot(
            botToken: 'xoxb-test-token',
            channelId: 'C123456789',
            httpClient: $this->httpClient,
        );
        $this->initBridge($bridge);

        $session = $this->createSession();
        $this->storage->createSession($session);
        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(slackMessageTs: '1234567890.123456'));

        $result = $bridge->onMessageEdit(
            sessionId: $session->id,
            messageId: 'msg-1',
            content: 'Updated content',
            editedAt: new \DateTimeImmutable(),
        );

        $this->assertNotNull($result);
        $this->assertEquals('1234567890.123456', $result->slackMessageTs);
    }

    // ─────────────────────────────────────────────────────────────────────
    // onMessageDelete Tests (Bot Mode Only)
    // ─────────────────────────────────────────────────────────────────────

    public function testOnMessageDeleteCallsDeleteApiInBotMode(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => true]),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::bot(
            botToken: 'xoxb-test-token',
            channelId: 'C123456789',
            httpClient: $this->httpClient,
        );
        $this->initBridge($bridge);

        $session = $this->createSession();
        $this->storage->createSession($session);
        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(slackMessageTs: '1234567890.123456'));

        $bridge->onMessageDelete(
            sessionId: $session->id,
            messageId: 'msg-1',
            deletedAt: new \DateTimeImmutable(),
        );

        $request = $this->httpClient->getLastRequest();
        $this->assertStringContainsString('chat.delete', $request['url']);
        $this->assertEquals('1234567890.123456', $request['data']['ts']);
    }

    public function testOnMessageDeleteDoesNothingInWebhookMode(): void
    {
        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $bridge->onMessageDelete(
            sessionId: 'session-1',
            messageId: 'msg-1',
            deletedAt: new \DateTimeImmutable(),
        );

        $this->assertEmpty($this->httpClient->requests);
    }

    public function testOnMessageDeleteHandlesFailure(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => false, 'error' => 'message_not_found']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::bot(
            botToken: 'xoxb-test-token',
            channelId: 'C123456789',
            httpClient: $this->httpClient,
        );
        $this->initBridge($bridge);

        $session = $this->createSession();
        $this->storage->createSession($session);
        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(slackMessageTs: '1234567890.123456'));

        // Should not throw
        $bridge->onMessageDelete(
            sessionId: $session->id,
            messageId: 'msg-1',
            deletedAt: new \DateTimeImmutable(),
        );

        $this->assertCount(1, $this->httpClient->requests);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Error Handling Tests
    // ─────────────────────────────────────────────────────────────────────

    public function testHandlesNetworkErrors(): void
    {
        $this->httpClient->nextResponse = [
            'body' => null,
            'httpCode' => 0,
            'error' => 'Connection refused',
        ];

        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();

        // Should not throw
        $bridge->onNewSession($session);

        $this->assertCount(1, $this->httpClient->requests);
    }

    public function testHandlesInvalidJsonResponse(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'not valid json',
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::bot(
            botToken: 'xoxb-test-token',
            channelId: 'C123456789',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id);

        // Should not throw
        $bridge->onVisitorMessage($message, $session);

        $this->assertCount(1, $this->httpClient->requests);
    }

    public function testHandlesSlackApiError(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => false, 'error' => 'channel_not_found']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::bot(
            botToken: 'xoxb-test-token',
            channelId: 'C123456789',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id);

        // Should not throw
        $bridge->onVisitorMessage($message, $session);

        $this->assertCount(1, $this->httpClient->requests);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Additional Method Tests
    // ─────────────────────────────────────────────────────────────────────

    public function testOnOperatorMessageSkipsMessagesFromSlack(): void
    {
        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id, Sender::OPERATOR);

        $bridge->onOperatorMessage($message, $session, 'slack', 'John');

        $this->assertEmpty($this->httpClient->requests);
    }

    public function testOnOperatorMessageSendsFromOtherBridges(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'ok',
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id, Sender::OPERATOR);

        $bridge->onOperatorMessage($message, $session, 'telegram', 'John');

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertStringContainsString('John', $request['data']['text']);
        $this->assertStringContainsString('telegram', $request['data']['text']);
    }

    public function testOnTypingDoesNothing(): void
    {
        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        // Slack doesn't have typing indicator API for channels
        $bridge->onTyping('session-1', true);

        $this->assertEmpty($this->httpClient->requests);
    }

    public function testOnCustomEventSendsBlocks(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'ok',
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $event = new CustomEvent(name: 'purchase', data: ['amount' => 99.99]);

        $bridge->onCustomEvent($event, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertArrayHasKey('blocks', $request['data']);
        $this->assertStringContainsString('purchase', $request['data']['text']);
    }

    public function testOnIdentityUpdateSendsBlocks(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'ok',
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = new Session(
            id: 'session-1',
            visitorId: 'visitor-1',
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
            identity: new UserIdentity(id: 'user-123', email: 'user@example.com', name: 'Bob'),
        );

        $bridge->onIdentityUpdate($session);

        $request = $this->httpClient->getLastRequest();
        $this->assertArrayHasKey('blocks', $request['data']);
        $this->assertStringContainsString('user-123', $request['data']['text']);
    }

    public function testOnIdentityUpdateDoesNothingWithNoIdentity(): void
    {
        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();

        $bridge->onIdentityUpdate($session);

        $this->assertEmpty($this->httpClient->requests);
    }

    public function testOnAiTakeoverSendsBlocks(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'ok',
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();

        $bridge->onAiTakeover($session, 'No operator available');

        $request = $this->httpClient->getLastRequest();
        $this->assertArrayHasKey('blocks', $request['data']);
        $this->assertStringContainsString('AI Takeover', $request['data']['text']);
    }

    public function testEscapesSlackSpecialCharacters(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'ok',
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = SlackBridge::webhook(
            webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = new Message(
            id: 'msg-1',
            sessionId: $session->id,
            content: 'Test <script>alert("xss")</script> & more',
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
        );

        $bridge->onVisitorMessage($message, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertStringContainsString('&lt;script&gt;', $request['data']['text']);
        $this->assertStringContainsString('&amp;', $request['data']['text']);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helper Methods
    // ─────────────────────────────────────────────────────────────────────

    private function createSession(): Session
    {
        return new Session(
            id: 'session-1',
            visitorId: 'visitor-1',
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
        );
    }

    private function createMessage(string $sessionId, Sender $sender = Sender::VISITOR): Message
    {
        return new Message(
            id: 'msg-1',
            sessionId: $sessionId,
            content: 'Hello, World!',
            sender: $sender,
            timestamp: new \DateTimeImmutable(),
        );
    }

    private function initBridge(SlackBridge $bridge): void
    {
        $this->pocketPing = new PocketPing(
            storage: $this->storage,
            bridges: [$bridge],
        );
    }
}

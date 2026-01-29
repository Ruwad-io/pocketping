<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Bridges\DiscordBridge;
use PocketPing\Models\BridgeMessageIds;
use PocketPing\Models\Message;
use PocketPing\Models\Sender;
use PocketPing\Models\Session;
use PocketPing\Models\SessionMetadata;
use PocketPing\Models\UserIdentity;
use PocketPing\PocketPing;
use PocketPing\Storage\MemoryStorage;

class DiscordBridgeTest extends TestCase
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
        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
            httpClient: $this->httpClient,
        );

        $this->assertEquals('discord', $bridge->getName());
    }

    public function testWebhookBridgeUsesDefaultOptions(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['id' => '999888777']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $bridge->onNewSession($session);

        $request = $this->httpClient->getLastRequest();
        $this->assertArrayNotHasKey('username', $request['data']);
        $this->assertArrayNotHasKey('avatar_url', $request['data']);
    }

    public function testWebhookBridgeAcceptsCustomOptions(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['id' => '999888777']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
            username: 'PocketPing Bot',
            avatarUrl: 'https://example.com/avatar.png',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id);
        $bridge->onVisitorMessage($message, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertEquals('PocketPing Bot', $request['data']['username']);
        $this->assertEquals('https://example.com/avatar.png', $request['data']['avatar_url']);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Constructor Validation Tests (Bot Mode)
    // ─────────────────────────────────────────────────────────────────────

    public function testCreatesBotBridgeWithRequiredParams(): void
    {
        $bridge = DiscordBridge::bot(
            botToken: 'test-bot-token',
            channelId: '123456789',
            httpClient: $this->httpClient,
        );

        $this->assertEquals('discord', $bridge->getName());
    }

    public function testBotBridgeSendsAuthorizationHeader(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['id' => '999888777']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = DiscordBridge::bot(
            botToken: 'my-secret-token',
            channelId: '123456789',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id);
        $bridge->onVisitorMessage($message, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertEquals('Bot my-secret-token', $request['headers']['Authorization']);
    }

    // ─────────────────────────────────────────────────────────────────────
    // onVisitorMessage Tests
    // ─────────────────────────────────────────────────────────────────────

    public function testOnVisitorMessageSendsMessageToWebhook(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['id' => '999888777']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id);

        $bridge->onVisitorMessage($message, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertEquals('POST', $request['method']);
        $this->assertStringContainsString('?wait=true', $request['url']);
        $this->assertStringContainsString('Hello, World!', $request['data']['content']);
    }

    public function testOnVisitorMessageSendsMessageViaBot(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['id' => '999888777']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = DiscordBridge::bot(
            botToken: 'test-bot-token',
            channelId: '123456789',
            httpClient: $this->httpClient,
        );
        $this->initBridge($bridge);

        $session = $this->createSession();
        $this->storage->createSession($session);
        $message = $this->createMessage($session->id);

        $bridge->onVisitorMessage($message, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertStringContainsString('/channels/123456789/messages', $request['url']);
    }

    public function testOnVisitorMessageStoresMessageId(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['id' => '999888777']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = DiscordBridge::bot(
            botToken: 'test-bot-token',
            channelId: '123456789',
            httpClient: $this->httpClient,
        );
        $this->initBridge($bridge);

        $session = $this->createSession();
        $this->storage->createSession($session);
        $message = $this->createMessage($session->id);

        $bridge->onVisitorMessage($message, $session);

        $bridgeIds = $this->storage->getBridgeMessageIds($message->id);
        $this->assertNotNull($bridgeIds);
        $this->assertEquals('999888777', $bridgeIds->discordMessageId);
    }

    public function testOnVisitorMessageHandlesApiErrorsGracefully(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['message' => 'Unauthorized']),
            'httpCode' => 401,
            'error' => null,
        ];

        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
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

    public function testOnNewSessionSendsEmbed(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['id' => '999888777']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $bridge->onNewSession($session);

        $request = $this->httpClient->getLastRequest();
        $this->assertArrayHasKey('embeds', $request['data']);
        $this->assertCount(1, $request['data']['embeds']);
    }

    public function testOnNewSessionFormatsSessionInfoCorrectly(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['id' => '999888777']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
            httpClient: $this->httpClient,
        );

        $session = new Session(
            id: 'session-1',
            visitorId: 'visitor-1',
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
            metadata: new SessionMetadata(url: 'https://example.com/page'),
            identity: new UserIdentity(id: 'user-1', email: 'jane@example.com'),
        );

        $bridge->onNewSession($session);

        $request = $this->httpClient->getLastRequest();
        $embed = $request['data']['embeds'][0];

        // Check fields contain contact info (email)
        $fieldValues = array_map(fn($f) => $f['value'], $embed['fields']);
        $this->assertTrue(in_array('jane@example.com', $fieldValues));
    }

    // ─────────────────────────────────────────────────────────────────────
    // onMessageEdit Tests (Bot Mode Only)
    // ─────────────────────────────────────────────────────────────────────

    public function testOnMessageEditCallsPatchApiInBotMode(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['id' => '999888777']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = DiscordBridge::bot(
            botToken: 'test-bot-token',
            channelId: '123456789',
            httpClient: $this->httpClient,
        );
        $this->initBridge($bridge);

        $session = $this->createSession();
        $this->storage->createSession($session);
        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(discordMessageId: '999888777'));

        $bridge->onMessageEdit(
            sessionId: $session->id,
            messageId: 'msg-1',
            content: 'Updated content',
            editedAt: new \DateTimeImmutable(),
        );

        $request = $this->httpClient->getLastRequest();
        $this->assertEquals('PATCH', $request['method']);
        $this->assertStringContainsString('/messages/999888777', $request['url']);
    }

    public function testOnMessageEditReturnsNullInWebhookMode(): void
    {
        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
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
            'body' => json_encode(['id' => '999888777']),
            'httpCode' => 200,
            'error' => null,
        ];

        $bridge = DiscordBridge::bot(
            botToken: 'test-bot-token',
            channelId: '123456789',
            httpClient: $this->httpClient,
        );
        $this->initBridge($bridge);

        $session = $this->createSession();
        $this->storage->createSession($session);
        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(discordMessageId: '999888777'));

        $result = $bridge->onMessageEdit(
            sessionId: $session->id,
            messageId: 'msg-1',
            content: 'Updated content',
            editedAt: new \DateTimeImmutable(),
        );

        $this->assertNotNull($result);
        $this->assertEquals('999888777', $result->discordMessageId);
    }

    // ─────────────────────────────────────────────────────────────────────
    // onMessageDelete Tests (Bot Mode Only)
    // ─────────────────────────────────────────────────────────────────────

    public function testOnMessageDeleteCallsDeleteApiInBotMode(): void
    {
        $this->httpClient->nextResponse = [
            'body' => '',
            'httpCode' => 204,
            'error' => null,
        ];

        $bridge = DiscordBridge::bot(
            botToken: 'test-bot-token',
            channelId: '123456789',
            httpClient: $this->httpClient,
        );
        $this->initBridge($bridge);

        $session = $this->createSession();
        $this->storage->createSession($session);
        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(discordMessageId: '999888777'));

        $bridge->onMessageDelete(
            sessionId: $session->id,
            messageId: 'msg-1',
            deletedAt: new \DateTimeImmutable(),
        );

        $request = $this->httpClient->getLastRequest();
        $this->assertEquals('DELETE', $request['method']);
        $this->assertStringContainsString('/messages/999888777', $request['url']);
    }

    public function testOnMessageDeleteDoesNothingInWebhookMode(): void
    {
        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
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
            'body' => json_encode(['message' => 'Unknown Message']),
            'httpCode' => 404,
            'error' => null,
        ];

        $bridge = DiscordBridge::bot(
            botToken: 'test-bot-token',
            channelId: '123456789',
            httpClient: $this->httpClient,
        );
        $this->initBridge($bridge);

        $session = $this->createSession();
        $this->storage->createSession($session);
        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(discordMessageId: '999888777'));

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

        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
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

        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
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

    public function testOnOperatorMessageSkipsMessagesFromDiscord(): void
    {
        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $message = $this->createMessage($session->id, Sender::OPERATOR);

        $bridge->onOperatorMessage($message, $session, 'discord', 'John');

        $this->assertEmpty($this->httpClient->requests);
    }

    public function testOnTypingTriggersTypingIndicatorInBotMode(): void
    {
        $this->httpClient->nextResponse = [
            'body' => '',
            'httpCode' => 204,
            'error' => null,
        ];

        $bridge = DiscordBridge::bot(
            botToken: 'test-bot-token',
            channelId: '123456789',
            httpClient: $this->httpClient,
        );

        $bridge->onTyping('session-1', true);

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertStringContainsString('/typing', $request['url']);
    }

    public function testOnTypingDoesNothingInWebhookMode(): void
    {
        $bridge = DiscordBridge::webhook(
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
            httpClient: $this->httpClient,
        );

        $bridge->onTyping('session-1', true);

        $this->assertEmpty($this->httpClient->requests);
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

    private function initBridge(DiscordBridge $bridge): void
    {
        $this->pocketPing = new PocketPing(
            storage: $this->storage,
            bridges: [$bridge],
        );
    }
}

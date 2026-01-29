<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Bridges\TelegramBridge;
use PocketPing\Models\Attachment;
use PocketPing\Models\BridgeMessageIds;
use PocketPing\Models\CustomEvent;
use PocketPing\Models\Message;
use PocketPing\Models\Sender;
use PocketPing\Models\Session;
use PocketPing\Models\SessionMetadata;
use PocketPing\Models\UserIdentity;
use PocketPing\PocketPing;
use PocketPing\Storage\MemoryStorage;

class TelegramBridgeTest extends TestCase
{
    private MockHttpClient $httpClient;
    private TelegramBridge $bridge;
    private MemoryStorage $storage;
    private PocketPing $pocketPing;

    protected function setUp(): void
    {
        $this->httpClient = new MockHttpClient();
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => true, 'result' => ['message_id' => 12345]]),
            'httpCode' => 200,
            'error' => null,
        ];

        $this->bridge = new TelegramBridge(
            botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
            chatId: '123456789',
            parseMode: 'HTML',
            disableNotification: false,
            httpClient: $this->httpClient,
        );

        $this->storage = new MemoryStorage();
        $this->pocketPing = new PocketPing(
            storage: $this->storage,
            bridges: [$this->bridge],
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Constructor Validation Tests
    // ─────────────────────────────────────────────────────────────────────

    public function testCreatesBridgeWithRequiredParams(): void
    {
        $bridge = new TelegramBridge(
            botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
            chatId: '12345',
            httpClient: $this->httpClient,
        );

        $this->assertEquals('telegram', $bridge->getName());
    }

    public function testUsesDefaultOptions(): void
    {
        $bridge = new TelegramBridge(
            botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
            chatId: '12345',
            httpClient: $this->httpClient,
        );

        // Test that default parse mode is HTML by checking a sent message
        $session = $this->createSession();
        $bridge->onNewSession($session);

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertEquals('HTML', $request['data']['parse_mode']);
        $this->assertArrayNotHasKey('disable_notification', $request['data']);
    }

    public function testAcceptsCustomOptions(): void
    {
        $bridge = new TelegramBridge(
            botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
            chatId: '12345',
            parseMode: 'Markdown',
            disableNotification: true,
            httpClient: $this->httpClient,
        );

        $session = $this->createSession();
        $bridge->onNewSession($session);

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertEquals('Markdown', $request['data']['parse_mode']);
        $this->assertTrue($request['data']['disable_notification']);
    }

    // ─────────────────────────────────────────────────────────────────────
    // onVisitorMessage Tests
    // ─────────────────────────────────────────────────────────────────────

    public function testOnVisitorMessageSendsMessageToApi(): void
    {
        $session = $this->createSession();
        $this->storage->createSession($session);

        $message = $this->createMessage($session->id);

        $this->bridge->onVisitorMessage($message, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertEquals('POST', $request['method']);
        $this->assertStringContainsString('api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz/sendMessage', $request['url']);
        $this->assertEquals('123456789', $request['data']['chat_id']);
        $this->assertStringContainsString('Hello, World!', $request['data']['text']);
    }

    public function testOnVisitorMessageReturnsMessageIdInResult(): void
    {
        $session = $this->createSession();
        $this->storage->createSession($session);

        $message = $this->createMessage($session->id);

        $this->bridge->onVisitorMessage($message, $session);

        // Verify the bridge message ID was stored
        $bridgeIds = $this->storage->getBridgeMessageIds($message->id);
        $this->assertNotNull($bridgeIds);
        $this->assertEquals(12345, $bridgeIds->telegramMessageId);
    }

    public function testOnVisitorMessageHandlesApiErrorsGracefully(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => false, 'description' => 'Bad Request']),
            'httpCode' => 400,
            'error' => null,
        ];

        $session = $this->createSession();
        $this->storage->createSession($session);

        $message = $this->createMessage($session->id);

        // Should not throw
        $this->bridge->onVisitorMessage($message, $session);

        // Verify no bridge ID was stored (failure)
        $bridgeIds = $this->storage->getBridgeMessageIds($message->id);
        $this->assertNull($bridgeIds);
    }

    public function testOnVisitorMessageIncludesAttachmentInfo(): void
    {
        $session = $this->createSession();
        $this->storage->createSession($session);

        $message = new Message(
            id: 'msg-1',
            sessionId: $session->id,
            content: 'Check this file',
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
            attachments: [
                new Attachment(
                    id: 'att-1',
                    filename: 'document.pdf',
                    mimeType: 'application/pdf',
                    size: 1024,
                    url: 'https://example.com/doc.pdf',
                ),
            ],
        );

        $this->bridge->onVisitorMessage($message, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertStringContainsString('1 attachment(s)', $request['data']['text']);
    }

    // ─────────────────────────────────────────────────────────────────────
    // onNewSession Tests
    // ─────────────────────────────────────────────────────────────────────

    public function testOnNewSessionSendsSessionAnnouncement(): void
    {
        $session = $this->createSession();

        $this->bridge->onNewSession($session);

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertStringContainsString('New chat session', $request['data']['text']);
    }

    public function testOnNewSessionFormatsSessionInfoCorrectly(): void
    {
        $session = new Session(
            id: 'session-1',
            visitorId: 'visitor-1',
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
            metadata: new SessionMetadata(url: 'https://example.com/page'),
            identity: new UserIdentity(id: 'user-1', email: 'john@example.com'),
        );

        $this->bridge->onNewSession($session);

        $request = $this->httpClient->getLastRequest();
        // New format shows email/phone/userAgent instead of name
        $this->assertStringContainsString('john@example.com', $request['data']['text']);
        $this->assertStringContainsString('https://example.com/page', $request['data']['text']);
    }

    // ─────────────────────────────────────────────────────────────────────
    // onMessageEdit Tests
    // ─────────────────────────────────────────────────────────────────────

    public function testOnMessageEditCallsEditApiWithCorrectParams(): void
    {
        $session = $this->createSession();
        $this->storage->createSession($session);

        // First, store a bridge message ID
        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(telegramMessageId: 99999));

        $this->bridge->onMessageEdit(
            sessionId: $session->id,
            messageId: 'msg-1',
            content: 'Updated content',
            editedAt: new \DateTimeImmutable(),
        );

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertStringContainsString('editMessageText', $request['url']);
        $this->assertEquals(99999, $request['data']['message_id']);
        $this->assertStringContainsString('Updated content', $request['data']['text']);
    }

    public function testOnMessageEditReturnsTrueOnSuccess(): void
    {
        $session = $this->createSession();
        $this->storage->createSession($session);

        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(telegramMessageId: 99999));

        $result = $this->bridge->onMessageEdit(
            sessionId: $session->id,
            messageId: 'msg-1',
            content: 'Updated content',
            editedAt: new \DateTimeImmutable(),
        );

        $this->assertNotNull($result);
        $this->assertEquals(99999, $result->telegramMessageId);
    }

    public function testOnMessageEditReturnsNullOnFailure(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => false, 'description' => 'Message not found']),
            'httpCode' => 400,
            'error' => null,
        ];

        $session = $this->createSession();
        $this->storage->createSession($session);

        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(telegramMessageId: 99999));

        $result = $this->bridge->onMessageEdit(
            sessionId: $session->id,
            messageId: 'msg-1',
            content: 'Updated content',
            editedAt: new \DateTimeImmutable(),
        );

        $this->assertNull($result);
    }

    public function testOnMessageEditReturnsNullWhenNoBridgeId(): void
    {
        $session = $this->createSession();
        $this->storage->createSession($session);

        // Don't store any bridge message ID

        $result = $this->bridge->onMessageEdit(
            sessionId: $session->id,
            messageId: 'msg-1',
            content: 'Updated content',
            editedAt: new \DateTimeImmutable(),
        );

        $this->assertNull($result);
        $this->assertEmpty($this->httpClient->requests);
    }

    // ─────────────────────────────────────────────────────────────────────
    // onMessageDelete Tests
    // ─────────────────────────────────────────────────────────────────────

    public function testOnMessageDeleteCallsDeleteApiWithCorrectParams(): void
    {
        $session = $this->createSession();
        $this->storage->createSession($session);

        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(telegramMessageId: 99999));

        $this->bridge->onMessageDelete(
            sessionId: $session->id,
            messageId: 'msg-1',
            deletedAt: new \DateTimeImmutable(),
        );

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertStringContainsString('deleteMessage', $request['url']);
        $this->assertEquals(99999, $request['data']['message_id']);
    }

    public function testOnMessageDeleteSucceedsWithValidResponse(): void
    {
        $session = $this->createSession();
        $this->storage->createSession($session);

        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(telegramMessageId: 99999));

        // No exception should be thrown
        $this->bridge->onMessageDelete(
            sessionId: $session->id,
            messageId: 'msg-1',
            deletedAt: new \DateTimeImmutable(),
        );

        $this->assertCount(1, $this->httpClient->requests);
    }

    public function testOnMessageDeleteHandlesFailure(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => false, 'description' => 'Message not found']),
            'httpCode' => 400,
            'error' => null,
        ];

        $session = $this->createSession();
        $this->storage->createSession($session);

        $this->storage->saveBridgeMessageIds('msg-1', new BridgeMessageIds(telegramMessageId: 99999));

        // Should not throw
        $this->bridge->onMessageDelete(
            sessionId: $session->id,
            messageId: 'msg-1',
            deletedAt: new \DateTimeImmutable(),
        );

        $this->assertCount(1, $this->httpClient->requests);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Error Handling Tests
    // ─────────────────────────────────────────────────────────────────────

    public function testLogsWarningButDoesNotThrowOnApiFailure(): void
    {
        $this->httpClient->nextResponse = [
            'body' => json_encode(['ok' => false, 'description' => 'Unauthorized']),
            'httpCode' => 401,
            'error' => null,
        ];

        $session = $this->createSession();

        // Should not throw
        $this->bridge->onNewSession($session);

        $this->assertCount(1, $this->httpClient->requests);
    }

    public function testHandlesNetworkErrors(): void
    {
        $this->httpClient->nextResponse = [
            'body' => null,
            'httpCode' => 0,
            'error' => 'Connection refused',
        ];

        $session = $this->createSession();

        // Should not throw
        $this->bridge->onNewSession($session);

        $this->assertCount(1, $this->httpClient->requests);
    }

    public function testHandlesInvalidResponses(): void
    {
        $this->httpClient->nextResponse = [
            'body' => 'not json',
            'httpCode' => 200,
            'error' => null,
        ];

        $session = $this->createSession();

        // Should not throw
        $this->bridge->onNewSession($session);

        $this->assertCount(1, $this->httpClient->requests);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Additional Method Tests
    // ─────────────────────────────────────────────────────────────────────

    public function testOnOperatorMessageSkipsMessagesFromTelegram(): void
    {
        $session = $this->createSession();
        $message = $this->createMessage($session->id, Sender::OPERATOR);

        $this->bridge->onOperatorMessage($message, $session, 'telegram', 'John');

        $this->assertEmpty($this->httpClient->requests);
    }

    public function testOnOperatorMessageSendsFromOtherBridges(): void
    {
        $session = $this->createSession();
        $message = $this->createMessage($session->id, Sender::OPERATOR);

        $this->bridge->onOperatorMessage($message, $session, 'discord', 'John');

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertStringContainsString('John', $request['data']['text']);
        $this->assertStringContainsString('discord', $request['data']['text']);
    }

    public function testOnTypingSendsChatAction(): void
    {
        $this->bridge->onTyping('session-1', true);

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertStringContainsString('sendChatAction', $request['url']);
        $this->assertEquals('typing', $request['data']['action']);
    }

    public function testOnTypingDoesNothingWhenNotTyping(): void
    {
        $this->bridge->onTyping('session-1', false);

        $this->assertEmpty($this->httpClient->requests);
    }

    public function testOnCustomEventSendsEvent(): void
    {
        $session = $this->createSession();
        $event = new CustomEvent(name: 'button_click', data: ['button' => 'subscribe']);

        $this->bridge->onCustomEvent($event, $session);

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertStringContainsString('button_click', $request['data']['text']);
    }

    public function testOnIdentityUpdateSendsUpdate(): void
    {
        $session = new Session(
            id: 'session-1',
            visitorId: 'visitor-1',
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
            identity: new UserIdentity(id: 'user-123', email: 'user@example.com', name: 'John'),
        );

        $this->bridge->onIdentityUpdate($session);

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertStringContainsString('user-123', $request['data']['text']);
        $this->assertStringContainsString('John', $request['data']['text']);
    }

    public function testOnIdentityUpdateDoesNothingWithNoIdentity(): void
    {
        $session = $this->createSession();

        $this->bridge->onIdentityUpdate($session);

        $this->assertEmpty($this->httpClient->requests);
    }

    public function testOnAiTakeoverSendsNotification(): void
    {
        $session = $this->createSession();

        $this->bridge->onAiTakeover($session, 'Operator unavailable');

        $request = $this->httpClient->getLastRequest();
        $this->assertNotNull($request);
        $this->assertStringContainsString('AI Takeover', $request['data']['text']);
        $this->assertStringContainsString('Operator unavailable', $request['data']['text']);
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
}

<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Bridges\AbstractBridge;
use PocketPing\Models\ConnectRequest;
use PocketPing\Models\CustomEvent;
use PocketPing\Models\IdentifyRequest;
use PocketPing\Models\Message;
use PocketPing\Models\MessageStatus;
use PocketPing\Models\ReadRequest;
use PocketPing\Models\Sender;
use PocketPing\Models\SendMessageRequest;
use PocketPing\Models\Session;
use PocketPing\Models\SessionMetadata;
use PocketPing\Models\UserIdentity;
use PocketPing\PocketPing;
use PocketPing\Storage\MemoryStorage;

class PocketPingTest extends TestCase
{
    private PocketPing $pocketPing;
    private MemoryStorage $storage;

    protected function setUp(): void
    {
        $this->storage = new MemoryStorage();
        $this->pocketPing = new PocketPing(
            storage: $this->storage,
            welcomeMessage: 'Welcome!',
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // Connect Tests
    // ─────────────────────────────────────────────────────────────────

    public function testConnectCreatesNewSession(): void
    {
        $request = new ConnectRequest(
            visitorId: 'new-visitor',
            metadata: new SessionMetadata(url: 'https://example.com'),
        );

        $response = $this->pocketPing->handleConnect($request);

        $this->assertNotEmpty($response->sessionId);
        $this->assertEquals('new-visitor', $response->visitorId);
        $this->assertEmpty($response->messages);
        $this->assertEquals('Welcome!', $response->welcomeMessage);
    }

    public function testConnectReusesExistingSessionBySessionId(): void
    {
        // Create initial session
        $session = $this->createSession('existing-session', 'visitor-1');
        $this->storage->createSession($session);

        $request = new ConnectRequest(
            visitorId: 'visitor-1',
            sessionId: 'existing-session',
        );

        $response = $this->pocketPing->handleConnect($request);

        $this->assertEquals('existing-session', $response->sessionId);
        $this->assertEquals('visitor-1', $response->visitorId);
    }

    public function testConnectReusesExistingSessionByVisitorId(): void
    {
        $session = $this->createSession('session-1', 'returning-visitor');
        $this->storage->createSession($session);

        $request = new ConnectRequest(
            visitorId: 'returning-visitor',
        );

        $response = $this->pocketPing->handleConnect($request);

        $this->assertEquals('session-1', $response->sessionId);
    }

    public function testConnectReturnsExistingMessages(): void
    {
        $session = $this->createSession('session-with-messages', 'visitor-1');
        $this->storage->createSession($session);

        $message = new Message(
            id: 'msg-1',
            sessionId: 'session-with-messages',
            content: 'Hello!',
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
        );
        $this->storage->saveMessage($message);

        $request = new ConnectRequest(
            visitorId: 'visitor-1',
            sessionId: 'session-with-messages',
        );

        $response = $this->pocketPing->handleConnect($request);

        $this->assertCount(1, $response->messages);
        $this->assertEquals('Hello!', $response->messages[0]->content);
    }

    public function testConnectUpdatesMetadata(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $session->metadata = new SessionMetadata(url: 'https://example.com/old');
        $this->storage->createSession($session);

        $request = new ConnectRequest(
            visitorId: 'visitor-1',
            sessionId: 'session-1',
            metadata: new SessionMetadata(url: 'https://example.com/new'),
        );

        $this->pocketPing->handleConnect($request);

        $updatedSession = $this->storage->getSession('session-1');
        $this->assertEquals('https://example.com/new', $updatedSession->metadata->url);
    }

    public function testConnectCallsOnNewSessionCallback(): void
    {
        $called = false;
        $capturedSession = null;

        $pocketPing = new PocketPing(
            storage: $this->storage,
            onNewSession: function (Session $session) use (&$called, &$capturedSession) {
                $called = true;
                $capturedSession = $session;
            },
        );

        $request = new ConnectRequest(visitorId: 'new-visitor');
        $pocketPing->handleConnect($request);

        $this->assertTrue($called);
        $this->assertEquals('new-visitor', $capturedSession->visitorId);
    }

    // ─────────────────────────────────────────────────────────────────
    // Message Tests
    // ─────────────────────────────────────────────────────────────────

    public function testHandleVisitorMessage(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $request = new SendMessageRequest(
            sessionId: 'session-1',
            content: 'Hello!',
            sender: Sender::VISITOR,
        );

        $response = $this->pocketPing->handleMessage($request);

        $this->assertNotEmpty($response->messageId);
        $this->assertInstanceOf(\DateTimeImmutable::class, $response->timestamp);

        $messages = $this->storage->getMessages('session-1');
        $this->assertCount(1, $messages);
        $this->assertEquals('Hello!', $messages[0]->content);
    }

    public function testHandleOperatorMessage(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $request = new SendMessageRequest(
            sessionId: 'session-1',
            content: 'Hi there!',
            sender: Sender::OPERATOR,
        );

        $response = $this->pocketPing->handleMessage($request);

        $messages = $this->storage->getMessages('session-1');
        $this->assertEquals(Sender::OPERATOR, $messages[0]->sender);
    }

    public function testHandleMessageUpdatesSessionActivity(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $originalActivity = $session->lastActivity;
        $this->storage->createSession($session);

        // Small delay to ensure time difference
        usleep(1000);

        $request = new SendMessageRequest(
            sessionId: 'session-1',
            content: 'Hello!',
            sender: Sender::VISITOR,
        );

        $this->pocketPing->handleMessage($request);

        $updatedSession = $this->storage->getSession('session-1');
        $this->assertGreaterThan($originalActivity, $updatedSession->lastActivity);
    }

    public function testHandleMessageInvalidSession(): void
    {
        $request = new SendMessageRequest(
            sessionId: 'non-existent',
            content: 'Hello!',
            sender: Sender::VISITOR,
        );

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Session not found');

        $this->pocketPing->handleMessage($request);
    }

    public function testOperatorMessageDisablesAi(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $session->aiActive = true;
        $this->storage->createSession($session);

        $request = new SendMessageRequest(
            sessionId: 'session-1',
            content: 'Hi, I am the operator',
            sender: Sender::OPERATOR,
        );

        $this->pocketPing->handleMessage($request);

        $updatedSession = $this->storage->getSession('session-1');
        $this->assertFalse($updatedSession->aiActive);
    }

    public function testHandleMessageCallsOnMessageCallback(): void
    {
        $called = false;
        $capturedMessage = null;

        $pocketPing = new PocketPing(
            storage: $this->storage,
            onMessage: function (Message $message) use (&$called, &$capturedMessage) {
                $called = true;
                $capturedMessage = $message;
            },
        );

        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $request = new SendMessageRequest(
            sessionId: 'session-1',
            content: 'Test message',
            sender: Sender::VISITOR,
        );

        $pocketPing->handleMessage($request);

        $this->assertTrue($called);
        $this->assertEquals('Test message', $capturedMessage->content);
    }

    // ─────────────────────────────────────────────────────────────────
    // Read Receipt Tests
    // ─────────────────────────────────────────────────────────────────

    public function testHandleReadUpdatesMessageStatus(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $message = new Message(
            id: 'msg-1',
            sessionId: 'session-1',
            content: 'Hello!',
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
        );
        $this->storage->saveMessage($message);

        $request = new ReadRequest(
            sessionId: 'session-1',
            messageIds: ['msg-1'],
            status: MessageStatus::DELIVERED,
        );

        $this->pocketPing->handleRead($request);

        $updatedMessage = $this->storage->getMessage('msg-1');
        $this->assertEquals(MessageStatus::DELIVERED, $updatedMessage->status);
    }

    public function testHandleReadSetsDeliveredAt(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $message = new Message(
            id: 'msg-1',
            sessionId: 'session-1',
            content: 'Hello!',
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
        );
        $this->storage->saveMessage($message);

        $request = new ReadRequest(
            sessionId: 'session-1',
            messageIds: ['msg-1'],
            status: MessageStatus::DELIVERED,
        );

        $this->pocketPing->handleRead($request);

        $updatedMessage = $this->storage->getMessage('msg-1');
        $this->assertNotNull($updatedMessage->deliveredAt);
    }

    public function testHandleReadSetsReadAt(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $message = new Message(
            id: 'msg-1',
            sessionId: 'session-1',
            content: 'Hello!',
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
        );
        $this->storage->saveMessage($message);

        $request = new ReadRequest(
            sessionId: 'session-1',
            messageIds: ['msg-1'],
            status: MessageStatus::READ,
        );

        $this->pocketPing->handleRead($request);

        $updatedMessage = $this->storage->getMessage('msg-1');
        $this->assertNotNull($updatedMessage->readAt);
        $this->assertEquals(MessageStatus::READ, $updatedMessage->status);
    }

    // ─────────────────────────────────────────────────────────────────
    // WebSocket Tests
    // ─────────────────────────────────────────────────────────────────

    public function testRegisterWebsocket(): void
    {
        $mockWs = new class {
            public array $sentMessages = [];
            public function send(string $message): void
            {
                $this->sentMessages[] = $message;
            }
        };

        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $this->pocketPing->registerWebsocket('session-1', $mockWs);

        // Send a message to trigger broadcast
        $request = new SendMessageRequest(
            sessionId: 'session-1',
            content: 'Test broadcast',
            sender: Sender::VISITOR,
        );

        $this->pocketPing->handleMessage($request);

        $this->assertNotEmpty($mockWs->sentMessages);
        $this->assertStringContainsString('Test broadcast', $mockWs->sentMessages[0]);
    }

    public function testUnregisterWebsocket(): void
    {
        $mockWs = new class {
            public array $sentMessages = [];
            public function send(string $message): void
            {
                $this->sentMessages[] = $message;
            }
        };

        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $this->pocketPing->registerWebsocket('session-1', $mockWs);
        $this->pocketPing->unregisterWebsocket('session-1', $mockWs);

        $request = new SendMessageRequest(
            sessionId: 'session-1',
            content: 'Test',
            sender: Sender::VISITOR,
        );

        $this->pocketPing->handleMessage($request);

        $this->assertEmpty($mockWs->sentMessages);
    }

    // ─────────────────────────────────────────────────────────────────
    // Operator Tests
    // ─────────────────────────────────────────────────────────────────

    public function testSendOperatorMessage(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $message = $this->pocketPing->sendOperatorMessage(
            sessionId: 'session-1',
            content: 'Hello from operator!',
            sourceBridge: 'test',
            operatorName: 'John',
        );

        $this->assertEquals('Hello from operator!', $message->content);
        $this->assertEquals(Sender::OPERATOR, $message->sender);

        $messages = $this->storage->getMessages('session-1');
        $this->assertCount(1, $messages);
    }

    public function testSetOperatorOnline(): void
    {
        $this->assertFalse($this->pocketPing->isOperatorOnline());

        $this->pocketPing->setOperatorOnline(true);

        $this->assertTrue($this->pocketPing->isOperatorOnline());
    }

    // ─────────────────────────────────────────────────────────────────
    // Identity Tests
    // ─────────────────────────────────────────────────────────────────

    public function testHandleIdentifyUpdatesSessionIdentity(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $request = new IdentifyRequest(
            sessionId: 'session-1',
            identity: new UserIdentity(
                id: 'user-123',
                email: 'user@example.com',
                name: 'John Doe',
            ),
        );

        $response = $this->pocketPing->handleIdentify($request);

        $this->assertTrue($response->ok);

        $updatedSession = $this->storage->getSession('session-1');
        $this->assertEquals('user-123', $updatedSession->identity->id);
        $this->assertEquals('user@example.com', $updatedSession->identity->email);
    }

    public function testHandleIdentifyRequiresId(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $request = new IdentifyRequest(
            sessionId: 'session-1',
            identity: new UserIdentity(id: ''),
        );

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('identity.id is required');

        $this->pocketPing->handleIdentify($request);
    }

    public function testHandleIdentifyInvalidSession(): void
    {
        $request = new IdentifyRequest(
            sessionId: 'non-existent',
            identity: new UserIdentity(id: 'user-123'),
        );

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Session not found');

        $this->pocketPing->handleIdentify($request);
    }

    // ─────────────────────────────────────────────────────────────────
    // Custom Event Tests
    // ─────────────────────────────────────────────────────────────────

    public function testOnEventHandlerRegistersHandler(): void
    {
        $called = false;

        $this->pocketPing->onEventHandler('test_event', function () use (&$called) {
            $called = true;
        });

        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $event = new CustomEvent(name: 'test_event', data: ['key' => 'value']);
        $this->pocketPing->handleCustomEvent('session-1', $event);

        $this->assertTrue($called);
    }

    public function testOnEventHandlerUnsubscribe(): void
    {
        $callCount = 0;

        $unsubscribe = $this->pocketPing->onEventHandler('test_event', function () use (&$callCount) {
            $callCount++;
        });

        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $event = new CustomEvent(name: 'test_event');
        $this->pocketPing->handleCustomEvent('session-1', $event);
        $this->assertEquals(1, $callCount);

        $unsubscribe();

        $this->pocketPing->handleCustomEvent('session-1', $event);
        $this->assertEquals(1, $callCount); // Should not increment
    }

    public function testWildcardEventHandler(): void
    {
        $receivedEvents = [];

        $this->pocketPing->onEventHandler('*', function (CustomEvent $event) use (&$receivedEvents) {
            $receivedEvents[] = $event->name;
        });

        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $this->pocketPing->handleCustomEvent('session-1', new CustomEvent(name: 'event1'));
        $this->pocketPing->handleCustomEvent('session-1', new CustomEvent(name: 'event2'));

        $this->assertEquals(['event1', 'event2'], $receivedEvents);
    }

    public function testHandleCustomEventSetsSessionId(): void
    {
        $capturedEvent = null;

        $this->pocketPing->onEventHandler('test_event', function (CustomEvent $event) use (&$capturedEvent) {
            $capturedEvent = $event;
        });

        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $event = new CustomEvent(name: 'test_event');
        $this->pocketPing->handleCustomEvent('session-1', $event);

        $this->assertEquals('session-1', $capturedEvent->sessionId);
    }

    // ─────────────────────────────────────────────────────────────────
    // Bridge Tests
    // ─────────────────────────────────────────────────────────────────

    public function testAddBridge(): void
    {
        $bridge = $this->createMockBridge();

        $this->pocketPing->addBridge($bridge);

        $this->assertContains($bridge, $this->pocketPing->getBridges());
    }

    public function testBridgeNotifiedOnNewSession(): void
    {
        $bridge = $this->createMockBridge();
        $pocketPing = new PocketPing(
            storage: $this->storage,
            bridges: [$bridge],
        );

        $request = new ConnectRequest(visitorId: 'new-visitor');
        $pocketPing->handleConnect($request);

        $this->assertTrue($bridge->newSessionCalled);
    }

    public function testBridgeNotifiedOnVisitorMessage(): void
    {
        $bridge = $this->createMockBridge();
        $pocketPing = new PocketPing(
            storage: $this->storage,
            bridges: [$bridge],
        );

        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $request = new SendMessageRequest(
            sessionId: 'session-1',
            content: 'Hello!',
            sender: Sender::VISITOR,
        );

        $pocketPing->handleMessage($request);

        $this->assertTrue($bridge->visitorMessageCalled);
    }

    // ─────────────────────────────────────────────────────────────────
    // Version Tests
    // ─────────────────────────────────────────────────────────────────

    public function testCheckWidgetVersionOk(): void
    {
        $pocketPing = new PocketPing(
            storage: $this->storage,
            latestWidgetVersion: '0.3.0',
        );

        $result = $pocketPing->checkWidgetVersion('0.3.0');

        $this->assertEquals('ok', $result->status->value);
        $this->assertTrue($result->canContinue);
    }

    public function testCheckWidgetVersionOutdated(): void
    {
        $pocketPing = new PocketPing(
            storage: $this->storage,
            latestWidgetVersion: '0.3.0',
        );

        $result = $pocketPing->checkWidgetVersion('0.2.0');

        $this->assertEquals('outdated', $result->status->value);
        $this->assertTrue($result->canContinue);
    }

    public function testCheckWidgetVersionUnsupported(): void
    {
        $pocketPing = new PocketPing(
            storage: $this->storage,
            minWidgetVersion: '0.2.0',
        );

        $result = $pocketPing->checkWidgetVersion('0.1.0');

        $this->assertEquals('unsupported', $result->status->value);
        $this->assertFalse($result->canContinue);
    }

    // ─────────────────────────────────────────────────────────────────
    // Helper Methods
    // ─────────────────────────────────────────────────────────────────

    private function createSession(string $id, string $visitorId): Session
    {
        return new Session(
            id: $id,
            visitorId: $visitorId,
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
        );
    }

    private function createMockBridge(): object
    {
        return new class extends AbstractBridge {
            public bool $newSessionCalled = false;
            public bool $visitorMessageCalled = false;

            public function getName(): string
            {
                return 'mock';
            }

            public function onNewSession(Session $session): void
            {
                $this->newSessionCalled = true;
            }

            public function onVisitorMessage(Message $message, Session $session): void
            {
                $this->visitorMessageCalled = true;
            }
        };
    }
}

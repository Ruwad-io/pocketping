<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Models\ConnectRequest;
use PocketPing\Models\ConnectResponse;
use PocketPing\Models\CustomEvent;
use PocketPing\Models\IdentifyRequest;
use PocketPing\Models\Message;
use PocketPing\Models\MessageStatus;
use PocketPing\Models\ReadRequest;
use PocketPing\Models\SendMessageRequest;
use PocketPing\Models\Sender;
use PocketPing\Models\Session;
use PocketPing\Models\SessionMetadata;
use PocketPing\Models\TrackedElement;
use PocketPing\Models\TriggerOptions;
use PocketPing\Models\UserIdentity;
use PocketPing\Models\VersionCheckResult;
use PocketPing\Models\VersionStatus;
use PocketPing\Models\WebSocketEvent;

class ModelsTest extends TestCase
{
    // ─────────────────────────────────────────────────────────────────
    // UserIdentity Tests
    // ─────────────────────────────────────────────────────────────────

    public function testUserIdentityFromArray(): void
    {
        $identity = UserIdentity::fromArray([
            'id' => 'user-123',
            'email' => 'user@example.com',
            'name' => 'John Doe',
            'plan' => 'premium',
            'company' => 'Acme Inc',
        ]);

        $this->assertEquals('user-123', $identity->id);
        $this->assertEquals('user@example.com', $identity->email);
        $this->assertEquals('John Doe', $identity->name);
        $this->assertEquals('premium', $identity->customFields['plan']);
        $this->assertEquals('Acme Inc', $identity->customFields['company']);
    }

    public function testUserIdentityToArray(): void
    {
        $identity = new UserIdentity(
            id: 'user-123',
            email: 'user@example.com',
            name: 'John Doe',
            customFields: ['plan' => 'premium'],
        );

        $array = $identity->toArray();

        $this->assertEquals('user-123', $array['id']);
        $this->assertEquals('user@example.com', $array['email']);
        $this->assertEquals('John Doe', $array['name']);
        $this->assertEquals('premium', $array['plan']);
    }

    public function testUserIdentityRequiresId(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        UserIdentity::fromArray(['email' => 'test@test.com']);
    }

    // ─────────────────────────────────────────────────────────────────
    // SessionMetadata Tests
    // ─────────────────────────────────────────────────────────────────

    public function testSessionMetadataFromArray(): void
    {
        $metadata = SessionMetadata::fromArray([
            'url' => 'https://example.com',
            'referrer' => 'https://google.com',
            'pageTitle' => 'Home Page',
            'userAgent' => 'Mozilla/5.0',
            'deviceType' => 'desktop',
        ]);

        $this->assertEquals('https://example.com', $metadata->url);
        $this->assertEquals('https://google.com', $metadata->referrer);
        $this->assertEquals('Home Page', $metadata->pageTitle);
        $this->assertEquals('desktop', $metadata->deviceType);
    }

    public function testSessionMetadataMergePreservesGeoInfo(): void
    {
        $original = new SessionMetadata(
            url: 'https://example.com/old',
            ip: '192.168.1.1',
            country: 'US',
            city: 'New York',
        );

        $new = new SessionMetadata(
            url: 'https://example.com/new',
            userAgent: 'Mozilla/5.0',
        );

        $merged = $original->mergeWith($new);

        $this->assertEquals('https://example.com/new', $merged->url);
        $this->assertEquals('192.168.1.1', $merged->ip);
        $this->assertEquals('US', $merged->country);
        $this->assertEquals('New York', $merged->city);
        $this->assertEquals('Mozilla/5.0', $merged->userAgent);
    }

    // ─────────────────────────────────────────────────────────────────
    // Session Tests
    // ─────────────────────────────────────────────────────────────────

    public function testSessionFromArray(): void
    {
        $session = Session::fromArray([
            'id' => 'session-123',
            'visitorId' => 'visitor-456',
            'createdAt' => '2024-01-01T12:00:00Z',
            'lastActivity' => '2024-01-01T13:00:00Z',
            'operatorOnline' => true,
            'aiActive' => false,
        ]);

        $this->assertEquals('session-123', $session->id);
        $this->assertEquals('visitor-456', $session->visitorId);
        $this->assertTrue($session->operatorOnline);
    }

    public function testSessionToArray(): void
    {
        $session = new Session(
            id: 'session-123',
            visitorId: 'visitor-456',
            createdAt: new \DateTimeImmutable('2024-01-01T12:00:00Z'),
            lastActivity: new \DateTimeImmutable('2024-01-01T13:00:00Z'),
            operatorOnline: true,
        );

        $array = $session->toArray();

        $this->assertEquals('session-123', $array['id']);
        $this->assertEquals('visitor-456', $array['visitorId']);
        $this->assertTrue($array['operatorOnline']);
    }

    // ─────────────────────────────────────────────────────────────────
    // Message Tests
    // ─────────────────────────────────────────────────────────────────

    public function testMessageFromArray(): void
    {
        $message = Message::fromArray([
            'id' => 'msg-123',
            'sessionId' => 'session-456',
            'content' => 'Hello!',
            'sender' => 'visitor',
            'timestamp' => '2024-01-01T12:00:00Z',
            'status' => 'sent',
        ]);

        $this->assertEquals('msg-123', $message->id);
        $this->assertEquals('session-456', $message->sessionId);
        $this->assertEquals('Hello!', $message->content);
        $this->assertEquals(Sender::VISITOR, $message->sender);
        $this->assertEquals(MessageStatus::SENT, $message->status);
    }

    public function testMessageWithStatus(): void
    {
        $message = new Message(
            id: 'msg-123',
            sessionId: 'session-456',
            content: 'Hello!',
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
        );

        $updated = $message->withStatus(MessageStatus::READ);

        $this->assertEquals(MessageStatus::SENT, $message->status);
        $this->assertEquals(MessageStatus::READ, $updated->status);
    }

    // ─────────────────────────────────────────────────────────────────
    // TrackedElement Tests
    // ─────────────────────────────────────────────────────────────────

    public function testTrackedElementFromArray(): void
    {
        $element = TrackedElement::fromArray([
            'selector' => '#pricing-btn',
            'name' => 'clicked_pricing',
            'event' => 'click',
            'widgetMessage' => 'Need help with pricing?',
        ]);

        $this->assertEquals('#pricing-btn', $element->selector);
        $this->assertEquals('clicked_pricing', $element->name);
        $this->assertEquals('click', $element->event);
        $this->assertEquals('Need help with pricing?', $element->widgetMessage);
    }

    public function testTrackedElementDefaultEvent(): void
    {
        $element = TrackedElement::fromArray([
            'selector' => '#btn',
            'name' => 'test_event',
        ]);

        $this->assertEquals('click', $element->event);
    }

    // ─────────────────────────────────────────────────────────────────
    // CustomEvent Tests
    // ─────────────────────────────────────────────────────────────────

    public function testCustomEventFromArray(): void
    {
        $event = CustomEvent::fromArray([
            'name' => 'page_view',
            'data' => ['page' => '/pricing'],
            'timestamp' => '2024-01-01T12:00:00Z',
            'sessionId' => 'session-123',
        ]);

        $this->assertEquals('page_view', $event->name);
        $this->assertEquals('/pricing', $event->data['page']);
        $this->assertEquals('session-123', $event->sessionId);
    }

    public function testCustomEventWithSessionId(): void
    {
        $event = new CustomEvent(name: 'test_event');
        $updated = $event->withSessionId('session-123');

        $this->assertNull($event->sessionId);
        $this->assertEquals('session-123', $updated->sessionId);
    }

    // ─────────────────────────────────────────────────────────────────
    // ConnectRequest Tests
    // ─────────────────────────────────────────────────────────────────

    public function testConnectRequestFromArray(): void
    {
        $request = ConnectRequest::fromArray([
            'visitorId' => 'visitor-123',
            'sessionId' => 'session-456',
            'metadata' => ['url' => 'https://example.com'],
        ]);

        $this->assertEquals('visitor-123', $request->visitorId);
        $this->assertEquals('session-456', $request->sessionId);
        $this->assertEquals('https://example.com', $request->metadata->url);
    }

    // ─────────────────────────────────────────────────────────────────
    // SendMessageRequest Tests
    // ─────────────────────────────────────────────────────────────────

    public function testSendMessageRequestFromArray(): void
    {
        $request = SendMessageRequest::fromArray([
            'sessionId' => 'session-123',
            'content' => 'Hello!',
            'sender' => 'visitor',
        ]);

        $this->assertEquals('session-123', $request->sessionId);
        $this->assertEquals('Hello!', $request->content);
        $this->assertEquals(Sender::VISITOR, $request->sender);
    }

    public function testSendMessageRequestContentLengthLimit(): void
    {
        $longContent = str_repeat('a', 4001);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('exceeds maximum length');

        new SendMessageRequest(
            sessionId: 'session-123',
            content: $longContent,
            sender: Sender::VISITOR,
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // VersionCheckResult Tests
    // ─────────────────────────────────────────────────────────────────

    public function testVersionCheckResultToArray(): void
    {
        $result = new VersionCheckResult(
            status: VersionStatus::OUTDATED,
            message: 'Update available',
            minVersion: '0.2.0',
            latestVersion: '0.3.0',
            canContinue: true,
        );

        $array = $result->toArray();

        $this->assertEquals('outdated', $array['status']);
        $this->assertEquals('Update available', $array['message']);
        $this->assertEquals('0.2.0', $array['minVersion']);
        $this->assertEquals('0.3.0', $array['latestVersion']);
        $this->assertTrue($array['canContinue']);
    }

    // ─────────────────────────────────────────────────────────────────
    // WebSocketEvent Tests
    // ─────────────────────────────────────────────────────────────────

    public function testWebSocketEventToJson(): void
    {
        $event = new WebSocketEvent('message', ['content' => 'Hello']);

        $json = $event->toJson();
        $decoded = json_decode($json, true);

        $this->assertEquals('message', $decoded['type']);
        $this->assertEquals('Hello', $decoded['data']['content']);
    }

    // ─────────────────────────────────────────────────────────────────
    // JSON Serialization Tests
    // ─────────────────────────────────────────────────────────────────

    public function testModelsJsonSerializable(): void
    {
        $identity = new UserIdentity(id: 'user-123', email: 'test@test.com');
        $this->assertJson(json_encode($identity));

        $metadata = new SessionMetadata(url: 'https://example.com');
        $this->assertJson(json_encode($metadata));

        $session = new Session(
            id: 'session-123',
            visitorId: 'visitor-456',
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
        );
        $this->assertJson(json_encode($session));

        $message = new Message(
            id: 'msg-123',
            sessionId: 'session-456',
            content: 'Hello!',
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
        );
        $this->assertJson(json_encode($message));
    }
}

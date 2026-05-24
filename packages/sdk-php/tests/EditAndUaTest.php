<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Models\DeleteMessageRequest;
use PocketPing\Models\EditMessageRequest;
use PocketPing\Models\Sender;
use PocketPing\Models\SendMessageRequest;
use PocketPing\Models\Session;
use PocketPing\PocketPing;
use PocketPing\Storage\MemoryStorage;
use PocketPing\Utils\UaFilterConfig;

/**
 * Regression tests for:
 *  - Message edit (previously fatal: write to a readonly Message::$content).
 *  - User-Agent filter wiring on the PocketPing entry point (previously absent).
 */
class EditAndUaTest extends TestCase
{
    private PocketPing $pp;
    private MemoryStorage $storage;

    protected function setUp(): void
    {
        $this->storage = new MemoryStorage();
        $this->pp = new PocketPing(storage: $this->storage);
    }

    private function newSession(): Session
    {
        return new Session(
            id: 'sess-1',
            visitorId: 'vis-1',
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
        );
    }

    public function testEditMessageUpdatesContentWithoutFatal(): void
    {
        $this->storage->createSession($this->newSession());
        $resp = $this->pp->handleMessage(new SendMessageRequest(
            sessionId: 'sess-1',
            content: 'original',
            sender: Sender::VISITOR,
        ));

        $edit = $this->pp->handleEditMessage(new EditMessageRequest(
            sessionId: 'sess-1',
            messageId: $resp->messageId,
            content: 'edited!',
        ));

        $this->assertSame('edited!', $edit->getContent());

        $stored = $this->storage->getMessage($resp->messageId);
        $this->assertNotNull($stored);
        $this->assertSame('edited!', $stored->content);
        $this->assertNotNull($stored->editedAt);
    }

    public function testDeleteMessageSoftDeletes(): void
    {
        $this->storage->createSession($this->newSession());
        $resp = $this->pp->handleMessage(new SendMessageRequest(
            sessionId: 'sess-1',
            content: 'bye',
            sender: Sender::VISITOR,
        ));

        $del = $this->pp->handleDeleteMessage(new DeleteMessageRequest(
            sessionId: 'sess-1',
            messageId: $resp->messageId,
        ));

        $this->assertTrue($del->deleted);
        $stored = $this->storage->getMessage($resp->messageId);
        $this->assertNotNull($stored);
        $this->assertNotNull($stored->deletedAt);
    }

    public function testUaFilterBlocksKnownBot(): void
    {
        $pp = new PocketPing(
            storage: new MemoryStorage(),
            uaFilter: new UaFilterConfig(enabled: true),
        );

        $result = $pp->checkUaFilter(
            'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
        );

        $this->assertFalse($result->allowed);
    }

    public function testUaFilterAllowsHumanBrowser(): void
    {
        $pp = new PocketPing(
            storage: new MemoryStorage(),
            uaFilter: new UaFilterConfig(enabled: true),
        );

        $result = $pp->checkUaFilter(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
            . '(KHTML, like Gecko) Chrome/120.0 Safari/537.36'
        );

        $this->assertTrue($result->allowed);
    }

    public function testUaFilterAllowsAllWhenNotConfigured(): void
    {
        $result = $this->pp->checkUaFilter('Googlebot');
        $this->assertTrue($result->allowed);
    }

    public function testGetClientUserAgentFromHeaders(): void
    {
        $ua = $this->pp->getClientUserAgent(['User-Agent' => 'TestAgent/1.0']);
        $this->assertSame('TestAgent/1.0', $ua);
    }
}

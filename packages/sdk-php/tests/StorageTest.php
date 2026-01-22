<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Models\Message;
use PocketPing\Models\Sender;
use PocketPing\Models\Session;
use PocketPing\Storage\MemoryStorage;

class StorageTest extends TestCase
{
    private MemoryStorage $storage;

    protected function setUp(): void
    {
        $this->storage = new MemoryStorage();
    }

    // ─────────────────────────────────────────────────────────────────
    // Session Tests
    // ─────────────────────────────────────────────────────────────────

    public function testCreateSession(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');

        $this->storage->createSession($session);

        $retrieved = $this->storage->getSession('session-1');
        $this->assertNotNull($retrieved);
        $this->assertEquals('session-1', $retrieved->id);
        $this->assertEquals('visitor-1', $retrieved->visitorId);
    }

    public function testGetSessionReturnsNullForNonExistent(): void
    {
        $session = $this->storage->getSession('non-existent');

        $this->assertNull($session);
    }

    public function testUpdateSession(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $session->aiActive = true;
        $this->storage->updateSession($session);

        $retrieved = $this->storage->getSession('session-1');
        $this->assertTrue($retrieved->aiActive);
    }

    public function testDeleteSession(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $this->storage->deleteSession('session-1');

        $this->assertNull($this->storage->getSession('session-1'));
    }

    public function testDeleteSessionRemovesMessages(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $message = $this->createMessage('msg-1', 'session-1', 'Hello!');
        $this->storage->saveMessage($message);

        $this->storage->deleteSession('session-1');

        $this->assertNull($this->storage->getMessage('msg-1'));
    }

    public function testGetSessionByVisitorId(): void
    {
        $session1 = $this->createSession('session-1', 'visitor-1');
        $session1->lastActivity = new \DateTimeImmutable('2024-01-01T12:00:00Z');
        $this->storage->createSession($session1);

        $session2 = $this->createSession('session-2', 'visitor-1');
        $session2->lastActivity = new \DateTimeImmutable('2024-01-02T12:00:00Z');
        $this->storage->createSession($session2);

        $retrieved = $this->storage->getSessionByVisitorId('visitor-1');

        $this->assertNotNull($retrieved);
        $this->assertEquals('session-2', $retrieved->id); // Most recent
    }

    public function testGetSessionByVisitorIdReturnsNullForNonExistent(): void
    {
        $session = $this->storage->getSessionByVisitorId('non-existent');

        $this->assertNull($session);
    }

    // ─────────────────────────────────────────────────────────────────
    // Message Tests
    // ─────────────────────────────────────────────────────────────────

    public function testSaveMessage(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $message = $this->createMessage('msg-1', 'session-1', 'Hello!');
        $this->storage->saveMessage($message);

        $retrieved = $this->storage->getMessage('msg-1');
        $this->assertNotNull($retrieved);
        $this->assertEquals('Hello!', $retrieved->content);
    }

    public function testGetMessages(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $this->storage->saveMessage($this->createMessage('msg-1', 'session-1', 'First'));
        $this->storage->saveMessage($this->createMessage('msg-2', 'session-1', 'Second'));
        $this->storage->saveMessage($this->createMessage('msg-3', 'session-1', 'Third'));

        $messages = $this->storage->getMessages('session-1');

        $this->assertCount(3, $messages);
        $this->assertEquals('First', $messages[0]->content);
        $this->assertEquals('Third', $messages[2]->content);
    }

    public function testGetMessagesWithAfter(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $this->storage->saveMessage($this->createMessage('msg-1', 'session-1', 'First'));
        $this->storage->saveMessage($this->createMessage('msg-2', 'session-1', 'Second'));
        $this->storage->saveMessage($this->createMessage('msg-3', 'session-1', 'Third'));

        $messages = $this->storage->getMessages('session-1', 'msg-1');

        $this->assertCount(2, $messages);
        $this->assertEquals('Second', $messages[0]->content);
    }

    public function testGetMessagesWithLimit(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        for ($i = 1; $i <= 10; $i++) {
            $this->storage->saveMessage($this->createMessage("msg-{$i}", 'session-1', "Message {$i}"));
        }

        $messages = $this->storage->getMessages('session-1', null, 5);

        $this->assertCount(5, $messages);
    }

    public function testSaveMessageUpdatesExisting(): void
    {
        $session = $this->createSession('session-1', 'visitor-1');
        $this->storage->createSession($session);

        $message = $this->createMessage('msg-1', 'session-1', 'Original');
        $this->storage->saveMessage($message);

        // Create updated message with same ID
        $updated = new Message(
            id: 'msg-1',
            sessionId: 'session-1',
            content: 'Updated',
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
        );
        $this->storage->saveMessage($updated);

        $messages = $this->storage->getMessages('session-1');
        $this->assertCount(1, $messages);
        $this->assertEquals('Updated', $messages[0]->content);
    }

    // ─────────────────────────────────────────────────────────────────
    // Cleanup Tests
    // ─────────────────────────────────────────────────────────────────

    public function testCleanupOldSessions(): void
    {
        $oldSession = $this->createSession('old-session', 'visitor-1');
        $oldSession->lastActivity = new \DateTimeImmutable('-2 days');
        $this->storage->createSession($oldSession);

        $newSession = $this->createSession('new-session', 'visitor-2');
        $newSession->lastActivity = new \DateTimeImmutable('now');
        $this->storage->createSession($newSession);

        $cutoff = new \DateTimeImmutable('-1 day');
        $deleted = $this->storage->cleanupOldSessions($cutoff);

        $this->assertEquals(1, $deleted);
        $this->assertNull($this->storage->getSession('old-session'));
        $this->assertNotNull($this->storage->getSession('new-session'));
    }

    // ─────────────────────────────────────────────────────────────────
    // Utility Methods Tests
    // ─────────────────────────────────────────────────────────────────

    public function testGetAllSessions(): void
    {
        $this->storage->createSession($this->createSession('session-1', 'visitor-1'));
        $this->storage->createSession($this->createSession('session-2', 'visitor-2'));

        $sessions = $this->storage->getAllSessions();

        $this->assertCount(2, $sessions);
    }

    public function testGetSessionCount(): void
    {
        $this->assertEquals(0, $this->storage->getSessionCount());

        $this->storage->createSession($this->createSession('session-1', 'visitor-1'));
        $this->storage->createSession($this->createSession('session-2', 'visitor-2'));

        $this->assertEquals(2, $this->storage->getSessionCount());
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

    private function createMessage(string $id, string $sessionId, string $content): Message
    {
        return new Message(
            id: $id,
            sessionId: $sessionId,
            content: $content,
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
        );
    }
}

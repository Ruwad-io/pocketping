<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Bridges\AbstractBridge;
use PocketPing\Models\Attachment;
use PocketPing\Models\AttachmentStatus;
use PocketPing\Models\ConnectRequest;
use PocketPing\Models\Message;
use PocketPing\Models\Sender;
use PocketPing\Models\SendMessageRequest;
use PocketPing\Models\Session;
use PocketPing\Models\UploadRequest;
use PocketPing\PocketPing;
use PocketPing\Storage\MemoryStorage;

class AttachmentsTest extends TestCase
{
    private PocketPing $pocketPing;
    private MemoryStorage $storage;

    protected function setUp(): void
    {
        $this->storage = new MemoryStorage();
        $this->pocketPing = new PocketPing(storage: $this->storage);
        $this->storage->createSession($this->createSession('session-1', 'visitor-1'));
    }

    private function createSession(string $id, string $visitorId): Session
    {
        return new Session(
            id: $id,
            visitorId: $visitorId,
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
        );
    }

    private function uploadRequest(
        string $mimeType = 'image/png',
        int $size = 1024,
        string $filename = 'photo.png',
        string $sessionId = 'session-1',
    ): UploadRequest {
        return new UploadRequest(
            sessionId: $sessionId,
            filename: $filename,
            mimeType: $mimeType,
            size: $size,
        );
    }

    // 1. Creates upload request with presigned URL
    public function testCreatesUploadRequestWithPresignedUrl(): void
    {
        $before = new \DateTimeImmutable();
        $response = $this->pocketPing->handleUploadRequest($this->uploadRequest());

        $this->assertNotEmpty($response->attachmentId);
        $this->assertStringContainsString($response->attachmentId, $response->uploadUrl);
        $this->assertStringStartsWith('https://uploads.pocketping.local/', $response->uploadUrl);
        $this->assertGreaterThan($before, $response->expiresAt);

        // Persisted as pending
        $stored = $this->storage->getAttachment($response->attachmentId);
        $this->assertNotNull($stored);
        $this->assertSame(AttachmentStatus::PENDING, $stored->status);
        $this->assertNull($stored->messageId);
    }

    // 2. Marks attachment as ready after upload
    public function testMarksAttachmentReadyAfterUpload(): void
    {
        $response = $this->pocketPing->handleUploadRequest($this->uploadRequest());

        $attachment = $this->pocketPing->handleUploadComplete($response->attachmentId);

        $this->assertSame(AttachmentStatus::READY, $attachment->status);
        $this->assertSame(
            AttachmentStatus::READY,
            $this->storage->getAttachment($response->attachmentId)?->status
        );
    }

    // 3. Links attachments to message
    public function testLinksAttachmentsToMessage(): void
    {
        $upload = $this->pocketPing->handleUploadRequest($this->uploadRequest());
        $this->pocketPing->handleUploadComplete($upload->attachmentId);

        $response = $this->pocketPing->handleMessage(new SendMessageRequest(
            sessionId: 'session-1',
            content: 'Here is a file',
            sender: Sender::VISITOR,
            attachmentIds: [$upload->attachmentId],
        ));

        $stored = $this->storage->getAttachment($upload->attachmentId);
        $this->assertNotNull($stored);
        $this->assertSame($response->messageId, $stored->messageId);
    }

    // 4. Returns attachments with message
    public function testReturnsAttachmentsWithMessage(): void
    {
        $upload = $this->pocketPing->handleUploadRequest($this->uploadRequest());
        $this->pocketPing->handleUploadComplete($upload->attachmentId);

        $this->pocketPing->handleMessage(new SendMessageRequest(
            sessionId: 'session-1',
            content: 'With attachment',
            sender: Sender::VISITOR,
            attachmentIds: [$upload->attachmentId],
        ));

        // Via connect
        $connect = $this->pocketPing->handleConnect(new ConnectRequest(
            visitorId: 'visitor-1',
            sessionId: 'session-1',
        ));

        $this->assertCount(1, $connect->messages);
        $message = $connect->messages[0];
        $this->assertIsArray($message->attachments);
        $this->assertCount(1, $message->attachments);
        $this->assertInstanceOf(Attachment::class, $message->attachments[0]);
        $this->assertSame($upload->attachmentId, $message->attachments[0]->id);

        // Via get messages
        $result = $this->pocketPing->handleGetMessages('session-1');
        $this->assertCount(1, $result['messages'][0]['attachments']);
    }

    // 5. Rejects invalid mime types
    public function testRejectsInvalidMimeTypes(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->pocketPing->handleUploadRequest(
            $this->uploadRequest(mimeType: 'application/x-msdownload')
        );
    }

    // 6. Rejects files over size limit
    public function testRejectsFilesOverSizeLimit(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->pocketPing->handleUploadRequest(
            $this->uploadRequest(size: PocketPing::MAX_ATTACHMENT_SIZE + 1)
        );
    }

    // 7. Handles upload failure gracefully
    public function testHandlesUploadFailureGracefully(): void
    {
        $upload = $this->pocketPing->handleUploadRequest($this->uploadRequest());

        $attachment = $this->pocketPing->handleUploadFailed($upload->attachmentId);
        $this->assertSame(AttachmentStatus::FAILED, $attachment->status);

        // Unknown id returns null without crashing
        $this->assertNull($this->storage->getAttachment('does-not-exist'));
    }

    // 8. Syncs attachments to bridges
    public function testSyncsAttachmentsToBridges(): void
    {
        $bridge = new class extends AbstractBridge {
            public ?Message $received = null;

            public function getName(): string
            {
                return 'recording';
            }

            public function onVisitorMessage(Message $message, Session $session): void
            {
                $this->received = $message;
            }
        };

        $pocketPing = new PocketPing(storage: $this->storage, bridges: [$bridge]);

        $upload = $pocketPing->handleUploadRequest($this->uploadRequest());
        $pocketPing->handleUploadComplete($upload->attachmentId);

        $pocketPing->handleMessage(new SendMessageRequest(
            sessionId: 'session-1',
            content: 'See attached',
            sender: Sender::VISITOR,
            attachmentIds: [$upload->attachmentId],
        ));

        $this->assertNotNull($bridge->received);
        $this->assertIsArray($bridge->received->attachments);
        $ids = array_map(fn (Attachment $a) => $a->id, $bridge->received->attachments);
        $this->assertContains($upload->attachmentId, $ids);
    }

    // Extra: rejects upload for unknown session
    public function testRejectsUploadForUnknownSession(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->pocketPing->handleUploadRequest(
            $this->uploadRequest(sessionId: 'no-such-session')
        );
    }

    // Extra: respects overridable options
    public function testRespectsOverridableOptions(): void
    {
        $pocketPing = new PocketPing(
            storage: $this->storage,
            maxAttachmentSize: 100,
            allowedMimeTypes: ['image/png'],
            uploadBaseUrl: 'https://files.example.com/',
        );

        $response = $pocketPing->handleUploadRequest($this->uploadRequest(size: 50));
        $this->assertStringStartsWith('https://files.example.com/', $response->uploadUrl);

        $this->expectException(\InvalidArgumentException::class);
        $pocketPing->handleUploadRequest($this->uploadRequest(size: 101));
    }
}

<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Models\ConnectRequest;
use PocketPing\Models\CustomEvent;
use PocketPing\Models\DeleteMessageRequest;
use PocketPing\Models\EditMessageRequest;
use PocketPing\Models\Message;
use PocketPing\Models\MessageStatus;
use PocketPing\Models\ReadRequest;
use PocketPing\Models\Sender;
use PocketPing\Models\SendMessageRequest;
use PocketPing\Models\Session;
use PocketPing\Models\SessionMetadata;
use PocketPing\Models\TrackedElement;
use PocketPing\Models\TypingRequest;
use PocketPing\Models\UploadRequest;
use PocketPing\Models\UserIdentity;
use PocketPing\PocketPing;
use PocketPing\Storage\MemoryStorage;

/**
 * Coverage for PocketPing handler paths not exercised by the base test:
 * typing, presence, pagination, uploads, version warnings/headers,
 * websocket cleanup, event broadcasting and error handling.
 */
class PocketPingExtraTest extends TestCase
{
    private MemoryStorage $storage;
    private PocketPing $pp;

    protected function setUp(): void
    {
        $this->storage = new MemoryStorage();
        $this->pp = new PocketPing(storage: $this->storage);
    }

    private function session(string $id = 'sess-1', string $visitor = 'vis-1'): Session
    {
        return new Session(
            id: $id,
            visitorId: $visitor,
            createdAt: new \DateTimeImmutable(),
            lastActivity: new \DateTimeImmutable(),
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // Typing / Presence
    // ─────────────────────────────────────────────────────────────────

    public function testHandleTypingBroadcasts(): void
    {
        $ws = new class {
            public array $sent = [];
            public function send(string $m): void
            {
                $this->sent[] = $m;
            }
        };
        $this->pp->registerWebsocket('sess-1', $ws);

        $resp = $this->pp->handleTyping(new TypingRequest(
            sessionId: 'sess-1',
            sender: Sender::OPERATOR,
            isTyping: true,
        ));

        $this->assertSame(['ok' => true], $resp);
        $this->assertNotEmpty($ws->sent);
        $this->assertStringContainsString('typing', $ws->sent[0]);
    }

    public function testHandlePresenceReflectsOperatorStatus(): void
    {
        $this->pp->setOperatorOnline(true);
        $presence = $this->pp->handlePresence();
        $this->assertTrue($presence->online);
        $this->assertFalse($presence->aiEnabled);
    }

    // ─────────────────────────────────────────────────────────────────
    // Connect: tracked elements + identity update
    // ─────────────────────────────────────────────────────────────────

    public function testConnectReturnsTrackedElements(): void
    {
        $pp = new PocketPing(
            storage: $this->storage,
            trackedElements: [new TrackedElement(selector: '#btn', name: 'click_btn')],
        );

        $resp = $pp->handleConnect(new ConnectRequest(visitorId: 'v-1'));
        $this->assertNotNull($resp->trackedElements);
        $this->assertCount(1, $resp->trackedElements);
    }

    public function testConnectUpdatesIdentityOnExistingSession(): void
    {
        $this->storage->createSession($this->session());

        $this->pp->handleConnect(new ConnectRequest(
            visitorId: 'vis-1',
            sessionId: 'sess-1',
            identity: new UserIdentity(id: 'user-9', email: 'a@b.com'),
        ));

        $updated = $this->storage->getSession('sess-1');
        $this->assertSame('user-9', $updated->identity->id);
    }

    public function testConnectMergesMetadataOnExistingSessionWithNoPriorMetadata(): void
    {
        $this->storage->createSession($this->session());

        $this->pp->handleConnect(new ConnectRequest(
            visitorId: 'vis-1',
            sessionId: 'sess-1',
            metadata: new SessionMetadata(url: 'https://x.test'),
        ));

        $updated = $this->storage->getSession('sess-1');
        $this->assertSame('https://x.test', $updated->metadata->url);
    }

    // ─────────────────────────────────────────────────────────────────
    // getMessages pagination
    // ─────────────────────────────────────────────────────────────────

    public function testHandleGetMessagesPagination(): void
    {
        $this->storage->createSession($this->session());
        for ($i = 0; $i < 5; $i++) {
            $this->storage->saveMessage(new Message(
                id: "m-{$i}",
                sessionId: 'sess-1',
                content: "msg {$i}",
                sender: Sender::VISITOR,
                timestamp: new \DateTimeImmutable(),
            ));
        }

        $result = $this->pp->handleGetMessages('sess-1', null, 3);
        $this->assertCount(3, $result['messages']);
        $this->assertTrue($result['hasMore']);

        $allResult = $this->pp->handleGetMessages('sess-1', null, 50);
        $this->assertCount(5, $allResult['messages']);
        $this->assertFalse($allResult['hasMore']);
    }

    // ─────────────────────────────────────────────────────────────────
    // Read receipts: read sets delivered + bridge notify; no-match no-op
    // ─────────────────────────────────────────────────────────────────

    public function testHandleReadReturnsZeroWhenNoMatchingMessages(): void
    {
        $this->storage->createSession($this->session());
        $resp = $this->pp->handleRead(new ReadRequest(
            sessionId: 'sess-1',
            messageIds: ['does-not-exist'],
            status: MessageStatus::READ,
        ));
        $this->assertSame(0, $resp->updated);
    }

    public function testHandleReadIgnoresMessagesFromOtherSession(): void
    {
        $this->storage->createSession($this->session());
        $this->storage->createSession($this->session('other', 'v2'));
        $this->storage->saveMessage(new Message(
            id: 'm-x',
            sessionId: 'other',
            content: 'foreign',
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
        ));

        $resp = $this->pp->handleRead(new ReadRequest(
            sessionId: 'sess-1',
            messageIds: ['m-x'],
            status: MessageStatus::READ,
        ));

        $this->assertSame(0, $resp->updated);
    }

    // ─────────────────────────────────────────────────────────────────
    // Edit/Delete error branches
    // ─────────────────────────────────────────────────────────────────

    public function testEditRejectsEmptyContent(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Content cannot be empty');
        $this->pp->handleEditMessage(new EditMessageRequest('sess-1', 'm', '   '));
    }

    public function testEditRejectsMissingSession(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Session not found');
        $this->pp->handleEditMessage(new EditMessageRequest('nope', 'm', 'hi'));
    }

    public function testEditRejectsMissingMessage(): void
    {
        $this->storage->createSession($this->session());
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Message not found');
        $this->pp->handleEditMessage(new EditMessageRequest('sess-1', 'missing', 'hi'));
    }

    public function testEditRejectsMessageFromOtherSession(): void
    {
        $this->storage->createSession($this->session());
        $this->storage->createSession($this->session('other', 'v2'));
        $this->storage->saveMessage(new Message(
            id: 'm-foreign',
            sessionId: 'other',
            content: 'x',
            sender: Sender::VISITOR,
            timestamp: new \DateTimeImmutable(),
        ));

        $this->expectException(\InvalidArgumentException::class);
        $this->pp->handleEditMessage(new EditMessageRequest('sess-1', 'm-foreign', 'hi'));
    }

    public function testEditRejectsOperatorMessage(): void
    {
        $this->storage->createSession($this->session());
        $resp = $this->pp->handleMessage(new SendMessageRequest('sess-1', 'op', Sender::OPERATOR));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Unauthorized');
        $this->pp->handleEditMessage(new EditMessageRequest('sess-1', $resp->messageId, 'hi'));
    }

    public function testEditRejectsDeletedMessage(): void
    {
        $this->storage->createSession($this->session());
        $resp = $this->pp->handleMessage(new SendMessageRequest('sess-1', 'orig', Sender::VISITOR));
        $this->pp->handleDeleteMessage(new DeleteMessageRequest('sess-1', $resp->messageId));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Cannot edit deleted message');
        $this->pp->handleEditMessage(new EditMessageRequest('sess-1', $resp->messageId, 'hi'));
    }

    public function testDeleteRejectsMissingSession(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Session not found');
        $this->pp->handleDeleteMessage(new DeleteMessageRequest('nope', 'm'));
    }

    public function testDeleteRejectsMissingMessage(): void
    {
        $this->storage->createSession($this->session());
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Message not found');
        $this->pp->handleDeleteMessage(new DeleteMessageRequest('sess-1', 'missing'));
    }

    public function testDeleteRejectsOperatorMessage(): void
    {
        $this->storage->createSession($this->session());
        $resp = $this->pp->handleMessage(new SendMessageRequest('sess-1', 'op', Sender::OPERATOR));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Unauthorized');
        $this->pp->handleDeleteMessage(new DeleteMessageRequest('sess-1', $resp->messageId));
    }

    // ─────────────────────────────────────────────────────────────────
    // Upload flow
    // ─────────────────────────────────────────────────────────────────

    public function testUploadRequestCreatesPendingAttachment(): void
    {
        $this->storage->createSession($this->session());
        $resp = $this->pp->handleUploadRequest(new UploadRequest(
            sessionId: 'sess-1',
            filename: 'a.png',
            mimeType: 'image/png',
            size: 1000,
        ));

        $this->assertNotEmpty($resp->attachmentId);
        $this->assertStringContainsString($resp->attachmentId, $resp->uploadUrl);
        $this->assertGreaterThan(new \DateTimeImmutable(), $resp->expiresAt);
    }

    public function testUploadRequestRejectsMissingSession(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Session not found');
        $this->pp->handleUploadRequest(new UploadRequest('nope', 'a.png', 'image/png', 10));
    }

    public function testUploadRequestRejectsInvalidMimeType(): void
    {
        $this->storage->createSession($this->session());
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid MIME type');
        $this->pp->handleUploadRequest(new UploadRequest('sess-1', 'evil.exe', 'application/x-msdownload', 10));
    }

    public function testUploadRequestRejectsOversizeFile(): void
    {
        $this->storage->createSession($this->session());
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('File too large');
        $this->pp->handleUploadRequest(new UploadRequest('sess-1', 'big.png', 'image/png', PocketPing::MAX_ATTACHMENT_SIZE + 1));
    }

    public function testUploadRequestRejectsZeroSize(): void
    {
        $this->storage->createSession($this->session());
        $this->expectException(\InvalidArgumentException::class);
        $this->pp->handleUploadRequest(new UploadRequest('sess-1', 'empty.png', 'image/png', 0));
    }

    public function testUploadCompleteMarksReady(): void
    {
        $this->storage->createSession($this->session());
        $up = $this->pp->handleUploadRequest(new UploadRequest('sess-1', 'a.png', 'image/png', 100));
        $att = $this->pp->handleUploadComplete($up->attachmentId);
        $this->assertSame('ready', $att->status->value);
    }

    public function testUploadFailedMarksFailed(): void
    {
        $this->storage->createSession($this->session());
        $up = $this->pp->handleUploadRequest(new UploadRequest('sess-1', 'a.png', 'image/png', 100));
        $att = $this->pp->handleUploadFailed($up->attachmentId);
        $this->assertSame('failed', $att->status->value);
    }

    public function testUploadCompleteRejectsUnknownAttachment(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Attachment not found');
        $this->pp->handleUploadComplete('does-not-exist');
    }

    public function testUploadFailedRejectsUnknownAttachment(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->pp->handleUploadFailed('does-not-exist');
    }

    public function testMessageWithLinkedAttachments(): void
    {
        $this->storage->createSession($this->session());
        $up = $this->pp->handleUploadRequest(new UploadRequest('sess-1', 'a.png', 'image/png', 100));
        $this->pp->handleUploadComplete($up->attachmentId);

        $resp = $this->pp->handleMessage(new SendMessageRequest(
            sessionId: 'sess-1',
            content: 'see attachment',
            sender: Sender::VISITOR,
            attachmentIds: [$up->attachmentId],
        ));

        $stored = $this->storage->getMessage($resp->messageId);
        $this->assertNotNull($stored->attachments);
        $this->assertSame($resp->messageId, $stored->attachments[0]->messageId);
    }

    public function testMessageWithUnknownAttachmentIdIsSkipped(): void
    {
        $this->storage->createSession($this->session());
        $resp = $this->pp->handleMessage(new SendMessageRequest(
            sessionId: 'sess-1',
            content: 'x',
            sender: Sender::VISITOR,
            attachmentIds: ['ghost'],
        ));

        $stored = $this->storage->getMessage($resp->messageId);
        $this->assertNull($stored->attachments);
    }

    // ─────────────────────────────────────────────────────────────────
    // WebSocket: dead-connection cleanup + send_text fallback
    // ─────────────────────────────────────────────────────────────────

    public function testBroadcastCleansUpDeadConnections(): void
    {
        $dead = new class {
            public function send(string $m): void
            {
                throw new \RuntimeException('socket closed');
            }
        };
        $this->pp->registerWebsocket('sess-1', $dead);

        // Broadcast (via emitEvent) should not throw and should drop the dead conn.
        $this->pp->emitEvent('sess-1', 'ping', ['x' => 1]);

        // Second broadcast: still no exception (connection removed).
        $this->pp->emitEvent('sess-1', 'ping2');
        $this->assertTrue(true);
    }

    public function testBroadcastUsesSendTextFallback(): void
    {
        $ws = new class {
            public array $sent = [];
            public function send_text(string $m): void
            {
                $this->sent[] = $m;
            }
        };
        $this->pp->registerWebsocket('sess-1', $ws);
        $this->pp->emitEvent('sess-1', 'evt', ['k' => 'v']);
        $this->assertNotEmpty($ws->sent);
    }

    public function testSetOperatorOnlineBroadcastsPresence(): void
    {
        $ws = new class {
            public array $sent = [];
            public function send(string $m): void
            {
                $this->sent[] = $m;
            }
        };
        $this->pp->registerWebsocket('sess-1', $ws);
        $this->pp->setOperatorOnline(true);
        $this->assertStringContainsString('presence', $ws->sent[0]);
    }

    // ─────────────────────────────────────────────────────────────────
    // Custom events: off handler, wildcard error, onEvent callback error
    // ─────────────────────────────────────────────────────────────────

    public function testOffEventHandlerRemovesHandler(): void
    {
        $count = 0;
        $handler = function () use (&$count): void {
            $count++;
        };
        $this->pp->onEventHandler('e', $handler);
        $this->pp->offEventHandler('e', $handler);

        $this->storage->createSession($this->session());
        $this->pp->handleCustomEvent('sess-1', new CustomEvent(name: 'e'));
        $this->assertSame(0, $count);
    }

    public function testHandleCustomEventUnknownSessionLogsAndReturns(): void
    {
        // No session created; should not throw.
        $this->pp->handleCustomEvent('ghost', new CustomEvent(name: 'e'));
        $this->assertTrue(true);
    }

    public function testHandleCustomEventSwallowsHandlerExceptions(): void
    {
        $this->storage->createSession($this->session());
        $this->pp->onEventHandler('boom', function (): void {
            throw new \RuntimeException('handler failed');
        });
        $this->pp->onEventHandler('*', function (): void {
            throw new \RuntimeException('wildcard failed');
        });
        $pp = new PocketPing(
            storage: $this->storage,
            onEvent: function (): void {
                throw new \RuntimeException('callback failed');
            },
        );
        // Use this->pp for handler/wildcard error paths
        $this->pp->handleCustomEvent('sess-1', new CustomEvent(name: 'boom'));

        // And a fresh pp for the onEvent callback error path
        $pp->handleCustomEvent('sess-1', new CustomEvent(name: 'whatever'));
        $this->assertTrue(true);
    }

    public function testEmitAndBroadcastEvent(): void
    {
        $ws = new class {
            public array $sent = [];
            public function send(string $m): void
            {
                $this->sent[] = $m;
            }
        };
        $this->pp->registerWebsocket('sess-1', $ws);
        $this->pp->broadcastEvent('global', ['v' => 1]);
        $this->assertNotEmpty($ws->sent);
        $this->assertStringContainsString('global', $ws->sent[0]);
    }

    // ─────────────────────────────────────────────────────────────────
    // Version helpers
    // ─────────────────────────────────────────────────────────────────

    public function testGetVersionHeaders(): void
    {
        $pp = new PocketPing(
            storage: $this->storage,
            minWidgetVersion: '0.2.0',
            latestWidgetVersion: '0.5.0',
        );
        $check = $pp->checkWidgetVersion('0.1.0');
        $headers = $pp->getVersionHeaders($check);
        $this->assertSame('unsupported', $headers['X-PocketPing-Version-Status']);
        $this->assertSame('0.2.0', $headers['X-PocketPing-Min-Version']);
        $this->assertSame('0.5.0', $headers['X-PocketPing-Latest-Version']);
        $this->assertArrayHasKey('X-PocketPing-Version-Message', $headers);
    }

    public function testSendVersionWarningBroadcasts(): void
    {
        $ws = new class {
            public array $sent = [];
            public function send(string $m): void
            {
                $this->sent[] = $m;
            }
        };
        $pp = new PocketPing(storage: $this->storage, minWidgetVersion: '1.0.0');
        $pp->registerWebsocket('sess-1', $ws);

        $check = $pp->checkWidgetVersion('0.1.0');
        $pp->sendVersionWarning('sess-1', $check, '0.1.0');

        $this->assertNotEmpty($ws->sent);
        $this->assertStringContainsString('version_warning', $ws->sent[0]);
    }

    public function testGetVersionChecker(): void
    {
        $this->assertNotNull($this->pp->getVersionChecker());
    }

    // ─────────────────────────────────────────────────────────────────
    // Misc getters / accessors
    // ─────────────────────────────────────────────────────────────────

    public function testGetStorageAndGetSession(): void
    {
        $this->storage->createSession($this->session());
        $this->assertSame($this->storage, $this->pp->getStorage());
        $this->assertNotNull($this->pp->getSession('sess-1'));
        $this->assertNull($this->pp->getSession('ghost'));
    }

    public function testGetAiProviderNullByDefault(): void
    {
        $this->assertNull($this->pp->getAiProvider());
    }

    public function testGetUaFilterNullByDefault(): void
    {
        $this->assertNull($this->pp->getUaFilter());
    }

    public function testGetClientUserAgentFromServer(): void
    {
        $_SERVER['HTTP_USER_AGENT'] = 'ServerAgent/2.0';
        $this->assertSame('ServerAgent/2.0', $this->pp->getClientUserAgent());
        unset($_SERVER['HTTP_USER_AGENT']);
    }

    public function testGetClientUserAgentMissingHeaderReturnsNull(): void
    {
        $this->assertNull($this->pp->getClientUserAgent(['X-Other' => 'v']));
    }

    public function testGetClientIpFromHeaders(): void
    {
        $ip = $this->pp->getClientIp(['X-Forwarded-For' => '1.2.3.4, 5.6.7.8']);
        $this->assertSame('1.2.3.4', $ip);
    }

    public function testCheckIpFilterWithLogging(): void
    {
        $pp = new PocketPing(
            storage: $this->storage,
            ipFilter: ['enabled' => true, 'mode' => 'blocklist', 'blocklist' => ['10.0.0.0/8']],
        );
        $result = $pp->checkIpFilterWithLogging('10.1.2.3');
        $this->assertFalse($result->allowed);
    }
}

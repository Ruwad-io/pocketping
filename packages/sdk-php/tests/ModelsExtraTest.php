<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Models\Attachment;
use PocketPing\Models\AttachmentStatus;
use PocketPing\Models\BridgeMessageIds;
use PocketPing\Models\BridgeMessageResult;
use PocketPing\Models\ConnectRequest;
use PocketPing\Models\ConnectResponse;
use PocketPing\Models\CustomEvent;
use PocketPing\Models\DeleteMessageRequest;
use PocketPing\Models\DeleteMessageResponse;
use PocketPing\Models\EditMessageRequest;
use PocketPing\Models\EditMessageResponse;
use PocketPing\Models\IdentifyRequest;
use PocketPing\Models\IdentifyResponse;
use PocketPing\Models\Message;
use PocketPing\Models\MessageStatus;
use PocketPing\Models\PresenceResponse;
use PocketPing\Models\ReadRequest;
use PocketPing\Models\ReadResponse;
use PocketPing\Models\Sender;
use PocketPing\Models\SendMessageRequest;
use PocketPing\Models\SendMessageResponse;
use PocketPing\Models\Session;
use PocketPing\Models\SessionMetadata;
use PocketPing\Models\TrackedElement;
use PocketPing\Models\TriggerOptions;
use PocketPing\Models\UploadRequest;
use PocketPing\Models\UploadResponse;
use PocketPing\Models\UploadSource;
use PocketPing\Models\UserIdentity;
use PocketPing\Models\VersionWarning;
use PocketPing\Models\WebSocketEvent;

/**
 * Round-trip and edge-case coverage for the data models'
 * fromArray / toArray / jsonSerialize and helper methods.
 */
class ModelsExtraTest extends TestCase
{
    // ── ConnectRequest ──────────────────────────────────────────────
    public function testConnectRequestRoundTrip(): void
    {
        $req = new ConnectRequest(
            visitorId: 'v-1',
            sessionId: 's-1',
            metadata: new SessionMetadata(url: 'https://x'),
            identity: new UserIdentity(id: 'u-1'),
        );
        $arr = $req->toArray();
        $this->assertSame('v-1', $arr['visitorId']);
        $this->assertSame('s-1', $arr['sessionId']);
        $this->assertArrayHasKey('metadata', $arr);
        $this->assertArrayHasKey('identity', $arr);
        $this->assertJson(json_encode($req));
    }

    public function testConnectRequestRequiresVisitorId(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        ConnectRequest::fromArray([]);
    }

    // ── ConnectResponse ─────────────────────────────────────────────
    public function testConnectResponseToArray(): void
    {
        $msg = new Message('m', 's', 'hi', Sender::VISITOR, new \DateTimeImmutable());
        $resp = new ConnectResponse(
            sessionId: 's',
            visitorId: 'v',
            operatorOnline: true,
            welcomeMessage: 'Hello',
            messages: [$msg],
            trackedElements: [new TrackedElement('#a', 'a')],
        );
        $arr = $resp->toArray();
        $this->assertSame('Hello', $arr['welcomeMessage']);
        $this->assertCount(1, $arr['messages']);
        $this->assertCount(1, $arr['trackedElements']);
        $this->assertJson(json_encode($resp));
    }

    // ── CustomEvent ─────────────────────────────────────────────────
    public function testCustomEventToArrayAndJson(): void
    {
        $e = new CustomEvent('purchase', ['amount' => 99], new \DateTimeImmutable(), 's-1');
        $arr = $e->toArray();
        $this->assertSame('purchase', $arr['name']);
        $this->assertSame(99, $arr['data']['amount']);
        $this->assertSame('s-1', $arr['sessionId']);
        $this->assertJson(json_encode($e));
    }

    public function testCustomEventRequiresName(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        CustomEvent::fromArray([]);
    }

    public function testCustomEventFromArrayWithDateTimeObject(): void
    {
        $e = CustomEvent::fromArray(['name' => 'x', 'timestamp' => new \DateTimeImmutable('2020-01-01')]);
        $this->assertSame('2020', $e->timestamp->format('Y'));
    }

    // ── DeleteMessage Request/Response ──────────────────────────────
    public function testDeleteMessageRequestRoundTrip(): void
    {
        $req = DeleteMessageRequest::fromArray(['sessionId' => 's', 'messageId' => 'm']);
        $this->assertSame('s', $req->sessionId);
        $this->assertSame(['sessionId' => 's', 'messageId' => 'm'], $req->toArray());
        $this->assertJson(json_encode($req));
    }

    public function testDeleteMessageRequestRequiresFields(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        DeleteMessageRequest::fromArray(['sessionId' => 's']);
    }

    public function testDeleteMessageResponseRoundTrip(): void
    {
        $resp = DeleteMessageResponse::fromArray(['deleted' => true]);
        $this->assertTrue($resp->deleted);
        $this->assertSame(['deleted' => true], $resp->toArray());
        $this->assertJson(json_encode($resp));
        $this->assertFalse(DeleteMessageResponse::fromArray([])->deleted);
    }

    // ── EditMessage Request/Response ────────────────────────────────
    public function testEditMessageRequestRoundTrip(): void
    {
        $req = EditMessageRequest::fromArray(['sessionId' => 's', 'messageId' => 'm', 'content' => 'new']);
        $this->assertSame('new', $req->content);
        $this->assertSame(['sessionId' => 's', 'messageId' => 'm', 'content' => 'new'], $req->toArray());
        $this->assertJson(json_encode($req));
    }

    public function testEditMessageRequestRequiresContent(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        EditMessageRequest::fromArray(['sessionId' => 's', 'messageId' => 'm']);
    }

    public function testEditMessageRequestEnforcesMaxLength(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new EditMessageRequest('s', 'm', str_repeat('a', 4001));
    }

    public function testEditMessageResponseAccessors(): void
    {
        $resp = new EditMessageResponse([
            'id' => 'm-1',
            'content' => 'updated',
            'editedAt' => '2024-01-01T00:00:00+00:00',
        ]);
        $this->assertSame('m-1', $resp->getMessageId());
        $this->assertSame('updated', $resp->getContent());
        $this->assertSame('2024', $resp->getEditedAt()->format('Y'));
        $this->assertArrayHasKey('message', $resp->toArray());
        $this->assertJson(json_encode($resp));

        $fromArray = EditMessageResponse::fromArray(['message' => ['id' => 'm', 'content' => 'c', 'editedAt' => '2024-01-01T00:00:00+00:00']]);
        $this->assertSame('m', $fromArray->getMessageId());
    }

    public function testEditMessageResponseRequiresMessage(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        EditMessageResponse::fromArray([]);
    }

    // ── Identify Request/Response ───────────────────────────────────
    public function testIdentifyRequestRoundTrip(): void
    {
        $req = IdentifyRequest::fromArray(['sessionId' => 's', 'identity' => ['id' => 'u-1', 'email' => 'a@b.c']]);
        $this->assertSame('u-1', $req->identity->id);
        $arr = $req->toArray();
        $this->assertSame('s', $arr['sessionId']);
        $this->assertSame('u-1', $arr['identity']['id']);
        $this->assertJson(json_encode($req));
    }

    public function testIdentifyRequestRequiresIdentity(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        IdentifyRequest::fromArray(['sessionId' => 's']);
    }

    public function testIdentifyResponseRoundTrip(): void
    {
        $resp = new IdentifyResponse(ok: true);
        $this->assertSame(['ok' => true], $resp->toArray());
        $this->assertJson(json_encode($resp));
    }

    // ── ReadRequest/Response ────────────────────────────────────────
    public function testReadRequestRoundTrip(): void
    {
        $req = ReadRequest::fromArray(['sessionId' => 's', 'messageIds' => ['a', 'b'], 'status' => 'delivered']);
        $this->assertSame(MessageStatus::DELIVERED, $req->status);
        $this->assertSame(['a', 'b'], $req->messageIds);
        $arr = $req->toArray();
        $this->assertSame('delivered', $arr['status']);
        $this->assertJson(json_encode($req));
    }

    public function testReadRequestDefaultsToRead(): void
    {
        $req = ReadRequest::fromArray(['sessionId' => 's', 'messageIds' => ['a']]);
        $this->assertSame(MessageStatus::READ, $req->status);
    }

    public function testReadRequestRequiresMessageIds(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        ReadRequest::fromArray(['sessionId' => 's']);
    }

    public function testReadResponseRoundTrip(): void
    {
        $resp = new ReadResponse(updated: 3);
        $this->assertSame(['updated' => 3], $resp->toArray());
        $this->assertJson(json_encode($resp));
    }

    // ── SendMessage Request/Response ────────────────────────────────
    public function testSendMessageRequestRoundTripWithAttachments(): void
    {
        $req = SendMessageRequest::fromArray([
            'sessionId' => 's',
            'content' => 'hi',
            'sender' => 'visitor',
            'replyTo' => 'm-0',
            'attachmentIds' => ['a-1'],
            'attachments' => [['id' => 'a-1', 'filename' => 'f', 'mimeType' => 'image/png', 'size' => 1, 'url' => 'u']],
        ]);
        $this->assertSame('m-0', $req->replyTo);
        $arr = $req->toArray();
        $this->assertSame(['a-1'], $arr['attachmentIds']);
        $this->assertCount(1, $arr['attachments']);
        $this->assertJson(json_encode($req));
    }

    public function testSendMessageRequestRequiresSender(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        SendMessageRequest::fromArray(['sessionId' => 's', 'content' => 'x']);
    }

    public function testSendMessageResponseRoundTrip(): void
    {
        $ts = new \DateTimeImmutable();
        $resp = new SendMessageResponse('m-1', $ts);
        $arr = $resp->toArray();
        $this->assertSame('m-1', $arr['messageId']);
        $this->assertJson(json_encode($resp));
    }

    // ── PresenceResponse ────────────────────────────────────────────
    public function testPresenceResponseToArrayWithOperators(): void
    {
        $resp = new PresenceResponse(
            online: true,
            operators: [['id' => 'o1', 'name' => 'Op']],
            aiEnabled: true,
            aiActiveAfter: 30,
        );
        $arr = $resp->toArray();
        $this->assertTrue($arr['online']);
        $this->assertSame(30, $arr['aiActiveAfter']);
        $this->assertArrayHasKey('operators', $arr);
        $this->assertJson(json_encode($resp));
    }

    // ── Upload Request/Response ─────────────────────────────────────
    public function testUploadRequestRoundTrip(): void
    {
        $req = UploadRequest::fromArray(['sessionId' => 's', 'filename' => 'f.png', 'mimeType' => 'image/png', 'size' => 10]);
        $this->assertSame(10, $req->size);
        $arr = $req->toArray();
        $this->assertSame('f.png', $arr['filename']);
        $this->assertJson(json_encode($req));
    }

    public function testUploadRequestRequiresSize(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        UploadRequest::fromArray(['sessionId' => 's', 'filename' => 'f', 'mimeType' => 'image/png']);
    }

    public function testUploadResponseRoundTrip(): void
    {
        $resp = new UploadResponse('a-1', 'https://up/a-1', new \DateTimeImmutable());
        $arr = $resp->toArray();
        $this->assertSame('a-1', $arr['attachmentId']);
        $this->assertArrayHasKey('expiresAt', $arr);
        $this->assertJson(json_encode($resp));
    }

    // ── TrackedElement / TriggerOptions ─────────────────────────────
    public function testTrackedElementToArrayWithData(): void
    {
        $el = new TrackedElement('#a', 'click_a', 'submit', 'Need help?', ['k' => 'v']);
        $arr = $el->toArray();
        $this->assertSame('submit', $arr['event']);
        $this->assertSame('Need help?', $arr['widgetMessage']);
        $this->assertSame(['k' => 'v'], $arr['data']);
        $this->assertJson(json_encode($el));
    }

    public function testTrackedElementRequiresSelectorAndName(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        TrackedElement::fromArray(['name' => 'x']);
    }

    public function testTriggerOptionsRoundTrip(): void
    {
        $opt = TriggerOptions::fromArray(['widgetMessage' => 'Open me']);
        $this->assertSame('Open me', $opt->widgetMessage);
        $this->assertSame(['widgetMessage' => 'Open me'], $opt->toArray());
        $this->assertJson(json_encode($opt));

        $empty = TriggerOptions::fromArray([]);
        $this->assertSame([], $empty->toArray());
    }

    // ── BridgeMessageIds ────────────────────────────────────────────
    public function testBridgeMessageIdsRoundTripAndMerge(): void
    {
        $ids = BridgeMessageIds::fromArray([
            'telegramMessageId' => 5,
            'discordMessageId' => 'd-1',
            'slackMessageTs' => '1.2',
        ]);
        $arr = $ids->toArray();
        $this->assertSame(5, $arr['telegramMessageId']);
        $this->assertSame('d-1', $arr['discordMessageId']);
        $this->assertSame('1.2', $arr['slackMessageTs']);
        $this->assertJson(json_encode($ids));

        $merged = (new BridgeMessageIds(telegramMessageId: 1))
            ->mergeWith(new BridgeMessageIds(discordMessageId: 'd-2'));
        $this->assertSame(1, $merged->telegramMessageId);
        $this->assertSame('d-2', $merged->discordMessageId);
    }

    // ── BridgeMessageResult ─────────────────────────────────────────
    public function testBridgeMessageResultSuccessAndFailure(): void
    {
        $ok = BridgeMessageResult::success('123');
        $this->assertTrue($ok->success);
        $this->assertSame('123', $ok->platformMessageId);
        $okArr = $ok->toArray();
        $this->assertArrayHasKey('platformMessageId', $okArr);
        $this->assertJson(json_encode($ok));

        $fail = BridgeMessageResult::failure('boom');
        $this->assertFalse($fail->success);
        $failArr = $fail->toArray();
        $this->assertSame('boom', $failArr['error']);
    }

    // ── VersionWarning ──────────────────────────────────────────────
    public function testVersionWarningToArray(): void
    {
        $w = new VersionWarning(
            severity: 'warning',
            message: 'upgrade',
            currentVersion: '0.1.0',
            minVersion: '0.2.0',
            latestVersion: '0.5.0',
            canContinue: false,
            upgradeUrl: 'https://up',
        );
        $arr = $w->toArray();
        $this->assertSame('warning', $arr['severity']);
        $this->assertSame('0.2.0', $arr['minVersion']);
        $this->assertSame('0.5.0', $arr['latestVersion']);
        $this->assertSame('https://up', $arr['upgradeUrl']);
        $this->assertFalse($arr['canContinue']);
        $this->assertJson(json_encode($w));
    }

    // ── Attachment ──────────────────────────────────────────────────
    public function testAttachmentRoundTripWithAllFields(): void
    {
        $att = Attachment::fromArray([
            'id' => 'a-1',
            'filename' => 'f.png',
            'mimeType' => 'image/png',
            'size' => 100,
            'url' => 'https://u',
            'messageId' => 'm-1',
            'thumbnailUrl' => 'https://thumb',
            'status' => 'pending',
            'createdAt' => '2024-01-01T00:00:00+00:00',
            'uploadedFrom' => 'telegram',
            'bridgeFileId' => 'bf-1',
        ]);
        $arr = $att->toArray();
        $this->assertSame('a-1', $arr['id']);
        $this->assertSame('m-1', $arr['messageId']);
        $this->assertSame('https://thumb', $arr['thumbnailUrl']);
        $this->assertSame('pending', $arr['status']);
        $this->assertSame('telegram', $arr['uploadedFrom']);
        $this->assertSame('bf-1', $arr['bridgeFileId']);
        $this->assertJson(json_encode($att));
    }

    public function testAttachmentRequiresFields(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Attachment::fromArray(['id' => 'a']);
    }

    public function testAttachmentWithMessageIdAndStatus(): void
    {
        $att = new Attachment('a', 'f', 'image/png', 1, 'u', status: AttachmentStatus::PENDING);
        $linked = $att->withMessageId('m-9');
        $this->assertSame('m-9', $linked->messageId);
        $this->assertNull($att->messageId);

        $ready = $att->withStatus(AttachmentStatus::READY);
        $this->assertSame(AttachmentStatus::READY, $ready->status);
        $this->assertSame(AttachmentStatus::PENDING, $att->status);
    }

    public function testUploadSourceEnum(): void
    {
        $this->assertSame('widget', UploadSource::WIDGET->value);
        $this->assertSame(UploadSource::SLACK, UploadSource::from('slack'));
    }

    // ── Message edge: deletedAt/editedAt from array ─────────────────
    public function testMessageFromArrayWithTimestamps(): void
    {
        $msg = Message::fromArray([
            'id' => 'm',
            'sessionId' => 's',
            'content' => 'c',
            'sender' => 'operator',
            'timestamp' => '2024-01-01T00:00:00+00:00',
            'deliveredAt' => '2024-01-01T00:01:00+00:00',
            'readAt' => '2024-01-01T00:02:00+00:00',
            'editedAt' => '2024-01-01T00:03:00+00:00',
            'deletedAt' => '2024-01-01T00:04:00+00:00',
            'replyTo' => 'm-0',
            'metadata' => ['x' => 1],
            'attachments' => [['id' => 'a', 'filename' => 'f', 'mimeType' => 'image/png', 'size' => 1, 'url' => 'u']],
        ]);
        $arr = $msg->toArray();
        $this->assertArrayHasKey('deliveredAt', $arr);
        $this->assertArrayHasKey('readAt', $arr);
        $this->assertArrayHasKey('editedAt', $arr);
        $this->assertArrayHasKey('deletedAt', $arr);
        $this->assertSame('m-0', $arr['replyTo']);
        $this->assertArrayHasKey('metadata', $arr);
        $this->assertCount(1, $arr['attachments']);
    }

    public function testMessageWithDeliveredAndReadHelpers(): void
    {
        $msg = new Message('m', 's', 'c', Sender::VISITOR, new \DateTimeImmutable());
        $delivered = $msg->withDeliveredAt(new \DateTimeImmutable());
        $read = $msg->withReadAt(new \DateTimeImmutable());
        $this->assertNotNull($delivered->deliveredAt);
        $this->assertNotNull($read->readAt);
        $this->assertNull($msg->deliveredAt);
    }

    public function testMessageRequiresRequiredFields(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Message::fromArray(['id' => 'm']);
    }

    // ── Session helpers ─────────────────────────────────────────────
    public function testSessionWithHelpers(): void
    {
        $s = new Session('s', 'v', new \DateTimeImmutable(), new \DateTimeImmutable());
        $touched = $s->touchActivity();
        $this->assertGreaterThanOrEqual($s->lastActivity, $touched->lastActivity);

        $withMeta = $s->withMetadata(new SessionMetadata(url: 'https://x'));
        $this->assertSame('https://x', $withMeta->metadata->url);

        $withId = $s->withIdentity(new UserIdentity(id: 'u'));
        $this->assertSame('u', $withId->identity->id);

        $withAi = $s->withAiActive(true);
        $this->assertTrue($withAi->aiActive);
        $this->assertFalse($s->aiActive);
    }

    public function testSessionFromArrayWithPhoneAndNested(): void
    {
        $s = Session::fromArray([
            'id' => 's',
            'visitorId' => 'v',
            'userPhone' => '+33612345678',
            'userPhoneCountry' => 'FR',
            'metadata' => ['url' => 'https://x'],
            'identity' => ['id' => 'u-1'],
        ]);
        $this->assertSame('+33612345678', $s->userPhone);
        $this->assertSame('FR', $s->userPhoneCountry);
        $this->assertSame('https://x', $s->metadata->url);
        $this->assertSame('u-1', $s->identity->id);
        $this->assertJson(json_encode($s));
    }

    // ── WebSocketEvent ──────────────────────────────────────────────
    public function testWebSocketEventToArrayAndJsonSerialize(): void
    {
        $e = new WebSocketEvent('typing', ['isTyping' => true]);
        $this->assertSame('typing', $e->toArray()['type']);
        $this->assertJson(json_encode($e));
    }
}

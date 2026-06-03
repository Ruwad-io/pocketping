<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Bridges\AbstractBridge;
use PocketPing\Models\ConnectRequest;
use PocketPing\Models\CsatRequest;
use PocketPing\Models\Sender;
use PocketPing\Models\SendMessageRequest;
use PocketPing\Models\Session;
use PocketPing\PocketPing;
use PocketPing\Storage\MemoryStorage;

/**
 * Bridge that records plain notifications (the CSAT one-liner channel).
 */
final class NotifyBridge extends AbstractBridge
{
    /** @var array<array{session: Session, message: string}> */
    public array $disconnectCalls = [];

    public function getName(): string
    {
        return 'telegram';
    }

    public function notifyDisconnect(Session $session, string $message): void
    {
        $this->disconnectCalls[] = ['session' => $session, 'message' => $message];
    }
}

/**
 * Websocket double that records every payload it is sent.
 */
final class RecordingSocket
{
    /** @var string[] */
    public array $sent = [];

    public function send(string $message): void
    {
        $this->sent[] = $message;
    }
}

class CsatTest extends TestCase
{
    private NotifyBridge $bridge;
    private PocketPing $pp;

    protected function setUp(): void
    {
        $this->bridge = new NotifyBridge();
        $this->pp = new PocketPing(bridges: [$this->bridge]);
    }

    private function newSession(): string
    {
        return $this->pp->handleConnect(new ConnectRequest(visitorId: 'v1'))->sessionId;
    }

    public function testRequestCsatSetsPendingAndBroadcastsCsatRequest(): void
    {
        $sessionId = $this->newSession();
        $ws = new RecordingSocket();
        $this->pp->registerWebsocket($sessionId, $ws);

        $result = $this->pp->requestCsat($sessionId);
        $this->assertSame(['ok' => true], $result);

        $session = $this->pp->getSession($sessionId);
        $this->assertNotNull($session?->csat);
        $this->assertTrue($session->csat->pending);
        $this->assertInstanceOf(\DateTimeImmutable::class, $session->csat->requestedAt);

        $this->assertNotEmpty($ws->sent);
        $this->assertStringContainsString('csat_request', $ws->sent[0]);
    }

    public function testHandleCsatStoresScoreClearsPendingNotifiesBridgeRunsOnCsat(): void
    {
        /** @var array{0: Session, 1: array{score: int, comment: ?string}}|null $captured */
        $captured = null;
        $this->pp = new PocketPing(
            bridges: [$this->bridge],
            onCsat: function (Session $session, array $rating) use (&$captured): void {
                $captured = [$session, $rating];
            },
        );

        $sessionId = $this->newSession();
        $this->pp->requestCsat($sessionId);

        $res = $this->pp->handleCsat(new CsatRequest(sessionId: $sessionId, score: 5, comment: '  great  '));
        $this->assertSame(['ok' => true], $res->toArray());

        $session = $this->pp->getSession($sessionId);
        $this->assertSame(5, $session?->csat?->score);
        $this->assertSame('great', $session->csat->comment);
        $this->assertFalse($session->csat->pending);
        $this->assertInstanceOf(\DateTimeImmutable::class, $session->csat->respondedAt);

        $last = $this->bridge->disconnectCalls[count($this->bridge->disconnectCalls) - 1] ?? null;
        $this->assertSame('⭐ 😍 5/5 — "great"', $last['message'] ?? null);

        $this->assertNotNull($captured);
        $this->assertSame(['score' => 5, 'comment' => 'great'], $captured[1]);
    }

    public function testHandleCsatAcceptsArrayBody(): void
    {
        $sessionId = $this->newSession();

        $res = $this->pp->handleCsat(['sessionId' => $sessionId, 'score' => 3]);
        $this->assertSame(['ok' => true], $res->toArray());

        $session = $this->pp->getSession($sessionId);
        $this->assertSame(3, $session?->csat?->score);
        $this->assertNull($session->csat->comment);
    }

    public function testHandleCsatRejectsOutOfRangeScore(): void
    {
        $sessionId = $this->newSession();

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/1-5/');
        $this->pp->handleCsat(new CsatRequest(sessionId: $sessionId, score: 0));
    }

    public function testHandleCsatRejectsScoreAboveRange(): void
    {
        $sessionId = $this->newSession();

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/1-5/');
        $this->pp->handleCsat(new CsatRequest(sessionId: $sessionId, score: 6));
    }

    public function testHandleCsatRejectsFractionalScore(): void
    {
        $sessionId = $this->newSession();

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/1-5/');
        // 3.9 must be rejected outright, not silently truncated to 3.
        $this->pp->handleCsat(['sessionId' => $sessionId, 'score' => 3.9]);
    }

    public function testHandleCsatRejectsNonNumericScore(): void
    {
        $sessionId = $this->newSession();

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/1-5/');
        $this->pp->handleCsat(['sessionId' => $sessionId, 'score' => 'good']);
    }

    public function testHandleCsatIsIdempotentOnceRated(): void
    {
        $sessionId = $this->newSession();

        $this->pp->handleCsat(new CsatRequest(sessionId: $sessionId, score: 4));
        $second = $this->pp->handleCsat(new CsatRequest(sessionId: $sessionId, score: 1));

        $this->assertSame(['ok' => true, 'alreadyRated' => true], $second->toArray());

        $session = $this->pp->getSession($sessionId);
        $this->assertSame(4, $session?->csat?->score); // unchanged
    }

    public function testHandleCsatThrowsWhenSessionMissing(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Session not found');
        $this->pp->handleCsat(new CsatRequest(sessionId: 'nope', score: 3));
    }

    public function testRequestCsatThrowsWhenSessionMissing(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Session not found');
        $this->pp->requestCsat('nope');
    }

    public function testHandleCsatFiresSignedWebhook(): void
    {
        $http = new MockHttpClient();
        $this->pp = new PocketPing(
            webhookUrl: 'https://example.com/hook',
            webhookSecret: 'topsecret',
            httpClient: $http,
        );

        $sessionId = $this->newSession();
        $this->pp->handleCsat(new CsatRequest(sessionId: $sessionId, score: 5, comment: 'nice'));

        $req = $http->getLastRequest();
        $this->assertNotNull($req);
        $this->assertSame('POST', $req['method']);
        $this->assertSame('https://example.com/hook', $req['url']);
        $this->assertSame('csat_submitted', $req['data']['type']);
        $this->assertSame($sessionId, $req['data']['data']['sessionId']);
        $this->assertSame(5, $req['data']['data']['score']);
        $this->assertSame('nice', $req['data']['data']['comment']);
        $this->assertArrayHasKey('respondedAt', $req['data']['data']);
        $this->assertArrayHasKey('sentAt', $req['data']);

        // Signature is sha256=HMAC over the JSON-encoded payload.
        $this->assertArrayHasKey('X-PocketPing-Signature', $req['headers']);
        $body = json_encode($req['data'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $expected = 'sha256=' . hash_hmac('sha256', (string) $body, 'topsecret');
        $this->assertSame($expected, $req['headers']['X-PocketPing-Signature']);
    }

    public function testHandleCsatSkipsWebhookWhenNoUrlConfigured(): void
    {
        $http = new MockHttpClient();
        $this->pp = new PocketPing(httpClient: $http);

        $sessionId = $this->newSession();
        $this->pp->handleCsat(new CsatRequest(sessionId: $sessionId, score: 4));

        $this->assertEmpty($http->requests);
    }

    // ─────────────────────────────────────────────────────────────────
    // getStats
    // ─────────────────────────────────────────────────────────────────

    public function testGetStatsComputesConversationsResponseRateAndCsat(): void
    {
        $pp = new PocketPing();

        $a = $pp->handleConnect(new ConnectRequest(visitorId: 'va'))->sessionId;
        $b = $pp->handleConnect(new ConnectRequest(visitorId: 'vb'))->sessionId;

        // Session A: visitor message + operator reply + 5-star rating.
        $pp->handleMessage(new SendMessageRequest(sessionId: $a, content: 'hi', sender: Sender::VISITOR));
        $pp->sendOperatorMessage($a, 'hello!');
        $pp->handleCsat(new CsatRequest(sessionId: $a, score: 5));

        // Session B: visitor message only (unanswered).
        $pp->handleMessage(new SendMessageRequest(sessionId: $b, content: 'anyone?', sender: Sender::VISITOR));

        $stats = $pp->getStats();

        $this->assertSame(2, $stats['conversations']);
        $this->assertSame(0.5, $stats['responseRate']);
        $this->assertSame(1, $stats['unansweredNow']);
        $this->assertEquals(['percent' => 1, 'average' => 5, 'responses' => 1], $stats['csat']);
        $this->assertCount(7, $stats['conversationsSparkline']);
    }

    public function testGetStatsThrowsWhenStorageCannotListSessions(): void
    {
        $storage = new class implements \PocketPing\Storage\StorageInterface {
            public function createSession(Session $session): void
            {
            }

            public function getSession(string $sessionId): ?Session
            {
                return null;
            }

            public function updateSession(Session $session): void
            {
            }

            public function deleteSession(string $sessionId): void
            {
            }

            public function saveMessage(\PocketPing\Models\Message $message): void
            {
            }

            public function getMessages(string $sessionId, ?string $after = null, int $limit = 50): array
            {
                return [];
            }

            public function getMessage(string $messageId): ?\PocketPing\Models\Message
            {
                return null;
            }

            public function cleanupOldSessions(\DateTimeInterface $olderThan): int
            {
                return 0;
            }

            public function getSessionByVisitorId(string $visitorId): ?Session
            {
                return null;
            }
        };

        $pp = new PocketPing(storage: $storage);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/listSessions/');
        $pp->getStats();
    }

    public function testGetStatsRespectsExplicitWindow(): void
    {
        $storage = new MemoryStorage();
        $pp = new PocketPing(storage: $storage);

        // A session created 10 days ago should fall outside a "last 7 days" default window.
        $old = new Session(
            id: 'old',
            visitorId: 'vo',
            createdAt: new \DateTimeImmutable('-10 days'),
            lastActivity: new \DateTimeImmutable('-10 days'),
        );
        $storage->createSession($old);

        $recent = $pp->handleConnect(new ConnectRequest(visitorId: 'vr'))->sessionId;
        $this->assertNotEmpty($recent);

        $stats = $pp->getStats();
        $this->assertSame(1, $stats['conversations']); // only the recent one
    }
}

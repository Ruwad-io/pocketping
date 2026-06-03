<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Models\Message;
use PocketPing\Models\Sender;
use PocketPing\Models\Session;
use PocketPing\Models\SessionCsat;
use PocketPing\Stats\Stats;

class StatsTest extends TestCase
{
    private function dt(string $iso): \DateTimeImmutable
    {
        return new \DateTimeImmutable($iso);
    }

    private function session(string $id, string $createdAt, ?SessionCsat $csat = null): Session
    {
        $created = $this->dt($createdAt);

        return new Session(
            id: $id,
            visitorId: 'v-' . $id,
            createdAt: $created,
            lastActivity: $created,
            csat: $csat,
        );
    }

    private function message(string $id, string $sessionId, Sender $sender, string $timestamp): Message
    {
        return new Message(
            id: $id,
            sessionId: $sessionId,
            content: 'hi',
            sender: $sender,
            timestamp: $this->dt($timestamp),
        );
    }

    public function testMessagesOutsideWindowAreExcluded(): void
    {
        $from = $this->dt('2026-06-01T00:00:00+00:00');
        $to = $this->dt('2026-06-02T00:00:00+00:00');

        // Session created in-window, but with messages on both sides of it.
        $session = $this->session('s1', '2026-06-01T10:00:00+00:00');
        $messages = [
            // before window — excluded
            $this->message('m0', 's1', Sender::VISITOR, '2026-05-30T10:00:00+00:00'),
            // in window — counted
            $this->message('m1', 's1', Sender::VISITOR, '2026-06-01T10:00:00+00:00'),
            $this->message('m2', 's1', Sender::OPERATOR, '2026-06-01T10:05:00+00:00'),
            // at the inclusive boundary — counted
            $this->message('m3', 's1', Sender::VISITOR, '2026-06-02T00:00:00+00:00'),
            // after window — excluded
            $this->message('m4', 's1', Sender::OPERATOR, '2026-06-05T10:00:00+00:00'),
        ];

        $stats = Stats::compute([['session' => $session, 'messages' => $messages]], $from, $to);

        $this->assertSame(1, $stats['conversations']);
        // Only the 3 in-window (inclusive) messages, not all 5.
        $this->assertSame(3, $stats['messages']);
    }

    public function testRatingSubmittedOutsideWindowExcludedFromResponses(): void
    {
        $from = $this->dt('2026-06-01T00:00:00+00:00');
        $to = $this->dt('2026-06-02T00:00:00+00:00');

        // Conversation created in-window but rated *after* the window closed.
        $ratedLate = $this->session('s1', '2026-06-01T10:00:00+00:00', new SessionCsat(
            pending: false,
            score: 5,
            respondedAt: $this->dt('2026-06-10T10:00:00+00:00'),
        ));

        // Conversation created in-window and rated in-window.
        $ratedInWindow = $this->session('s2', '2026-06-01T11:00:00+00:00', new SessionCsat(
            pending: false,
            score: 4,
            respondedAt: $this->dt('2026-06-01T12:00:00+00:00'),
        ));

        // Conversation with a score but no respondedAt (never actually submitted).
        $noRespondedAt = $this->session('s3', '2026-06-01T12:00:00+00:00', new SessionCsat(
            pending: true,
            score: 2,
            respondedAt: null,
        ));

        $stats = Stats::compute([
            ['session' => $ratedLate, 'messages' => []],
            ['session' => $ratedInWindow, 'messages' => []],
            ['session' => $noRespondedAt, 'messages' => []],
        ], $from, $to);

        // Only the single in-window rating counts.
        $this->assertSame(1, $stats['csat']['responses']);
        $this->assertEqualsWithDelta(4.0, $stats['csat']['average'], 1e-9);
        $this->assertEqualsWithDelta(1.0, $stats['csat']['percent'], 1e-9);
    }

    public function testRatingSubmittedAtBoundaryIsIncluded(): void
    {
        $from = $this->dt('2026-06-01T00:00:00+00:00');
        $to = $this->dt('2026-06-02T00:00:00+00:00');

        $session = $this->session('s1', '2026-06-01T10:00:00+00:00', new SessionCsat(
            pending: false,
            score: 5,
            respondedAt: $to, // exactly on the inclusive upper bound
        ));

        $stats = Stats::compute([['session' => $session, 'messages' => []]], $from, $to);

        $this->assertSame(1, $stats['csat']['responses']);
    }
}

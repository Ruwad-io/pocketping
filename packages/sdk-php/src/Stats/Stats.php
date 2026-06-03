<?php

declare(strict_types=1);

namespace PocketPing\Stats;

use PocketPing\Models\Message;
use PocketPing\Models\Sender;
use PocketPing\Models\Session;

/**
 * Mini support stats for self-hosted SDK deployments — the same shape the SaaS
 * `/api/v1/stats` returns (minus the per-project breakdown, since an SDK owns a
 * single deployment). Small, honest numbers, computed over the customer's store.
 *
 * Pure computation — no I/O — so it's trivially testable.
 */
final class Stats
{
    private const DAY_SECONDS = 24 * 60 * 60;

    /**
     * Compute stats from session+message pairs already loaded from storage.
     *
     * @param array<array{session: Session, messages: Message[]}> $entries
     * @return array<string, mixed>
     */
    public static function compute(array $entries, \DateTimeInterface $from, \DateTimeInterface $to): array
    {
        $fromTs = $from->getTimestamp();
        $toTs = $to->getTimestamp();
        $days = max(1, (int) ceil(($toTs - $fromTs) / self::DAY_SECONDS));
        $buckets = array_fill(0, $days, 0);

        $conversations = 0;
        $messages = 0;
        $answered = 0;
        $unansweredNow = 0;
        /** @var float[] $frtSeconds */
        $frtSeconds = [];
        /** @var int[] $csatScores */
        $csatScores = [];

        foreach ($entries as $entry) {
            $session = $entry['session'];
            $msgs = $entry['messages'];

            $created = $session->createdAt->getTimestamp();
            if ($created < $fromTs || $created > $toTs) {
                continue;
            }
            $conversations++;

            $idx = (int) floor(($created - $fromTs) / self::DAY_SECONDS);
            if ($idx >= 0 && $idx < $days) {
                $buckets[$idx]++;
            }

            // Order messages chronologically.
            $ordered = $msgs;
            usort(
                $ordered,
                fn (Message $a, Message $b) => $a->timestamp->getTimestamp() <=> $b->timestamp->getTimestamp()
            );
            $messages += count($ordered);

            $firstVisitor = null;
            $firstOperator = null;
            foreach ($ordered as $m) {
                if ($m->sender === Sender::VISITOR && $firstVisitor === null) {
                    $firstVisitor = $m->timestamp;
                } elseif (($m->sender === Sender::OPERATOR || $m->sender === Sender::AI) && $firstOperator === null) {
                    $firstOperator = $m->timestamp;
                }
                if ($firstVisitor !== null && $firstOperator !== null) {
                    break;
                }
            }

            if ($firstOperator !== null) {
                $answered++;
            }
            if (
                $firstVisitor !== null
                && $firstOperator !== null
                && $firstOperator->getTimestamp() >= $firstVisitor->getTimestamp()
            ) {
                $frtSeconds[] = (float) ($firstOperator->getTimestamp() - $firstVisitor->getTimestamp());
            }

            $last = $ordered[count($ordered) - 1] ?? null;
            if ($last !== null && $last->sender === Sender::VISITOR) {
                $unansweredNow++;
            }

            if ($session->csat !== null && $session->csat->score !== null) {
                $csatScores[] = $session->csat->score;
            }
        }

        $csatResponses = count($csatScores);
        $csatGood = count(array_filter($csatScores, fn (int $n) => $n >= 4));

        return [
            'from' => $from->format(\DateTimeInterface::ATOM),
            'to' => $to->format(\DateTimeInterface::ATOM),
            'conversations' => $conversations,
            'conversationsSparkline' => $buckets,
            'messages' => $messages,
            'responseRate' => $conversations === 0 ? 0.0 : $answered / $conversations,
            'medianFirstResponseSeconds' => self::median($frtSeconds),
            'unansweredNow' => $unansweredNow,
            'csat' => [
                'percent' => $csatResponses === 0 ? null : $csatGood / $csatResponses,
                'average' => $csatResponses === 0 ? null : array_sum($csatScores) / $csatResponses,
                'responses' => $csatResponses,
            ],
        ];
    }

    /**
     * @param float[] $values
     */
    private static function median(array $values): ?float
    {
        if ($values === []) {
            return null;
        }
        sort($values);
        $count = count($values);
        $mid = intdiv($count, 2);

        return $count % 2 === 0
            ? ($values[$mid - 1] + $values[$mid]) / 2
            : $values[$mid];
    }
}

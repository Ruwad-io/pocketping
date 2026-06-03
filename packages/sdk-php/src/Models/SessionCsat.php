<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Post-conversation CSAT (Customer Satisfaction) rating state stored on a session.
 */
final class SessionCsat implements \JsonSerializable
{
    public function __construct(
        /** A rating has been requested and is awaiting an answer. */
        public bool $pending = false,
        /** Submitted score, 1..5. */
        public ?int $score = null,
        /** Optional free-text comment. */
        public ?string $comment = null,
        /** When the rating was requested. */
        public ?\DateTimeImmutable $requestedAt = null,
        /** When the visitor submitted. */
        public ?\DateTimeImmutable $respondedAt = null,
    ) {
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $requestedAt = null;
        if (isset($data['requestedAt'])) {
            $requestedAt = is_string($data['requestedAt'])
                ? new \DateTimeImmutable($data['requestedAt'])
                : \DateTimeImmutable::createFromInterface($data['requestedAt']);
        }

        $respondedAt = null;
        if (isset($data['respondedAt'])) {
            $respondedAt = is_string($data['respondedAt'])
                ? new \DateTimeImmutable($data['respondedAt'])
                : \DateTimeImmutable::createFromInterface($data['respondedAt']);
        }

        return new self(
            pending: (bool) ($data['pending'] ?? false),
            score: isset($data['score']) ? (int) $data['score'] : null,
            comment: isset($data['comment']) ? (string) $data['comment'] : null,
            requestedAt: $requestedAt,
            respondedAt: $respondedAt,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'pending' => $this->pending,
            'score' => $this->score,
            'comment' => $this->comment,
            'requestedAt' => $this->requestedAt?->format(\DateTimeInterface::ATOM),
            'respondedAt' => $this->respondedAt?->format(\DateTimeInterface::ATOM),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}

<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Visitor-submitted CSAT rating (POST /csat).
 */
final class CsatRequest implements \JsonSerializable
{
    /**
     * @param string $sessionId Session ID
     * @param int $score Score from 1 to 5
     * @param string|null $comment Optional free-text comment
     */
    public function __construct(
        public readonly string $sessionId,
        public readonly int $score,
        public readonly ?string $comment = null,
    ) {
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            sessionId: (string) ($data['sessionId'] ?? throw new \InvalidArgumentException('CsatRequest requires sessionId')),
            score: (int) ($data['score'] ?? throw new \InvalidArgumentException('CsatRequest requires score')),
            comment: isset($data['comment']) ? (string) $data['comment'] : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'sessionId' => $this->sessionId,
            'score' => $this->score,
            'comment' => $this->comment,
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

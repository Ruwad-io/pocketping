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
        $rawScore = $data['score'] ?? throw new \InvalidArgumentException('CsatRequest requires score');

        // Reject fractional / non-integer scores before casting — the API promises an
        // integer 1-5, and a silent (int) cast would truncate e.g. 3.9 to 3.
        if (!is_int($rawScore)) {
            if (!is_numeric($rawScore) || (float) $rawScore !== floor((float) $rawScore)) {
                throw new \InvalidArgumentException('CSAT score must be an integer 1-5');
            }
        }

        return new self(
            sessionId: (string) ($data['sessionId'] ?? throw new \InvalidArgumentException('CsatRequest requires sessionId')),
            score: (int) $rawScore,
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

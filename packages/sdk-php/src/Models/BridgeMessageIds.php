<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Bridge message IDs for edit/delete synchronization.
 */
final class BridgeMessageIds implements \JsonSerializable
{
    /**
     * @param int|null $telegramMessageId Telegram message ID
     * @param string|null $discordMessageId Discord snowflake ID
     * @param string|null $slackMessageTs Slack message timestamp
     */
    public function __construct(
        public ?int $telegramMessageId = null,
        public ?string $discordMessageId = null,
        public ?string $slackMessageTs = null,
    ) {
    }

    /**
     * Merge with another BridgeMessageIds (for partial updates).
     */
    public function mergeWith(BridgeMessageIds $other): self
    {
        return new self(
            telegramMessageId: $other->telegramMessageId ?? $this->telegramMessageId,
            discordMessageId: $other->discordMessageId ?? $this->discordMessageId,
            slackMessageTs: $other->slackMessageTs ?? $this->slackMessageTs,
        );
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            telegramMessageId: isset($data['telegramMessageId']) ? (int) $data['telegramMessageId'] : null,
            discordMessageId: isset($data['discordMessageId']) ? (string) $data['discordMessageId'] : null,
            slackMessageTs: isset($data['slackMessageTs']) ? (string) $data['slackMessageTs'] : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $result = [];
        if ($this->telegramMessageId !== null) {
            $result['telegramMessageId'] = $this->telegramMessageId;
        }
        if ($this->discordMessageId !== null) {
            $result['discordMessageId'] = $this->discordMessageId;
        }
        if ($this->slackMessageTs !== null) {
            $result['slackMessageTs'] = $this->slackMessageTs;
        }
        return $result;
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}

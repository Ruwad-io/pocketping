<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Result from a bridge message send operation.
 * Contains the platform-specific message ID for edit/delete synchronization.
 */
final class BridgeMessageResult implements \JsonSerializable
{
    /**
     * @param bool $success Whether the message was sent successfully
     * @param string|int|null $platformMessageId Platform-specific message ID (Telegram int, Discord/Slack string)
     * @param string|null $error Error message if the operation failed
     */
    public function __construct(
        public readonly bool $success,
        public readonly string|int|null $platformMessageId = null,
        public readonly ?string $error = null,
    ) {
    }

    /**
     * Create a successful result with a message ID.
     */
    public static function success(string|int $platformMessageId): self
    {
        return new self(
            success: true,
            platformMessageId: $platformMessageId,
        );
    }

    /**
     * Create a failed result with an error message.
     */
    public static function failure(string $error): self
    {
        return new self(
            success: false,
            error: $error,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = ['success' => $this->success];

        if ($this->platformMessageId !== null) {
            $data['platformMessageId'] = $this->platformMessageId;
        }

        if ($this->error !== null) {
            $data['error'] = $this->error;
        }

        return $data;
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}

<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Result of checking widget version against backend requirements.
 */
final class VersionCheckResult implements \JsonSerializable
{
    public function __construct(
        public readonly VersionStatus $status,
        public readonly ?string $message = null,
        public readonly ?string $minVersion = null,
        public readonly ?string $latestVersion = null,
        public readonly bool $canContinue = true,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = [
            'status' => $this->status->value,
            'canContinue' => $this->canContinue,
        ];

        if ($this->message !== null) {
            $data['message'] = $this->message;
        }

        if ($this->minVersion !== null) {
            $data['minVersion'] = $this->minVersion;
        }

        if ($this->latestVersion !== null) {
            $data['latestVersion'] = $this->latestVersion;
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

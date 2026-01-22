<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Version warning sent to widget.
 */
final class VersionWarning implements \JsonSerializable
{
    public function __construct(
        public readonly string $severity, // "info", "warning", "error"
        public readonly string $message,
        public readonly string $currentVersion,
        public readonly ?string $minVersion = null,
        public readonly ?string $latestVersion = null,
        public readonly bool $canContinue = true,
        public readonly ?string $upgradeUrl = null,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = [
            'severity' => $this->severity,
            'message' => $this->message,
            'currentVersion' => $this->currentVersion,
            'canContinue' => $this->canContinue,
        ];

        if ($this->minVersion !== null) {
            $data['minVersion'] = $this->minVersion;
        }

        if ($this->latestVersion !== null) {
            $data['latestVersion'] = $this->latestVersion;
        }

        if ($this->upgradeUrl !== null) {
            $data['upgradeUrl'] = $this->upgradeUrl;
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

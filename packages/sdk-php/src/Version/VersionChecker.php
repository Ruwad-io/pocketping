<?php

declare(strict_types=1);

namespace PocketPing\Version;

use PocketPing\Models\VersionCheckResult;
use PocketPing\Models\VersionStatus;
use PocketPing\Models\VersionWarning;

/**
 * Version checker for widget compatibility.
 */
final class VersionChecker
{
    private const DEFAULT_UPGRADE_URL = 'https://docs.pocketping.io/widget/installation';

    public function __construct(
        private readonly ?string $minVersion = null,
        private readonly ?string $latestVersion = null,
        private readonly ?string $warningMessage = null,
        private readonly string $upgradeUrl = self::DEFAULT_UPGRADE_URL,
    ) {
    }

    /**
     * Parse a semver string into [major, minor, patch] array.
     *
     * @return array{int, int, int}
     */
    public static function parseVersion(string $version): array
    {
        // Remove 'v' prefix if present
        $version = ltrim($version, 'v');

        $parts = explode('.', $version);

        $major = isset($parts[0]) ? (int) $parts[0] : 0;
        $minor = isset($parts[1]) ? (int) $parts[1] : 0;

        // Handle pre-release versions (e.g., 1.0.0-beta.1)
        $patch = 0;
        if (isset($parts[2])) {
            $patchPart = explode('-', $parts[2])[0];
            $patch = (int) $patchPart;
        }

        return [$major, $minor, $patch];
    }

    /**
     * Compare two semver strings.
     *
     * @return int -1 if v1 < v2, 0 if equal, 1 if v1 > v2
     */
    public static function compareVersions(string $v1, string $v2): int
    {
        $p1 = self::parseVersion($v1);
        $p2 = self::parseVersion($v2);

        if ($p1 < $p2) {
            return -1;
        }

        if ($p1 > $p2) {
            return 1;
        }

        return 0;
    }

    /**
     * Check widget version compatibility.
     *
     * @param string|null $widgetVersion Version string from X-PocketPing-Version header
     */
    public function check(?string $widgetVersion): VersionCheckResult
    {
        // No version provided - allow but can't check
        if ($widgetVersion === null || $widgetVersion === '') {
            return new VersionCheckResult(
                status: VersionStatus::OK,
                minVersion: $this->minVersion,
                latestVersion: $this->latestVersion,
                canContinue: true,
            );
        }

        // Check against minimum version
        if ($this->minVersion !== null) {
            $comparison = self::compareVersions($widgetVersion, $this->minVersion);
            if ($comparison < 0) {
                $defaultMsg = sprintf(
                    'Widget version %s is no longer supported. Please upgrade to %s or later.',
                    $widgetVersion,
                    $this->minVersion
                );

                return new VersionCheckResult(
                    status: VersionStatus::UNSUPPORTED,
                    message: $this->warningMessage ?? $defaultMsg,
                    minVersion: $this->minVersion,
                    latestVersion: $this->latestVersion,
                    canContinue: false,
                );
            }
        }

        // Check if outdated (behind latest)
        if ($this->latestVersion !== null) {
            $comparison = self::compareVersions($widgetVersion, $this->latestVersion);
            if ($comparison < 0) {
                // Check how far behind
                $current = self::parseVersion($widgetVersion);
                $latest = self::parseVersion($this->latestVersion);

                if ($current[0] < $latest[0]) {
                    // Major version behind - deprecated
                    $defaultMsg = sprintf(
                        'Widget version %s is deprecated. Please upgrade to %s.',
                        $widgetVersion,
                        $this->latestVersion
                    );

                    return new VersionCheckResult(
                        status: VersionStatus::DEPRECATED,
                        message: $this->warningMessage ?? $defaultMsg,
                        minVersion: $this->minVersion,
                        latestVersion: $this->latestVersion,
                        canContinue: true,
                    );
                }

                // Minor/patch behind - outdated
                return new VersionCheckResult(
                    status: VersionStatus::OUTDATED,
                    message: sprintf('A newer widget version (%s) is available.', $this->latestVersion),
                    minVersion: $this->minVersion,
                    latestVersion: $this->latestVersion,
                    canContinue: true,
                );
            }
        }

        // Version is current
        return new VersionCheckResult(
            status: VersionStatus::OK,
            minVersion: $this->minVersion,
            latestVersion: $this->latestVersion,
            canContinue: true,
        );
    }

    /**
     * Get HTTP headers to set for version information.
     *
     * @return array<string, string>
     */
    public function getHeaders(VersionCheckResult $result): array
    {
        $headers = [
            'X-PocketPing-Version-Status' => $result->status->value,
        ];

        if ($result->minVersion !== null) {
            $headers['X-PocketPing-Min-Version'] = $result->minVersion;
        }

        if ($result->latestVersion !== null) {
            $headers['X-PocketPing-Latest-Version'] = $result->latestVersion;
        }

        if ($result->message !== null) {
            $headers['X-PocketPing-Version-Message'] = $result->message;
        }

        return $headers;
    }

    /**
     * Create a version warning for WebSocket notification.
     */
    public function createWarning(VersionCheckResult $result, string $currentVersion): VersionWarning
    {
        $severityMap = [
            VersionStatus::OK->value => 'info',
            VersionStatus::OUTDATED->value => 'info',
            VersionStatus::DEPRECATED->value => 'warning',
            VersionStatus::UNSUPPORTED->value => 'error',
        ];

        return new VersionWarning(
            severity: $severityMap[$result->status->value] ?? 'info',
            message: $result->message ?? '',
            currentVersion: $currentVersion,
            minVersion: $result->minVersion,
            latestVersion: $result->latestVersion,
            canContinue: $result->canContinue,
            upgradeUrl: $this->upgradeUrl,
        );
    }

    /**
     * Get the minimum version.
     */
    public function getMinVersion(): ?string
    {
        return $this->minVersion;
    }

    /**
     * Get the latest version.
     */
    public function getLatestVersion(): ?string
    {
        return $this->latestVersion;
    }

    /**
     * Get the upgrade URL.
     */
    public function getUpgradeUrl(): string
    {
        return $this->upgradeUrl;
    }
}

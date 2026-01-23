<?php

declare(strict_types=1);

namespace PocketPing\Utils;

/**
 * IP filter modes.
 */
enum IpFilterMode: string
{
    case BLOCKLIST = 'blocklist';
    case ALLOWLIST = 'allowlist';
    case BOTH = 'both';
}

/**
 * Reasons for IP filter decisions.
 */
enum IpFilterReason: string
{
    case BLOCKLIST = 'blocklist';
    case ALLOWLIST = 'allowlist';
    case NOT_IN_ALLOWLIST = 'not_in_allowlist';
    case CUSTOM = 'custom';
    case DEFAULT = 'default';
    case DISABLED = 'disabled';
}

/**
 * Result of an IP filter check.
 */
class IpFilterResult
{
    public function __construct(
        public readonly bool $allowed,
        public readonly IpFilterReason $reason,
        public readonly ?string $matchedRule = null,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_filter([
            'allowed' => $this->allowed,
            'reason' => $this->reason->value,
            'matchedRule' => $this->matchedRule,
        ], fn($v) => $v !== null);
    }
}

/**
 * Log event for IP filter decisions.
 */
class IpFilterLogEvent
{
    public readonly \DateTimeImmutable $timestamp;

    /**
     * @param array<string, mixed>|null $requestInfo
     */
    public function __construct(
        public readonly string $ip,
        public readonly bool $allowed,
        public readonly IpFilterReason $reason,
        public readonly ?string $matchedRule = null,
        public readonly ?array $requestInfo = null,
    ) {
        $this->timestamp = new \DateTimeImmutable();
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_filter([
            'ip' => $this->ip,
            'allowed' => $this->allowed,
            'reason' => $this->reason->value,
            'matchedRule' => $this->matchedRule,
            'timestamp' => $this->timestamp->format(\DateTimeInterface::ATOM),
            'requestInfo' => $this->requestInfo,
        ], fn($v) => $v !== null);
    }
}

/**
 * IP filter configuration.
 */
class IpFilterConfig
{
    /**
     * @param bool $enabled Whether IP filtering is enabled
     * @param IpFilterMode $mode The filter mode
     * @param string[] $allowlist List of allowed IPs/CIDRs
     * @param string[] $blocklist List of blocked IPs/CIDRs
     * @param callable(string, array<string, mixed>|null): (bool|null)|null $customFilter Custom filter function
     * @param bool $logBlocked Whether to log blocked requests
     * @param int $blockedStatusCode HTTP status code for blocked requests
     * @param string $blockedMessage Message for blocked requests
     * @param callable(IpFilterLogEvent): void|null $onBlocked Callback for blocked events
     */
    public function __construct(
        public bool $enabled = false,
        public IpFilterMode $mode = IpFilterMode::BLOCKLIST,
        public array $allowlist = [],
        public array $blocklist = [],
        public mixed $customFilter = null,
        public bool $logBlocked = true,
        public int $blockedStatusCode = 403,
        public string $blockedMessage = 'Forbidden',
        public mixed $onBlocked = null,
    ) {
    }

    /**
     * Create from array.
     *
     * @param array<string, mixed>|null $data
     */
    public static function fromArray(?array $data): ?self
    {
        if ($data === null) {
            return null;
        }

        $mode = IpFilterMode::BLOCKLIST;
        if (isset($data['mode'])) {
            $mode = is_string($data['mode'])
                ? IpFilterMode::from($data['mode'])
                : $data['mode'];
        }

        return new self(
            enabled: $data['enabled'] ?? false,
            mode: $mode,
            allowlist: $data['allowlist'] ?? [],
            blocklist: $data['blocklist'] ?? [],
            customFilter: $data['customFilter'] ?? null,
            logBlocked: $data['logBlocked'] ?? true,
            blockedStatusCode: $data['blockedStatusCode'] ?? 403,
            blockedMessage: $data['blockedMessage'] ?? 'Forbidden',
            onBlocked: $data['onBlocked'] ?? null,
        );
    }
}

/**
 * IP filtering utilities.
 */
final class IpFilter
{
    /**
     * Check if an IP matches a CIDR range or exact IP.
     */
    public static function ipMatchesCidr(string $ip, string $cidr): bool
    {
        // Parse the CIDR
        if (str_contains($cidr, '/')) {
            [$subnet, $bits] = explode('/', $cidr, 2);
            $bitsInt = (int) $bits;

            if ($bitsInt < 0 || $bitsInt > 32) {
                return false;
            }
        } else {
            $subnet = $cidr;
            $bitsInt = 32; // Treat as single IP
        }

        // Convert IPs to long integers
        $ipLong = ip2long($ip);
        $subnetLong = ip2long($subnet);

        if ($ipLong === false || $subnetLong === false) {
            return false;
        }

        // Calculate the mask
        if ($bitsInt === 0) {
            return true; // 0.0.0.0/0 matches everything
        }

        $mask = -1 << (32 - $bitsInt);

        // Compare with mask
        return ($ipLong & $mask) === ($subnetLong & $mask);
    }

    /**
     * Check if an IP matches any entry in a list.
     *
     * @param string[] $entries
     */
    public static function ipMatchesAny(string $ip, array $entries): ?string
    {
        foreach ($entries as $entry) {
            if (self::ipMatchesCidr($ip, $entry)) {
                return $entry;
            }
        }

        return null;
    }

    /**
     * Check if an IP should be allowed based on config (without custom filter).
     */
    public static function shouldAllowIp(string $ip, ?IpFilterConfig $config): IpFilterResult
    {
        if ($config === null || !$config->enabled) {
            return new IpFilterResult(true, IpFilterReason::DISABLED);
        }

        return match ($config->mode) {
            IpFilterMode::BLOCKLIST => self::checkBlocklistMode($ip, $config),
            IpFilterMode::ALLOWLIST => self::checkAllowlistMode($ip, $config),
            IpFilterMode::BOTH => self::checkBothMode($ip, $config),
        };
    }

    /**
     * Full IP filter check including custom filter.
     *
     * @param array<string, mixed>|null $requestInfo
     */
    public static function checkIpFilter(
        string $ip,
        ?IpFilterConfig $config,
        ?array $requestInfo = null,
    ): IpFilterResult {
        if ($config === null || !$config->enabled) {
            return new IpFilterResult(true, IpFilterReason::DISABLED);
        }

        // Check custom filter first
        if ($config->customFilter !== null) {
            try {
                $customResult = ($config->customFilter)($ip, $requestInfo);
                if ($customResult !== null) {
                    return new IpFilterResult($customResult, IpFilterReason::CUSTOM);
                }
            } catch (\Throwable $e) {
                error_log("[PocketPing] Custom IP filter error: " . $e->getMessage());
            }
        }

        // Fall back to list-based filtering
        return self::shouldAllowIp($ip, $config);
    }

    /**
     * Get client IP from request (works with most PHP frameworks).
     *
     * @param array<string, string>|null $headers Optional headers array
     */
    public static function getClientIp(?array $headers = null): string
    {
        // If headers provided, check them
        if ($headers !== null) {
            // Check common proxy headers
            foreach (['X-Forwarded-For', 'X-Real-IP', 'CF-Connecting-IP'] as $header) {
                $normalizedHeader = str_replace('-', '_', strtoupper($header));
                $value = $headers[$header] ?? $headers[$normalizedHeader] ?? null;
                if ($value !== null && $value !== '') {
                    // X-Forwarded-For can contain multiple IPs
                    if (str_contains($value, ',')) {
                        return trim(explode(',', $value)[0]);
                    }
                    return trim($value);
                }
            }
        }

        // Fall back to $_SERVER
        $serverHeaders = [
            'HTTP_CF_CONNECTING_IP',
            'HTTP_X_FORWARDED_FOR',
            'HTTP_X_REAL_IP',
            'REMOTE_ADDR',
        ];

        foreach ($serverHeaders as $key) {
            $value = $_SERVER[$key] ?? null;
            if ($value !== null && $value !== '') {
                // X-Forwarded-For can contain multiple IPs
                if (str_contains($value, ',')) {
                    return trim(explode(',', $value)[0]);
                }
                return trim($value);
            }
        }

        return '';
    }

    /**
     * Log an IP filter event.
     *
     * @param array<string, mixed>|null $requestInfo
     */
    public static function logFilterEvent(
        ?IpFilterConfig $config,
        IpFilterResult $result,
        string $ip,
        ?array $requestInfo = null,
    ): void {
        if ($config === null || !$config->logBlocked || $result->allowed) {
            return;
        }

        $event = new IpFilterLogEvent(
            ip: $ip,
            allowed: $result->allowed,
            reason: $result->reason,
            matchedRule: $result->matchedRule,
            requestInfo: $requestInfo,
        );

        error_log(sprintf(
            '[PocketPing] IP blocked: %s (reason: %s%s)',
            $ip,
            $result->reason->value,
            $result->matchedRule !== null ? ", rule: {$result->matchedRule}" : '',
        ));

        // Call onBlocked callback if provided
        if ($config->onBlocked !== null) {
            try {
                ($config->onBlocked)($event);
            } catch (\Throwable $e) {
                error_log("[PocketPing] onBlocked callback error: " . $e->getMessage());
            }
        }
    }

    /**
     * Create a blocked response array for use with HTTP responses.
     *
     * @return array{status: int, headers: array<string, string>, body: string}
     */
    public static function createBlockedResponse(?IpFilterConfig $config): array
    {
        $status = $config?->blockedStatusCode ?? 403;
        $message = $config?->blockedMessage ?? 'Forbidden';

        return [
            'status' => $status,
            'headers' => [
                'Content-Type' => 'application/json',
            ],
            'body' => json_encode(['error' => $message]),
        ];
    }

    private static function checkBlocklistMode(string $ip, IpFilterConfig $config): IpFilterResult
    {
        $matched = self::ipMatchesAny($ip, $config->blocklist);
        if ($matched !== null) {
            return new IpFilterResult(false, IpFilterReason::BLOCKLIST, $matched);
        }

        return new IpFilterResult(true, IpFilterReason::DEFAULT);
    }

    private static function checkAllowlistMode(string $ip, IpFilterConfig $config): IpFilterResult
    {
        $matched = self::ipMatchesAny($ip, $config->allowlist);
        if ($matched !== null) {
            return new IpFilterResult(true, IpFilterReason::ALLOWLIST, $matched);
        }

        return new IpFilterResult(false, IpFilterReason::NOT_IN_ALLOWLIST);
    }

    private static function checkBothMode(string $ip, IpFilterConfig $config): IpFilterResult
    {
        // Allowlist takes precedence
        $allowlistMatched = self::ipMatchesAny($ip, $config->allowlist);
        if ($allowlistMatched !== null) {
            return new IpFilterResult(true, IpFilterReason::ALLOWLIST, $allowlistMatched);
        }

        // Then check blocklist
        $blocklistMatched = self::ipMatchesAny($ip, $config->blocklist);
        if ($blocklistMatched !== null) {
            return new IpFilterResult(false, IpFilterReason::BLOCKLIST, $blocklistMatched);
        }

        // Default allow if not in either list
        return new IpFilterResult(true, IpFilterReason::DEFAULT);
    }
}

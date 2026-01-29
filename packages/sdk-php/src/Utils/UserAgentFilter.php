<?php

declare(strict_types=1);

namespace PocketPing\Utils;

use DateTime;
use DateTimeZone;

/**
 * User-Agent Filtering utilities for PocketPing SDK.
 * Blocks bots and unwanted user agents to prevent spam sessions.
 * Supports both substring matching and regex patterns.
 */

enum UaFilterMode: string
{
    case BLOCKLIST = 'blocklist';
    case ALLOWLIST = 'allowlist';
    case BOTH = 'both';
}

enum UaFilterReason: string
{
    case BLOCKLIST = 'blocklist';
    case ALLOWLIST = 'allowlist';
    case DEFAULT_BOT = 'default_bot';
    case CUSTOM = 'custom';
    case NOT_IN_ALLOWLIST = 'not_in_allowlist';
    case DEFAULT = 'default';
}

class UaFilterResult
{
    public function __construct(
        public readonly bool $allowed,
        public readonly UaFilterReason $reason,
        public readonly ?string $matchedPattern = null,
    ) {
    }
}

class UaFilterLogEvent
{
    public function __construct(
        public readonly string $type, // 'blocked' or 'allowed'
        public readonly string $userAgent,
        public readonly UaFilterReason $reason,
        public readonly ?string $matchedPattern,
        public readonly string $path,
        public readonly DateTime $timestamp,
        public readonly ?string $sessionId = null,
    ) {
    }
}

class UaFilterConfig
{
    public function __construct(
        public bool $enabled = false,
        public UaFilterMode $mode = UaFilterMode::BLOCKLIST,
        public array $allowlist = [],
        public array $blocklist = [],
        public bool $useDefaultBots = true,
        public mixed $customFilter = null,
        public bool $logBlocked = true,
        public mixed $logger = null,
        public int $blockedStatusCode = 403,
        public string $blockedMessage = 'Forbidden',
    ) {
    }
}

class UserAgentFilter
{
    /**
     * Default bot patterns to block.
     * These are known bots, crawlers, and automated tools that shouldn't create chat sessions.
     */
    public const DEFAULT_BOT_PATTERNS = [
        // Search Engine Crawlers
        'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
        'yandexbot', 'sogou', 'exabot', 'facebot', 'ia_archiver',
        // SEO/Analytics Tools
        'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot', 'rogerbot',
        'screaming frog', 'seokicks', 'sistrix', 'linkdexbot', 'blexbot',
        // Generic Bot Indicators
        'bot/', 'crawler', 'spider', 'scraper', 'headless',
        'phantomjs', 'selenium', 'puppeteer', 'playwright', 'webdriver',
        // Monitoring/Uptime Services
        'pingdom', 'uptimerobot', 'statuscake', 'site24x7', 'newrelic',
        'datadog', 'gtmetrix', 'pagespeed',
        // Social Media Crawlers
        'twitterbot', 'linkedinbot', 'pinterestbot', 'telegrambot',
        'whatsapp', 'slackbot', 'discordbot', 'applebot',
        // AI/LLM Crawlers
        'gptbot', 'chatgpt-user', 'anthropic-ai', 'claude-web',
        'perplexitybot', 'ccbot', 'bytespider', 'cohere-ai',
        // HTTP Libraries (automated requests)
        'curl/', 'wget/', 'httpie/', 'python-requests', 'python-urllib',
        'axios/', 'node-fetch', 'go-http-client', 'java/', 'okhttp',
        'libwww-perl', 'httpclient',
        // Archive/Research Bots
        'archive.org_bot', 'wayback', 'commoncrawl',
        // Security Scanners
        'nmap', 'nikto', 'sqlmap', 'masscan', 'zgrab',
    ];

    /**
     * Check if a pattern is a regex (starts and ends with /).
     */
    private static function isRegexPattern(string $pattern): bool
    {
        return strlen($pattern) > 2 && $pattern[0] === '/' && $pattern[strlen($pattern) - 1] === '/';
    }

    /**
     * Check if a user-agent matches any pattern in the list.
     * Supports both substring matching and regex patterns (e.g., /bot-\d+/).
     * Returns the matched pattern or null.
     */
    public static function matchesAnyPattern(string $userAgent, array $patterns): ?string
    {
        $uaLower = strtolower($userAgent);
        foreach ($patterns as $pattern) {
            // Check if pattern is a regex
            if (self::isRegexPattern($pattern)) {
                // Use the pattern as-is for preg_match (it includes delimiters)
                $regexPattern = $pattern . 'i'; // Add case-insensitive flag
                if (@preg_match($regexPattern, $uaLower) === 1) {
                    return $pattern;
                }
            } else {
                // Simple substring match (case-insensitive)
                if (str_contains($uaLower, strtolower($pattern))) {
                    return $pattern;
                }
            }
        }
        return null;
    }

    /**
     * Main UA filter function - determines if a user-agent should be allowed.
     */
    public static function shouldAllowUa(string $userAgent, UaFilterConfig $config): UaFilterResult
    {
        $mode = $config->mode;
        $allowlist = $config->allowlist;
        $blocklist = $config->blocklist;

        // Add default bot patterns if enabled
        if ($config->useDefaultBots) {
            $blocklist = array_merge($blocklist, self::DEFAULT_BOT_PATTERNS);
        }

        switch ($mode) {
            case UaFilterMode::ALLOWLIST:
                // Only allow if in allowlist
                $matched = self::matchesAnyPattern($userAgent, $allowlist);
                if ($matched !== null) {
                    return new UaFilterResult(true, UaFilterReason::ALLOWLIST, $matched);
                }
                return new UaFilterResult(false, UaFilterReason::NOT_IN_ALLOWLIST);

            case UaFilterMode::BLOCKLIST:
                // Block if in blocklist, allow otherwise
                $matched = self::matchesAnyPattern($userAgent, $blocklist);
                if ($matched !== null) {
                    // Determine if it's a default bot or custom blocklist
                    $isDefaultBot = self::matchesAnyPattern($userAgent, $config->blocklist) === null;
                    $reason = $isDefaultBot ? UaFilterReason::DEFAULT_BOT : UaFilterReason::BLOCKLIST;
                    return new UaFilterResult(false, $reason, $matched);
                }
                return new UaFilterResult(true, UaFilterReason::DEFAULT);

            case UaFilterMode::BOTH:
                // Allowlist takes precedence, then check blocklist
                $allowMatched = self::matchesAnyPattern($userAgent, $allowlist);
                if ($allowMatched !== null) {
                    return new UaFilterResult(true, UaFilterReason::ALLOWLIST, $allowMatched);
                }
                $blockMatched = self::matchesAnyPattern($userAgent, $blocklist);
                if ($blockMatched !== null) {
                    $isDefaultBot = self::matchesAnyPattern($userAgent, $config->blocklist) === null;
                    $reason = $isDefaultBot ? UaFilterReason::DEFAULT_BOT : UaFilterReason::BLOCKLIST;
                    return new UaFilterResult(false, $reason, $blockMatched);
                }
                return new UaFilterResult(true, UaFilterReason::DEFAULT);

            default:
                return new UaFilterResult(true, UaFilterReason::DEFAULT);
        }
    }

    /**
     * Check UA filter with support for custom filter callback.
     */
    public static function checkUaFilter(
        ?string $userAgent,
        UaFilterConfig $config,
        array $requestInfo
    ): UaFilterResult {
        // No user-agent = allow (could be internal request)
        if ($userAgent === null || $userAgent === '') {
            return new UaFilterResult(true, UaFilterReason::DEFAULT);
        }

        // Disabled = allow all
        if (!$config->enabled) {
            return new UaFilterResult(true, UaFilterReason::DEFAULT);
        }

        // 1. Check custom filter first
        if ($config->customFilter !== null && is_callable($config->customFilter)) {
            $result = call_user_func($config->customFilter, $userAgent, $requestInfo);
            if ($result === true) {
                return new UaFilterResult(true, UaFilterReason::CUSTOM);
            }
            if ($result === false) {
                return new UaFilterResult(false, UaFilterReason::CUSTOM);
            }
            // null = fall through to list-based filtering
        }

        // 2. Apply list-based filtering
        return self::shouldAllowUa($userAgent, $config);
    }

    /**
     * Create a UA filter log event.
     */
    public static function createLogEvent(
        string $eventType,
        string $userAgent,
        UaFilterReason $reason,
        ?string $matchedPattern,
        string $path,
        ?string $sessionId = null
    ): UaFilterLogEvent {
        return new UaFilterLogEvent(
            type: $eventType,
            userAgent: $userAgent,
            reason: $reason,
            matchedPattern: $matchedPattern,
            path: $path,
            timestamp: new DateTime('now', new DateTimeZone('UTC')),
            sessionId: $sessionId,
        );
    }

    /**
     * Check if a user-agent looks like a bot based on default patterns.
     * Utility function for quick bot detection.
     */
    public static function isBot(string $userAgent): bool
    {
        return self::matchesAnyPattern($userAgent, self::DEFAULT_BOT_PATTERNS) !== null;
    }
}

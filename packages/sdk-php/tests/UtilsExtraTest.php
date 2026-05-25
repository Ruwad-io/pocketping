<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Models\VersionStatus;
use PocketPing\Utils\IpFilter;
use PocketPing\Utils\IpFilterConfig;
use PocketPing\Utils\IpFilterLogEvent;
use PocketPing\Utils\IpFilterMode;
use PocketPing\Utils\IpFilterReason;
use PocketPing\Utils\UaFilterConfig;
use PocketPing\Utils\UaFilterMode;
use PocketPing\Utils\UaFilterReason;
use PocketPing\Utils\UserAgentFilter;
use PocketPing\Version\VersionChecker;

/**
 * Coverage for VersionChecker, UserAgentFilter and IpFilter
 * branches not exercised elsewhere.
 */
class UtilsExtraTest extends TestCase
{
    // ─────────────────────────────────────────────────────────────────
    // VersionChecker
    // ─────────────────────────────────────────────────────────────────

    public function testParseVersionStripsPrefixAndPrerelease(): void
    {
        $this->assertSame([1, 2, 3], VersionChecker::parseVersion('v1.2.3-beta.1'));
        $this->assertSame([2, 0, 0], VersionChecker::parseVersion('2'));
        $this->assertSame([0, 5, 0], VersionChecker::parseVersion('0.5'));
    }

    public function testCompareVersions(): void
    {
        $this->assertSame(-1, VersionChecker::compareVersions('1.0.0', '2.0.0'));
        $this->assertSame(1, VersionChecker::compareVersions('2.1.0', '2.0.0'));
        $this->assertSame(0, VersionChecker::compareVersions('1.2.3', '1.2.3'));
    }

    public function testCheckNullVersionIsOk(): void
    {
        $checker = new VersionChecker(minVersion: '1.0.0', latestVersion: '2.0.0');
        $this->assertSame(VersionStatus::OK, $checker->check(null)->status);
        $this->assertSame(VersionStatus::OK, $checker->check('')->status);
    }

    public function testCheckDeprecatedWhenMajorBehind(): void
    {
        $checker = new VersionChecker(latestVersion: '2.0.0');
        $result = $checker->check('1.5.0');
        $this->assertSame(VersionStatus::DEPRECATED, $result->status);
        $this->assertTrue($result->canContinue);
        $this->assertNotNull($result->message);
    }

    public function testCheckOutdatedWhenMinorBehind(): void
    {
        $checker = new VersionChecker(latestVersion: '2.5.0');
        $result = $checker->check('2.1.0');
        $this->assertSame(VersionStatus::OUTDATED, $result->status);
    }

    public function testCheckUnsupportedUsesCustomMessage(): void
    {
        $checker = new VersionChecker(minVersion: '2.0.0', warningMessage: 'Custom warn');
        $result = $checker->check('1.0.0');
        $this->assertSame(VersionStatus::UNSUPPORTED, $result->status);
        $this->assertSame('Custom warn', $result->message);
    }

    public function testCheckCurrentVersionIsOk(): void
    {
        $checker = new VersionChecker(minVersion: '1.0.0', latestVersion: '2.0.0');
        $this->assertSame(VersionStatus::OK, $checker->check('2.0.0')->status);
    }

    public function testGetHeadersIncludesAllPresentFields(): void
    {
        $checker = new VersionChecker(minVersion: '1.0.0', latestVersion: '2.0.0');
        $result = $checker->check('0.9.0'); // unsupported -> has message
        $headers = $checker->getHeaders($result);
        $this->assertSame('unsupported', $headers['X-PocketPing-Version-Status']);
        $this->assertArrayHasKey('X-PocketPing-Min-Version', $headers);
        $this->assertArrayHasKey('X-PocketPing-Latest-Version', $headers);
        $this->assertArrayHasKey('X-PocketPing-Version-Message', $headers);
    }

    public function testGetHeadersMinimalWhenNoConfig(): void
    {
        $checker = new VersionChecker();
        $headers = $checker->getHeaders($checker->check('1.0.0'));
        $this->assertSame(['X-PocketPing-Version-Status' => 'ok'], $headers);
    }

    public function testCreateWarningSeverityMapping(): void
    {
        $checker = new VersionChecker(minVersion: '2.0.0', upgradeUrl: 'https://up');
        $unsupported = $checker->check('1.0.0');
        $warning = $checker->createWarning($unsupported, '1.0.0');
        $this->assertSame('error', $warning->severity);
        $this->assertFalse($warning->canContinue);
        $this->assertSame('https://up', $warning->upgradeUrl);

        $deprecatedChecker = new VersionChecker(latestVersion: '2.0.0');
        $deprecated = $deprecatedChecker->check('1.0.0');
        $this->assertSame('warning', $deprecatedChecker->createWarning($deprecated, '1.0.0')->severity);

        $okWarning = $checker->createWarning($checker->check('2.0.0'), '2.0.0');
        $this->assertSame('info', $okWarning->severity);
    }

    public function testVersionCheckerGetters(): void
    {
        $checker = new VersionChecker(minVersion: '1.0.0', latestVersion: '2.0.0', upgradeUrl: 'https://docs');
        $this->assertSame('1.0.0', $checker->getMinVersion());
        $this->assertSame('2.0.0', $checker->getLatestVersion());
        $this->assertSame('https://docs', $checker->getUpgradeUrl());
    }

    // ─────────────────────────────────────────────────────────────────
    // UserAgentFilter
    // ─────────────────────────────────────────────────────────────────

    public function testIsBotDetectsKnownPatterns(): void
    {
        $this->assertTrue(UserAgentFilter::isBot('Mozilla/5.0 (compatible; Googlebot/2.1)'));
        $this->assertTrue(UserAgentFilter::isBot('curl/8.0'));
        $this->assertFalse(UserAgentFilter::isBot('Mozilla/5.0 (Macintosh) Chrome/120 Safari/537'));
    }

    public function testMatchesAnyPatternRegex(): void
    {
        $this->assertSame('/bot-\d+/', UserAgentFilter::matchesAnyPattern('custom-bot-123', ['/bot-\d+/']));
        $this->assertNull(UserAgentFilter::matchesAnyPattern('human', ['/bot-\d+/']));
    }

    public function testMatchesAnyPatternSubstring(): void
    {
        $this->assertSame('FooBar', UserAgentFilter::matchesAnyPattern('xx FOOBAR yy', ['FooBar']));
    }

    public function testShouldAllowUaAllowlistMode(): void
    {
        $config = new UaFilterConfig(
            enabled: true,
            mode: UaFilterMode::ALLOWLIST,
            allowlist: ['MyApp'],
            useDefaultBots: false,
        );
        $allowed = UserAgentFilter::shouldAllowUa('MyApp/1.0', $config);
        $this->assertTrue($allowed->allowed);
        $this->assertSame(UaFilterReason::ALLOWLIST, $allowed->reason);

        $blocked = UserAgentFilter::shouldAllowUa('Other/1.0', $config);
        $this->assertFalse($blocked->allowed);
        $this->assertSame(UaFilterReason::NOT_IN_ALLOWLIST, $blocked->reason);
    }

    public function testShouldAllowUaBlocklistDistinguishesCustomVsDefaultBot(): void
    {
        $config = new UaFilterConfig(
            enabled: true,
            mode: UaFilterMode::BLOCKLIST,
            blocklist: ['evilcorp'],
            useDefaultBots: true,
        );

        $customBlocked = UserAgentFilter::shouldAllowUa('evilcorp scanner', $config);
        $this->assertFalse($customBlocked->allowed);
        $this->assertSame(UaFilterReason::BLOCKLIST, $customBlocked->reason);

        $defaultBot = UserAgentFilter::shouldAllowUa('Googlebot/2.1', $config);
        $this->assertFalse($defaultBot->allowed);
        $this->assertSame(UaFilterReason::DEFAULT_BOT, $defaultBot->reason);

        $allowed = UserAgentFilter::shouldAllowUa('Mozilla/5.0 Chrome/120', $config);
        $this->assertTrue($allowed->allowed);
        $this->assertSame(UaFilterReason::DEFAULT, $allowed->reason);
    }

    public function testShouldAllowUaBothMode(): void
    {
        $config = new UaFilterConfig(
            enabled: true,
            mode: UaFilterMode::BOTH,
            allowlist: ['TrustedBot'],
            blocklist: ['evilcorp'],
            useDefaultBots: true,
        );

        // Allowlist wins even though it contains "bot"
        $allow = UserAgentFilter::shouldAllowUa('TrustedBot/1', $config);
        $this->assertTrue($allow->allowed);
        $this->assertSame(UaFilterReason::ALLOWLIST, $allow->reason);

        // Custom blocklist hit
        $blockCustom = UserAgentFilter::shouldAllowUa('evilcorp', $config);
        $this->assertFalse($blockCustom->allowed);
        $this->assertSame(UaFilterReason::BLOCKLIST, $blockCustom->reason);

        // Default bot hit
        $blockDefault = UserAgentFilter::shouldAllowUa('bingbot', $config);
        $this->assertFalse($blockDefault->allowed);
        $this->assertSame(UaFilterReason::DEFAULT_BOT, $blockDefault->reason);

        // Falls through to default allow
        $allowDefault = UserAgentFilter::shouldAllowUa('Mozilla/5.0 Chrome/120', $config);
        $this->assertTrue($allowDefault->allowed);
        $this->assertSame(UaFilterReason::DEFAULT, $allowDefault->reason);
    }

    public function testCheckUaFilterEmptyOrDisabledAllows(): void
    {
        $config = new UaFilterConfig(enabled: true);
        $this->assertTrue(UserAgentFilter::checkUaFilter(null, $config, [])->allowed);
        $this->assertTrue(UserAgentFilter::checkUaFilter('', $config, [])->allowed);

        $disabled = new UaFilterConfig(enabled: false);
        $this->assertTrue(UserAgentFilter::checkUaFilter('Googlebot', $disabled, [])->allowed);
    }

    public function testCheckUaFilterCustomFilterBranches(): void
    {
        $allowAll = new UaFilterConfig(enabled: true, customFilter: fn ($ua, $req) => true);
        $r1 = UserAgentFilter::checkUaFilter('Googlebot', $allowAll, []);
        $this->assertTrue($r1->allowed);
        $this->assertSame(UaFilterReason::CUSTOM, $r1->reason);

        $blockAll = new UaFilterConfig(enabled: true, customFilter: fn ($ua, $req) => false);
        $r2 = UserAgentFilter::checkUaFilter('Mozilla', $blockAll, []);
        $this->assertFalse($r2->allowed);
        $this->assertSame(UaFilterReason::CUSTOM, $r2->reason);

        // null defers to list-based filtering
        $defer = new UaFilterConfig(enabled: true, customFilter: fn ($ua, $req) => null);
        $r3 = UserAgentFilter::checkUaFilter('Googlebot', $defer, []);
        $this->assertFalse($r3->allowed);
        $this->assertSame(UaFilterReason::DEFAULT_BOT, $r3->reason);
    }

    public function testCreateLogEvent(): void
    {
        $event = UserAgentFilter::createLogEvent(
            'blocked',
            'Googlebot',
            UaFilterReason::DEFAULT_BOT,
            'googlebot',
            '/connect',
            'sess-1',
        );
        $this->assertSame('blocked', $event->type);
        $this->assertSame('Googlebot', $event->userAgent);
        $this->assertSame('googlebot', $event->matchedPattern);
        $this->assertSame('/connect', $event->path);
        $this->assertSame('sess-1', $event->sessionId);
    }

    // ─────────────────────────────────────────────────────────────────
    // IpFilter: logging, onBlocked, getClientIp, blocked response
    // ─────────────────────────────────────────────────────────────────

    public function testLogFilterEventInvokesOnBlocked(): void
    {
        $captured = null;
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::BLOCKLIST,
            blocklist: ['10.0.0.0/8'],
            onBlocked: function (IpFilterLogEvent $e) use (&$captured): void {
                $captured = $e;
            },
        );
        $result = IpFilter::shouldAllowIp('10.1.1.1', $config);
        IpFilter::logFilterEvent($config, $result, '10.1.1.1', ['path' => '/x']);

        $this->assertNotNull($captured);
        $this->assertSame('10.1.1.1', $captured->ip);
        $this->assertFalse($captured->allowed);
        $arr = $captured->toArray();
        $this->assertSame('10.1.1.1', $arr['ip']);
        $this->assertArrayHasKey('timestamp', $arr);
    }

    public function testLogFilterEventSkippedWhenAllowed(): void
    {
        $called = false;
        $config = new IpFilterConfig(
            enabled: true,
            blocklist: ['10.0.0.0/8'],
            onBlocked: function () use (&$called): void {
                $called = true;
            },
        );
        $allowed = IpFilter::shouldAllowIp('8.8.8.8', $config);
        IpFilter::logFilterEvent($config, $allowed, '8.8.8.8');
        $this->assertFalse($called);
    }

    public function testLogFilterEventSwallowsOnBlockedException(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            blocklist: ['10.0.0.0/8'],
            onBlocked: function (): void {
                throw new \RuntimeException('logging crashed');
            },
        );
        $result = IpFilter::shouldAllowIp('10.0.0.1', $config);
        // Should not throw.
        IpFilter::logFilterEvent($config, $result, '10.0.0.1');
        $this->assertTrue(true);
    }

    public function testLogFilterEventNoOpWhenLogBlockedDisabled(): void
    {
        $called = false;
        $config = new IpFilterConfig(
            enabled: true,
            logBlocked: false,
            blocklist: ['10.0.0.0/8'],
            onBlocked: function () use (&$called): void {
                $called = true;
            },
        );
        $result = IpFilter::shouldAllowIp('10.0.0.1', $config);
        IpFilter::logFilterEvent($config, $result, '10.0.0.1');
        $this->assertFalse($called);
    }

    public function testCheckIpFilterCustomFilterExceptionFallsThrough(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::BLOCKLIST,
            blocklist: ['10.0.0.0/8'],
            customFilter: function (): void {
                throw new \RuntimeException('custom crashed');
            },
        );
        $result = IpFilter::checkIpFilter('10.0.0.1', $config);
        // Falls through to list-based filtering despite the exception.
        $this->assertFalse($result->allowed);
        $this->assertSame(IpFilterReason::BLOCKLIST, $result->reason);
    }

    public function testGetClientIpHeaderVariants(): void
    {
        $this->assertSame('1.1.1.1', IpFilter::getClientIp(['X-Real-IP' => '1.1.1.1']));
        $this->assertSame('2.2.2.2', IpFilter::getClientIp(['CF-Connecting-IP' => '2.2.2.2']));
        // Normalised header key (X_FORWARDED_FOR style) with multiple IPs
        $this->assertSame('3.3.3.3', IpFilter::getClientIp(['X_FORWARDED_FOR' => '3.3.3.3, 9.9.9.9']));
        $this->assertSame('', IpFilter::getClientIp([]));
    }

    public function testGetClientIpFromServerSuperglobal(): void
    {
        $_SERVER['REMOTE_ADDR'] = '4.4.4.4';
        $this->assertSame('4.4.4.4', IpFilter::getClientIp());
        unset($_SERVER['REMOTE_ADDR']);

        $_SERVER['HTTP_X_FORWARDED_FOR'] = '5.5.5.5, 6.6.6.6';
        $this->assertSame('5.5.5.5', IpFilter::getClientIp());
        unset($_SERVER['HTTP_X_FORWARDED_FOR']);
    }

    public function testCreateBlockedResponseDefaults(): void
    {
        $resp = IpFilter::createBlockedResponse(null);
        $this->assertSame(403, $resp['status']);
        $this->assertStringContainsString('Forbidden', $resp['body']);
    }

    public function testIpFilterResultToArray(): void
    {
        $result = IpFilter::shouldAllowIp('10.0.0.1', new IpFilterConfig(
            enabled: true,
            blocklist: ['10.0.0.0/8'],
        ));
        $arr = $result->toArray();
        $this->assertFalse($arr['allowed']);
        $this->assertSame('blocklist', $arr['reason']);
        $this->assertSame('10.0.0.0/8', $arr['matchedRule']);
    }
}

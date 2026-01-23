<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\PocketPing;
use PocketPing\Utils\IpFilter;
use PocketPing\Utils\IpFilterConfig;
use PocketPing\Utils\IpFilterMode;
use PocketPing\Utils\IpFilterReason;

class IpFilterTest extends TestCase
{
    // ─────────────────────────────────────────────────────────────────
    // ipMatchesCidr Tests
    // ─────────────────────────────────────────────────────────────────

    public function testIpMatchesCidrExactMatch(): void
    {
        $this->assertTrue(IpFilter::ipMatchesCidr('192.168.1.1', '192.168.1.1'));
        $this->assertFalse(IpFilter::ipMatchesCidr('192.168.1.2', '192.168.1.1'));
    }

    public function testIpMatchesCidr24Subnet(): void
    {
        $this->assertTrue(IpFilter::ipMatchesCidr('192.168.1.0', '192.168.1.0/24'));
        $this->assertTrue(IpFilter::ipMatchesCidr('192.168.1.1', '192.168.1.0/24'));
        $this->assertTrue(IpFilter::ipMatchesCidr('192.168.1.255', '192.168.1.0/24'));
        $this->assertFalse(IpFilter::ipMatchesCidr('192.168.2.0', '192.168.1.0/24'));
    }

    public function testIpMatchesCidr16Subnet(): void
    {
        $this->assertTrue(IpFilter::ipMatchesCidr('192.168.0.0', '192.168.0.0/16'));
        $this->assertTrue(IpFilter::ipMatchesCidr('192.168.255.255', '192.168.0.0/16'));
        $this->assertFalse(IpFilter::ipMatchesCidr('192.169.0.0', '192.168.0.0/16'));
    }

    public function testIpMatchesCidr8Subnet(): void
    {
        $this->assertTrue(IpFilter::ipMatchesCidr('10.0.0.1', '10.0.0.0/8'));
        $this->assertTrue(IpFilter::ipMatchesCidr('10.255.255.255', '10.0.0.0/8'));
        $this->assertFalse(IpFilter::ipMatchesCidr('11.0.0.0', '10.0.0.0/8'));
    }

    public function testIpMatchesCidr32SingleIp(): void
    {
        $this->assertTrue(IpFilter::ipMatchesCidr('203.0.113.50', '203.0.113.50/32'));
        $this->assertFalse(IpFilter::ipMatchesCidr('203.0.113.51', '203.0.113.50/32'));
    }

    public function testIpMatchesCidr0AllIps(): void
    {
        $this->assertTrue(IpFilter::ipMatchesCidr('1.2.3.4', '0.0.0.0/0'));
        $this->assertTrue(IpFilter::ipMatchesCidr('255.255.255.255', '0.0.0.0/0'));
    }

    public function testIpMatchesCidrInvalidInputs(): void
    {
        $this->assertFalse(IpFilter::ipMatchesCidr('invalid', '192.168.1.0/24'));
        $this->assertFalse(IpFilter::ipMatchesCidr('192.168.1.1', 'invalid/24'));
        $this->assertFalse(IpFilter::ipMatchesCidr('192.168.1.1', '192.168.1.0/33'));
        $this->assertFalse(IpFilter::ipMatchesCidr('192.168.1.1', '192.168.1.0/-1'));
    }

    // ─────────────────────────────────────────────────────────────────
    // ipMatchesAny Tests
    // ─────────────────────────────────────────────────────────────────

    public function testIpMatchesAnyFindsMatch(): void
    {
        $entries = ['192.168.1.0/24', '10.0.0.0/8', '203.0.113.50'];

        $this->assertEquals('192.168.1.0/24', IpFilter::ipMatchesAny('192.168.1.100', $entries));
        $this->assertEquals('10.0.0.0/8', IpFilter::ipMatchesAny('10.50.25.1', $entries));
        $this->assertEquals('203.0.113.50', IpFilter::ipMatchesAny('203.0.113.50', $entries));
    }

    public function testIpMatchesAnyNoMatch(): void
    {
        $entries = ['192.168.1.0/24', '10.0.0.0/8'];

        $this->assertNull(IpFilter::ipMatchesAny('172.16.0.1', $entries));
        $this->assertNull(IpFilter::ipMatchesAny('8.8.8.8', $entries));
    }

    public function testIpMatchesAnyEmptyList(): void
    {
        $this->assertNull(IpFilter::ipMatchesAny('192.168.1.1', []));
    }

    // ─────────────────────────────────────────────────────────────────
    // shouldAllowIp Tests
    // ─────────────────────────────────────────────────────────────────

    public function testShouldAllowIpBlocklistModeBlocks(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::BLOCKLIST,
            blocklist: ['192.168.1.0/24', '203.0.113.0/24'],
        );

        $result = IpFilter::shouldAllowIp('192.168.1.50', $config);
        $this->assertFalse($result->allowed);
        $this->assertEquals(IpFilterReason::BLOCKLIST, $result->reason);
    }

    public function testShouldAllowIpBlocklistModeAllows(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::BLOCKLIST,
            blocklist: ['192.168.1.0/24'],
        );

        $result = IpFilter::shouldAllowIp('10.0.0.1', $config);
        $this->assertTrue($result->allowed);
        $this->assertEquals(IpFilterReason::DEFAULT, $result->reason);
    }

    public function testShouldAllowIpAllowlistModeAllows(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::ALLOWLIST,
            allowlist: ['10.0.0.0/8', '192.168.0.0/16'],
        );

        $result = IpFilter::shouldAllowIp('10.0.0.50', $config);
        $this->assertTrue($result->allowed);
        $this->assertEquals(IpFilterReason::ALLOWLIST, $result->reason);
    }

    public function testShouldAllowIpAllowlistModeBlocks(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::ALLOWLIST,
            allowlist: ['10.0.0.0/8'],
        );

        $result = IpFilter::shouldAllowIp('192.168.1.1', $config);
        $this->assertFalse($result->allowed);
        $this->assertEquals(IpFilterReason::NOT_IN_ALLOWLIST, $result->reason);
    }

    public function testShouldAllowIpBothModeAllowlistPriority(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::BOTH,
            allowlist: ['10.0.0.1'],
            blocklist: ['10.0.0.0/24'],
        );

        $result = IpFilter::shouldAllowIp('10.0.0.1', $config);
        $this->assertTrue($result->allowed);
        $this->assertEquals(IpFilterReason::ALLOWLIST, $result->reason);
    }

    public function testShouldAllowIpBothModeBlocklistApplies(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::BOTH,
            allowlist: ['10.0.0.1'],
            blocklist: ['10.0.0.0/24'],
        );

        $result = IpFilter::shouldAllowIp('10.0.0.2', $config);
        $this->assertFalse($result->allowed);
        $this->assertEquals(IpFilterReason::BLOCKLIST, $result->reason);
    }

    public function testShouldAllowIpBothModeDefaultAllow(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::BOTH,
            allowlist: ['10.0.0.1'],
            blocklist: ['192.168.1.0/24'],
        );

        $result = IpFilter::shouldAllowIp('8.8.8.8', $config);
        $this->assertTrue($result->allowed);
        $this->assertEquals(IpFilterReason::DEFAULT, $result->reason);
    }

    public function testShouldAllowIpNullConfig(): void
    {
        $result = IpFilter::shouldAllowIp('192.168.1.1', null);
        $this->assertTrue($result->allowed);
        $this->assertEquals(IpFilterReason::DISABLED, $result->reason);
    }

    public function testShouldAllowIpDisabledConfig(): void
    {
        $config = new IpFilterConfig(
            enabled: false,
            blocklist: ['192.168.1.0/24'],
        );

        $result = IpFilter::shouldAllowIp('192.168.1.50', $config);
        $this->assertTrue($result->allowed);
        $this->assertEquals(IpFilterReason::DISABLED, $result->reason);
    }

    // ─────────────────────────────────────────────────────────────────
    // checkIpFilter Tests
    // ─────────────────────────────────────────────────────────────────

    public function testCheckIpFilterCustomFilterBlocks(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::BLOCKLIST,
            blocklist: ['192.168.1.0/24'],
            customFilter: function (string $ip, ?array $requestInfo): ?bool {
                // Block all IPs starting with "10."
                if (str_starts_with($ip, '10.')) {
                    return false;
                }
                return null; // Defer to list-based
            },
        );

        $result = IpFilter::checkIpFilter('10.0.0.1', $config, null);
        $this->assertFalse($result->allowed);
        $this->assertEquals(IpFilterReason::CUSTOM, $result->reason);
    }

    public function testCheckIpFilterCustomFilterAllows(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::BLOCKLIST,
            blocklist: ['192.168.1.0/24'],
            customFilter: function (string $ip, ?array $requestInfo): ?bool {
                if ($ip === '8.8.8.8') {
                    return true;
                }
                return null;
            },
        );

        $result = IpFilter::checkIpFilter('8.8.8.8', $config, null);
        $this->assertTrue($result->allowed);
        $this->assertEquals(IpFilterReason::CUSTOM, $result->reason);
    }

    public function testCheckIpFilterCustomFilterDefers(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::BLOCKLIST,
            blocklist: ['192.168.1.0/24'],
            customFilter: function (string $ip, ?array $requestInfo): ?bool {
                return null; // Defer
            },
        );

        $result = IpFilter::checkIpFilter('192.168.1.50', $config, null);
        $this->assertFalse($result->allowed);
        $this->assertEquals(IpFilterReason::BLOCKLIST, $result->reason);
    }

    // ─────────────────────────────────────────────────────────────────
    // IpFilterConfig Tests
    // ─────────────────────────────────────────────────────────────────

    public function testIpFilterConfigFromArray(): void
    {
        $config = IpFilterConfig::fromArray([
            'enabled' => true,
            'mode' => 'blocklist',
            'blocklist' => ['192.168.1.0/24'],
        ]);

        $this->assertNotNull($config);
        $this->assertTrue($config->enabled);
        $this->assertEquals(IpFilterMode::BLOCKLIST, $config->mode);
        $this->assertEquals(['192.168.1.0/24'], $config->blocklist);
    }

    public function testIpFilterConfigFromArrayWithDefaults(): void
    {
        $config = IpFilterConfig::fromArray([]);

        $this->assertNotNull($config);
        $this->assertFalse($config->enabled);
        $this->assertEquals(IpFilterMode::BLOCKLIST, $config->mode);
        $this->assertEquals([], $config->allowlist);
        $this->assertEquals([], $config->blocklist);
        $this->assertTrue($config->logBlocked);
        $this->assertEquals(403, $config->blockedStatusCode);
        $this->assertEquals('Forbidden', $config->blockedMessage);
    }

    public function testIpFilterConfigFromArrayNull(): void
    {
        $this->assertNull(IpFilterConfig::fromArray(null));
    }

    // ─────────────────────────────────────────────────────────────────
    // PocketPing Integration Tests
    // ─────────────────────────────────────────────────────────────────

    public function testPocketPingAcceptsIpFilterArray(): void
    {
        $pp = new PocketPing(
            ipFilter: [
                'enabled' => true,
                'mode' => 'blocklist',
                'blocklist' => ['192.168.1.0/24'],
            ],
        );

        $ipFilter = $pp->getIpFilter();
        $this->assertNotNull($ipFilter);
        $this->assertTrue($ipFilter->enabled);
        $this->assertEquals(['192.168.1.0/24'], $ipFilter->blocklist);
    }

    public function testPocketPingAcceptsIpFilterConfig(): void
    {
        $config = new IpFilterConfig(
            enabled: true,
            mode: IpFilterMode::ALLOWLIST,
            allowlist: ['10.0.0.0/8'],
        );

        $pp = new PocketPing(ipFilter: $config);

        $this->assertSame($config, $pp->getIpFilter());
    }

    public function testPocketPingCheckIpFilter(): void
    {
        $pp = new PocketPing(
            ipFilter: [
                'enabled' => true,
                'mode' => 'blocklist',
                'blocklist' => ['192.168.1.0/24'],
            ],
        );

        $blockedResult = $pp->checkIpFilter('192.168.1.50');
        $this->assertFalse($blockedResult->allowed);
        $this->assertEquals(IpFilterReason::BLOCKLIST, $blockedResult->reason);

        $allowedResult = $pp->checkIpFilter('10.0.0.1');
        $this->assertTrue($allowedResult->allowed);
        $this->assertEquals(IpFilterReason::DEFAULT, $allowedResult->reason);
    }

    public function testPocketPingCreateBlockedResponse(): void
    {
        $pp = new PocketPing(
            ipFilter: [
                'enabled' => true,
                'blockedStatusCode' => 403,
                'blockedMessage' => 'Access Denied',
            ],
        );

        $response = $pp->createBlockedResponse();
        $this->assertEquals(403, $response['status']);
        $this->assertEquals('application/json', $response['headers']['Content-Type']);
        $this->assertStringContainsString('Access Denied', $response['body']);
    }
}

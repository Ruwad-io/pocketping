<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\Utils\BotDetection;

class BotDetectionTest extends TestCase
{
    // ─────────────────────────────────────────────────────────────────
    // isDatacenterIp Tests
    // ─────────────────────────────────────────────────────────────────

    public function testIsDatacenterIpMatchesIpv4Ranges(): void
    {
        // Google Cloud (34.0.0.0/9), OVH (51.75.0.0/16),
        // Hetzner (5.9.0.0/16), DigitalOcean (159.65.0.0/16).
        $this->assertTrue(BotDetection::isDatacenterIp('34.72.176.129'));
        $this->assertTrue(BotDetection::isDatacenterIp('51.75.1.1'));
        $this->assertTrue(BotDetection::isDatacenterIp('5.9.1.1'));
        $this->assertTrue(BotDetection::isDatacenterIp('159.65.1.1'));
    }

    public function testIsDatacenterIpMatchesIpv6Ranges(): void
    {
        // OVH (2001:41d0::/32), Hetzner (2a01:4f8::/29).
        $this->assertTrue(BotDetection::isDatacenterIp('2001:41d0:350:1400::1'));
        $this->assertTrue(BotDetection::isDatacenterIp('2a01:4f8::1'));
    }

    public function testIsDatacenterIpMatchesBracketedIpv6(): void
    {
        $this->assertTrue(BotDetection::isDatacenterIp('[2a01:4f8::1]'));
    }

    public function testIsDatacenterIpResidentialAndUnknown(): void
    {
        // Public DNS / residential-style addresses not in the datacenter list.
        $this->assertFalse(BotDetection::isDatacenterIp('8.8.8.8'));
        $this->assertFalse(BotDetection::isDatacenterIp('1.1.1.1'));
        $this->assertFalse(BotDetection::isDatacenterIp('192.168.1.1'));
        $this->assertFalse(BotDetection::isDatacenterIp('unknown'));
        $this->assertFalse(BotDetection::isDatacenterIp('UNKNOWN'));
        $this->assertFalse(BotDetection::isDatacenterIp(''));
    }

    public function testIsDatacenterIpGarbageInput(): void
    {
        $this->assertFalse(BotDetection::isDatacenterIp('not-an-ip'));
        $this->assertFalse(BotDetection::isDatacenterIp('999.999.999.999'));
        $this->assertFalse(BotDetection::isDatacenterIp('34.72.176'));
    }

    // ─────────────────────────────────────────────────────────────────
    // isHeadlessUserAgent Tests
    // ─────────────────────────────────────────────────────────────────

    public function testIsHeadlessUserAgentDetectsMarkers(): void
    {
        $this->assertTrue(BotDetection::isHeadlessUserAgent(
            'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36'
        ));
        $this->assertTrue(BotDetection::isHeadlessUserAgent('python-requests/2.31.0'));
        $this->assertTrue(BotDetection::isHeadlessUserAgent('curl/8.4.0'));
    }

    public function testIsHeadlessUserAgentAllowsRealChrome(): void
    {
        $realChrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            . '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        $this->assertFalse(BotDetection::isHeadlessUserAgent($realChrome));
    }

    public function testIsHeadlessUserAgentEmptyAndNull(): void
    {
        $this->assertFalse(BotDetection::isHeadlessUserAgent(''));
        $this->assertFalse(BotDetection::isHeadlessUserAgent(null));
    }

    // ─────────────────────────────────────────────────────────────────
    // isHostingOrg Tests
    // ─────────────────────────────────────────────────────────────────

    public function testIsHostingOrgDetectsHostingProviders(): void
    {
        $this->assertTrue(BotDetection::isHostingOrg('Hetzner Online GmbH'));
        $this->assertTrue(BotDetection::isHostingOrg('DigitalOcean, LLC'));
        $this->assertTrue(BotDetection::isHostingOrg('Vultr Holdings, LLC'));
    }

    public function testIsHostingOrgExcludesBroadBrands(): void
    {
        // Broad consumer brands are intentionally excluded — they also run
        // residential ASNs and their cloud ranges are covered by the CIDR list.
        $this->assertFalse(BotDetection::isHostingOrg('Google Fiber Inc.'));
        $this->assertFalse(BotDetection::isHostingOrg('Google LLC'));
        $this->assertFalse(BotDetection::isHostingOrg('AMAZON-02'));
        $this->assertFalse(BotDetection::isHostingOrg('Orange S.A.'));
    }

    public function testIsHostingOrgEmptyAndNull(): void
    {
        $this->assertFalse(BotDetection::isHostingOrg(''));
        $this->assertFalse(BotDetection::isHostingOrg(null));
    }

    // ─────────────────────────────────────────────────────────────────
    // detectBot Tests
    // ─────────────────────────────────────────────────────────────────

    public function testDetectBotDatacenterIp(): void
    {
        $verdict = BotDetection::detectBot('34.72.176.129', null, null);
        $this->assertTrue($verdict['isBot']);
        $this->assertEquals('datacenter_ip', $verdict['reason']);
    }

    public function testDetectBotHostingAsn(): void
    {
        // Clean IP/UA, but a hosting ASN org name.
        $verdict = BotDetection::detectBot('8.8.8.8', null, 'Hetzner Online GmbH');
        $this->assertTrue($verdict['isBot']);
        $this->assertEquals('hosting_asn', $verdict['reason']);
    }

    public function testDetectBotHeadlessUa(): void
    {
        $verdict = BotDetection::detectBot('8.8.8.8', 'python-requests/2.31.0', null);
        $this->assertTrue($verdict['isBot']);
        $this->assertEquals('headless_ua', $verdict['reason']);
    }

    public function testDetectBotCleanResidentialIsNotBot(): void
    {
        $realChrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            . '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        $verdict = BotDetection::detectBot('8.8.8.8', $realChrome, 'Orange S.A.');
        $this->assertFalse($verdict['isBot']);
        $this->assertNull($verdict['reason']);
    }

    public function testDetectBotDatacenterTakesPrecedence(): void
    {
        // Datacenter IP is checked before the (clean) UA path.
        $verdict = BotDetection::detectBot('159.65.1.1', 'python-requests/2.31.0', null);
        $this->assertTrue($verdict['isBot']);
        $this->assertEquals('datacenter_ip', $verdict['reason']);
    }

    public function testDetectBotAllNullInputs(): void
    {
        $verdict = BotDetection::detectBot(null, null, null);
        $this->assertFalse($verdict['isBot']);
        $this->assertNull($verdict['reason']);
    }
}

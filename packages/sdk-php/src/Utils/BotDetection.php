<?php

declare(strict_types=1);

namespace PocketPing\Utils;

/**
 * Heuristic bot detection for widget connections.
 *
 * Many widget sessions are bots that load the page (running JS, so the widget
 * connects) but never send a message. They spoof real-browser User-Agents — so
 * UA-pattern filtering does NOT catch them — but they originate from datacenter
 * / cloud IP ranges. This lets callers flag such connections and skip the
 * operator "new visitor" notification (the session can still be created, and a
 * thread created on-demand if the visitor ever actually sends a message, so
 * false positives self-heal).
 *
 * Dependency-free: a bundled list of well-known cloud/datacenter CIDR ranges
 * plus obvious headless/automation UA markers, and an optional ASN org-name
 * signal. Mirrors the canonical sdk-go bot_detection.go for cross-mode parity.
 */
final class BotDetection
{
    /**
     * Curated (non-exhaustive) list of cloud/datacenter ranges that dominate
     * scraper / headless-browser traffic. Refresh periodically from providers'
     * published ranges.
     *
     * @var string[]
     */
    public const DEFAULT_DATACENTER_CIDRS = [
        // Google Cloud (the 34.x / 35.x ranges seen dominating real traffic)
        '34.0.0.0/9', '34.128.0.0/10', '35.184.0.0/13', '35.192.0.0/14',
        '35.196.0.0/15', '35.198.0.0/16', '35.200.0.0/13', '35.208.0.0/12',
        '35.224.0.0/12', '35.240.0.0/13', '104.196.0.0/14', '104.154.0.0/15',
        '130.211.0.0/16', '146.148.0.0/17',
        // Amazon AWS
        '3.0.0.0/9', '13.32.0.0/15', '15.177.0.0/18', '18.32.0.0/11',
        '52.0.0.0/11', '54.64.0.0/11', '99.77.0.0/18',
        // Microsoft Azure
        '13.64.0.0/11', '20.0.0.0/11', '40.64.0.0/10', '52.224.0.0/11', '104.40.0.0/13',
        // DigitalOcean
        '104.131.0.0/16', '138.197.0.0/16', '142.93.0.0/16', '159.65.0.0/16',
        '165.227.0.0/16', '167.71.0.0/16', '167.99.0.0/16', '178.62.0.0/16',
        '188.166.0.0/16',
        // OVH
        '51.68.0.0/14', '51.75.0.0/16', '51.81.0.0/16', '54.36.0.0/16',
        '145.239.0.0/16', '147.135.0.0/16', '198.27.64.0/18',
        // Hetzner
        '5.9.0.0/16', '78.46.0.0/15', '88.99.0.0/16', '94.130.0.0/16',
        '116.202.0.0/15', '135.181.0.0/16', '136.243.0.0/16', '142.132.0.0/16',
        '157.90.0.0/16', '159.69.0.0/16', '167.235.0.0/16', '168.119.0.0/16',
        '188.40.0.0/16',
        // Linode / Akamai
        '45.33.0.0/16', '45.56.0.0/16', '45.79.0.0/16', '139.144.0.0/16',
        '172.104.0.0/15', '173.255.192.0/18',
        // Scaleway / Online.net
        '51.15.0.0/16', '51.158.0.0/15', '163.172.0.0/16', '195.154.0.0/16',
        '212.83.128.0/19',
        // Datacenter IPv6 prefixes
        '2600:1f00::/24', '2a05:d000::/24', '2001:41d0::/32', '2a01:4f8::/29',
        '2604:a880::/32', '2a03:b0c0::/32', '2607:f8b0::/32', '2a00:1450::/32',
    ];

    /**
     * Obvious automation/headless User-Agent substrings (lowercase).
     *
     * @var string[]
     */
    public const HEADLESS_UA_MARKERS = [
        'headlesschrome', 'phantomjs', 'electron', 'puppeteer', 'playwright',
        'selenium', 'webdriver', 'python-requests', 'curl/', 'wget/',
        'go-http-client', 'node-fetch', 'axios/', 'java/', 'okhttp',
    ];

    /**
     * UNAMBIGUOUS hosting/datacenter ASN org-name substrings (lowercase).
     *
     * Broad consumer brands (google/amazon/microsoft/cloudflare) are
     * intentionally excluded — they also run residential ASNs (e.g. "Google
     * Fiber") and their cloud ranges are covered by DEFAULT_DATACENTER_CIDRS
     * instead.
     *
     * @var string[]
     */
    public const HOSTING_ORG_MARKERS = [
        'digitalocean', 'ovh', 'hetzner', 'linode', 'scaleway', 'vultr',
        'leaseweb', 'contabo', 'datacamp', 'm247', 'choopa', 'datacenter',
        'data center', 'hosting',
    ];

    /**
     * Report whether the given IP belongs to a known datacenter/cloud range.
     */
    public static function isDatacenterIp(string $ip): bool
    {
        $ip = trim($ip);
        if ($ip === '' || strcasecmp($ip, 'unknown') === 0) {
            return false;
        }

        // Strip IPv6 brackets, e.g. "[2a01:4f8::1]".
        $ip = trim($ip, '[]');

        $packed = @inet_pton($ip);
        if ($packed === false) {
            return false;
        }

        foreach (self::DEFAULT_DATACENTER_CIDRS as $cidr) {
            if (self::ipInCidr($packed, $cidr)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Report whether the given UA contains an obvious automation marker.
     */
    public static function isHeadlessUserAgent(?string $ua): bool
    {
        if ($ua === null || $ua === '') {
            return false;
        }

        $lower = strtolower($ua);
        foreach (self::HEADLESS_UA_MARKERS as $marker) {
            if (str_contains($lower, $marker)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Report whether the given ASN org name is an unambiguous hosting provider.
     */
    public static function isHostingOrg(?string $org): bool
    {
        if ($org === null || $org === '') {
            return false;
        }

        $lower = strtolower($org);
        foreach (self::HOSTING_ORG_MARKERS as $marker) {
            if (str_contains($lower, $marker)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Return a heuristic verdict for a widget connection. A connection is
     * flagged when it comes from a datacenter IP (or hosting ASN) or carries a
     * headless UA marker.
     *
     * @return array{isBot: bool, reason: ?string} reason ∈
     *     'datacenter_ip' | 'hosting_asn' | 'headless_ua' | null
     */
    public static function detectBot(?string $ip, ?string $ua, ?string $org): array
    {
        if ($ip !== null && self::isDatacenterIp($ip)) {
            return ['isBot' => true, 'reason' => 'datacenter_ip'];
        }
        if (self::isHostingOrg($org)) {
            return ['isBot' => true, 'reason' => 'hosting_asn'];
        }
        if (self::isHeadlessUserAgent($ua)) {
            return ['isBot' => true, 'reason' => 'headless_ua'];
        }

        return ['isBot' => false, 'reason' => null];
    }

    /**
     * Test whether a packed IP address (from inet_pton) falls within a CIDR.
     * Supports IPv4 and IPv6. The address family must match the CIDR's family.
     */
    private static function ipInCidr(string $packedIp, string $cidr): bool
    {
        if (!str_contains($cidr, '/')) {
            return false;
        }

        [$subnet, $bitsStr] = explode('/', $cidr, 2);
        $bits = (int) $bitsStr;

        $packedSubnet = @inet_pton($subnet);
        if ($packedSubnet === false) {
            return false;
        }

        // Address families must match (4 bytes for IPv4, 16 for IPv6).
        if (strlen($packedIp) !== strlen($packedSubnet)) {
            return false;
        }

        $maxBits = strlen($packedSubnet) * 8;
        if ($bits < 0 || $bits > $maxBits) {
            return false;
        }
        if ($bits === 0) {
            return true;
        }

        $fullBytes = intdiv($bits, 8);
        $remainderBits = $bits % 8;

        // Compare whole bytes covered by the prefix.
        if ($fullBytes > 0 && substr($packedIp, 0, $fullBytes) !== substr($packedSubnet, 0, $fullBytes)) {
            return false;
        }

        // Compare the partial trailing byte, if any.
        if ($remainderBits > 0) {
            $mask = (~0 << (8 - $remainderBits)) & 0xFF;
            $ipByte = ord($packedIp[$fullBytes]);
            $subnetByte = ord($packedSubnet[$fullBytes]);
            if (($ipByte & $mask) !== ($subnetByte & $mask)) {
                return false;
            }
        }

        return true;
    }
}

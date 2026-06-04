/**
 * Heuristic bot detection for widget connections.
 *
 * Many widget sessions are bots that load the page (running JS, so the widget
 * connects) but never send a message. They spoof real-browser User-Agents — so
 * UA-pattern filtering (see user-agent-filter.ts) does NOT catch them — but they
 * originate from datacenter / cloud IP ranges. This lets callers flag such
 * connections and skip the operator "new visitor" notification (the session can
 * still be created, and a thread created on-demand if the visitor ever actually
 * sends a message, so false positives self-heal).
 *
 * Detection is intentionally dependency-free: a bundled list of well-known cloud
 * / datacenter CIDR ranges plus obvious headless/automation UA markers, and an
 * optional ASN org-name signal. Mirrors the Go SDK bot_detection.go and the SaaS
 * lib/bot-detection.ts for cross-mode parity.
 */

// ── Datacenter / cloud IPv4 CIDR ranges (curated, refreshable) ───────────────
// Not exhaustive — covers the largest cloud providers that dominate scraper /
// headless-browser traffic. Refresh periodically from providers' published
// ranges (GCP cloud.json, AWS ip-ranges.json, Azure ServiceTags, etc.).
export const DATACENTER_CIDRS_V4: string[] = [
  // Google Cloud (the 34.x / 35.x ranges seen dominating real traffic)
  '34.0.0.0/9',
  '34.128.0.0/10',
  '35.184.0.0/13',
  '35.192.0.0/14',
  '35.196.0.0/15',
  '35.198.0.0/16',
  '35.200.0.0/13',
  '35.208.0.0/12',
  '35.224.0.0/12',
  '35.240.0.0/13',
  '104.196.0.0/14',
  '104.154.0.0/15',
  '130.211.0.0/16',
  '146.148.0.0/17',
  // Amazon AWS (major blocks)
  '3.0.0.0/9',
  '13.32.0.0/15',
  '15.177.0.0/18',
  '18.32.0.0/11',
  '52.0.0.0/11',
  '54.64.0.0/11',
  '99.77.0.0/18',
  // Microsoft Azure (major blocks)
  '13.64.0.0/11',
  '20.0.0.0/11',
  '40.64.0.0/10',
  '52.224.0.0/11',
  '104.40.0.0/13',
  // DigitalOcean
  '104.131.0.0/16',
  '138.197.0.0/16',
  '142.93.0.0/16',
  '159.65.0.0/16',
  '165.227.0.0/16',
  '167.71.0.0/16',
  '167.99.0.0/16',
  '178.62.0.0/16',
  '188.166.0.0/16',
  // OVH
  '51.68.0.0/14',
  '51.75.0.0/16',
  '51.81.0.0/16',
  '54.36.0.0/16',
  '145.239.0.0/16',
  '147.135.0.0/16',
  '198.27.64.0/18',
  // Hetzner
  '5.9.0.0/16',
  '78.46.0.0/15',
  '88.99.0.0/16',
  '94.130.0.0/16',
  '116.202.0.0/15',
  '135.181.0.0/16',
  '136.243.0.0/16',
  '142.132.0.0/16',
  '157.90.0.0/16',
  '159.69.0.0/16',
  '167.235.0.0/16',
  '168.119.0.0/16',
  '188.40.0.0/16',
  // Linode / Akamai
  '45.33.0.0/16',
  '45.56.0.0/16',
  '45.79.0.0/16',
  '139.144.0.0/16',
  '172.104.0.0/15',
  '173.255.192.0/18',
  // Scaleway / Online.net
  '51.15.0.0/16',
  '51.158.0.0/15',
  '163.172.0.0/16',
  '195.154.0.0/16',
  '212.83.128.0/19',
];

// Datacenter IPv6 prefixes (provider-assigned blocks). Matched on string prefix
// of the normalized leading hextets — enough to flag the common offenders.
export const DATACENTER_V6_PREFIXES: string[] = [
  '2600:1f', // AWS
  '2a05:d0', // AWS (eu)
  '2001:41d0', // OVH
  // Hetzner 2a01:4f8::/29 spans the second hextet 4f8..4ff (parity with the Go CIDR).
  '2a01:4f8', // Hetzner
  '2a01:4f9', // Hetzner
  '2a01:4fa', // Hetzner
  '2a01:4fb', // Hetzner
  '2a01:4fc', // Hetzner
  '2a01:4fd', // Hetzner
  '2a01:4fe', // Hetzner
  '2a01:4ff', // Hetzner
  '2604:a880', // DigitalOcean
  '2a03:b0c0', // DigitalOcean
  '2607:f8b0', // Google
  '2a00:1450', // Google
];

// Obvious headless / automation User-Agent markers.
export const HEADLESS_UA_MARKERS: string[] = [
  'headlesschrome',
  'phantomjs',
  'electron',
  'puppeteer',
  'playwright',
  'selenium',
  'webdriver',
  'python-requests',
  'curl/',
  'wget/',
  'go-http-client',
  'node-fetch',
  'axios/',
  'java/',
  'okhttp',
];

// UNAMBIGUOUS hosting/datacenter ASN org-name substrings. Broad consumer brands
// (google/amazon/microsoft/cloudflare/akamai) are intentionally excluded — they
// also run residential ASNs (e.g. "Google Fiber") and their cloud ranges are
// covered by DATACENTER_CIDRS_V4 / DATACENTER_V6_PREFIXES instead.
export const HOSTING_ORG_MARKERS: string[] = [
  'digitalocean',
  'ovh',
  'hetzner',
  'linode',
  'scaleway',
  'vultr',
  'leaseweb',
  'contabo',
  'datacamp',
  'm247',
  'choopa',
  'datacenter',
  'data center',
  'hosting',
];

// ── IP parsing / CIDR matching (IPv4) ────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function ipv4InCidr(ipInt: number, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const rangeInt = ipv4ToInt(range);
  if (rangeInt === null) return false;
  const bits = Number(bitsStr);
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/** Returns true when the IP belongs to a known datacenter / cloud range. */
export function isDatacenterIp(ip: string | null | undefined): boolean {
  if (!ip || ip === 'unknown') return false;
  let trimmed = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

  // IPv4-mapped IPv6 (e.g. ::ffff:34.72.176.129) — match the embedded IPv4 so
  // mapped datacenter clients (common from socket.remoteAddress) aren't missed.
  const mapped = trimmed.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) {
    trimmed = mapped[1];
  } else if (trimmed.includes(':')) {
    return DATACENTER_V6_PREFIXES.some((p) => trimmed.startsWith(p));
  }

  const ipInt = ipv4ToInt(trimmed);
  if (ipInt === null) return false;
  return DATACENTER_CIDRS_V4.some((cidr) => ipv4InCidr(ipInt, cidr));
}

/** Returns true when the User-Agent contains an obvious automation marker. */
export function isHeadlessUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return HEADLESS_UA_MARKERS.some((m) => ua.includes(m));
}

/**
 * Returns true when the ASN org name is an UNAMBIGUOUS hosting/cloud provider.
 *
 * Deliberately excludes broad brand names like Google / Amazon / Microsoft /
 * Cloudflare / Akamai: those brands also operate residential/consumer ASNs
 * (e.g. "Google Fiber Inc.", Amazon retail/corp, Cloudflare WARP), so matching
 * the bare brand would flag real visitors as bots. Their *cloud* ranges are
 * covered precisely by the CIDR list above, so we rely on the datacenter_ip
 * signal for them and keep this matcher to providers whose org name is
 * essentially always a datacenter.
 */
export function isHostingOrg(org: string | null | undefined): boolean {
  if (!org) return false;
  const o = org.toLowerCase();
  return HOSTING_ORG_MARKERS.some((p) => o.includes(p));
}

export interface BotSignal {
  ip?: string | null;
  userAgent?: string | null;
  org?: string | null;
}

export type BotReason = 'datacenter_ip' | 'hosting_asn' | 'headless_ua' | null;

export interface BotVerdict {
  isBot: boolean;
  reason: BotReason;
}

/**
 * Heuristic verdict for a widget connection. A connection is flagged when it
 * comes from a datacenter IP (or hosting ASN), or carries a headless UA marker.
 */
export function detectBot(signal: BotSignal): BotVerdict {
  if (isDatacenterIp(signal.ip)) {
    return { isBot: true, reason: 'datacenter_ip' };
  }
  if (isHostingOrg(signal.org)) {
    return { isBot: true, reason: 'hosting_asn' };
  }
  if (isHeadlessUserAgent(signal.userAgent)) {
    return { isBot: true, reason: 'headless_ua' };
  }
  return { isBot: false, reason: null };
}

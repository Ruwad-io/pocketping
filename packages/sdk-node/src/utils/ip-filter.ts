/**
 * IP Filtering utilities for PocketPing SDK
 * Supports CIDR notation and individual IP addresses
 */

export type IpFilterMode = 'allowlist' | 'blocklist' | 'both';

export interface IpFilterConfig {
  /** Enable/disable IP filtering (default: false) */
  enabled?: boolean;
  /** Filter mode (default: 'blocklist') */
  mode?: IpFilterMode;
  /** IPs/CIDRs to allow (e.g., ['192.168.1.0/24', '10.0.0.1']) */
  allowlist?: string[];
  /** IPs/CIDRs to block (e.g., ['203.0.113.0/24', '198.51.100.50']) */
  blocklist?: string[];
  /** Custom filter callback for advanced logic */
  customFilter?: IpFilterCallback;
  /** Log blocked requests for security auditing (default: true) */
  logBlocked?: boolean;
  /** Custom logger function */
  logger?: (event: IpFilterLogEvent) => void;
  /** HTTP status code for blocked requests (default: 403) */
  blockedStatusCode?: number;
  /** Response message for blocked requests (default: 'Forbidden') */
  blockedMessage?: string;
  /** Trust proxy headers (X-Forwarded-For, etc.) (default: true) */
  trustProxy?: boolean;
  /** Ordered list of headers to check for client IP */
  proxyHeaders?: string[];
}

export interface IpFilterLogEvent {
  type: 'blocked' | 'allowed';
  ip: string;
  reason: 'allowlist' | 'blocklist' | 'custom' | 'not_in_allowlist' | 'default';
  path: string;
  timestamp: Date;
  sessionId?: string;
}

export interface IpFilterResult {
  allowed: boolean;
  reason: 'allowlist' | 'blocklist' | 'custom' | 'not_in_allowlist' | 'default';
}

/**
 * Custom IP filter callback
 * Return true to allow, false to block, undefined to defer to list-based filtering
 */
export type IpFilterCallback = (
  ip: string,
  request: { path: string; sessionId?: string }
) => boolean | undefined | Promise<boolean | undefined>;

/**
 * Parse an IPv4 address to a 32-bit unsigned number
 * Returns null for invalid IPs
 */
export function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0; // Convert to unsigned
}

/**
 * Parse CIDR notation to base IP and mask
 * Supports both '192.168.1.0/24' and '192.168.1.1' formats
 */
export function parseCidr(cidr: string): { base: number; mask: number } | null {
  const [ip, bits] = cidr.split('/');
  const base = ipToNumber(ip);
  if (base === null) return null;

  const prefix = bits ? parseInt(bits, 10) : 32;
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return null;

  // Create mask: prefix 1-bits followed by (32-prefix) 0-bits
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;

  return { base: (base & mask) >>> 0, mask };
}

/**
 * Check if an IP matches a CIDR range or exact IP
 */
export function ipMatchesCidr(ip: string, cidr: string): boolean {
  const ipNum = ipToNumber(ip);
  if (ipNum === null) return false;

  const parsed = parseCidr(cidr);
  if (!parsed) return false;

  return ((ipNum & parsed.mask) >>> 0) === parsed.base;
}

/**
 * Check if IP matches any entry in a list of IPs/CIDRs
 */
export function ipMatchesAny(ip: string, list: string[]): boolean {
  return list.some((entry) => ipMatchesCidr(ip, entry));
}

/**
 * Main IP filter function - determines if an IP should be allowed
 */
export function shouldAllowIp(
  ip: string,
  config: IpFilterConfig
): IpFilterResult {
  const { mode = 'blocklist', allowlist = [], blocklist = [] } = config;

  switch (mode) {
    case 'allowlist':
      // Only allow if in allowlist
      if (ipMatchesAny(ip, allowlist)) {
        return { allowed: true, reason: 'allowlist' };
      }
      return { allowed: false, reason: 'not_in_allowlist' };

    case 'blocklist':
      // Block if in blocklist, allow otherwise
      if (ipMatchesAny(ip, blocklist)) {
        return { allowed: false, reason: 'blocklist' };
      }
      return { allowed: true, reason: 'default' };

    case 'both':
      // Allowlist takes precedence, then check blocklist
      if (ipMatchesAny(ip, allowlist)) {
        return { allowed: true, reason: 'allowlist' };
      }
      if (ipMatchesAny(ip, blocklist)) {
        return { allowed: false, reason: 'blocklist' };
      }
      return { allowed: true, reason: 'default' };

    default:
      return { allowed: true, reason: 'default' };
  }
}

/**
 * Check IP filter with support for custom filter callback
 */
export async function checkIpFilter(
  ip: string,
  config: IpFilterConfig,
  requestInfo: { path: string; sessionId?: string }
): Promise<IpFilterResult> {
  // 1. Check custom filter first
  if (config.customFilter) {
    const customResult = await config.customFilter(ip, requestInfo);
    if (customResult === true) return { allowed: true, reason: 'custom' };
    if (customResult === false) return { allowed: false, reason: 'custom' };
    // undefined = fall through to list-based filtering
  }

  // 2. Apply list-based filtering
  return shouldAllowIp(ip, config);
}

/**
 * Default proxy headers to check for client IP (in order of preference)
 */
export const DEFAULT_PROXY_HEADERS = [
  'cf-connecting-ip', // Cloudflare
  'x-forwarded-for', // Standard proxy header
  'x-real-ip', // Nginx
  'x-client-ip', // Apache
];

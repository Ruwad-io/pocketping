/**
 * IP filtering utilities for Bridge Server
 */

export type IpFilterMode = "blocklist" | "allowlist" | "both";

export type IpFilterReason =
  | "blocklist"
  | "allowlist"
  | "not_in_allowlist"
  | "custom"
  | "default"
  | "disabled";

export interface IpFilterResult {
  allowed: boolean;
  reason: IpFilterReason;
  matchedRule?: string;
}

export interface IpFilterLogEvent {
  ip: string;
  allowed: boolean;
  reason: IpFilterReason;
  matchedRule?: string;
  timestamp: string;
  requestInfo?: Record<string, unknown>;
}

export interface IpFilterConfig {
  enabled?: boolean;
  mode?: IpFilterMode;
  allowlist?: string[];
  blocklist?: string[];
  customFilter?: (
    ip: string,
    requestInfo?: Record<string, unknown>
  ) => boolean | undefined | Promise<boolean | undefined>;
  logBlocked?: boolean;
  blockedStatusCode?: number;
  blockedMessage?: string;
  onBlocked?: (event: IpFilterLogEvent) => void;
}

/**
 * Convert IPv4 address to a number for comparison
 */
export function ipToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) + num;
  }

  // Convert to unsigned 32-bit
  return result >>> 0;
}

/**
 * Parse CIDR notation to network address and mask
 */
export function parseCidr(cidr: string): { network: number; mask: number } | null {
  let ip: string;
  let bits: number;

  if (cidr.includes("/")) {
    const parts = cidr.split("/");
    ip = parts[0];
    bits = parseInt(parts[1], 10);
    if (isNaN(bits) || bits < 0 || bits > 32) return null;
  } else {
    // Treat as /32 (single IP)
    ip = cidr;
    bits = 32;
  }

  const network = ipToNumber(ip);
  if (network === null) return null;

  // Create mask
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;

  return { network, mask };
}

/**
 * Check if an IP matches a CIDR range
 */
export function ipMatchesCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr);
  if (!parsed) return false;

  const ipNum = ipToNumber(ip);
  if (ipNum === null) return false;

  return (ipNum & parsed.mask) === (parsed.network & parsed.mask);
}

/**
 * Check if an IP matches any entry in a list
 */
export function ipMatchesAny(ip: string, entries: string[]): string | undefined {
  for (const entry of entries) {
    if (ipMatchesCidr(ip, entry)) {
      return entry;
    }
  }
  return undefined;
}

/**
 * Check if an IP should be allowed based on config (without custom filter)
 */
export function shouldAllowIp(ip: string, config: IpFilterConfig | null | undefined): IpFilterResult {
  if (!config || !config.enabled) {
    return { allowed: true, reason: "disabled" };
  }

  const mode = config.mode || "blocklist";

  switch (mode) {
    case "blocklist": {
      const matched = ipMatchesAny(ip, config.blocklist || []);
      if (matched) {
        return { allowed: false, reason: "blocklist", matchedRule: matched };
      }
      return { allowed: true, reason: "default" };
    }

    case "allowlist": {
      const matched = ipMatchesAny(ip, config.allowlist || []);
      if (matched) {
        return { allowed: true, reason: "allowlist", matchedRule: matched };
      }
      return { allowed: false, reason: "not_in_allowlist" };
    }

    case "both": {
      // Allowlist takes precedence
      const allowlistMatched = ipMatchesAny(ip, config.allowlist || []);
      if (allowlistMatched) {
        return { allowed: true, reason: "allowlist", matchedRule: allowlistMatched };
      }

      // Then check blocklist
      const blocklistMatched = ipMatchesAny(ip, config.blocklist || []);
      if (blocklistMatched) {
        return { allowed: false, reason: "blocklist", matchedRule: blocklistMatched };
      }

      // Default allow if not in either list
      return { allowed: true, reason: "default" };
    }

    default:
      return { allowed: true, reason: "default" };
  }
}

/**
 * Full IP filter check including custom filter
 */
export async function checkIpFilter(
  ip: string,
  config: IpFilterConfig | null | undefined,
  requestInfo?: Record<string, unknown>
): Promise<IpFilterResult> {
  if (!config || !config.enabled) {
    return { allowed: true, reason: "disabled" };
  }

  // Check custom filter first
  if (config.customFilter) {
    try {
      const customResult = await config.customFilter(ip, requestInfo);
      if (customResult !== undefined) {
        return { allowed: customResult, reason: "custom" };
      }
    } catch (err) {
      console.error("[IpFilter] Custom filter error:", err);
    }
  }

  // Fall back to list-based filtering
  return shouldAllowIp(ip, config);
}

/**
 * Get client IP from request headers (Hono context)
 */
export function getClientIp(headers: Headers, remoteAddr?: string): string {
  // Check common proxy headers
  const cfIp = headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp.trim();

  const forwardedFor = headers.get("X-Forwarded-For");
  if (forwardedFor) {
    // Take first IP in chain (original client)
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = headers.get("X-Real-IP");
  if (realIp) return realIp.trim();

  // Fall back to remote address
  return remoteAddr || "";
}

/**
 * Log an IP filter event
 */
export function logFilterEvent(
  config: IpFilterConfig | null | undefined,
  result: IpFilterResult,
  ip: string,
  requestInfo?: Record<string, unknown>
): void {
  if (!config?.logBlocked || result.allowed) {
    return;
  }

  const event: IpFilterLogEvent = {
    ip,
    allowed: result.allowed,
    reason: result.reason,
    matchedRule: result.matchedRule,
    timestamp: new Date().toISOString(),
    requestInfo,
  };

  console.warn(
    `[IpFilter] IP blocked: ${ip} (reason: ${result.reason}${
      result.matchedRule ? `, rule: ${result.matchedRule}` : ""
    })`
  );

  // Call onBlocked callback if provided
  if (config.onBlocked) {
    try {
      config.onBlocked(event);
    } catch (err) {
      console.error("[IpFilter] onBlocked callback error:", err);
    }
  }
}

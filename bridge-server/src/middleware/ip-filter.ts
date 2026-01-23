/**
 * IP filter middleware for Hono
 */

import type { Context, Next } from "hono";
import type { IpFilterConfig } from "../utils/ip-filter";
import { checkIpFilter, getClientIp, logFilterEvent } from "../utils/ip-filter";

/**
 * Create IP filter middleware for Hono
 */
export function createIpFilterMiddleware(config: IpFilterConfig | null | undefined) {
  return async (c: Context, next: Next) => {
    // Skip if filtering is disabled
    if (!config?.enabled) {
      return await next();
    }

    // Get client IP
    const ip = getClientIp(c.req.raw.headers, c.env?.remoteAddr);

    if (!ip) {
      // Can't determine IP, allow by default
      console.warn("[IpFilter] Could not determine client IP, allowing request");
      return await next();
    }

    // Build request info for custom filter and logging
    const requestInfo = {
      path: c.req.path,
      method: c.req.method,
      userAgent: c.req.header("User-Agent"),
    };

    // Check IP filter
    const result = await checkIpFilter(ip, config, requestInfo);

    // Log blocked requests
    logFilterEvent(config, result, ip, requestInfo);

    if (result.allowed) {
      return await next();
    }

    // Return blocked response
    const status = config.blockedStatusCode || 403;
    const message = config.blockedMessage || "Forbidden";

    return c.json({ error: message }, status);
  };
}

/**
 * Factory function for use in route handlers (not as middleware)
 */
export async function checkRequestIpFilter(
  c: Context,
  config: IpFilterConfig | null | undefined
): Promise<{ allowed: boolean; ip: string }> {
  if (!config?.enabled) {
    return { allowed: true, ip: "" };
  }

  const ip = getClientIp(c.req.raw.headers, c.env?.remoteAddr);

  if (!ip) {
    return { allowed: true, ip: "" };
  }

  const requestInfo = {
    path: c.req.path,
    method: c.req.method,
    userAgent: c.req.header("User-Agent"),
  };

  const result = await checkIpFilter(ip, config, requestInfo);
  logFilterEvent(config, result, ip, requestInfo);

  return { allowed: result.allowed, ip };
}

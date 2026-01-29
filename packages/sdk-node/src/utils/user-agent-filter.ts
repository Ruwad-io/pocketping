/**
 * User-Agent Filtering utilities for PocketPing SDK
 * Blocks bots and unwanted user agents to prevent spam sessions
 */

export type UaFilterMode = 'allowlist' | 'blocklist' | 'both';

export type UaFilterReason =
  | 'allowlist'
  | 'blocklist'
  | 'default_bot'
  | 'custom'
  | 'not_in_allowlist'
  | 'default';

export interface UaFilterConfig {
  /** Enable/disable UA filtering (default: false) */
  enabled?: boolean;
  /** Filter mode (default: 'blocklist') */
  mode?: UaFilterMode;
  /** UA patterns to allow (case-insensitive substring match) */
  allowlist?: string[];
  /** UA patterns to block (case-insensitive substring match) */
  blocklist?: string[];
  /** Include default bot patterns in blocklist (default: true) */
  useDefaultBots?: boolean;
  /** Custom filter callback for advanced logic */
  customFilter?: UaFilterCallback;
  /** Log blocked requests for security auditing (default: true) */
  logBlocked?: boolean;
  /** Custom logger function */
  logger?: (event: UaFilterLogEvent) => void;
  /** HTTP status code for blocked requests (default: 403) */
  blockedStatusCode?: number;
  /** Response message for blocked requests (default: 'Forbidden') */
  blockedMessage?: string;
}

export interface UaFilterLogEvent {
  type: 'blocked' | 'allowed';
  userAgent: string;
  reason: UaFilterReason;
  matchedPattern?: string;
  path: string;
  timestamp: Date;
  sessionId?: string;
}

export interface UaFilterResult {
  allowed: boolean;
  reason: UaFilterReason;
  matchedPattern?: string;
}

/**
 * Custom UA filter callback
 * Return true to allow, false to block, undefined to defer to list-based filtering
 */
export type UaFilterCallback = (
  userAgent: string,
  request: { path: string; sessionId?: string }
) => boolean | undefined | Promise<boolean | undefined>;

/**
 * Default bot patterns to block
 * These are known bots, crawlers, and automated tools that shouldn't create chat sessions
 */
export const DEFAULT_BOT_PATTERNS: string[] = [
  // ─────────────────────────────────────────────────────────────────
  // Search Engine Crawlers
  // ─────────────────────────────────────────────────────────────────
  'googlebot',
  'bingbot',
  'slurp', // Yahoo
  'duckduckbot',
  'baiduspider',
  'yandexbot',
  'sogou',
  'exabot',
  'facebot', // Facebook
  'ia_archiver', // Alexa

  // ─────────────────────────────────────────────────────────────────
  // SEO/Analytics Tools
  // ─────────────────────────────────────────────────────────────────
  'semrushbot',
  'ahrefsbot',
  'mj12bot', // Majestic
  'dotbot',
  'rogerbot', // Moz
  'screaming frog',
  'seokicks',
  'sistrix',
  'linkdexbot',
  'blexbot',

  // ─────────────────────────────────────────────────────────────────
  // Generic Bot Indicators
  // ─────────────────────────────────────────────────────────────────
  'bot/',
  'crawler',
  'spider',
  'scraper',
  'headless',
  'phantomjs',
  'selenium',
  'puppeteer',
  'playwright',
  'webdriver',

  // ─────────────────────────────────────────────────────────────────
  // Monitoring/Uptime Services
  // ─────────────────────────────────────────────────────────────────
  'pingdom',
  'uptimerobot',
  'statuscake',
  'site24x7',
  'newrelic',
  'datadog',
  'gtmetrix',
  'pagespeed',

  // ─────────────────────────────────────────────────────────────────
  // Social Media Crawlers
  // ─────────────────────────────────────────────────────────────────
  'twitterbot',
  'linkedinbot',
  'pinterestbot',
  'telegrambot',
  'whatsapp',
  'slackbot',
  'discordbot',
  'applebot',

  // ─────────────────────────────────────────────────────────────────
  // AI/LLM Crawlers
  // ─────────────────────────────────────────────────────────────────
  'gptbot',
  'chatgpt-user',
  'anthropic-ai',
  'claude-web',
  'perplexitybot',
  'ccbot', // Common Crawl
  'bytespider', // ByteDance
  'cohere-ai',

  // ─────────────────────────────────────────────────────────────────
  // HTTP Libraries (automated requests)
  // ─────────────────────────────────────────────────────────────────
  'curl/',
  'wget/',
  'httpie/',
  'python-requests',
  'python-urllib',
  'axios/',
  'node-fetch',
  'go-http-client',
  'java/',
  'okhttp',
  'libwww-perl',
  'httpclient',

  // ─────────────────────────────────────────────────────────────────
  // Archive/Research Bots
  // ─────────────────────────────────────────────────────────────────
  'archive.org_bot',
  'wayback',
  'commoncrawl',

  // ─────────────────────────────────────────────────────────────────
  // Security Scanners
  // ─────────────────────────────────────────────────────────────────
  'nmap',
  'nikto',
  'sqlmap',
  'masscan',
  'zgrab',
];

/**
 * Check if a pattern is a regex (starts and ends with /)
 */
function isRegexPattern(pattern: string): boolean {
  return pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2;
}

/**
 * Extract regex from pattern string (removes leading/trailing /)
 */
function extractRegex(pattern: string): RegExp | null {
  try {
    // Remove leading/trailing slashes
    const regexStr = pattern.slice(1, -1);
    return new RegExp(regexStr, 'i'); // Case-insensitive
  } catch {
    // Invalid regex, return null
    return null;
  }
}

/**
 * Check if a user-agent matches any pattern in the list
 * Supports both substring matching and regex patterns (e.g., /bot-\d+/)
 * Returns the matched pattern or undefined
 */
export function matchesAnyPattern(
  userAgent: string,
  patterns: string[]
): string | undefined {
  const ua = userAgent.toLowerCase();
  for (const pattern of patterns) {
    // Check if pattern is a regex
    if (isRegexPattern(pattern)) {
      const regex = extractRegex(pattern);
      if (regex && regex.test(ua)) {
        return pattern;
      }
    } else {
      // Simple substring match (case-insensitive)
      if (ua.includes(pattern.toLowerCase())) {
        return pattern;
      }
    }
  }
  return undefined;
}

/**
 * Main UA filter function - determines if a user-agent should be allowed
 */
export function shouldAllowUa(
  userAgent: string,
  config: UaFilterConfig
): UaFilterResult {
  const {
    mode = 'blocklist',
    allowlist = [],
    blocklist = [],
    useDefaultBots = true,
  } = config;

  const ua = userAgent.toLowerCase();

  // Build combined blocklist (custom + default bots)
  const combinedBlocklist = [...blocklist];
  if (useDefaultBots) {
    combinedBlocklist.push(...DEFAULT_BOT_PATTERNS);
  }

  switch (mode) {
    case 'allowlist':
      // Only allow if matches allowlist
      const allowMatch = matchesAnyPattern(ua, allowlist);
      if (allowMatch) {
        return { allowed: true, reason: 'allowlist', matchedPattern: allowMatch };
      }
      return { allowed: false, reason: 'not_in_allowlist' };

    case 'blocklist':
      // Block if matches blocklist (including default bots)
      const blockMatch = matchesAnyPattern(ua, combinedBlocklist);
      if (blockMatch) {
        // Determine if it matched a custom pattern or default bot
        const isDefaultBot = !blocklist.some(
          (p) => ua.includes(p.toLowerCase())
        );
        return {
          allowed: false,
          reason: isDefaultBot ? 'default_bot' : 'blocklist',
          matchedPattern: blockMatch,
        };
      }
      return { allowed: true, reason: 'default' };

    case 'both':
      // Allowlist takes precedence, then check blocklist
      const bothAllowMatch = matchesAnyPattern(ua, allowlist);
      if (bothAllowMatch) {
        return {
          allowed: true,
          reason: 'allowlist',
          matchedPattern: bothAllowMatch,
        };
      }
      const bothBlockMatch = matchesAnyPattern(ua, combinedBlocklist);
      if (bothBlockMatch) {
        const isDefaultBot = !blocklist.some(
          (p) => ua.includes(p.toLowerCase())
        );
        return {
          allowed: false,
          reason: isDefaultBot ? 'default_bot' : 'blocklist',
          matchedPattern: bothBlockMatch,
        };
      }
      return { allowed: true, reason: 'default' };

    default:
      return { allowed: true, reason: 'default' };
  }
}

/**
 * Check UA filter with support for custom filter callback
 */
export async function checkUaFilter(
  userAgent: string | undefined,
  config: UaFilterConfig,
  requestInfo: { path: string; sessionId?: string }
): Promise<UaFilterResult> {
  // No user-agent = allow (could be internal request)
  if (!userAgent) {
    return { allowed: true, reason: 'default' };
  }

  // Disabled = allow all
  if (!config.enabled) {
    return { allowed: true, reason: 'default' };
  }

  // 1. Check custom filter first
  if (config.customFilter) {
    const customResult = await config.customFilter(userAgent, requestInfo);
    if (customResult === true)
      return { allowed: true, reason: 'custom' };
    if (customResult === false)
      return { allowed: false, reason: 'custom' };
    // undefined = fall through to list-based filtering
  }

  // 2. Apply list-based filtering
  return shouldAllowUa(userAgent, config);
}

/**
 * Check if a user-agent looks like a bot based on default patterns
 * Utility function for quick bot detection
 */
export function isBot(userAgent: string): boolean {
  return matchesAnyPattern(userAgent, DEFAULT_BOT_PATTERNS) !== undefined;
}

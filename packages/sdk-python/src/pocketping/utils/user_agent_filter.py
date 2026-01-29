"""
User-Agent Filtering utilities for PocketPing SDK.
Blocks bots and unwanted user agents to prevent spam sessions.
Supports both substring matching and regex patterns.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable, List, Literal, Optional, Union

UaFilterMode = Literal["allowlist", "blocklist", "both"]
UaFilterReason = Literal[
    "allowlist", "blocklist", "default_bot", "custom", "not_in_allowlist", "default"
]


# Default bot patterns to block
# These are known bots, crawlers, and automated tools that shouldn't create chat sessions
DEFAULT_BOT_PATTERNS: List[str] = [
    # Search Engine Crawlers
    "googlebot",
    "bingbot",
    "slurp",  # Yahoo
    "duckduckbot",
    "baiduspider",
    "yandexbot",
    "sogou",
    "exabot",
    "facebot",  # Facebook
    "ia_archiver",  # Alexa
    # SEO/Analytics Tools
    "semrushbot",
    "ahrefsbot",
    "mj12bot",  # Majestic
    "dotbot",
    "rogerbot",  # Moz
    "screaming frog",
    "seokicks",
    "sistrix",
    "linkdexbot",
    "blexbot",
    # Generic Bot Indicators
    "bot/",
    "crawler",
    "spider",
    "scraper",
    "headless",
    "phantomjs",
    "selenium",
    "puppeteer",
    "playwright",
    "webdriver",
    # Monitoring/Uptime Services
    "pingdom",
    "uptimerobot",
    "statuscake",
    "site24x7",
    "newrelic",
    "datadog",
    "gtmetrix",
    "pagespeed",
    # Social Media Crawlers
    "twitterbot",
    "linkedinbot",
    "pinterestbot",
    "telegrambot",
    "whatsapp",
    "slackbot",
    "discordbot",
    "applebot",
    # AI/LLM Crawlers
    "gptbot",
    "chatgpt-user",
    "anthropic-ai",
    "claude-web",
    "perplexitybot",
    "ccbot",  # Common Crawl
    "bytespider",  # ByteDance
    "cohere-ai",
    # HTTP Libraries (automated requests)
    "curl/",
    "wget/",
    "httpie/",
    "python-requests",
    "python-urllib",
    "axios/",
    "node-fetch",
    "go-http-client",
    "java/",
    "okhttp",
    "libwww-perl",
    "httpclient",
    # Archive/Research Bots
    "archive.org_bot",
    "wayback",
    "commoncrawl",
    # Security Scanners
    "nmap",
    "nikto",
    "sqlmap",
    "masscan",
    "zgrab",
]


@dataclass
class UaFilterLogEvent:
    """Log event for UA filtering actions."""

    type: Literal["blocked", "allowed"]
    user_agent: str
    reason: UaFilterReason
    matched_pattern: Optional[str]
    path: str
    timestamp: datetime
    session_id: Optional[str] = None


@dataclass
class UaFilterResult:
    """Result of UA filter check."""

    allowed: bool
    reason: UaFilterReason
    matched_pattern: Optional[str] = None


# Type for custom filter callback
# Return True to allow, False to block, None to defer to list-based filtering
UaFilterCallback = Callable[
    [str, dict],  # (user_agent, request_info)
    Union[Optional[bool], Awaitable[Optional[bool]]],
]


@dataclass
class UaFilterConfig:
    """Configuration for User-Agent filtering."""

    # Enable/disable UA filtering (default: False)
    enabled: bool = False

    # Filter mode (default: 'blocklist')
    mode: UaFilterMode = "blocklist"

    # UA patterns to allow
    allowlist: List[str] = field(default_factory=list)

    # UA patterns to block
    blocklist: List[str] = field(default_factory=list)

    # Include default bot patterns in blocklist (default: True)
    use_default_bots: bool = True

    # Custom filter callback for advanced logic
    custom_filter: Optional[UaFilterCallback] = None

    # Log blocked requests for security auditing (default: True)
    log_blocked: bool = True

    # Custom logger function
    logger: Optional[Callable[[UaFilterLogEvent], None]] = None

    # HTTP status code for blocked requests (default: 403)
    blocked_status_code: int = 403

    # Response message for blocked requests (default: 'Forbidden')
    blocked_message: str = "Forbidden"


def is_regex_pattern(pattern: str) -> bool:
    """Check if a pattern is a regex (starts and ends with /)."""
    return pattern.startswith("/") and pattern.endswith("/") and len(pattern) > 2


def extract_regex(pattern: str) -> Optional[re.Pattern]:
    """Extract regex from pattern string (removes leading/trailing /)."""
    try:
        # Remove leading/trailing slashes
        regex_str = pattern[1:-1]
        return re.compile(regex_str, re.IGNORECASE)
    except re.error:
        # Invalid regex, return None
        return None


def matches_any_pattern(user_agent: str, patterns: List[str]) -> Optional[str]:
    """
    Check if a user-agent matches any pattern in the list.
    Supports both substring matching and regex patterns (e.g., /bot-\\d+/).
    Returns the matched pattern or None.
    """
    ua_lower = user_agent.lower()
    for pattern in patterns:
        # Check if pattern is a regex
        if is_regex_pattern(pattern):
            regex = extract_regex(pattern)
            if regex and regex.search(ua_lower):
                return pattern
        else:
            # Simple substring match (case-insensitive)
            if pattern.lower() in ua_lower:
                return pattern
    return None


def should_allow_ua(user_agent: str, config: UaFilterConfig) -> UaFilterResult:
    """
    Main UA filter function - determines if a user-agent should be allowed.
    """
    mode = config.mode
    allowlist = config.allowlist or []
    blocklist = list(config.blocklist or [])

    # Add default bot patterns if enabled
    if config.use_default_bots:
        blocklist.extend(DEFAULT_BOT_PATTERNS)

    if mode == "allowlist":
        # Only allow if in allowlist
        matched = matches_any_pattern(user_agent, allowlist)
        if matched:
            return UaFilterResult(allowed=True, reason="allowlist", matched_pattern=matched)
        return UaFilterResult(allowed=False, reason="not_in_allowlist")

    elif mode == "blocklist":
        # Block if in blocklist, allow otherwise
        matched = matches_any_pattern(user_agent, blocklist)
        if matched:
            # Determine if it's a default bot or custom blocklist
            is_default_bot = not matches_any_pattern(user_agent, config.blocklist or [])
            return UaFilterResult(
                allowed=False,
                reason="default_bot" if is_default_bot else "blocklist",
                matched_pattern=matched,
            )
        return UaFilterResult(allowed=True, reason="default")

    elif mode == "both":
        # Allowlist takes precedence, then check blocklist
        allow_matched = matches_any_pattern(user_agent, allowlist)
        if allow_matched:
            return UaFilterResult(allowed=True, reason="allowlist", matched_pattern=allow_matched)

        block_matched = matches_any_pattern(user_agent, blocklist)
        if block_matched:
            is_default_bot = not matches_any_pattern(user_agent, config.blocklist or [])
            return UaFilterResult(
                allowed=False,
                reason="default_bot" if is_default_bot else "blocklist",
                matched_pattern=block_matched,
            )
        return UaFilterResult(allowed=True, reason="default")

    else:
        return UaFilterResult(allowed=True, reason="default")


async def check_ua_filter(
    user_agent: Optional[str],
    config: UaFilterConfig,
    request_info: dict,
) -> UaFilterResult:
    """
    Check UA filter with support for custom filter callback.
    """
    import asyncio

    # No user-agent = allow (could be internal request)
    if not user_agent:
        return UaFilterResult(allowed=True, reason="default")

    # Disabled = allow all
    if not config.enabled:
        return UaFilterResult(allowed=True, reason="default")

    # 1. Check custom filter first
    if config.custom_filter:
        result = config.custom_filter(user_agent, request_info)
        # Handle async custom filter
        if asyncio.iscoroutine(result):
            result = await result
        if result is True:
            return UaFilterResult(allowed=True, reason="custom")
        if result is False:
            return UaFilterResult(allowed=False, reason="custom")
        # None = fall through to list-based filtering

    # 2. Apply list-based filtering
    return should_allow_ua(user_agent, config)


def create_log_event(
    event_type: Literal["blocked", "allowed"],
    user_agent: str,
    reason: UaFilterReason,
    matched_pattern: Optional[str],
    path: str,
    session_id: Optional[str] = None,
) -> UaFilterLogEvent:
    """Create a UA filter log event."""
    return UaFilterLogEvent(
        type=event_type,
        user_agent=user_agent,
        reason=reason,
        matched_pattern=matched_pattern,
        path=path,
        timestamp=datetime.now(timezone.utc),
        session_id=session_id,
    )


def is_bot(user_agent: str) -> bool:
    """
    Check if a user-agent looks like a bot based on default patterns.
    Utility function for quick bot detection.
    """
    return matches_any_pattern(user_agent, DEFAULT_BOT_PATTERNS) is not None

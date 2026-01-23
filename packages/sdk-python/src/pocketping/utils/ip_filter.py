"""
IP Filtering utilities for PocketPing SDK.
Supports CIDR notation and individual IP addresses.
"""

from __future__ import annotations

import socket
import struct
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable, List, Literal, Optional, Tuple, Union

IpFilterMode = Literal["allowlist", "blocklist", "both"]
IpFilterReason = Literal["allowlist", "blocklist", "custom", "not_in_allowlist", "default"]


@dataclass
class IpFilterLogEvent:
    """Log event for IP filtering actions."""

    type: Literal["blocked", "allowed"]
    ip: str
    reason: IpFilterReason
    path: str
    timestamp: datetime
    session_id: Optional[str] = None


@dataclass
class IpFilterResult:
    """Result of IP filter check."""

    allowed: bool
    reason: IpFilterReason


# Type for custom filter callback
# Return True to allow, False to block, None to defer to list-based filtering
IpFilterCallback = Callable[
    [str, dict],  # (ip, request_info)
    Union[Optional[bool], Awaitable[Optional[bool]]],
]


@dataclass
class IpFilterConfig:
    """Configuration for IP filtering."""

    # Enable/disable IP filtering (default: False)
    enabled: bool = False

    # Filter mode (default: 'blocklist')
    mode: IpFilterMode = "blocklist"

    # IPs/CIDRs to allow (e.g., ['192.168.1.0/24', '10.0.0.1'])
    allowlist: List[str] = field(default_factory=list)

    # IPs/CIDRs to block (e.g., ['203.0.113.0/24', '198.51.100.50'])
    blocklist: List[str] = field(default_factory=list)

    # Custom filter callback for advanced logic
    custom_filter: Optional[IpFilterCallback] = None

    # Log blocked requests for security auditing (default: True)
    log_blocked: bool = True

    # Custom logger function
    logger: Optional[Callable[[IpFilterLogEvent], None]] = None

    # HTTP status code for blocked requests (default: 403)
    blocked_status_code: int = 403

    # Response message for blocked requests (default: 'Forbidden')
    blocked_message: str = "Forbidden"

    # Trust proxy headers (X-Forwarded-For, etc.) (default: True)
    trust_proxy: bool = True

    # Ordered list of headers to check for client IP
    proxy_headers: List[str] = field(
        default_factory=lambda: [
            "cf-connecting-ip",
            "x-forwarded-for",
            "x-real-ip",
            "x-client-ip",
        ]
    )


def ip_to_number(ip: str) -> Optional[int]:
    """
    Parse an IPv4 address to a 32-bit unsigned integer.
    Returns None for invalid IPs.
    """
    try:
        return struct.unpack("!I", socket.inet_aton(ip))[0]
    except (socket.error, struct.error, OSError):
        return None


def parse_cidr(cidr: str) -> Optional[Tuple[int, int]]:
    """
    Parse CIDR notation to (base_ip, mask).
    Supports both '192.168.1.0/24' and '192.168.1.1' formats.
    Returns None for invalid CIDR.
    """
    if "/" in cidr:
        parts = cidr.split("/", 1)
        ip = parts[0]
        try:
            prefix = int(parts[1])
        except ValueError:
            return None
    else:
        ip = cidr
        prefix = 32

    base = ip_to_number(ip)
    if base is None:
        return None

    if not (0 <= prefix <= 32):
        return None

    # Create mask: prefix 1-bits followed by (32-prefix) 0-bits
    if prefix == 0:
        mask = 0
    else:
        mask = (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF

    return (base & mask, mask)


def ip_matches_cidr(ip: str, cidr: str) -> bool:
    """
    Check if an IP matches a CIDR range or exact IP.
    """
    ip_num = ip_to_number(ip)
    if ip_num is None:
        return False

    parsed = parse_cidr(cidr)
    if parsed is None:
        return False

    base, mask = parsed
    return (ip_num & mask) == base


def ip_matches_any(ip: str, entries: List[str]) -> bool:
    """
    Check if IP matches any entry in the list of IPs/CIDRs.
    """
    return any(ip_matches_cidr(ip, entry) for entry in entries)


def should_allow_ip(ip: str, config: IpFilterConfig) -> IpFilterResult:
    """
    Main IP filter function - determines if an IP should be allowed.
    """
    mode = config.mode
    allowlist = config.allowlist or []
    blocklist = config.blocklist or []

    if mode == "allowlist":
        # Only allow if in allowlist
        if ip_matches_any(ip, allowlist):
            return IpFilterResult(allowed=True, reason="allowlist")
        return IpFilterResult(allowed=False, reason="not_in_allowlist")

    elif mode == "blocklist":
        # Block if in blocklist, allow otherwise
        if ip_matches_any(ip, blocklist):
            return IpFilterResult(allowed=False, reason="blocklist")
        return IpFilterResult(allowed=True, reason="default")

    elif mode == "both":
        # Allowlist takes precedence, then check blocklist
        if ip_matches_any(ip, allowlist):
            return IpFilterResult(allowed=True, reason="allowlist")
        if ip_matches_any(ip, blocklist):
            return IpFilterResult(allowed=False, reason="blocklist")
        return IpFilterResult(allowed=True, reason="default")

    else:
        return IpFilterResult(allowed=True, reason="default")


async def check_ip_filter(
    ip: str,
    config: IpFilterConfig,
    request_info: dict,
) -> IpFilterResult:
    """
    Check IP filter with support for custom filter callback.
    """
    import asyncio

    # 1. Check custom filter first
    if config.custom_filter:
        result = config.custom_filter(ip, request_info)
        # Handle async custom filter
        if asyncio.iscoroutine(result):
            result = await result
        if result is True:
            return IpFilterResult(allowed=True, reason="custom")
        if result is False:
            return IpFilterResult(allowed=False, reason="custom")
        # None = fall through to list-based filtering

    # 2. Apply list-based filtering
    return should_allow_ip(ip, config)


def create_log_event(
    event_type: Literal["blocked", "allowed"],
    ip: str,
    reason: IpFilterReason,
    path: str,
    session_id: Optional[str] = None,
) -> IpFilterLogEvent:
    """Create an IP filter log event."""
    return IpFilterLogEvent(
        type=event_type,
        ip=ip,
        reason=reason,
        path=path,
        timestamp=datetime.now(timezone.utc),
        session_id=session_id,
    )

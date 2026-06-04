"""
Heuristic bot detection for widget connections.

Many widget sessions are bots that load the page (running JS, so the widget
connects) but never send a message. They spoof real-browser User-Agents -- so
UA-pattern filtering does NOT catch them -- but they originate from datacenter
/ cloud IP ranges. This lets callers flag such connections and skip the
operator "new visitor" notification (the session can still be created, and a
thread created on-demand if the visitor ever actually sends a message, so
false positives self-heal).

Dependency-free (stdlib only): a bundled list of well-known cloud/datacenter
CIDR ranges plus obvious headless/automation UA markers, and an optional ASN
org-name signal. Mirrors sdk-go/bot_detection.go for cross-mode parity.
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from typing import List, Optional

# DEFAULT_DATACENTER_CIDRS is a curated (non-exhaustive) list of cloud/datacenter
# ranges that dominate scraper / headless-browser traffic. Refresh periodically
# from providers' published ranges.
DEFAULT_DATACENTER_CIDRS: List[str] = [
    # Google Cloud (the 34.x / 35.x ranges seen dominating real traffic)
    "34.0.0.0/9", "34.128.0.0/10", "35.184.0.0/13", "35.192.0.0/14",
    "35.196.0.0/15", "35.198.0.0/16", "35.200.0.0/13", "35.208.0.0/12",
    "35.224.0.0/12", "35.240.0.0/13", "104.196.0.0/14", "104.154.0.0/15",
    "130.211.0.0/16", "146.148.0.0/17",
    # Amazon AWS
    "3.0.0.0/9", "13.32.0.0/15", "15.177.0.0/18", "18.32.0.0/11",
    "52.0.0.0/11", "54.64.0.0/11", "99.77.0.0/18",
    # Microsoft Azure
    "13.64.0.0/11", "20.0.0.0/11", "40.64.0.0/10", "52.224.0.0/11", "104.40.0.0/13",
    # DigitalOcean
    "104.131.0.0/16", "138.197.0.0/16", "142.93.0.0/16", "159.65.0.0/16",
    "165.227.0.0/16", "167.71.0.0/16", "167.99.0.0/16", "178.62.0.0/16",
    "188.166.0.0/16",
    # OVH
    "51.68.0.0/14", "51.75.0.0/16", "51.81.0.0/16", "54.36.0.0/16",
    "145.239.0.0/16", "147.135.0.0/16", "198.27.64.0/18",
    # Hetzner
    "5.9.0.0/16", "78.46.0.0/15", "88.99.0.0/16", "94.130.0.0/16",
    "116.202.0.0/15", "135.181.0.0/16", "136.243.0.0/16", "142.132.0.0/16",
    "157.90.0.0/16", "159.69.0.0/16", "167.235.0.0/16", "168.119.0.0/16",
    "188.40.0.0/16",
    # Linode / Akamai
    "45.33.0.0/16", "45.56.0.0/16", "45.79.0.0/16", "139.144.0.0/16",
    "172.104.0.0/15", "173.255.192.0/18",
    # Scaleway / Online.net
    "51.15.0.0/16", "51.158.0.0/15", "163.172.0.0/16", "195.154.0.0/16",
    "212.83.128.0/19",
    # Datacenter IPv6 prefixes
    "2600:1f00::/24", "2a05:d000::/24", "2001:41d0::/32", "2a01:4f8::/29",
    "2604:a880::/32", "2a03:b0c0::/32", "2607:f8b0::/32", "2a00:1450::/32",
]


def _parse_cidrs(cidrs: List[str]) -> list:
    nets = []
    for c in cidrs:
        try:
            nets.append(ipaddress.ip_network(c, strict=False))
        except ValueError:
            continue
    return nets


_DATACENTER_NETS = _parse_cidrs(DEFAULT_DATACENTER_CIDRS)


# HEADLESS_UA_MARKERS are obvious automation/headless User-Agent substrings.
HEADLESS_UA_MARKERS: List[str] = [
    "headlesschrome", "phantomjs", "electron", "puppeteer", "playwright",
    "selenium", "webdriver", "python-requests", "curl/", "wget/",
    "go-http-client", "node-fetch", "axios/", "java/", "okhttp",
]

# HOSTING_ORG_MARKERS are UNAMBIGUOUS hosting/datacenter ASN org-name substrings.
# Broad consumer brands (google/amazon/microsoft/cloudflare) are intentionally
# excluded -- they also run residential ASNs (e.g. "Google Fiber") and their
# cloud ranges are covered by DEFAULT_DATACENTER_CIDRS instead.
HOSTING_ORG_MARKERS: List[str] = [
    "digitalocean", "ovh", "hetzner", "linode", "scaleway", "vultr",
    "leaseweb", "contabo", "datacamp", "m247", "choopa", "datacenter",
    "data center", "hosting",
]


def is_datacenter_ip(ip: str) -> bool:
    """Report whether ``ip`` belongs to a known datacenter/cloud range."""
    if ip is None:
        return False
    ip = ip.strip()
    if ip == "" or ip.lower() == "unknown":
        return False
    ip = ip.strip("[]")
    try:
        parsed = ipaddress.ip_address(ip)
    except ValueError:
        return False
    # Normalize IPv4-mapped IPv6 (e.g. ::ffff:34.72.176.129) to its IPv4 form so
    # mapped datacenter clients are still matched against the IPv4 ranges.
    mapped = getattr(parsed, "ipv4_mapped", None)
    if mapped is not None:
        parsed = mapped
    for net in _DATACENTER_NETS:
        if parsed.version == net.version and parsed in net:
            return True
    return False


def is_headless_user_agent(ua: str) -> bool:
    """Report whether ``ua`` contains an obvious automation marker."""
    if not ua:
        return False
    lower = ua.lower()
    return any(m in lower for m in HEADLESS_UA_MARKERS)


def is_hosting_org(org: str) -> bool:
    """Report whether ``org`` is an unambiguous hosting/cloud provider."""
    if not org:
        return False
    lower = org.lower()
    return any(m in lower for m in HOSTING_ORG_MARKERS)


@dataclass
class BotVerdict:
    """Result of :func:`detect_bot`.

    ``reason`` is one of ``'datacenter_ip'``, ``'hosting_asn'``,
    ``'headless_ua'``, or ``None`` when the connection is not flagged.
    """

    is_bot: bool
    reason: Optional[str] = None


def detect_bot(
    ip: str = "",
    user_agent: str = "",
    org: str = "",
) -> BotVerdict:
    """Return a heuristic verdict for a widget connection.

    A connection is flagged when it comes from a datacenter IP (or hosting
    ASN) or carries a headless UA marker.
    """
    if is_datacenter_ip(ip):
        return BotVerdict(is_bot=True, reason="datacenter_ip")
    if is_hosting_org(org):
        return BotVerdict(is_bot=True, reason="hosting_asn")
    if is_headless_user_agent(user_agent):
        return BotVerdict(is_bot=True, reason="headless_ua")
    return BotVerdict(is_bot=False, reason=None)

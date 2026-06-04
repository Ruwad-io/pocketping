"""Tests for heuristic bot detection (utils/bot_detection.py)."""

from pocketping.utils.bot_detection import (
    DEFAULT_DATACENTER_CIDRS,
    HEADLESS_UA_MARKERS,
    HOSTING_ORG_MARKERS,
    BotVerdict,
    detect_bot,
    is_datacenter_ip,
    is_headless_user_agent,
    is_hosting_org,
)

CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
HEADLESS_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0 Safari/537.36"


# ─────────────────────────────────────────────────────────────────
# is_datacenter_ip
# ─────────────────────────────────────────────────────────────────


class TestIsDatacenterIp:
    def test_google_cloud_ipv4(self):
        assert is_datacenter_ip("34.72.176.129") is True

    def test_ovh_ipv4(self):
        assert is_datacenter_ip("51.75.1.1") is True

    def test_hetzner_ipv4(self):
        assert is_datacenter_ip("5.9.1.1") is True

    def test_digitalocean_ipv4(self):
        assert is_datacenter_ip("159.65.1.1") is True

    def test_ovh_ipv6(self):
        assert is_datacenter_ip("2001:41d0:350:1400::1") is True

    def test_hetzner_ipv6(self):
        assert is_datacenter_ip("2a01:4f8::1") is True

    def test_ipv4_mapped_ipv6(self):
        # ::ffff:<ipv4> must be matched against the IPv4 datacenter ranges.
        assert is_datacenter_ip("::ffff:34.72.176.129") is True

    def test_bracketed_ipv6_is_stripped(self):
        assert is_datacenter_ip("[2a01:4f8::1]") is True

    def test_residential_ipv4_false(self):
        assert is_datacenter_ip("192.168.1.1") is False

    def test_public_residential_ipv4_false(self):
        assert is_datacenter_ip("8.8.8.8") is False

    def test_unknown_false(self):
        assert is_datacenter_ip("unknown") is False

    def test_empty_false(self):
        assert is_datacenter_ip("") is False

    def test_garbage_false(self):
        assert is_datacenter_ip("not-an-ip") is False


# ─────────────────────────────────────────────────────────────────
# is_headless_user_agent
# ─────────────────────────────────────────────────────────────────


class TestIsHeadlessUserAgent:
    def test_headless_chrome(self):
        assert is_headless_user_agent(HEADLESS_UA) is True

    def test_python_requests(self):
        assert is_headless_user_agent("python-requests/2.31.0") is True

    def test_curl(self):
        assert is_headless_user_agent("curl/8.1.2") is True

    def test_real_chrome_false(self):
        assert is_headless_user_agent(CHROME_UA) is False

    def test_empty_false(self):
        assert is_headless_user_agent("") is False

    def test_case_insensitive(self):
        assert is_headless_user_agent("PHANTOMJS/2.1") is True


# ─────────────────────────────────────────────────────────────────
# is_hosting_org
# ─────────────────────────────────────────────────────────────────


class TestIsHostingOrg:
    def test_hetzner(self):
        assert is_hosting_org("Hetzner Online GmbH") is True

    def test_digitalocean(self):
        assert is_hosting_org("DigitalOcean, LLC") is True

    def test_vultr(self):
        assert is_hosting_org("The Constant Company / Vultr") is True

    def test_google_fiber_false(self):
        # Consumer/residential brand intentionally excluded
        assert is_hosting_org("Google Fiber Inc.") is False

    def test_google_llc_false(self):
        assert is_hosting_org("Google LLC") is False

    def test_amazon_false(self):
        assert is_hosting_org("AMAZON-02") is False

    def test_orange_false(self):
        assert is_hosting_org("Orange S.A.") is False

    def test_empty_false(self):
        assert is_hosting_org("") is False


# ─────────────────────────────────────────────────────────────────
# detect_bot
# ─────────────────────────────────────────────────────────────────


class TestDetectBot:
    def test_datacenter_ip_verdict(self):
        verdict = detect_bot(ip="34.72.176.129", user_agent=CHROME_UA)
        assert verdict.is_bot is True
        assert verdict.reason == "datacenter_ip"

    def test_hosting_asn_verdict(self):
        verdict = detect_bot(ip="8.8.8.8", user_agent=CHROME_UA, org="Hetzner Online GmbH")
        assert verdict.is_bot is True
        assert verdict.reason == "hosting_asn"

    def test_headless_ua_verdict(self):
        verdict = detect_bot(ip="8.8.8.8", user_agent=HEADLESS_UA)
        assert verdict.is_bot is True
        assert verdict.reason == "headless_ua"

    def test_clean_residential_not_bot(self):
        verdict = detect_bot(ip="8.8.8.8", user_agent=CHROME_UA, org="Orange S.A.")
        assert verdict.is_bot is False
        assert verdict.reason is None

    def test_datacenter_ip_takes_precedence_over_ua(self):
        # Datacenter IP is checked first, so reason is datacenter_ip
        verdict = detect_bot(ip="5.9.1.1", user_agent=HEADLESS_UA)
        assert verdict.is_bot is True
        assert verdict.reason == "datacenter_ip"

    def test_defaults_are_not_bot(self):
        verdict = detect_bot()
        assert verdict.is_bot is False
        assert verdict.reason is None


# ─────────────────────────────────────────────────────────────────
# Module data sanity
# ─────────────────────────────────────────────────────────────────


class TestModuleData:
    def test_cidrs_present(self):
        assert len(DEFAULT_DATACENTER_CIDRS) > 0

    def test_headless_markers_present(self):
        assert "headlesschrome" in HEADLESS_UA_MARKERS
        assert "python-requests" in HEADLESS_UA_MARKERS

    def test_hosting_markers_exclude_broad_brands(self):
        for excluded in ("google", "amazon", "microsoft", "cloudflare", "akamai"):
            assert excluded not in HOSTING_ORG_MARKERS

    def test_hosting_markers_include_providers(self):
        for included in ("digitalocean", "hetzner", "vultr", "ovh"):
            assert included in HOSTING_ORG_MARKERS

    def test_verdict_dataclass_defaults(self):
        verdict = BotVerdict(is_bot=False)
        assert verdict.reason is None

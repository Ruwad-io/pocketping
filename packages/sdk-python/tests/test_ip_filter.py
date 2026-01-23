"""Tests for IP filter utilities."""

import pytest

from pocketping.utils.ip_filter import (
    IpFilterConfig,
    check_ip_filter,
    ip_matches_any,
    ip_matches_cidr,
    ip_to_number,
    parse_cidr,
    should_allow_ip,
)


class TestIpToNumber:
    def test_valid_ips(self):
        assert ip_to_number("0.0.0.0") == 0
        assert ip_to_number("255.255.255.255") == 4294967295
        assert ip_to_number("192.168.1.1") == 3232235777
        assert ip_to_number("10.0.0.1") == 167772161

    def test_invalid_ips(self):
        assert ip_to_number("invalid") is None
        assert ip_to_number("256.1.1.1") is None
        # Note: "1.2.3" is valid in Python (legacy format "1.2.0.3")
        assert ip_to_number("1.2.3.4.5") is None
        assert ip_to_number("") is None
        assert ip_to_number("a.b.c.d") is None


class TestParseCidr:
    def test_cidr_notation(self):
        result = parse_cidr("192.168.1.0/24")
        assert result is not None
        assert result[1] == 4294967040  # 255.255.255.0

    def test_single_ip_as_32(self):
        result = parse_cidr("192.168.1.1")
        assert result is not None
        assert result[1] == 4294967295  # 255.255.255.255

    def test_cidr_0(self):
        result = parse_cidr("0.0.0.0/0")
        assert result is not None
        assert result[1] == 0

    def test_invalid_cidr(self):
        assert parse_cidr("invalid/24") is None
        assert parse_cidr("192.168.1.0/33") is None
        assert parse_cidr("192.168.1.0/-1") is None


class TestIpMatchesCidr:
    def test_exact_ip(self):
        assert ip_matches_cidr("192.168.1.1", "192.168.1.1") is True
        assert ip_matches_cidr("192.168.1.2", "192.168.1.1") is False

    def test_24_subnet(self):
        assert ip_matches_cidr("192.168.1.0", "192.168.1.0/24") is True
        assert ip_matches_cidr("192.168.1.1", "192.168.1.0/24") is True
        assert ip_matches_cidr("192.168.1.255", "192.168.1.0/24") is True
        assert ip_matches_cidr("192.168.2.0", "192.168.1.0/24") is False

    def test_16_subnet(self):
        assert ip_matches_cidr("192.168.0.0", "192.168.0.0/16") is True
        assert ip_matches_cidr("192.168.255.255", "192.168.0.0/16") is True
        assert ip_matches_cidr("192.169.0.0", "192.168.0.0/16") is False

    def test_8_subnet(self):
        assert ip_matches_cidr("10.0.0.1", "10.0.0.0/8") is True
        assert ip_matches_cidr("10.255.255.255", "10.0.0.0/8") is True
        assert ip_matches_cidr("11.0.0.0", "10.0.0.0/8") is False

    def test_32_single_ip(self):
        assert ip_matches_cidr("203.0.113.50", "203.0.113.50/32") is True
        assert ip_matches_cidr("203.0.113.51", "203.0.113.50/32") is False

    def test_0_all_ips(self):
        assert ip_matches_cidr("1.2.3.4", "0.0.0.0/0") is True
        assert ip_matches_cidr("255.255.255.255", "0.0.0.0/0") is True

    def test_invalid_ips(self):
        assert ip_matches_cidr("invalid", "192.168.1.0/24") is False
        assert ip_matches_cidr("192.168.1.1", "invalid/24") is False


class TestIpMatchesAny:
    def test_matches_in_list(self):
        entries = ["192.168.1.0/24", "10.0.0.0/8", "203.0.113.50"]
        assert ip_matches_any("192.168.1.100", entries) is True
        assert ip_matches_any("10.50.25.1", entries) is True
        assert ip_matches_any("203.0.113.50", entries) is True

    def test_not_in_list(self):
        entries = ["192.168.1.0/24", "10.0.0.0/8"]
        assert ip_matches_any("172.16.0.1", entries) is False
        assert ip_matches_any("8.8.8.8", entries) is False

    def test_empty_list(self):
        assert ip_matches_any("192.168.1.1", []) is False


class TestShouldAllowIp:
    def test_blocklist_mode_blocks(self):
        config = IpFilterConfig(
            enabled=True,
            mode="blocklist",
            blocklist=["192.168.1.0/24", "203.0.113.0/24"],
        )
        result = should_allow_ip("192.168.1.50", config)
        assert result.allowed is False
        assert result.reason == "blocklist"

    def test_blocklist_mode_allows(self):
        config = IpFilterConfig(
            enabled=True,
            mode="blocklist",
            blocklist=["192.168.1.0/24"],
        )
        result = should_allow_ip("10.0.0.1", config)
        assert result.allowed is True
        assert result.reason == "default"

    def test_blocklist_empty_allows_all(self):
        config = IpFilterConfig(
            enabled=True,
            mode="blocklist",
            blocklist=[],
        )
        result = should_allow_ip("192.168.1.1", config)
        assert result.allowed is True

    def test_allowlist_mode_allows(self):
        config = IpFilterConfig(
            enabled=True,
            mode="allowlist",
            allowlist=["10.0.0.0/8", "192.168.0.0/16"],
        )
        result = should_allow_ip("10.0.0.50", config)
        assert result.allowed is True
        assert result.reason == "allowlist"

    def test_allowlist_mode_blocks(self):
        config = IpFilterConfig(
            enabled=True,
            mode="allowlist",
            allowlist=["10.0.0.0/8"],
        )
        result = should_allow_ip("192.168.1.1", config)
        assert result.allowed is False
        assert result.reason == "not_in_allowlist"

    def test_allowlist_empty_blocks_all(self):
        config = IpFilterConfig(
            enabled=True,
            mode="allowlist",
            allowlist=[],
        )
        result = should_allow_ip("10.0.0.1", config)
        assert result.allowed is False

    def test_both_mode_allowlist_priority(self):
        config = IpFilterConfig(
            enabled=True,
            mode="both",
            allowlist=["10.0.0.1"],
            blocklist=["10.0.0.0/24"],
        )
        result = should_allow_ip("10.0.0.1", config)
        assert result.allowed is True
        assert result.reason == "allowlist"

    def test_both_mode_blocklist_applies(self):
        config = IpFilterConfig(
            enabled=True,
            mode="both",
            allowlist=["10.0.0.1"],
            blocklist=["10.0.0.0/24"],
        )
        result = should_allow_ip("10.0.0.2", config)
        assert result.allowed is False
        assert result.reason == "blocklist"

    def test_both_mode_default_allows(self):
        config = IpFilterConfig(
            enabled=True,
            mode="both",
            allowlist=["10.0.0.1"],
            blocklist=["192.168.1.0/24"],
        )
        result = should_allow_ip("8.8.8.8", config)
        assert result.allowed is True
        assert result.reason == "default"


class TestCheckIpFilter:
    @pytest.mark.asyncio
    async def test_custom_filter_blocks(self):
        def custom_filter(ip, request_info):
            # Block all IPs starting with "10."
            if ip.startswith("10."):
                return False
            return None  # Defer to list-based

        config = IpFilterConfig(
            enabled=True,
            mode="blocklist",
            blocklist=["192.168.1.0/24"],
            custom_filter=custom_filter,
        )

        result = await check_ip_filter("10.0.0.1", config, {"path": "/test"})
        assert result.allowed is False
        assert result.reason == "custom"

    @pytest.mark.asyncio
    async def test_custom_filter_defers(self):
        def custom_filter(ip, request_info):
            # Only check specific IPs
            return None  # Defer to list-based

        config = IpFilterConfig(
            enabled=True,
            mode="blocklist",
            blocklist=["192.168.1.0/24"],
            custom_filter=custom_filter,
        )

        result = await check_ip_filter("192.168.1.50", config, {"path": "/test"})
        assert result.allowed is False
        assert result.reason == "blocklist"

    @pytest.mark.asyncio
    async def test_async_custom_filter(self):
        async def custom_filter(ip, request_info):
            # Simulate async check
            return ip == "8.8.8.8"

        config = IpFilterConfig(
            enabled=True,
            mode="blocklist",
            custom_filter=custom_filter,
        )

        result = await check_ip_filter("8.8.8.8", config, {"path": "/test"})
        assert result.allowed is True
        assert result.reason == "custom"

    @pytest.mark.asyncio
    async def test_without_custom_filter(self):
        config = IpFilterConfig(
            enabled=True,
            mode="blocklist",
            blocklist=["192.168.1.0/24"],
        )

        result = await check_ip_filter("192.168.1.50", config, {"path": "/test"})
        assert result.allowed is False
        assert result.reason == "blocklist"

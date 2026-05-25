"""Tests for User-Agent filtering utilities (utils/user_agent_filter.py)."""

import pytest

from pocketping.utils.user_agent_filter import (
    DEFAULT_BOT_PATTERNS,
    UaFilterConfig,
    UaFilterResult,
    check_ua_filter,
    create_log_event,
    extract_regex,
    is_bot,
    is_regex_pattern,
    matches_any_pattern,
    should_allow_ua,
)

CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"


# ─────────────────────────────────────────────────────────────────
# is_regex_pattern / extract_regex
# ─────────────────────────────────────────────────────────────────


class TestRegexHelpers:
    def test_is_regex_pattern_true_for_slash_wrapped(self):
        assert is_regex_pattern("/bot-\\d+/") is True

    def test_is_regex_pattern_false_for_substring(self):
        assert is_regex_pattern("googlebot") is False

    def test_is_regex_pattern_false_for_too_short(self):
        # "//" has length 2 -> not a valid regex pattern
        assert is_regex_pattern("//") is False

    def test_extract_regex_compiles_valid_pattern(self):
        regex = extract_regex("/bot-\\d+/")
        assert regex is not None
        assert regex.search("custom-bot-123") is not None

    def test_extract_regex_returns_none_for_invalid(self):
        # Unbalanced bracket is an invalid regex
        assert extract_regex("/[unclosed/") is None


# ─────────────────────────────────────────────────────────────────
# matches_any_pattern
# ─────────────────────────────────────────────────────────────────


class TestMatchesAnyPattern:
    def test_substring_match_case_insensitive(self):
        assert matches_any_pattern("Mozilla GOOGLEBOT", ["googlebot"]) == "googlebot"

    def test_regex_match(self):
        assert matches_any_pattern("custom-bot-42", ["/bot-\\d+/"]) == "/bot-\\d+/"

    def test_no_match_returns_none(self):
        assert matches_any_pattern(CHROME_UA, ["doesnotexist"]) is None

    def test_invalid_regex_pattern_is_skipped(self):
        # Invalid regex compiles to None and is skipped without matching
        assert matches_any_pattern("anything", ["/[bad/"]) is None

    def test_empty_pattern_list(self):
        assert matches_any_pattern(CHROME_UA, []) is None


# ─────────────────────────────────────────────────────────────────
# should_allow_ua: blocklist mode
# ─────────────────────────────────────────────────────────────────


class TestShouldAllowUaBlocklist:
    def test_default_bot_blocked(self):
        result = should_allow_ua(GOOGLEBOT_UA, UaFilterConfig(mode="blocklist"))
        assert result.allowed is False
        assert result.reason == "default_bot"
        assert result.matched_pattern == "googlebot"

    def test_normal_browser_allowed(self):
        result = should_allow_ua(CHROME_UA, UaFilterConfig(mode="blocklist"))
        assert result.allowed is True
        assert result.reason == "default"

    def test_custom_blocklist_match_reported_as_blocklist(self):
        config = UaFilterConfig(mode="blocklist", blocklist=["evilcorp"], use_default_bots=False)
        result = should_allow_ua("EvilCorp Scraper", config)
        assert result.allowed is False
        assert result.reason == "blocklist"
        assert result.matched_pattern == "evilcorp"

    def test_default_bots_disabled_allows_googlebot(self):
        config = UaFilterConfig(mode="blocklist", use_default_bots=False)
        result = should_allow_ua(GOOGLEBOT_UA, config)
        assert result.allowed is True


# ─────────────────────────────────────────────────────────────────
# should_allow_ua: allowlist mode
# ─────────────────────────────────────────────────────────────────


class TestShouldAllowUaAllowlist:
    def test_in_allowlist_allowed(self):
        config = UaFilterConfig(mode="allowlist", allowlist=["myapp"])
        result = should_allow_ua("MyApp/1.0", config)
        assert result.allowed is True
        assert result.reason == "allowlist"
        assert result.matched_pattern == "myapp"

    def test_not_in_allowlist_blocked(self):
        config = UaFilterConfig(mode="allowlist", allowlist=["myapp"])
        result = should_allow_ua(CHROME_UA, config)
        assert result.allowed is False
        assert result.reason == "not_in_allowlist"


# ─────────────────────────────────────────────────────────────────
# should_allow_ua: both mode
# ─────────────────────────────────────────────────────────────────


class TestShouldAllowUaBoth:
    def test_allowlist_takes_precedence(self):
        # Even a googlebot is allowed if it matches allowlist in 'both' mode
        config = UaFilterConfig(mode="both", allowlist=["googlebot"])
        result = should_allow_ua(GOOGLEBOT_UA, config)
        assert result.allowed is True
        assert result.reason == "allowlist"

    def test_blocklist_applied_after_allowlist(self):
        config = UaFilterConfig(mode="both", allowlist=["myapp"], blocklist=["evil"], use_default_bots=False)
        result = should_allow_ua("Evil/1.0", config)
        assert result.allowed is False
        assert result.reason == "blocklist"

    def test_default_bot_blocked_in_both_mode(self):
        config = UaFilterConfig(mode="both", allowlist=["myapp"])
        result = should_allow_ua(GOOGLEBOT_UA, config)
        assert result.allowed is False
        assert result.reason == "default_bot"

    def test_neutral_ua_allowed_in_both_mode(self):
        config = UaFilterConfig(mode="both", allowlist=["myapp"], use_default_bots=False)
        result = should_allow_ua(CHROME_UA, config)
        assert result.allowed is True
        assert result.reason == "default"


class TestShouldAllowUaUnknownMode:
    def test_unknown_mode_defaults_to_allow(self):
        config = UaFilterConfig(mode="weird")  # type: ignore[arg-type]
        result = should_allow_ua(CHROME_UA, config)
        assert result.allowed is True
        assert result.reason == "default"


# ─────────────────────────────────────────────────────────────────
# check_ua_filter (async wrapper + custom filter)
# ─────────────────────────────────────────────────────────────────


class TestCheckUaFilter:
    @pytest.mark.asyncio
    async def test_no_user_agent_allowed(self):
        config = UaFilterConfig(enabled=True)
        result = await check_ua_filter(None, config, {})
        assert result.allowed is True
        assert result.reason == "default"

    @pytest.mark.asyncio
    async def test_disabled_allows_everything(self):
        config = UaFilterConfig(enabled=False)
        result = await check_ua_filter(GOOGLEBOT_UA, config, {})
        assert result.allowed is True

    @pytest.mark.asyncio
    async def test_enabled_blocks_bot(self):
        config = UaFilterConfig(enabled=True)
        result = await check_ua_filter(GOOGLEBOT_UA, config, {})
        assert result.allowed is False

    @pytest.mark.asyncio
    async def test_sync_custom_filter_allow(self):
        config = UaFilterConfig(enabled=True, custom_filter=lambda ua, info: True)
        result = await check_ua_filter(GOOGLEBOT_UA, config, {})
        assert result.allowed is True
        assert result.reason == "custom"

    @pytest.mark.asyncio
    async def test_sync_custom_filter_block(self):
        config = UaFilterConfig(enabled=True, custom_filter=lambda ua, info: False)
        result = await check_ua_filter(CHROME_UA, config, {})
        assert result.allowed is False
        assert result.reason == "custom"

    @pytest.mark.asyncio
    async def test_custom_filter_none_falls_through(self):
        config = UaFilterConfig(enabled=True, custom_filter=lambda ua, info: None)
        result = await check_ua_filter(GOOGLEBOT_UA, config, {})
        # Falls through to list-based filtering -> bot blocked
        assert result.allowed is False
        assert result.reason == "default_bot"

    @pytest.mark.asyncio
    async def test_async_custom_filter(self):
        async def afilter(ua, info):
            return False

        config = UaFilterConfig(enabled=True, custom_filter=afilter)
        result = await check_ua_filter(CHROME_UA, config, {})
        assert result.allowed is False
        assert result.reason == "custom"


# ─────────────────────────────────────────────────────────────────
# create_log_event / is_bot
# ─────────────────────────────────────────────────────────────────


class TestLogEventAndIsBot:
    def test_create_log_event(self):
        event = create_log_event(
            "blocked", GOOGLEBOT_UA, "default_bot", "googlebot", "/connect", session_id="s1"
        )
        assert event.type == "blocked"
        assert event.user_agent == GOOGLEBOT_UA
        assert event.reason == "default_bot"
        assert event.matched_pattern == "googlebot"
        assert event.path == "/connect"
        assert event.session_id == "s1"
        assert event.timestamp is not None

    def test_is_bot_true(self):
        assert is_bot(GOOGLEBOT_UA) is True

    def test_is_bot_false(self):
        assert is_bot(CHROME_UA) is False

    def test_is_bot_detects_curl(self):
        assert is_bot("curl/8.1.2") is True

    def test_default_patterns_present(self):
        # Spec requires ~50 patterns
        assert len(DEFAULT_BOT_PATTERNS) >= 50
        assert "googlebot" in DEFAULT_BOT_PATTERNS
        assert "gptbot" in DEFAULT_BOT_PATTERNS


class TestUaFilterResultDataclass:
    def test_result_defaults(self):
        result = UaFilterResult(allowed=True, reason="default")
        assert result.matched_pattern is None

"""Tests for version management functionality."""

import pytest

from pocketping import PocketPing
from pocketping.models import VersionCheckResult, VersionStatus


class TestCheckWidgetVersion:
    """Tests for check_widget_version method."""

    class TestWithoutConstraints:
        """Tests when no version constraints are configured."""

        def test_returns_ok_when_no_version_provided(self):
            """Test that missing version returns ok status."""
            pp = PocketPing()
            result = pp.check_widget_version(None)

            assert result.status == VersionStatus.OK
            assert result.can_continue is True

        def test_returns_ok_when_version_provided_but_no_constraints(self):
            """Test that any version is ok when no constraints set."""
            pp = PocketPing()
            result = pp.check_widget_version("1.0.0")

            assert result.status == VersionStatus.OK
            assert result.can_continue is True

    class TestWithMinWidgetVersion:
        """Tests with minWidgetVersion configured."""

        @pytest.fixture
        def pp_with_min(self):
            """Create PocketPing with min version constraint."""
            return PocketPing(min_widget_version="0.2.0")

        def test_returns_ok_for_version_equal_to_min(self, pp_with_min):
            """Test version equal to min is allowed."""
            result = pp_with_min.check_widget_version("0.2.0")

            assert result.status == VersionStatus.OK
            assert result.can_continue is True

        def test_returns_ok_for_version_above_min(self, pp_with_min):
            """Test version above min is allowed."""
            result = pp_with_min.check_widget_version("0.3.0")

            assert result.status == VersionStatus.OK
            assert result.can_continue is True

        def test_returns_unsupported_for_version_below_min(self, pp_with_min):
            """Test version below min is blocked."""
            result = pp_with_min.check_widget_version("0.1.9")

            assert result.status == VersionStatus.UNSUPPORTED
            assert result.can_continue is False
            assert "0.1.9" in result.message
            assert "no longer supported" in result.message
            assert result.min_version == "0.2.0"

        def test_uses_custom_warning_message(self):
            """Test custom warning message is used."""
            pp = PocketPing(
                min_widget_version="0.2.0",
                version_warning_message="Please update your widget!",
            )

            result = pp.check_widget_version("0.1.0")

            assert result.message == "Please update your widget!"

    class TestWithLatestWidgetVersion:
        """Tests with latestWidgetVersion configured."""

        @pytest.fixture
        def pp_with_latest(self):
            """Create PocketPing with latest version configured."""
            return PocketPing(latest_widget_version="1.2.0")

        def test_returns_ok_for_version_equal_to_latest(self, pp_with_latest):
            """Test version at latest is ok."""
            result = pp_with_latest.check_widget_version("1.2.0")

            assert result.status == VersionStatus.OK
            assert result.can_continue is True

        def test_returns_ok_for_version_above_latest(self, pp_with_latest):
            """Test version above latest is ok."""
            result = pp_with_latest.check_widget_version("1.3.0")

            assert result.status == VersionStatus.OK
            assert result.can_continue is True

        def test_returns_outdated_for_minor_version_behind(self, pp_with_latest):
            """Test minor version behind is outdated."""
            result = pp_with_latest.check_widget_version("1.1.0")

            assert result.status == VersionStatus.OUTDATED
            assert result.can_continue is True
            assert "1.2.0" in result.message
            assert result.latest_version == "1.2.0"

        def test_returns_outdated_for_patch_version_behind(self):
            """Test patch version behind is outdated."""
            pp = PocketPing(latest_widget_version="1.2.1")
            result = pp.check_widget_version("1.2.0")

            assert result.status == VersionStatus.OUTDATED
            assert result.can_continue is True

        def test_returns_deprecated_for_major_version_behind(self, pp_with_latest):
            """Test major version behind is deprecated."""
            result = pp_with_latest.check_widget_version("0.9.0")

            assert result.status == VersionStatus.DEPRECATED
            assert result.can_continue is True
            assert "deprecated" in result.message.lower()

    class TestWithBothConstraints:
        """Tests with both min and latest version configured."""

        @pytest.fixture
        def pp_with_both(self):
            """Create PocketPing with both constraints."""
            return PocketPing(
                min_widget_version="0.2.0",
                latest_widget_version="1.0.0",
            )

        def test_unsupported_takes_precedence_over_deprecated(self, pp_with_both):
            """Test version below min is unsupported even if would be deprecated."""
            result = pp_with_both.check_widget_version("0.1.0")

            assert result.status == VersionStatus.UNSUPPORTED
            assert result.can_continue is False

        def test_returns_deprecated_for_supported_but_major_behind(self, pp_with_both):
            """Test version above min but major behind latest is deprecated."""
            result = pp_with_both.check_widget_version("0.5.0")

            assert result.status == VersionStatus.DEPRECATED
            assert result.can_continue is True

        def test_returns_ok_for_version_at_latest(self, pp_with_both):
            """Test version at latest is ok."""
            result = pp_with_both.check_widget_version("1.0.0")

            assert result.status == VersionStatus.OK
            assert result.can_continue is True

    class TestVersionParsing:
        """Tests for version string parsing."""

        @pytest.fixture
        def pp(self):
            """Create PocketPing with version constraints."""
            return PocketPing(
                min_widget_version="1.0.0",
                latest_widget_version="2.0.0",
            )

        def test_handles_v_prefix(self, pp):
            """Test versions with v prefix are parsed correctly."""
            result = pp.check_widget_version("v1.5.0")

            assert result.status == VersionStatus.DEPRECATED
            assert result.can_continue is True

        def test_handles_two_part_versions(self, pp):
            """Test two-part version strings work."""
            result = pp.check_widget_version("2.0")

            assert result.status == VersionStatus.OK
            assert result.can_continue is True

        def test_handles_prerelease_versions(self, pp):
            """Test pre-release versions are handled."""
            result = pp.check_widget_version("2.0.0-beta.1")

            assert result.status == VersionStatus.OK
            assert result.can_continue is True


class TestVersionResultStructure:
    """Tests for VersionCheckResult structure."""

    def test_includes_all_version_info(self):
        """Test result includes all configured version info."""
        pp = PocketPing(
            min_widget_version="0.2.0",
            latest_widget_version="1.0.0",
        )

        result = pp.check_widget_version("0.3.0")

        assert hasattr(result, "status")
        assert hasattr(result, "can_continue")
        assert result.min_version == "0.2.0"
        assert result.latest_version == "1.0.0"


class TestGetVersionHeaders:
    """Tests for get_version_headers method."""

    def test_includes_status_header(self):
        """Test status is always included."""
        pp = PocketPing(latest_widget_version="1.1.0")
        result = pp.check_widget_version("1.0.0")  # Minor version behind = outdated

        headers = pp.get_version_headers(result)

        assert "X-PocketPing-Version-Status" in headers
        assert headers["X-PocketPing-Version-Status"] == "outdated"

    def test_includes_min_version_when_set(self):
        """Test min version header is included when configured."""
        pp = PocketPing(min_widget_version="0.5.0")
        result = pp.check_widget_version("0.4.0")

        headers = pp.get_version_headers(result)

        assert headers.get("X-PocketPing-Min-Version") == "0.5.0"

    def test_includes_latest_version_when_set(self):
        """Test latest version header is included when configured."""
        pp = PocketPing(latest_widget_version="1.0.0")
        result = pp.check_widget_version("0.9.0")

        headers = pp.get_version_headers(result)

        assert headers.get("X-PocketPing-Latest-Version") == "1.0.0"

    def test_includes_message_when_present(self):
        """Test message header is included when there's a message."""
        pp = PocketPing(
            min_widget_version="0.5.0",
            version_warning_message="Custom warning",
        )
        result = pp.check_widget_version("0.4.0")

        headers = pp.get_version_headers(result)

        assert headers.get("X-PocketPing-Version-Message") == "Custom warning"


class TestSendVersionWarning:
    """Tests for send_version_warning method."""

    @pytest.mark.asyncio
    async def test_broadcasts_to_session(self, pocketping, sample_session, mock_websocket):
        """Test version warning is broadcast via WebSocket."""
        await pocketping.storage.create_session(sample_session)
        pocketping.register_websocket(sample_session.id, mock_websocket)

        version_check = VersionCheckResult(
            status=VersionStatus.DEPRECATED,
            message="Widget is deprecated",
            min_version="0.2.0",
            latest_version="1.0.0",
            can_continue=True,
        )

        await pocketping.send_version_warning(
            session_id=sample_session.id,
            version_check=version_check,
            current_version="0.5.0",
        )

        mock_websocket.send_text.assert_called()
        call_args = mock_websocket.send_text.call_args[0][0]
        assert "version_warning" in call_args
        assert "warning" in call_args  # severity
        assert "deprecated" in call_args.lower()

    @pytest.mark.asyncio
    async def test_maps_status_to_correct_severity(self, pocketping, sample_session, mock_websocket):
        """Test status is correctly mapped to severity."""
        await pocketping.storage.create_session(sample_session)
        pocketping.register_websocket(sample_session.id, mock_websocket)

        # Test unsupported -> error
        version_check = VersionCheckResult(
            status=VersionStatus.UNSUPPORTED,
            message="Unsupported",
            can_continue=False,
        )

        await pocketping.send_version_warning(
            session_id=sample_session.id,
            version_check=version_check,
            current_version="0.1.0",
        )

        call_args = mock_websocket.send_text.call_args[0][0]
        assert '"severity":"error"' in call_args or '"severity": "error"' in call_args.replace(" ", "")

"""Tests for the PocketPing identity functionality."""

import pytest

from pocketping.models import (
    ConnectRequest,
    IdentifyRequest,
    UserIdentity,
)


class TestPocketPingIdentify:
    """Tests for the identify functionality."""

    @pytest.mark.asyncio
    async def test_identify_updates_session(self, pocketping, sample_session):
        """Test that identify updates session with identity."""
        await pocketping.storage.create_session(sample_session)

        identity = UserIdentity(
            id="user_123",
            email="john@example.com",
            name="John Doe",
        )

        request = IdentifyRequest(
            session_id=sample_session.id,
            identity=identity,
        )

        response = await pocketping.handle_identify(request)

        assert response.ok is True

        session = await pocketping.storage.get_session(sample_session.id)
        assert session.identity is not None
        assert session.identity.id == "user_123"
        assert session.identity.email == "john@example.com"
        assert session.identity.name == "John Doe"

    @pytest.mark.asyncio
    async def test_identify_requires_id(self, pocketping, sample_session):
        """Test that identify requires identity.id."""
        await pocketping.storage.create_session(sample_session)

        # Create identity without id (will fail validation)
        with pytest.raises(Exception):
            identity = UserIdentity(id="")  # Empty string should fail
            request = IdentifyRequest(
                session_id=sample_session.id,
                identity=identity,
            )
            await pocketping.handle_identify(request)

    @pytest.mark.asyncio
    async def test_identify_invalid_session(self, pocketping):
        """Test identify with non-existent session."""
        identity = UserIdentity(id="user_123")
        request = IdentifyRequest(
            session_id="non-existent",
            identity=identity,
        )

        with pytest.raises(ValueError, match="Session not found"):
            await pocketping.handle_identify(request)

    @pytest.mark.asyncio
    async def test_identify_calls_callback(self, pocketping_with_callbacks, sample_session):
        """Test that identify calls the on_identify callback."""
        await pocketping_with_callbacks.storage.create_session(sample_session)

        identity = UserIdentity(
            id="user_123",
            name="Test User",
        )

        request = IdentifyRequest(
            session_id=sample_session.id,
            identity=identity,
        )

        await pocketping_with_callbacks.handle_identify(request)

        # Callback should have been called with the session
        pocketping_with_callbacks.on_identify_callback.assert_called_once()
        call_args = pocketping_with_callbacks.on_identify_callback.call_args[0]
        assert call_args[0].identity.id == "user_123"

    @pytest.mark.asyncio
    async def test_identify_with_custom_fields(self, pocketping, sample_session):
        """Test identify with custom fields."""
        await pocketping.storage.create_session(sample_session)

        identity = UserIdentity(
            id="user_123",
            plan="pro",
            company="Acme Inc",
        )

        request = IdentifyRequest(
            session_id=sample_session.id,
            identity=identity,
        )

        await pocketping.handle_identify(request)

        session = await pocketping.storage.get_session(sample_session.id)
        # Custom fields should be accessible
        identity_dict = session.identity.model_dump()
        assert identity_dict.get("plan") == "pro"
        assert identity_dict.get("company") == "Acme Inc"

    @pytest.mark.asyncio
    async def test_identify_notifies_bridges(self, pocketping, sample_session, mock_bridge):
        """Test that identify notifies bridges."""
        await pocketping.storage.create_session(sample_session)
        pocketping.add_bridge(mock_bridge)

        identity = UserIdentity(
            id="user_123",
            name="Test User",
        )

        request = IdentifyRequest(
            session_id=sample_session.id,
            identity=identity,
        )

        await pocketping.handle_identify(request)

        mock_bridge.on_identity_update.assert_called_once()


class TestPocketPingConnectWithIdentity:
    """Tests for connect with identity."""

    @pytest.mark.asyncio
    async def test_connect_with_identity(self, pocketping):
        """Test that connect accepts identity."""
        identity = UserIdentity(
            id="user_456",
            email="jane@example.com",
            name="Jane Doe",
        )

        request = ConnectRequest(
            visitor_id="new-visitor",
            identity=identity,
        )

        response = await pocketping.handle_connect(request)

        session = await pocketping.storage.get_session(response.session_id)
        assert session.identity is not None
        assert session.identity.id == "user_456"
        assert session.identity.email == "jane@example.com"

    @pytest.mark.asyncio
    async def test_connect_preserves_identity_on_reconnect(self, pocketping):
        """Test that reconnect preserves identity."""
        identity = UserIdentity(
            id="user_456",
            name="Jane",
        )

        # First connect with identity
        first_request = ConnectRequest(
            visitor_id="visitor-789",
            identity=identity,
        )
        first_response = await pocketping.handle_connect(first_request)

        # Reconnect without identity
        second_request = ConnectRequest(
            visitor_id="visitor-789",
            session_id=first_response.session_id,
        )
        second_response = await pocketping.handle_connect(second_request)

        assert second_response.session_id == first_response.session_id

        session = await pocketping.storage.get_session(second_response.session_id)
        assert session.identity is not None
        assert session.identity.id == "user_456"

"""Pytest configuration and fixtures for PocketPing SDK tests."""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from pocketping import PocketPing
from pocketping.models import (
    Message,
    MessageStatus,
    Sender,
    Session,
    SessionMetadata,
)
from pocketping.storage import MemoryStorage


@pytest.fixture
def event_loop():
    """Create an event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def memory_storage():
    """Create a fresh memory storage for each test."""
    return MemoryStorage()


@pytest.fixture
def pocketping(memory_storage):
    """Create a PocketPing instance with memory storage."""
    return PocketPing(storage=memory_storage)


@pytest.fixture
def sample_session():
    """Create a sample session for testing."""
    return Session(
        id="test-session-123",
        visitor_id="test-visitor-456",
        created_at=datetime.utcnow(),
        last_activity=datetime.utcnow(),
        operator_online=False,
        ai_active=False,
        metadata=SessionMetadata(
            url="https://example.com/test-page",
            referrer="https://google.com",
            page_title="Test Page",
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            timezone="Europe/Paris",
            language="en-US",
            screen_resolution="1920x1080",
            device_type="desktop",
            browser="Chrome",
            os="macOS",
            ip="192.168.1.1",
            country="France",
            city="Paris",
        ),
    )


@pytest.fixture
def sample_visitor_message(sample_session):
    """Create a sample visitor message for testing."""
    return Message(
        id="test-msg-001",
        session_id=sample_session.id,
        content="Hello, I need help!",
        sender=Sender.VISITOR,
        timestamp=datetime.utcnow(),
        status=MessageStatus.SENT,
    )


@pytest.fixture
def sample_operator_message(sample_session):
    """Create a sample operator message for testing."""
    return Message(
        id="test-msg-002",
        session_id=sample_session.id,
        content="Hi! How can I help you today?",
        sender=Sender.OPERATOR,
        timestamp=datetime.utcnow(),
        status=MessageStatus.SENT,
    )


@pytest.fixture
def mock_websocket():
    """Create a mock WebSocket connection."""
    ws = MagicMock()
    ws.send_text = AsyncMock()
    ws.close = AsyncMock()
    return ws


@pytest.fixture
def mock_bridge():
    """Create a mock bridge for testing."""
    bridge = MagicMock()
    bridge.name = "test-bridge"
    bridge.on_new_session = AsyncMock()
    bridge.on_visitor_message = AsyncMock()
    bridge.on_operator_message = AsyncMock()
    bridge.on_message_read = AsyncMock()
    return bridge

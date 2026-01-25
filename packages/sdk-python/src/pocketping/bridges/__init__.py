"""Notification bridges for PocketPing."""

from pocketping.bridges.base import Bridge, CompositeBridge
from pocketping.bridges.discord import DiscordBridge
from pocketping.bridges.slack import SlackBridge
from pocketping.bridges.telegram import TelegramBridge

__all__ = [
    "Bridge",
    "CompositeBridge",
    "TelegramBridge",
    "DiscordBridge",
    "SlackBridge",
]

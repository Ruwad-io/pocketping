"""Notification bridges for PocketPing."""

from pocketping.bridges.base import Bridge, CompositeBridge

__all__ = ["Bridge", "CompositeBridge"]

# Lazy imports for optional dependencies
def TelegramBridge(*args, **kwargs):
    from pocketping.bridges.telegram import TelegramBridge as _TelegramBridge
    return _TelegramBridge(*args, **kwargs)

def DiscordBridge(*args, **kwargs):
    from pocketping.bridges.discord import DiscordBridge as _DiscordBridge
    return _DiscordBridge(*args, **kwargs)

def SlackBridge(*args, **kwargs):
    from pocketping.bridges.slack import SlackBridge as _SlackBridge
    return _SlackBridge(*args, **kwargs)

"""Comprehensive tests for WebhookHandler incoming-message parsing.

Exercises the Telegram/Slack/Discord webhook parse paths, media extraction and
file/user-info downloads (mocked httpx.Client) in webhooks.py.
"""

from unittest.mock import MagicMock, patch

import httpx

from pocketping.webhooks import (
    OperatorAttachment,
    ParsedMedia,
    WebhookConfig,
    WebhookHandler,
)


def _collector():
    calls = []
    return calls, lambda *args: calls.append(args)


# ─────────────────────────────────────────────────────────────────
# Configuration / lifecycle
# ─────────────────────────────────────────────────────────────────


class TestWebhookHandlerLifecycle:
    def test_http_client_lazy_init_and_close(self):
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t"))
        assert handler._http_client is None
        client = handler.http_client
        assert isinstance(client, httpx.Client)
        # Returns the same client on repeat access
        assert handler.http_client is client
        handler.close()
        assert handler._http_client is None

    def test_close_when_not_initialized(self):
        handler = WebhookHandler(WebhookConfig())
        handler.close()  # no error

    def test_parsed_media_dataclass(self):
        m = ParsedMedia(file_id="f", filename="a.jpg", mime_type="image/jpeg", size=10)
        assert m.file_id == "f"

    def test_operator_attachment_defaults(self):
        a = OperatorAttachment(filename="a", mime_type="m", size=1, data=b"x")
        assert a.bridge_file_id is None


# ─────────────────────────────────────────────────────────────────
# Telegram webhook
# ─────────────────────────────────────────────────────────────────


class TestTelegramWebhook:
    def test_not_configured(self):
        handler = WebhookHandler(WebhookConfig())
        assert handler.handle_telegram_webhook({}) == {"error": "Telegram not configured"}

    def test_plain_text_message(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message=cb))
        payload = {
            "message": {
                "message_id": 5,
                "message_thread_id": 42,
                "text": "hello visitor",
                "from": {"first_name": "Alice"},
            }
        }
        assert handler.handle_telegram_webhook(payload) == {"ok": True}
        assert calls[0][0] == "42"
        assert calls[0][1] == "hello visitor"
        assert calls[0][2] == "Alice"
        assert calls[0][3] == "telegram"

    def test_message_with_ids_callback_and_reply(self):
        calls, cb = _collector()
        handler = WebhookHandler(
            WebhookConfig(telegram_bot_token="t", on_operator_message_with_ids=cb)
        )
        payload = {
            "message": {
                "message_id": 9,
                "message_thread_id": 42,
                "text": "answer",
                "from": {"first_name": "Bob"},
                "reply_to_message": {"message_id": 3},
            }
        }
        handler.handle_telegram_webhook(payload)
        # bridge_message_id is the last arg; reply id is index 5
        assert calls[0][6] == "9"
        assert calls[0][5] == 3

    def test_no_message_returns_ok(self):
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t"))
        assert handler.handle_telegram_webhook({"foo": "bar"}) == {"ok": True}

    def test_slash_command_skipped(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message=cb))
        payload = {"message": {"message_id": 1, "message_thread_id": 42, "text": "/start"}}
        handler.handle_telegram_webhook(payload)
        assert calls == []

    def test_no_topic_id_skipped(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message=cb))
        payload = {"message": {"message_id": 1, "text": "hi", "from": {"first_name": "X"}}}
        handler.handle_telegram_webhook(payload)
        assert calls == []

    def test_caption_used_when_no_text(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message=cb))
        payload = {
            "message": {
                "message_id": 1,
                "message_thread_id": 42,
                "caption": "from caption",
                "from": {"first_name": "X"},
            }
        }
        handler.handle_telegram_webhook(payload)
        assert calls[0][1] == "from caption"

    def test_photo_media_downloaded(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message=cb))
        payload = {
            "message": {
                "message_id": 1,
                "message_thread_id": 42,
                "photo": [{"file_id": "small"}, {"file_id": "big", "file_size": 999}],
                "from": {"first_name": "X"},
            }
        }
        with patch.object(handler, "_download_telegram_file", return_value=b"img"):
            handler.handle_telegram_webhook(payload)
        attachments = calls[0][4]
        assert len(attachments) == 1
        assert attachments[0].mime_type == "image/jpeg"
        assert attachments[0].data == b"img"

    def test_document_media(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message=cb))
        payload = {
            "message": {
                "message_id": 1,
                "message_thread_id": 42,
                "document": {"file_id": "d", "file_name": "report.pdf", "mime_type": "application/pdf", "file_size": 5},
                "from": {"first_name": "X"},
            }
        }
        with patch.object(handler, "_download_telegram_file", return_value=b"pdf"):
            handler.handle_telegram_webhook(payload)
        assert calls[0][4][0].filename == "report.pdf"

    def test_audio_video_voice_media(self):
        for kind, mime in [("audio", "audio/mpeg"), ("video", "video/mp4"), ("voice", "audio/ogg")]:
            calls, cb = _collector()
            handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message=cb))
            payload = {
                "message": {
                    "message_id": 1,
                    "message_thread_id": 42,
                    kind: {"file_id": "x", "file_size": 1},
                    "from": {"first_name": "X"},
                }
            }
            with patch.object(handler, "_download_telegram_file", return_value=b"data"):
                handler.handle_telegram_webhook(payload)
            assert calls[0][4][0].mime_type == mime

    def test_media_download_returns_none_no_attachment(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message=cb))
        payload = {
            "message": {
                "message_id": 1,
                "message_thread_id": 42,
                "photo": [{"file_id": "big"}],
                "from": {"first_name": "X"},
            }
        }
        with patch.object(handler, "_download_telegram_file", return_value=None):
            handler.handle_telegram_webhook(payload)
        assert calls[0][4] == []

    def test_no_content_no_media_skipped(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message=cb))
        payload = {"message": {"message_id": 1, "message_thread_id": 42, "from": {"first_name": "X"}}}
        handler.handle_telegram_webhook(payload)
        assert calls == []

    def test_edited_message_no_text_skipped(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message_edit=cb))
        payload = {"edited_message": {"message_id": 1, "message_thread_id": 42}}
        handler.handle_telegram_webhook(payload)
        assert calls == []

    def test_edited_message_command_skipped(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message_edit=cb))
        payload = {"edited_message": {"message_id": 1, "message_thread_id": 42, "text": "/cmd"}}
        handler.handle_telegram_webhook(payload)
        assert calls == []

    def test_edited_message_no_topic_skipped(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message_edit=cb))
        payload = {"edited_message": {"message_id": 1, "text": "edited"}}
        handler.handle_telegram_webhook(payload)
        assert calls == []

    def test_reaction_delete(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message_delete=cb))
        payload = {
            "message_reaction": {
                "message_id": 7,
                "message_thread_id": 42,
                "new_reaction": [{"emoji": "🗑"}],
            }
        }
        handler.handle_telegram_webhook(payload)
        assert calls[0][1] == "7"
        assert calls[0][2] == "telegram"

    def test_reaction_non_trash_ignored(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message_delete=cb))
        payload = {
            "message_reaction": {
                "message_id": 7,
                "message_thread_id": 42,
                "new_reaction": [{"emoji": "👍"}],
            }
        }
        handler.handle_telegram_webhook(payload)
        assert calls == []

    def test_delete_command_reply(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="t", on_operator_message_delete=cb))
        payload = {
            "message": {
                "message_id": 8,
                "message_thread_id": 42,
                "text": "/delete",
                "reply_to_message": {"message_id": 4},
            }
        }
        handler.handle_telegram_webhook(payload)
        assert calls[0][1] == "4"


class TestTelegramFileDownload:
    def test_download_success(self):
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="tok"))
        mock_client = MagicMock()
        getfile_resp = MagicMock()
        getfile_resp.json.return_value = {"ok": True, "result": {"file_path": "photos/x.jpg"}}
        file_resp = MagicMock()
        file_resp.content = b"bytes"
        mock_client.get.side_effect = [getfile_resp, file_resp]
        handler._http_client = mock_client
        assert handler._download_telegram_file("fid") == b"bytes"

    def test_download_no_token(self):
        handler = WebhookHandler(WebhookConfig())
        assert handler._download_telegram_file("fid") is None

    def test_download_bad_getfile(self):
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="tok"))
        mock_client = MagicMock()
        resp = MagicMock()
        resp.json.return_value = {"ok": False}
        mock_client.get.return_value = resp
        handler._http_client = mock_client
        assert handler._download_telegram_file("fid") is None

    def test_download_exception(self, capsys):
        handler = WebhookHandler(WebhookConfig(telegram_bot_token="tok"))
        mock_client = MagicMock()
        mock_client.get.side_effect = RuntimeError("net")
        handler._http_client = mock_client
        assert handler._download_telegram_file("fid") is None
        assert "file download error" in capsys.readouterr().out


# ─────────────────────────────────────────────────────────────────
# Slack webhook
# ─────────────────────────────────────────────────────────────────


class TestSlackWebhook:
    def test_not_configured(self):
        handler = WebhookHandler(WebhookConfig())
        assert handler.handle_slack_webhook({}) == {"error": "Slack not configured"}

    def test_url_verification_challenge(self):
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x"))
        result = handler.handle_slack_webhook(
            {"type": "url_verification", "challenge": "abc123"}
        )
        assert result == {"challenge": "abc123"}

    def test_plain_message_event(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x", on_operator_message=cb))
        payload = {
            "type": "event_callback",
            "event": {
                "type": "message",
                "thread_ts": "111.222",
                "ts": "111.333",
                "text": "operator reply",
                "user": "U1",
            },
        }
        with patch.object(handler, "_get_slack_user_name", return_value="Carol"):
            handler.handle_slack_webhook(payload)
        assert calls[0][0] == "111.222"
        assert calls[0][1] == "operator reply"
        assert calls[0][2] == "Carol"

    def test_message_with_ids(self):
        calls, cb = _collector()
        handler = WebhookHandler(
            WebhookConfig(slack_bot_token="x", on_operator_message_with_ids=cb)
        )
        payload = {
            "type": "event_callback",
            "event": {"type": "message", "thread_ts": "1.2", "ts": "1.3", "text": "hi", "user": "U1"},
        }
        with patch.object(handler, "_get_slack_user_name", return_value=None):
            handler.handle_slack_webhook(payload)
        assert calls[0][6] == "1.3"

    def test_message_with_files(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x", on_operator_message=cb))
        payload = {
            "type": "event_callback",
            "event": {
                "type": "message",
                "thread_ts": "1.2",
                "ts": "1.3",
                "text": "",
                "user": "U1",
                "files": [{"name": "doc.pdf", "mimetype": "application/pdf", "size": 5, "id": "F1"}],
            },
        }
        with patch.object(handler, "_download_slack_file", return_value=b"data"), patch.object(
            handler, "_get_slack_user_name", return_value="Carol"
        ):
            handler.handle_slack_webhook(payload)
        assert calls[0][4][0].filename == "doc.pdf"

    def test_message_changed_edit(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x", on_operator_message_edit=cb))
        payload = {
            "type": "event_callback",
            "event": {
                "type": "message",
                "subtype": "message_changed",
                "message": {"thread_ts": "1.2", "ts": "1.3", "text": "edited"},
            },
        }
        handler.handle_slack_webhook(payload)
        assert calls[0][2] == "edited"

    def test_message_changed_bot_not_allowed(self):
        calls, cb = _collector()
        handler = WebhookHandler(
            WebhookConfig(slack_bot_token="x", on_operator_message_edit=cb, allowed_bot_ids=["B-OK"])
        )
        payload = {
            "type": "event_callback",
            "event": {
                "type": "message",
                "subtype": "message_changed",
                "message": {"thread_ts": "1.2", "ts": "1.3", "text": "edited", "bot_id": "B-EVIL"},
            },
        }
        handler.handle_slack_webhook(payload)
        assert calls == []

    def test_message_deleted(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x", on_operator_message_delete=cb))
        payload = {
            "type": "event_callback",
            "event": {
                "type": "message",
                "subtype": "message_deleted",
                "deleted_ts": "1.3",
                "previous_message": {"thread_ts": "1.2", "ts": "1.3"},
            },
        }
        handler.handle_slack_webhook(payload)
        assert calls[0][1] == "1.3"

    def test_non_message_event_ignored(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x", on_operator_message=cb))
        payload = {"type": "event_callback", "event": {"type": "reaction_added"}}
        assert handler.handle_slack_webhook(payload) == {"ok": True}
        assert calls == []

    def test_bot_message_ignored(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x", on_operator_message=cb))
        payload = {
            "type": "event_callback",
            "event": {"type": "message", "thread_ts": "1.2", "ts": "1.3", "text": "hi", "bot_id": "B1"},
        }
        handler.handle_slack_webhook(payload)
        assert calls == []


class TestSlackHelpers:
    def test_download_slack_file_success(self):
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x"))
        mock_client = MagicMock()
        resp = MagicMock()
        resp.status_code = 200
        resp.content = b"file"
        mock_client.get.return_value = resp
        handler._http_client = mock_client
        assert handler._download_slack_file({"url_private_download": "https://x"}) == b"file"

    def test_download_slack_file_no_url(self):
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x"))
        assert handler._download_slack_file({}) is None

    def test_download_slack_file_bad_status(self):
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x"))
        mock_client = MagicMock()
        resp = MagicMock()
        resp.status_code = 403
        mock_client.get.return_value = resp
        handler._http_client = mock_client
        assert handler._download_slack_file({"url_private": "https://x"}) is None

    def test_download_slack_file_exception(self, capsys):
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x"))
        mock_client = MagicMock()
        mock_client.get.side_effect = RuntimeError("net")
        handler._http_client = mock_client
        assert handler._download_slack_file({"url_private": "https://x"}) is None
        assert "file download error" in capsys.readouterr().out

    def test_get_user_name_success(self):
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x"))
        mock_client = MagicMock()
        resp = MagicMock()
        resp.json.return_value = {"ok": True, "user": {"real_name": "Real Name", "name": "rn"}}
        mock_client.get.return_value = resp
        handler._http_client = mock_client
        assert handler._get_slack_user_name("U1") == "Real Name"

    def test_get_user_name_not_ok(self):
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x"))
        mock_client = MagicMock()
        resp = MagicMock()
        resp.json.return_value = {"ok": False}
        mock_client.get.return_value = resp
        handler._http_client = mock_client
        assert handler._get_slack_user_name("U1") is None

    def test_get_user_name_exception(self):
        handler = WebhookHandler(WebhookConfig(slack_bot_token="x"))
        mock_client = MagicMock()
        mock_client.get.side_effect = RuntimeError("net")
        handler._http_client = mock_client
        assert handler._get_slack_user_name("U1") is None


# ─────────────────────────────────────────────────────────────────
# Discord webhook
# ─────────────────────────────────────────────────────────────────


class TestDiscordWebhook:
    def test_ping_returns_pong(self):
        handler = WebhookHandler(WebhookConfig(discord_bot_token="x"))
        assert handler.handle_discord_webhook({"type": 1}) == {"type": 1}

    def test_reply_command(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(discord_bot_token="x", on_operator_message=cb))
        payload = {
            "type": 2,
            "channel_id": "chan-1",
            "data": {"name": "reply", "options": [{"name": "message", "value": "discord reply"}]},
            "member": {"user": {"username": "Dave"}},
        }
        result = handler.handle_discord_webhook(payload)
        assert calls[0][0] == "chan-1"
        assert calls[0][1] == "discord reply"
        assert calls[0][2] == "Dave"
        assert result["type"] == 4

    def test_reply_command_user_fallback(self):
        calls, cb = _collector()
        handler = WebhookHandler(WebhookConfig(discord_bot_token="x", on_operator_message=cb))
        payload = {
            "type": 2,
            "channel_id": "chan-1",
            "data": {"name": "reply", "options": [{"name": "message", "value": "hi"}]},
            "user": {"username": "Eve"},
        }
        handler.handle_discord_webhook(payload)
        assert calls[0][2] == "Eve"

    def test_reply_command_missing_content(self):
        handler = WebhookHandler(WebhookConfig(discord_bot_token="x"))
        payload = {"type": 2, "channel_id": "chan-1", "data": {"name": "reply", "options": []}}
        assert handler.handle_discord_webhook(payload) == {"type": 1}

    def test_non_reply_command(self):
        handler = WebhookHandler(WebhookConfig(discord_bot_token="x"))
        payload = {"type": 2, "data": {"name": "other"}}
        assert handler.handle_discord_webhook(payload) == {"type": 1}

    def test_unknown_type(self):
        handler = WebhookHandler(WebhookConfig(discord_bot_token="x"))
        assert handler.handle_discord_webhook({"type": 99}) == {"type": 1}

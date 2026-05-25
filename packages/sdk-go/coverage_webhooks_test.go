package pocketping

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// webhookTestTransport rewrites Telegram and Slack API calls to a test server.
type webhookTestTransport struct {
	telegramURL string
	slackURL    string
}

func (t *webhookTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	host := req.URL.Host
	if strings.Contains(host, "api.telegram.org") && t.telegramURL != "" {
		newURL := t.telegramURL + req.URL.Path
		if req.URL.RawQuery != "" {
			newURL += "?" + req.URL.RawQuery
		}
		newReq, _ := http.NewRequest(req.Method, newURL, req.Body)
		newReq.Header = req.Header
		return http.DefaultTransport.RoundTrip(newReq)
	}
	if strings.Contains(host, "slack.com") && t.slackURL != "" {
		newURL := t.slackURL + req.URL.Path
		if req.URL.RawQuery != "" {
			newURL += "?" + req.URL.RawQuery
		}
		newReq, _ := http.NewRequest(req.Method, newURL, req.Body)
		newReq.Header = req.Header
		return http.DefaultTransport.RoundTrip(newReq)
	}
	return http.DefaultTransport.RoundTrip(req)
}

func postWebhook(handler http.HandlerFunc, payload string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/webhook", bytes.NewReader([]byte(payload)))
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

// ─────────────────────────────────────────────────────────────────
// Telegram webhook — extra paths
// ─────────────────────────────────────────────────────────────────

func TestTelegramWebhookNotConfigured(t *testing.T) {
	wh := NewWebhookHandler(WebhookConfig{})
	rec := postWebhook(wh.HandleTelegramWebhook(), `{"message":{}}`)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestTelegramWebhookInvalidJSON(t *testing.T) {
	wh := NewWebhookHandler(WebhookConfig{TelegramBotToken: "tok"})
	rec := postWebhook(wh.HandleTelegramWebhook(), `{not json`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestTelegramWebhookCommandSkipped(t *testing.T) {
	called := false
	wh := NewWebhookHandler(WebhookConfig{
		TelegramBotToken:  "tok",
		OnOperatorMessage: func(ctx context.Context, sid, c, on, sb string, a []Attachment, r *int) { called = true },
	})
	rec := postWebhook(wh.HandleTelegramWebhook(), `{"message":{"message_id":1,"message_thread_id":5,"text":"/start"}}`)
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d", rec.Code)
	}
	if called {
		t.Error("command should be skipped, callback not invoked")
	}
}

func TestTelegramWebhookTextMessageWithReply(t *testing.T) {
	var gotSession, gotContent, gotOperator string
	var gotReplyTo *int
	var gotMsgID string
	wh := NewWebhookHandler(WebhookConfig{
		TelegramBotToken: "tok",
		OnOperatorMessage: func(ctx context.Context, sid, c, on, sb string, a []Attachment, r *int) {
			gotSession, gotContent, gotOperator, gotReplyTo = sid, c, on, r
		},
		OnOperatorMessageWithIDs: func(ctx context.Context, sid, c, on, sb string, a []Attachment, r *int, bid string) {
			gotMsgID = bid
		},
	})
	rec := postWebhook(wh.HandleTelegramWebhook(), `{"message":{"message_id":42,"message_thread_id":7,"text":"hello there","from":{"id":1,"first_name":"Alice"},"reply_to_message":{"message_id":99}}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if gotSession != "7" {
		t.Errorf("session = %q, want 7", gotSession)
	}
	if gotContent != "hello there" {
		t.Errorf("content = %q", gotContent)
	}
	if gotOperator != "Alice" {
		t.Errorf("operator = %q, want Alice", gotOperator)
	}
	if gotReplyTo == nil || *gotReplyTo != 99 {
		t.Errorf("replyTo = %v, want 99", gotReplyTo)
	}
	if gotMsgID != "42" {
		t.Errorf("bridge message id = %q, want 42", gotMsgID)
	}
}

func TestTelegramWebhookNoTopicSkipped(t *testing.T) {
	called := false
	wh := NewWebhookHandler(WebhookConfig{
		TelegramBotToken:  "tok",
		OnOperatorMessage: func(ctx context.Context, sid, c, on, sb string, a []Attachment, r *int) { called = true },
	})
	// No message_thread_id -> skipped.
	rec := postWebhook(wh.HandleTelegramWebhook(), `{"message":{"message_id":1,"text":"hi"}}`)
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d", rec.Code)
	}
	if called {
		t.Error("message without topic should be skipped")
	}
}

func TestTelegramWebhookPhotoDownloads(t *testing.T) {
	// Telegram getFile + file download server.
	fileSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/getFile") {
			_, _ = w.Write([]byte(`{"ok":true,"result":{"file_path":"photos/file_1.jpg"}}`))
			return
		}
		// File download.
		_, _ = w.Write([]byte("IMAGEDATA"))
	}))
	defer fileSrv.Close()

	var gotAttachments []Attachment
	wh := NewWebhookHandler(WebhookConfig{
		TelegramBotToken: "tok",
		OnOperatorMessage: func(ctx context.Context, sid, c, on, sb string, a []Attachment, r *int) {
			gotAttachments = a
		},
	})
	wh.httpClient = &http.Client{Transport: &webhookTestTransport{telegramURL: fileSrv.URL}}

	rec := postWebhook(wh.HandleTelegramWebhook(), `{"message":{"message_id":1,"message_thread_id":3,"photo":[{"file_id":"small","file_size":100},{"file_id":"large","file_size":500}]}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if len(gotAttachments) != 1 {
		t.Fatalf("attachments = %d, want 1", len(gotAttachments))
	}
	if string(gotAttachments[0].Data) != "IMAGEDATA" {
		t.Errorf("attachment data = %q", string(gotAttachments[0].Data))
	}
	if gotAttachments[0].MimeType != "image/jpeg" {
		t.Errorf("mime = %q", gotAttachments[0].MimeType)
	}
}

func TestTelegramWebhookDocumentDownloadFails(t *testing.T) {
	// getFile returns not OK -> download fails, message still delivered without attachment.
	fileSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":false}`))
	}))
	defer fileSrv.Close()

	var delivered bool
	var gotAtt []Attachment
	wh := NewWebhookHandler(WebhookConfig{
		TelegramBotToken: "tok",
		OnOperatorMessage: func(ctx context.Context, sid, c, on, sb string, a []Attachment, r *int) {
			delivered = true
			gotAtt = a
		},
	})
	wh.httpClient = &http.Client{Transport: &webhookTestTransport{telegramURL: fileSrv.URL}}

	rec := postWebhook(wh.HandleTelegramWebhook(), `{"message":{"message_id":1,"message_thread_id":3,"text":"see file","document":{"file_id":"doc1","file_name":"f.pdf","mime_type":"application/pdf","file_size":10}}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if !delivered {
		t.Error("expected message to be delivered even if download fails")
	}
	if len(gotAtt) != 0 {
		t.Errorf("expected no attachments on download failure, got %d", len(gotAtt))
	}
}

func TestTelegramWebhookEditCommandAndCaption(t *testing.T) {
	// Edited message that is a command -> skipped.
	wh := NewWebhookHandler(WebhookConfig{
		TelegramBotToken:      "tok",
		OnOperatorMessageEdit: func(ctx context.Context, sid, bid, c, sb string, e time.Time) { t.Error("should not be called for command") },
	})
	rec := postWebhook(wh.HandleTelegramWebhook(), `{"edited_message":{"message_id":1,"message_thread_id":5,"text":"/cmd"}}`)
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d", rec.Code)
	}

	// Edited message without topic -> skipped (no edit_date -> uses now).
	called := false
	wh2 := NewWebhookHandler(WebhookConfig{
		TelegramBotToken:      "tok",
		OnOperatorMessageEdit: func(ctx context.Context, sid, bid, c, sb string, e time.Time) { called = true },
	})
	rec2 := postWebhook(wh2.HandleTelegramWebhook(), `{"edited_message":{"message_id":1,"text":"updated caption"}}`)
	if rec2.Code != http.StatusOK || called {
		t.Errorf("edited message without topic should be skipped (code=%d called=%v)", rec2.Code, called)
	}
}

func TestTelegramWebhookReactionNonTrash(t *testing.T) {
	called := false
	wh := NewWebhookHandler(WebhookConfig{
		TelegramBotToken:        "tok",
		OnOperatorMessageDelete: func(ctx context.Context, sid, bid, sb string, d time.Time) { called = true },
	})
	rec := postWebhook(wh.HandleTelegramWebhook(), `{"message_reaction":{"message_id":1,"message_thread_id":5,"new_reaction":[{"type":"emoji","emoji":"👍"}]}}`)
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d", rec.Code)
	}
	if called {
		t.Error("non-trash reaction should not trigger delete")
	}
}

// ─────────────────────────────────────────────────────────────────
// Slack webhook
// ─────────────────────────────────────────────────────────────────

func TestSlackWebhookNotConfigured(t *testing.T) {
	wh := NewWebhookHandler(WebhookConfig{})
	rec := postWebhook(wh.HandleSlackWebhook(), `{"type":"event_callback"}`)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestSlackWebhookInvalidJSON(t *testing.T) {
	wh := NewWebhookHandler(WebhookConfig{SlackBotToken: "xoxb"})
	rec := postWebhook(wh.HandleSlackWebhook(), `{bad`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestSlackWebhookURLVerification(t *testing.T) {
	wh := NewWebhookHandler(WebhookConfig{SlackBotToken: "xoxb"})
	rec := postWebhook(wh.HandleSlackWebhook(), `{"type":"url_verification","challenge":"abc123"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["challenge"] != "abc123" {
		t.Errorf("challenge echo = %q", body["challenge"])
	}
}

func TestSlackWebhookNonMessageEventIgnored(t *testing.T) {
	wh := NewWebhookHandler(WebhookConfig{
		SlackBotToken:     "xoxb",
		OnOperatorMessage: func(ctx context.Context, sid, c, on, sb string, a []Attachment, r *int) { t.Error("should not call") },
	})
	rec := postWebhook(wh.HandleSlackWebhook(), `{"type":"event_callback","event":{"type":"reaction_added"}}`)
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d", rec.Code)
	}
}

func TestSlackWebhookMessageWithUserName(t *testing.T) {
	userSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"user":{"real_name":"Bob Smith","name":"bob"}}`))
	}))
	defer userSrv.Close()

	var gotSession, gotContent, gotOperator, gotTs string
	wh := NewWebhookHandler(WebhookConfig{
		SlackBotToken: "xoxb",
		OnOperatorMessage: func(ctx context.Context, sid, c, on, sb string, a []Attachment, r *int) {
			gotSession, gotContent, gotOperator = sid, c, on
		},
		OnOperatorMessageWithIDs: func(ctx context.Context, sid, c, on, sb string, a []Attachment, r *int, bid string) {
			gotTs = bid
		},
	})
	wh.httpClient = &http.Client{Transport: &webhookTestTransport{slackURL: userSrv.URL}}

	payload := `{"type":"event_callback","event":{"type":"message","thread_ts":"111.222","ts":"333.444","user":"U1","text":"Hello visitor"}}`
	rec := postWebhook(wh.HandleSlackWebhook(), payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if gotSession != "111.222" {
		t.Errorf("session = %q", gotSession)
	}
	if gotContent != "Hello visitor" {
		t.Errorf("content = %q", gotContent)
	}
	if gotOperator != "Bob Smith" {
		t.Errorf("operator = %q, want Bob Smith", gotOperator)
	}
	if gotTs != "333.444" {
		t.Errorf("ts = %q", gotTs)
	}
}

func TestSlackWebhookMessageWithFiles(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "users.info") {
			_, _ = w.Write([]byte(`{"ok":false}`)) // fall back to default operator name
			return
		}
		// File download.
		_, _ = w.Write([]byte("FILEBYTES"))
	}))
	defer srv.Close()

	var gotAtt []Attachment
	wh := NewWebhookHandler(WebhookConfig{
		SlackBotToken: "xoxb",
		OnOperatorMessage: func(ctx context.Context, sid, c, on, sb string, a []Attachment, r *int) {
			gotAtt = a
		},
	})
	wh.httpClient = &http.Client{Transport: &webhookTestTransport{slackURL: srv.URL}}

	payload := `{"type":"event_callback","event":{"type":"message","thread_ts":"t1","ts":"t2","user":"U1","files":[{"id":"F1","name":"doc.txt","mimetype":"text/plain","size":9,"url_private":"https://slack.com/files/doc.txt"}]}}`
	rec := postWebhook(wh.HandleSlackWebhook(), payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if len(gotAtt) != 1 || string(gotAtt[0].Data) != "FILEBYTES" {
		t.Fatalf("attachments = %+v", gotAtt)
	}
}

func TestSlackWebhookMessageChanged(t *testing.T) {
	var gotThread, gotTs, gotText string
	wh := NewWebhookHandler(WebhookConfig{
		SlackBotToken: "xoxb",
		OnOperatorMessageEdit: func(ctx context.Context, sid, bid, c, sb string, e time.Time) {
			gotThread, gotTs, gotText = sid, bid, c
		},
	})
	payload := `{"type":"event_callback","event":{"type":"message","subtype":"message_changed","message":{"ts":"m1","thread_ts":"th1","text":"edited text"}}}`
	rec := postWebhook(wh.HandleSlackWebhook(), payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if gotThread != "th1" || gotTs != "m1" || gotText != "edited text" {
		t.Errorf("edit got thread=%q ts=%q text=%q", gotThread, gotTs, gotText)
	}
}

func TestSlackWebhookMessageDeleted(t *testing.T) {
	var gotThread, gotTs string
	wh := NewWebhookHandler(WebhookConfig{
		SlackBotToken: "xoxb",
		OnOperatorMessageDelete: func(ctx context.Context, sid, bid, sb string, d time.Time) {
			gotThread, gotTs = sid, bid
		},
	})
	payload := `{"type":"event_callback","event":{"type":"message","subtype":"message_deleted","deleted_ts":"d1","previous_message":{"ts":"d1","thread_ts":"th2"}}}`
	rec := postWebhook(wh.HandleSlackWebhook(), payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if gotThread != "th2" || gotTs != "d1" {
		t.Errorf("delete got thread=%q ts=%q", gotThread, gotTs)
	}
}

func TestSlackIsAllowedBot(t *testing.T) {
	wh := NewWebhookHandler(WebhookConfig{AllowedBotIDs: []string{"B123"}})
	if !wh.isAllowedBot("B123") {
		t.Error("expected B123 to be allowed")
	}
	if wh.isAllowedBot("B999") {
		t.Error("expected B999 not allowed")
	}
	if wh.isAllowedBot("") {
		t.Error("empty bot id should not be allowed")
	}
}

func TestSlackGetUserNameFallbackToName(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"user":{"name":"justname"}}`))
	}))
	defer srv.Close()
	wh := NewWebhookHandler(WebhookConfig{SlackBotToken: "xoxb"})
	wh.httpClient = &http.Client{Transport: &webhookTestTransport{slackURL: srv.URL}}
	name, err := wh.getSlackUserName("U1")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if name != "justname" {
		t.Errorf("name = %q, want justname", name)
	}
}

func TestSlackGetUserNameError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":false}`))
	}))
	defer srv.Close()
	wh := NewWebhookHandler(WebhookConfig{SlackBotToken: "xoxb"})
	wh.httpClient = &http.Client{Transport: &webhookTestTransport{slackURL: srv.URL}}
	if _, err := wh.getSlackUserName("U1"); err == nil {
		t.Error("expected error when ok=false")
	}
}

func TestSlackDownloadFileStatusError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	wh := NewWebhookHandler(WebhookConfig{SlackBotToken: "xoxb"})
	wh.httpClient = &http.Client{Transport: &webhookTestTransport{slackURL: srv.URL}}
	_, err := wh.downloadSlackFile(SlackFile{URLPrivate: "https://slack.com/files/x"})
	if err == nil {
		t.Error("expected error on non-200 download")
	}
}

// ─────────────────────────────────────────────────────────────────
// Discord webhook (interactions)
// ─────────────────────────────────────────────────────────────────

func TestDiscordWebhookInvalidJSON(t *testing.T) {
	wh := NewWebhookHandler(WebhookConfig{})
	rec := postWebhook(wh.HandleDiscordWebhook(), `{bad`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestDiscordWebhookPing(t *testing.T) {
	wh := NewWebhookHandler(WebhookConfig{})
	rec := postWebhook(wh.HandleDiscordWebhook(), `{"type":1}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body map[string]int
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["type"] != DiscordResponseTypePong {
		t.Errorf("pong type = %d", body["type"])
	}
}

func TestDiscordWebhookReplyCommand(t *testing.T) {
	var gotThread, gotContent, gotOperator string
	wh := NewWebhookHandler(WebhookConfig{
		OnOperatorMessage: func(ctx context.Context, sid, c, on, sb string, a []Attachment, r *int) {
			gotThread, gotContent, gotOperator = sid, c, on
		},
	})
	payload := `{"type":2,"channel_id":"chan1","member":{"user":{"id":"u1","username":"Carol"}},"data":{"name":"reply","options":[{"name":"message","value":"on my way"}]}}`
	rec := postWebhook(wh.HandleDiscordWebhook(), payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if gotThread != "chan1" || gotContent != "on my way" || gotOperator != "Carol" {
		t.Errorf("got thread=%q content=%q operator=%q", gotThread, gotContent, gotOperator)
	}
	if !strings.Contains(rec.Body.String(), "Message sent to visitor") {
		t.Errorf("expected confirmation response, got %q", rec.Body.String())
	}
}

func TestDiscordWebhookReplyCommandUserFallback(t *testing.T) {
	var gotOperator string
	wh := NewWebhookHandler(WebhookConfig{
		OnOperatorMessage: func(ctx context.Context, sid, c, on, sb string, a []Attachment, r *int) {
			gotOperator = on
		},
	})
	// No member, only top-level user.
	payload := `{"type":2,"channel_id":"chan1","user":{"id":"u2","username":"Dave"},"data":{"name":"reply","options":[{"name":"message","value":"hi"}]}}`
	rec := postWebhook(wh.HandleDiscordWebhook(), payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if gotOperator != "Dave" {
		t.Errorf("operator = %q, want Dave", gotOperator)
	}
}

func TestDiscordWebhookUnknownInteractionDefaultsPong(t *testing.T) {
	wh := NewWebhookHandler(WebhookConfig{})
	// Application command but not "reply".
	payload := `{"type":2,"data":{"name":"other"}}`
	rec := postWebhook(wh.HandleDiscordWebhook(), payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body map[string]int
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["type"] != DiscordResponseTypePong {
		t.Errorf("expected pong default, got %d", body["type"])
	}
}

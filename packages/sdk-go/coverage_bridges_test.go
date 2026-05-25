package pocketping

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// countingServer returns a test server that records how many requests it got.
func countingServer(t *testing.T, body string) (*httptest.Server, func() int) {
	t.Helper()
	var count int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count++
		if body != "" {
			_, _ = w.Write([]byte(body))
		} else {
			_, _ = w.Write([]byte(`{"ok":true,"result":{"message_id":1}}`))
		}
	}))
	return srv, func() int { return count }
}

func sampleSession() *Session {
	return &Session{
		ID:        "sess-1",
		VisitorID: "visitor-1",
		UserPhone: "+33612345678",
		Identity:  &UserIdentity{ID: "u1", Name: "Alice", Email: "alice@example.com"},
		Metadata:  &SessionMetadata{URL: "https://example.com/pricing", UserAgent: "Mozilla/5.0 Chrome/120 Windows"},
	}
}

// ─────────────────────────────────────────────────────────────────
// BaseBridge no-op methods
// ─────────────────────────────────────────────────────────────────

func TestBaseBridgeNoOps(t *testing.T) {
	ctx := context.Background()
	b := &BaseBridge{BridgeName: "base"}
	if b.Name() != "base" {
		t.Errorf("Name = %q", b.Name())
	}
	if err := b.Init(ctx, nil); err != nil {
		t.Errorf("Init = %v", err)
	}
	s := sampleSession()
	if err := b.OnNewSession(ctx, s); err != nil {
		t.Errorf("OnNewSession = %v", err)
	}
	if err := b.OnVisitorMessage(ctx, &Message{}, s); err != nil {
		t.Errorf("OnVisitorMessage = %v", err)
	}
	if err := b.OnOperatorMessage(ctx, &Message{}, s, "", ""); err != nil {
		t.Errorf("OnOperatorMessage = %v", err)
	}
	if err := b.OnTyping(ctx, "s", true); err != nil {
		t.Errorf("OnTyping = %v", err)
	}
	if err := b.OnMessageRead(ctx, "s", nil, MessageStatusRead); err != nil {
		t.Errorf("OnMessageRead = %v", err)
	}
	if err := b.OnCustomEvent(ctx, CustomEvent{}, s); err != nil {
		t.Errorf("OnCustomEvent = %v", err)
	}
	if err := b.OnIdentityUpdate(ctx, s); err != nil {
		t.Errorf("OnIdentityUpdate = %v", err)
	}
	if err := b.Destroy(ctx); err != nil {
		t.Errorf("Destroy = %v", err)
	}
}

// ─────────────────────────────────────────────────────────────────
// CompositeBridge
// ─────────────────────────────────────────────────────────────────

type spyBridge struct {
	BaseBridge
	mu     spyCounters
	failOn string // method name that returns an error
}

type spyCounters struct {
	newSession, visitor, operator, typing, read, event, identity, destroy, initd int
}

func (s *spyBridge) Init(ctx context.Context, pp *PocketPing) error {
	s.mu.initd++
	if s.failOn == "init" {
		return errBoom
	}
	return nil
}
func (s *spyBridge) OnNewSession(ctx context.Context, sess *Session) error {
	s.mu.newSession++
	if s.failOn == "newSession" {
		return errBoom
	}
	return nil
}
func (s *spyBridge) OnVisitorMessage(ctx context.Context, m *Message, sess *Session) error {
	s.mu.visitor++
	if s.failOn == "visitor" {
		return errBoom
	}
	return nil
}
func (s *spyBridge) OnOperatorMessage(ctx context.Context, m *Message, sess *Session, sb, on string) error {
	s.mu.operator++
	if s.failOn == "operator" {
		return errBoom
	}
	return nil
}
func (s *spyBridge) OnTyping(ctx context.Context, sid string, t bool) error {
	s.mu.typing++
	if s.failOn == "typing" {
		return errBoom
	}
	return nil
}
func (s *spyBridge) OnMessageRead(ctx context.Context, sid string, ids []string, st MessageStatus) error {
	s.mu.read++
	if s.failOn == "read" {
		return errBoom
	}
	return nil
}
func (s *spyBridge) OnCustomEvent(ctx context.Context, e CustomEvent, sess *Session) error {
	s.mu.event++
	if s.failOn == "event" {
		return errBoom
	}
	return nil
}
func (s *spyBridge) OnIdentityUpdate(ctx context.Context, sess *Session) error {
	s.mu.identity++
	if s.failOn == "identity" {
		return errBoom
	}
	return nil
}
func (s *spyBridge) Destroy(ctx context.Context) error {
	s.mu.destroy++
	if s.failOn == "destroy" {
		return errBoom
	}
	return nil
}

var errBoom = &boomError{}

type boomError struct{}

func (*boomError) Error() string { return "boom" }

func TestCompositeBridgeForwardsToAll(t *testing.T) {
	ctx := context.Background()
	a := &spyBridge{BaseBridge: BaseBridge{BridgeName: "a"}}
	b := &spyBridge{BaseBridge: BaseBridge{BridgeName: "b"}}
	c := NewCompositeBridge(a, b)

	if c.Name() != "composite" {
		t.Errorf("Name = %q", c.Name())
	}
	if err := c.Init(ctx, nil); err != nil {
		t.Errorf("Init = %v", err)
	}
	s := sampleSession()
	_ = c.OnNewSession(ctx, s)
	_ = c.OnVisitorMessage(ctx, &Message{}, s)
	_ = c.OnOperatorMessage(ctx, &Message{}, s, "src", "op")
	_ = c.OnTyping(ctx, "s", true)
	_ = c.OnMessageRead(ctx, "s", []string{"m1"}, MessageStatusRead)
	_ = c.OnCustomEvent(ctx, CustomEvent{Name: "e"}, s)
	_ = c.OnIdentityUpdate(ctx, s)
	_ = c.Destroy(ctx)

	for _, sb := range []*spyBridge{a, b} {
		if sb.mu.initd != 1 || sb.mu.newSession != 1 || sb.mu.visitor != 1 || sb.mu.operator != 1 ||
			sb.mu.typing != 1 || sb.mu.read != 1 || sb.mu.event != 1 || sb.mu.identity != 1 || sb.mu.destroy != 1 {
			t.Errorf("bridge %s counters = %+v", sb.BridgeName, sb.mu)
		}
	}
}

func TestCompositeBridgeInitPropagatesError(t *testing.T) {
	ctx := context.Background()
	bad := &spyBridge{BaseBridge: BaseBridge{BridgeName: "bad"}, failOn: "init"}
	c := NewCompositeBridge(bad)
	if err := c.Init(ctx, nil); err == nil {
		t.Error("expected Init error to propagate")
	}
}

func TestCompositeBridgeContinuesOnErrors(t *testing.T) {
	ctx := context.Background()
	// Each bridge fails on a different method; composite swallows errors and continues.
	a := &spyBridge{BaseBridge: BaseBridge{BridgeName: "a"}, failOn: "newSession"}
	b := &spyBridge{BaseBridge: BaseBridge{BridgeName: "b"}}
	c := NewCompositeBridge(a, b)
	s := sampleSession()
	if err := c.OnNewSession(ctx, s); err != nil {
		t.Errorf("OnNewSession should swallow error, got %v", err)
	}
	if b.mu.newSession != 1 {
		t.Error("second bridge should still receive event after first errored")
	}

	// Exercise the error-continue path on every other method too.
	for _, m := range []string{"visitor", "operator", "typing", "read", "event", "identity", "destroy"} {
		bridge := &spyBridge{BaseBridge: BaseBridge{BridgeName: "x"}, failOn: m}
		comp := NewCompositeBridge(bridge)
		_ = comp.OnVisitorMessage(ctx, &Message{}, s)
		_ = comp.OnOperatorMessage(ctx, &Message{}, s, "", "")
		_ = comp.OnTyping(ctx, "s", true)
		_ = comp.OnMessageRead(ctx, "s", nil, MessageStatusRead)
		_ = comp.OnCustomEvent(ctx, CustomEvent{}, s)
		_ = comp.OnIdentityUpdate(ctx, s)
		_ = comp.Destroy(ctx)
	}
}

func TestCompositeBridgeAddBridge(t *testing.T) {
	c := NewCompositeBridge()
	c.AddBridge(&spyBridge{BaseBridge: BaseBridge{BridgeName: "added"}})
	if len(c.bridges) != 1 {
		t.Errorf("bridges len = %d, want 1", len(c.bridges))
	}
}

// ─────────────────────────────────────────────────────────────────
// Telegram bridge — extra event methods
// ─────────────────────────────────────────────────────────────────

func telegramBridgeTo(t *testing.T, server *httptest.Server) *TelegramBridge {
	t.Helper()
	return MustNewTelegramBridge("test-token", "-1001234", WithTelegramHTTPClient(&http.Client{
		Transport: &testTransport{baseURL: server.URL, token: "test-token"},
	}))
}

func TestTelegramBridgeMustConstructorPanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("expected panic on invalid config")
		}
	}()
	MustNewTelegramBridge("", "")
}

func TestTelegramBridgeOperatorTypingEventIdentity(t *testing.T) {
	srv, count := countingServer(t, `{"ok":true,"result":{"message_id":7}}`)
	defer srv.Close()
	b := telegramBridgeTo(t, srv)
	ctx := context.Background()
	s := sampleSession()

	// OnOperatorMessage from a different bridge -> sends.
	if err := b.OnOperatorMessage(ctx, &Message{Content: "hi"}, s, "slack", "Op"); err != nil {
		t.Errorf("OnOperatorMessage = %v", err)
	}
	// OnOperatorMessage from same bridge -> skipped.
	_ = b.OnOperatorMessage(ctx, &Message{Content: "echo"}, s, "telegram", "")
	// OnTyping true -> sends chat action; false -> no-op.
	_ = b.OnTyping(ctx, "s", true)
	_ = b.OnTyping(ctx, "s", false)
	// OnMessageRead is a no-op (no API call).
	_ = b.OnMessageRead(ctx, "s", []string{"m"}, MessageStatusRead)
	// OnCustomEvent with data.
	_ = b.OnCustomEvent(ctx, CustomEvent{Name: "clicked", Data: map[string]interface{}{"k": "v"}}, s)
	// OnIdentityUpdate.
	_ = b.OnIdentityUpdate(ctx, s)
	// OnIdentityUpdate with nil identity -> no send.
	_ = b.OnIdentityUpdate(ctx, &Session{ID: "x"})

	if count() == 0 {
		t.Error("expected at least one API call")
	}
}

func TestParseUserAgentBridgeHelper(t *testing.T) {
	cases := map[string]string{
		"Mozilla/5.0 Firefox/120.0 Windows":             "Firefox/Windows",
		"Mozilla Edg/120 Windows":                       "Edge/Windows",
		"Mozilla Chrome/120 Mac OS X":                   "Chrome/macOS",
		"Mozilla Version/16 Safari/605 Mac OS X":        "Safari/macOS",
		"Opera/9 OPR/100 Linux x86_64":                  "Opera/Linux",
		"Mozilla Chrome/120 Mobile Android 13":       "Chrome/Android",
		"Mozilla (iPhone) AppleWebKit Safari/605.1": "Safari/iOS",
		"weird-client":                              "Unknown/Unknown",
	}
	for ua, want := range cases {
		if got := parseUserAgent(ua); got != want {
			t.Errorf("parseUserAgent(%q) = %q, want %q", ua, got, want)
		}
	}
}

// ─────────────────────────────────────────────────────────────────
// Discord webhook bridge — event methods
// ─────────────────────────────────────────────────────────────────

func TestDiscordWebhookBridgeMustAndEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":"123"}`))
	}))
	defer srv.Close()

	b := MustNewDiscordWebhookBridge("https://discord.com/api/webhooks/1/abc",
		WithDiscordWebhookHTTPClient(&http.Client{Transport: &discordTestTransport{baseURL: srv.URL}}),
		WithDiscordWebhookUsername("Bot"),
		WithDiscordWebhookAvatarURL("https://x/avatar.png"),
	)
	ctx := context.Background()
	s := sampleSession()
	_ = b.Init(ctx, nil)
	_ = b.OnOperatorMessage(ctx, &Message{Content: "hi"}, s, "slack", "Op")
	_ = b.OnOperatorMessage(ctx, &Message{Content: "echo"}, s, "discord-webhook", "") // same bridge skip
	_ = b.OnTyping(ctx, "s", true)                                                    // no-op
	_ = b.OnMessageRead(ctx, "s", nil, MessageStatusRead)                             // no-op
	_ = b.OnCustomEvent(ctx, CustomEvent{Name: "e", Data: map[string]interface{}{"a": 1}}, s)
	_ = b.OnIdentityUpdate(ctx, s)
	_ = b.OnIdentityUpdate(ctx, &Session{ID: "x"}) // nil identity skip
}

func TestDiscordWebhookBridgeMustPanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("expected panic on invalid webhook URL")
		}
	}()
	MustNewDiscordWebhookBridge("not-a-discord-url")
}

// ─────────────────────────────────────────────────────────────────
// Discord bot bridge — event methods
// ─────────────────────────────────────────────────────────────────

func TestDiscordBotBridgeEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":"999"}`))
	}))
	defer srv.Close()

	b := NewDiscordBotBridge("bot-token", "channel-1",
		WithDiscordBotHTTPClient(&http.Client{Transport: &discordTestTransport{baseURL: srv.URL}}))
	ctx := context.Background()
	s := sampleSession()
	_ = b.Init(ctx, nil)
	_ = b.OnNewSession(ctx, s)
	_ = b.OnOperatorMessage(ctx, &Message{Content: "hi"}, s, "slack", "Op")
	_ = b.OnOperatorMessage(ctx, &Message{Content: "echo"}, s, "discord-bot", "") // skip
	_ = b.OnTyping(ctx, "s", true)
	_ = b.OnTyping(ctx, "s", false)
	_ = b.OnMessageRead(ctx, "s", nil, MessageStatusRead)
	_ = b.OnCustomEvent(ctx, CustomEvent{Name: "e", Data: map[string]interface{}{"a": 1}}, s)
	_ = b.OnIdentityUpdate(ctx, s)
	_ = b.OnIdentityUpdate(ctx, &Session{ID: "x"})
}

// ─────────────────────────────────────────────────────────────────
// Slack webhook bridge — event methods
// ─────────────────────────────────────────────────────────────────

func TestSlackWebhookBridgeMustAndEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`ok`))
	}))
	defer srv.Close()

	b := MustNewSlackWebhookBridge("https://hooks.slack.com/services/T/B/x",
		WithSlackWebhookUsername("Bot"),
		WithSlackWebhookIconEmoji(":robot:"),
	)
	// Override the webhook URL through the field so requests hit the test server.
	b.WebhookURL = srv.URL
	ctx := context.Background()
	s := sampleSession()
	_ = b.Init(ctx, nil)
	_ = b.OnNewSession(ctx, s)
	_ = b.OnVisitorMessage(ctx, &Message{Content: "hello"}, s)
	_ = b.OnOperatorMessage(ctx, &Message{Content: "hi"}, s, "telegram", "Op")
	_ = b.OnOperatorMessage(ctx, &Message{Content: "echo"}, s, "slack-webhook", "") // skip
	_ = b.OnTyping(ctx, "s", true)                                                  // no-op
	_ = b.OnMessageRead(ctx, "s", nil, MessageStatusRead)                           // no-op
	_ = b.OnCustomEvent(ctx, CustomEvent{Name: "e", Data: map[string]interface{}{"a": 1}}, s)
	_ = b.OnIdentityUpdate(ctx, s)
	_ = b.OnIdentityUpdate(ctx, &Session{ID: "x"})
}

func TestSlackWebhookBridgeMustPanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("expected panic on invalid Slack webhook URL")
		}
	}()
	MustNewSlackWebhookBridge("https://example.com/not-slack")
}

// ─────────────────────────────────────────────────────────────────
// Slack bot bridge — event methods
// ─────────────────────────────────────────────────────────────────

func TestSlackBotBridgeMustAndEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"ts":"1.2"}`))
	}))
	defer srv.Close()

	b := MustNewSlackBotBridge("xoxb-token", "channel-1",
		WithSlackBotHTTPClient(&http.Client{Transport: &slackTestTransport{baseURL: srv.URL}}))
	ctx := context.Background()
	s := sampleSession()
	_ = b.Init(ctx, nil)
	_ = b.OnNewSession(ctx, s)
	_ = b.OnOperatorMessage(ctx, &Message{Content: "hi"}, s, "telegram", "Op")
	_ = b.OnOperatorMessage(ctx, &Message{Content: "echo"}, s, "slack-bot", "") // skip
	_ = b.OnTyping(ctx, "s", true)                                              // no-op
	_ = b.OnMessageRead(ctx, "s", nil, MessageStatusRead)                       // no-op
	_ = b.OnCustomEvent(ctx, CustomEvent{Name: "e", Data: map[string]interface{}{"a": 1}}, s)
	_ = b.OnIdentityUpdate(ctx, s)
	_ = b.OnIdentityUpdate(ctx, &Session{ID: "x"})
}

func TestSlackBotBridgeMustPanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("expected panic on invalid Slack bot token")
		}
	}()
	MustNewSlackBotBridge("bad-token", "channel")
}

// formatSlackReplyQuote + buildReplyQuote
func TestFormatSlackReplyQuote(t *testing.T) {
	cases := []struct {
		msg  *Message
		want string
	}{
		{&Message{Sender: SenderVisitor, Content: "hi"}, "Visitor"},
		{&Message{Sender: SenderOperator, Content: "hi"}, "Support"},
		{&Message{Sender: SenderAI, Content: "hi"}, "AI"},
	}
	for _, c := range cases {
		got := formatSlackReplyQuote(c.msg)
		if !strings.Contains(got, c.want) {
			t.Errorf("formatSlackReplyQuote sender label = %q, want contains %q", got, c.want)
		}
	}

	// Deleted message preview.
	now := time.Now()
	del := formatSlackReplyQuote(&Message{Sender: SenderVisitor, Content: "secret", DeletedAt: &now})
	if !strings.Contains(del, "Message deleted") {
		t.Errorf("deleted preview = %q", del)
	}

	// Long content truncation.
	long := formatSlackReplyQuote(&Message{Sender: SenderVisitor, Content: strings.Repeat("x", 200)})
	if !strings.Contains(long, "...") {
		t.Errorf("expected truncation, got %q", long)
	}
}

func TestBuildReplyQuoteNoReply(t *testing.T) {
	// pp nil and ReplyTo empty -> empty quote (both webhook and bot variants).
	wb := &SlackWebhookBridge{}
	if wb.buildReplyQuote(context.Background(), &Message{}) != "" {
		t.Error("expected empty quote without reply")
	}
	bb := &SlackBotBridge{}
	if bb.buildReplyQuote(context.Background(), &Message{}) != "" {
		t.Error("expected empty quote without reply")
	}
}

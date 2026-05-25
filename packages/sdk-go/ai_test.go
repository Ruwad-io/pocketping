package pocketping

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// ─────────────────────────────────────────────────────────────────
// Provider request/parse tests (mocked HTTP via httptest)
// ─────────────────────────────────────────────────────────────────

// Test 1: OpenAIProvider builds the correct request and parses
// choices[0].message.content.
func TestOpenAIProviderRequestAndParse(t *testing.T) {
	var (
		gotPath string
		gotAuth string
		gotCT   string
		gotBody map[string]interface{}
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &gotBody)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Hello from OpenAI"}}]}`))
	}))
	defer srv.Close()

	p := &OpenAIProvider{
		APIKey:     "sk-test",
		Model:      "gpt-4o-mini",
		BaseURL:    srv.URL,
		HTTPClient: srv.Client(),
	}

	messages := []Message{
		{Sender: SenderVisitor, Content: "Hi"},
		{Sender: SenderOperator, Content: "Hello"},
	}

	reply, err := p.GenerateResponse(context.Background(), messages, "be nice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if reply != "Hello from OpenAI" {
		t.Errorf("reply = %q, want %q", reply, "Hello from OpenAI")
	}
	if gotPath != "/chat/completions" {
		t.Errorf("path = %q, want /chat/completions", gotPath)
	}
	if gotAuth != "Bearer sk-test" {
		t.Errorf("Authorization = %q, want Bearer sk-test", gotAuth)
	}
	if gotCT != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", gotCT)
	}
	if gotBody["model"] != "gpt-4o-mini" {
		t.Errorf("model = %v, want gpt-4o-mini", gotBody["model"])
	}
	if gotBody["max_tokens"].(float64) != 1000 {
		t.Errorf("max_tokens = %v, want 1000", gotBody["max_tokens"])
	}
	if gotBody["temperature"].(float64) != 0.7 {
		t.Errorf("temperature = %v, want 0.7", gotBody["temperature"])
	}

	msgs, ok := gotBody["messages"].([]interface{})
	if !ok || len(msgs) != 3 {
		t.Fatalf("messages = %v, want 3 entries (system + 2)", gotBody["messages"])
	}
	first := msgs[0].(map[string]interface{})
	if first["role"] != "system" || first["content"] != "be nice" {
		t.Errorf("first message = %v, want system/be nice", first)
	}
	second := msgs[1].(map[string]interface{})
	if second["role"] != "user" || second["content"] != "Hi" {
		t.Errorf("second message = %v, want user/Hi", second)
	}
	third := msgs[2].(map[string]interface{})
	if third["role"] != "assistant" || third["content"] != "Hello" {
		t.Errorf("third message = %v, want assistant/Hello", third)
	}
}

func TestOpenAIProviderParseEmptyChoices(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer srv.Close()

	p := &OpenAIProvider{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	reply, err := p.GenerateResponse(context.Background(), nil, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if reply != "" {
		t.Errorf("reply = %q, want empty", reply)
	}
}

func TestOpenAIProviderIsAvailable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	p := &OpenAIProvider{APIKey: "sk-test", BaseURL: srv.URL, HTTPClient: srv.Client()}
	if !p.IsAvailable(context.Background()) {
		t.Error("IsAvailable = false, want true")
	}

	pBad := &OpenAIProvider{APIKey: "wrong", BaseURL: srv.URL, HTTPClient: srv.Client()}
	if pBad.IsAvailable(context.Background()) {
		t.Error("IsAvailable = true with bad key, want false")
	}
}

// Test 2: AnthropicProvider builds the correct request (x-api-key header,
// system field, user/assistant roles) and parses content[0].text.
func TestAnthropicProviderRequestAndParse(t *testing.T) {
	var (
		gotPath    string
		gotAPIKey  string
		gotVersion string
		gotBody    map[string]interface{}
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAPIKey = r.Header.Get("x-api-key")
		gotVersion = r.Header.Get("anthropic-version")
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &gotBody)

		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"Hello from Claude"}]}`))
	}))
	defer srv.Close()

	p := &AnthropicProvider{
		APIKey:     "ak-test",
		Model:      "claude-sonnet-4-20250514",
		BaseURL:    srv.URL,
		HTTPClient: srv.Client(),
	}

	messages := []Message{
		{Sender: SenderVisitor, Content: "Hi"},
		{Sender: SenderAI, Content: "Hey"},
	}

	reply, err := p.GenerateResponse(context.Background(), messages, "custom system")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if reply != "Hello from Claude" {
		t.Errorf("reply = %q, want %q", reply, "Hello from Claude")
	}
	if gotPath != "/messages" {
		t.Errorf("path = %q, want /messages", gotPath)
	}
	if gotAPIKey != "ak-test" {
		t.Errorf("x-api-key = %q, want ak-test", gotAPIKey)
	}
	if gotVersion != "2023-06-01" {
		t.Errorf("anthropic-version = %q, want 2023-06-01", gotVersion)
	}
	if gotBody["model"] != "claude-sonnet-4-20250514" {
		t.Errorf("model = %v", gotBody["model"])
	}
	if gotBody["max_tokens"].(float64) != 1000 {
		t.Errorf("max_tokens = %v, want 1000", gotBody["max_tokens"])
	}
	if gotBody["system"] != "custom system" {
		t.Errorf("system = %v, want custom system", gotBody["system"])
	}

	msgs, ok := gotBody["messages"].([]interface{})
	if !ok || len(msgs) != 2 {
		t.Fatalf("messages = %v, want 2 entries (no system in array)", gotBody["messages"])
	}
	first := msgs[0].(map[string]interface{})
	if first["role"] != "user" || first["content"] != "Hi" {
		t.Errorf("first message = %v, want user/Hi", first)
	}
	second := msgs[1].(map[string]interface{})
	if second["role"] != "assistant" || second["content"] != "Hey" {
		t.Errorf("second message = %v, want assistant/Hey", second)
	}
}

func TestAnthropicProviderDefaultSystemPrompt(t *testing.T) {
	var gotBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &gotBody)
		_, _ = w.Write([]byte(`{"content":[{"text":"ok"}]}`))
	}))
	defer srv.Close()

	p := &AnthropicProvider{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	if _, err := p.GenerateResponse(context.Background(), nil, ""); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotBody["system"] != "You are a helpful customer support assistant." {
		t.Errorf("default system = %v", gotBody["system"])
	}
}

func TestAnthropicProviderIsAvailable(t *testing.T) {
	if !(&AnthropicProvider{APIKey: "k"}).IsAvailable(context.Background()) {
		t.Error("IsAvailable = false with key set, want true")
	}
	if (&AnthropicProvider{APIKey: ""}).IsAvailable(context.Background()) {
		t.Error("IsAvailable = true with no key, want false")
	}
}

// Test 3: GeminiProvider builds the correct request (model in URL, user/model
// roles) and parses candidates[0].content.parts[0].text.
func TestGeminiProviderRequestAndParse(t *testing.T) {
	var (
		gotPath  string
		gotQuery string
		gotBody  map[string]interface{}
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &gotBody)

		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"Hello from Gemini"}]}}]}`))
	}))
	defer srv.Close()

	p := &GeminiProvider{
		APIKey:     "gk-test",
		Model:      "gemini-1.5-flash",
		BaseURL:    srv.URL,
		HTTPClient: srv.Client(),
	}

	messages := []Message{
		{Sender: SenderVisitor, Content: "Hi"},
		{Sender: SenderOperator, Content: "Hello"},
	}

	reply, err := p.GenerateResponse(context.Background(), messages, "be brief")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if reply != "Hello from Gemini" {
		t.Errorf("reply = %q, want %q", reply, "Hello from Gemini")
	}
	if !strings.Contains(gotPath, "/models/gemini-1.5-flash:generateContent") {
		t.Errorf("path = %q, want model in URL", gotPath)
	}
	if !strings.Contains(gotQuery, "key=gk-test") {
		t.Errorf("query = %q, want key=gk-test", gotQuery)
	}

	contents, ok := gotBody["contents"].([]interface{})
	if !ok || len(contents) != 2 {
		t.Fatalf("contents = %v, want 2", gotBody["contents"])
	}
	first := contents[0].(map[string]interface{})
	if first["role"] != "user" {
		t.Errorf("first role = %v, want user", first["role"])
	}
	// System prompt prepended to first user part.
	firstParts := first["parts"].([]interface{})
	firstText := firstParts[0].(map[string]interface{})["text"].(string)
	if !strings.HasPrefix(firstText, "be brief\n\nUser: Hi") {
		t.Errorf("first text = %q, want system prompt prepended", firstText)
	}
	second := contents[1].(map[string]interface{})
	if second["role"] != "model" {
		t.Errorf("second role = %v, want model", second["role"])
	}

	genCfg, ok := gotBody["generationConfig"].(map[string]interface{})
	if !ok {
		t.Fatalf("generationConfig missing")
	}
	if genCfg["maxOutputTokens"].(float64) != 1000 {
		t.Errorf("maxOutputTokens = %v, want 1000", genCfg["maxOutputTokens"])
	}
}

func TestGeminiProviderParseEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"candidates":[]}`))
	}))
	defer srv.Close()
	p := &GeminiProvider{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	reply, err := p.GenerateResponse(context.Background(), nil, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if reply != "" {
		t.Errorf("reply = %q, want empty", reply)
	}
}

// ─────────────────────────────────────────────────────────────────
// Fake provider for wiring tests
// ─────────────────────────────────────────────────────────────────

type fakeAIProvider struct {
	mu        sync.Mutex
	reply     string
	err       error
	calls     int
	available bool
}

func (f *fakeAIProvider) Name() string { return "fake" }

func (f *fakeAIProvider) GenerateResponse(ctx context.Context, messages []Message, systemPrompt string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.err != nil {
		return "", f.err
	}
	return f.reply, nil
}

func (f *fakeAIProvider) IsAvailable(ctx context.Context) bool { return f.available }

func (f *fakeAIProvider) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

var _ AIProvider = (*fakeAIProvider)(nil)

func newSession(ctx context.Context, t *testing.T, pp *PocketPing) *Session {
	t.Helper()
	resp, err := pp.HandleConnect(ctx, ConnectRequest{VisitorID: "visitor-1"})
	if err != nil {
		t.Fatalf("HandleConnect: %v", err)
	}
	s, err := pp.GetSession(ctx, resp.SessionID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	return s
}

func aiMessages(ctx context.Context, t *testing.T, pp *PocketPing, sessionID string) []Message {
	t.Helper()
	msgs, err := pp.storage.GetMessages(ctx, sessionID, "", 100)
	if err != nil {
		t.Fatalf("GetMessages: %v", err)
	}
	var ai []Message
	for _, m := range msgs {
		if m.Sender == SenderAI {
			ai = append(ai, m)
		}
	}
	return ai
}

// Test 4: Fallback triggers with takeover delay 0, operator offline, fake
// provider returning "AI says hi" -> an AI message is stored.
func TestFallbackTriggersWhenOperatorOffline(t *testing.T) {
	ctx := context.Background()
	fake := &fakeAIProvider{reply: "AI says hi"}
	pp := New(Config{
		AIProvider:      fake,
		AITakeoverDelay: -1, // immediate takeover
	})

	session := newSession(ctx, t, pp)

	_, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: session.ID,
		Content:   "anyone there?",
		Sender:    SenderVisitor,
	})
	if err != nil {
		t.Fatalf("HandleMessage: %v", err)
	}

	ai := aiMessages(ctx, t, pp, session.ID)
	if len(ai) != 1 {
		t.Fatalf("AI message count = %d, want 1", len(ai))
	}
	if ai[0].Content != "AI says hi" {
		t.Errorf("AI content = %q, want %q", ai[0].Content, "AI says hi")
	}
	if ai[0].Sender != SenderAI {
		t.Errorf("AI sender = %q, want ai", ai[0].Sender)
	}
	if fake.callCount() != 1 {
		t.Errorf("provider calls = %d, want 1", fake.callCount())
	}

	updated, _ := pp.GetSession(ctx, session.ID)
	if !updated.AIActive {
		t.Error("session.AIActive = false, want true")
	}
}

// Test 5: No fallback when operator online.
func TestNoFallbackWhenOperatorOnline(t *testing.T) {
	ctx := context.Background()
	fake := &fakeAIProvider{reply: "AI says hi"}
	pp := New(Config{
		AIProvider:      fake,
		AITakeoverDelay: -1,
	})
	pp.SetOperatorOnline(true)

	session := newSession(ctx, t, pp)

	_, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: session.ID,
		Content:   "anyone there?",
		Sender:    SenderVisitor,
	})
	if err != nil {
		t.Fatalf("HandleMessage: %v", err)
	}

	if got := len(aiMessages(ctx, t, pp, session.ID)); got != 0 {
		t.Errorf("AI message count = %d, want 0", got)
	}
	if fake.callCount() != 0 {
		t.Errorf("provider calls = %d, want 0", fake.callCount())
	}
}

// Test 6: Operator message disables AI.
func TestOperatorMessageDisablesAI(t *testing.T) {
	ctx := context.Background()
	fake := &fakeAIProvider{reply: "AI says hi"}
	pp := New(Config{
		AIProvider:      fake,
		AITakeoverDelay: -1,
	})

	session := newSession(ctx, t, pp)

	// Visitor message triggers AI takeover.
	if _, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: session.ID,
		Content:   "hello?",
		Sender:    SenderVisitor,
	}); err != nil {
		t.Fatalf("HandleMessage visitor: %v", err)
	}

	active, _ := pp.GetSession(ctx, session.ID)
	if !active.AIActive {
		t.Fatal("expected AIActive=true after takeover")
	}

	// Operator replies -> disables AI.
	if _, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: session.ID,
		Content:   "I'm here now",
		Sender:    SenderOperator,
	}); err != nil {
		t.Fatalf("HandleMessage operator: %v", err)
	}

	updated, _ := pp.GetSession(ctx, session.ID)
	if updated.AIActive {
		t.Error("session.AIActive = true after operator message, want false")
	}
}

// Test 7 (optional): provider error is handled gracefully (no crash, no AI message).
func TestFallbackProviderErrorHandledGracefully(t *testing.T) {
	ctx := context.Background()
	fake := &fakeAIProvider{err: errors.New("boom")}
	pp := New(Config{
		AIProvider:      fake,
		AITakeoverDelay: -1,
	})

	session := newSession(ctx, t, pp)

	resp, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: session.ID,
		Content:   "hi",
		Sender:    SenderVisitor,
	})
	if err != nil {
		t.Fatalf("HandleMessage should not fail on AI error: %v", err)
	}
	if resp.MessageID == "" {
		t.Error("expected a message id for the visitor message")
	}
	if got := len(aiMessages(ctx, t, pp, session.ID)); got != 0 {
		t.Errorf("AI message count = %d, want 0 on provider error", got)
	}
}

// Test: no fallback before takeover delay elapses (operator recently active).
func TestNoFallbackBeforeTakeoverDelay(t *testing.T) {
	ctx := context.Background()
	fake := &fakeAIProvider{reply: "AI says hi"}
	pp := New(Config{
		AIProvider:      fake,
		AITakeoverDelay: 300, // 5 minutes
	})

	session := newSession(ctx, t, pp)

	// Operator was just active -> takeover not due yet.
	if _, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: session.ID,
		Content:   "hi operator here",
		Sender:    SenderOperator,
	}); err != nil {
		t.Fatalf("HandleMessage operator: %v", err)
	}

	if _, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: session.ID,
		Content:   "still there?",
		Sender:    SenderVisitor,
	}); err != nil {
		t.Fatalf("HandleMessage visitor: %v", err)
	}

	if got := len(aiMessages(ctx, t, pp, session.ID)); got != 0 {
		t.Errorf("AI message count = %d, want 0 (delay not elapsed)", got)
	}
}

// Test: no fallback when no AI provider configured.
func TestNoFallbackWithoutProvider(t *testing.T) {
	ctx := context.Background()
	pp := New(Config{AITakeoverDelay: -1})

	session := newSession(ctx, t, pp)
	if _, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: session.ID,
		Content:   "hello",
		Sender:    SenderVisitor,
	}); err != nil {
		t.Fatalf("HandleMessage: %v", err)
	}
	if got := len(aiMessages(ctx, t, pp, session.ID)); got != 0 {
		t.Errorf("AI message count = %d, want 0", got)
	}
}

// Test: HandlePresence reflects AI configuration.
func TestHandlePresenceReportsAI(t *testing.T) {
	ctx := context.Background()

	ppNoAI := New(Config{})
	if p := ppNoAI.HandlePresence(ctx); p.AIEnabled {
		t.Error("AIEnabled = true without provider, want false")
	}

	ppAI := New(Config{AIProvider: &fakeAIProvider{}, AITakeoverDelay: 120})
	p := ppAI.HandlePresence(ctx)
	if !p.AIEnabled {
		t.Error("AIEnabled = false with provider, want true")
	}
	if p.AIActiveAfter != 120 {
		t.Errorf("AIActiveAfter = %d, want 120", p.AIActiveAfter)
	}
}

// Test: empty AI reply does not create a message.
func TestFallbackEmptyReplyNoMessage(t *testing.T) {
	ctx := context.Background()
	fake := &fakeAIProvider{reply: ""}
	pp := New(Config{AIProvider: fake, AITakeoverDelay: -1})

	session := newSession(ctx, t, pp)
	if _, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID: session.ID,
		Content:   "hello",
		Sender:    SenderVisitor,
	}); err != nil {
		t.Fatalf("HandleMessage: %v", err)
	}
	if got := len(aiMessages(ctx, t, pp, session.ID)); got != 0 {
		t.Errorf("AI message count = %d, want 0 for empty reply", got)
	}
}

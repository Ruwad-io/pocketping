package pocketping

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// httpClientToServer returns an *http.Client whose transport rewrites every
// request to the given test server, so providers that hardcode a base URL can
// still be exercised. (Providers here accept BaseURL, but this keeps tests
// resilient.)

func TestNewOpenAIProviderDefaults(t *testing.T) {
	p := NewOpenAIProvider("sk-x")
	if p.Name() != "openai" {
		t.Errorf("Name = %q", p.Name())
	}
	if p.APIKey != "sk-x" {
		t.Errorf("APIKey = %q", p.APIKey)
	}
	if p.Model != "gpt-4o-mini" {
		t.Errorf("Model = %q", p.Model)
	}
	if p.BaseURL != "https://api.openai.com/v1" {
		t.Errorf("BaseURL = %q", p.BaseURL)
	}
}

func TestNewAnthropicProviderDefaults(t *testing.T) {
	p := NewAnthropicProvider("ak-x")
	if p.Name() != "anthropic" {
		t.Errorf("Name = %q", p.Name())
	}
	if p.Model != "claude-sonnet-4-20250514" {
		t.Errorf("Model = %q", p.Model)
	}
	if p.BaseURL != "https://api.anthropic.com/v1" {
		t.Errorf("BaseURL = %q", p.BaseURL)
	}
}

func TestNewGeminiProviderDefaults(t *testing.T) {
	p := NewGeminiProvider("gk-x")
	if p.Name() != "gemini" {
		t.Errorf("Name = %q", p.Name())
	}
	if p.Model != "gemini-1.5-flash" {
		t.Errorf("Model = %q", p.Model)
	}
	if p.BaseURL != "https://generativelanguage.googleapis.com/v1beta" {
		t.Errorf("BaseURL = %q", p.BaseURL)
	}
}

func TestProviderDefaultBaseURLAndModelFallback(t *testing.T) {
	// When BaseURL/Model are empty, the provider methods fall back to defaults.
	op := &OpenAIProvider{}
	if op.baseURL() != "https://api.openai.com/v1" {
		t.Errorf("openai baseURL fallback = %q", op.baseURL())
	}
	if op.model() != "gpt-4o-mini" {
		t.Errorf("openai model fallback = %q", op.model())
	}
	ap := &AnthropicProvider{}
	if ap.baseURL() != "https://api.anthropic.com/v1" {
		t.Errorf("anthropic baseURL fallback = %q", ap.baseURL())
	}
	if ap.model() != "claude-sonnet-4-20250514" {
		t.Errorf("anthropic model fallback = %q", ap.model())
	}
	gp := &GeminiProvider{}
	if gp.baseURL() != "https://generativelanguage.googleapis.com/v1beta" {
		t.Errorf("gemini baseURL fallback = %q", gp.baseURL())
	}
	if gp.model() != "gemini-1.5-flash" {
		t.Errorf("gemini model fallback = %q", gp.model())
	}
}

func TestProviderTrailingSlashTrimmed(t *testing.T) {
	op := &OpenAIProvider{BaseURL: "https://x.example/v1/"}
	if op.baseURL() != "https://x.example/v1" {
		t.Errorf("openai baseURL = %q", op.baseURL())
	}
	ap := &AnthropicProvider{BaseURL: "https://x.example/v1/"}
	if ap.baseURL() != "https://x.example/v1" {
		t.Errorf("anthropic baseURL = %q", ap.baseURL())
	}
	gp := &GeminiProvider{BaseURL: "https://x.example/v1beta/"}
	if gp.baseURL() != "https://x.example/v1beta" {
		t.Errorf("gemini baseURL = %q", gp.baseURL())
	}
}

func TestOpenAIProviderErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	p := &OpenAIProvider{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	if _, err := p.GenerateResponse(context.Background(), nil, ""); err == nil {
		t.Error("expected error on 500 status")
	}
}

func TestOpenAIProviderIsAvailableNetworkError(t *testing.T) {
	// Point at a closed server to force a transport error.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close()
	p := &OpenAIProvider{APIKey: "k", BaseURL: url}
	if p.IsAvailable(context.Background()) {
		t.Error("expected IsAvailable=false on network error")
	}
}

func TestAnthropicProviderErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	p := &AnthropicProvider{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	if _, err := p.GenerateResponse(context.Background(), nil, "sys"); err == nil {
		t.Error("expected error on 400 status")
	}
}

func TestAnthropicProviderEmptyContent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"content":[]}`))
	}))
	defer srv.Close()
	p := &AnthropicProvider{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	reply, err := p.GenerateResponse(context.Background(), nil, "sys")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if reply != "" {
		t.Errorf("reply = %q, want empty", reply)
	}
}

func TestGeminiProviderErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	p := &GeminiProvider{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	if _, err := p.GenerateResponse(context.Background(), []Message{{Sender: SenderVisitor, Content: "hi"}}, "sys"); err == nil {
		t.Error("expected error on 403 status")
	}
}

func TestGeminiProviderNoSystemPromptForOperatorFirst(t *testing.T) {
	// First message is from operator -> role "model", system prompt NOT prepended.
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody = make([]byte, r.ContentLength)
		_, _ = r.Body.Read(gotBody)
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}`))
	}))
	defer srv.Close()
	p := &GeminiProvider{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	reply, err := p.GenerateResponse(context.Background(), []Message{{Sender: SenderOperator, Content: "first"}}, "system prompt")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if reply != "ok" {
		t.Errorf("reply = %q", reply)
	}
}

func TestGeminiProviderIsAvailable(t *testing.T) {
	if !(&GeminiProvider{APIKey: "k"}).IsAvailable(context.Background()) {
		t.Error("expected available with key")
	}
	if (&GeminiProvider{}).IsAvailable(context.Background()) {
		t.Error("expected not available without key")
	}
}

func TestRoleForSender(t *testing.T) {
	if roleForSender(SenderVisitor) != "user" {
		t.Error("visitor should map to user")
	}
	if roleForSender(SenderOperator) != "assistant" {
		t.Error("operator should map to assistant")
	}
	if roleForSender(SenderAI) != "assistant" {
		t.Error("ai should map to assistant")
	}
}

func TestHttpClientOr(t *testing.T) {
	if httpClientOr(nil) != http.DefaultClient {
		t.Error("nil should return default client")
	}
	custom := &http.Client{}
	if httpClientOr(custom) != custom {
		t.Error("custom client should be returned")
	}
}

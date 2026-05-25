package pocketping

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// DefaultAISystemPrompt is the default system prompt used for AI fallback
// when none is configured.
const DefaultAISystemPrompt = "You are a helpful customer support assistant. " +
	"Be friendly, concise, and helpful. " +
	"If you don't know something, say so and offer to connect them with a human."

// DefaultAITakeoverDelay is the default delay (in seconds) before the AI takes
// over a session when no operator is online.
const DefaultAITakeoverDelay = 300

// AIProvider is the interface for AI providers used for the offline-takeover
// fallback. Implementations generate a reply from the conversation history.
type AIProvider interface {
	// Name returns the provider's unique name (e.g. "openai").
	Name() string

	// GenerateResponse generates a reply given the conversation history and an
	// optional system prompt. messages is ordered oldest-to-newest.
	GenerateResponse(ctx context.Context, messages []Message, systemPrompt string) (string, error)

	// IsAvailable reports whether the provider is reachable/usable.
	IsAvailable(ctx context.Context) bool
}

// roleForSender maps a message sender to the "user"/"assistant" role used by
// chat-completion style APIs.
func roleForSender(sender Sender) string {
	if sender == SenderVisitor {
		return "user"
	}
	return "assistant"
}

// httpClientOr returns the provided client or http.DefaultClient when nil.
func httpClientOr(c *http.Client) *http.Client {
	if c == nil {
		return http.DefaultClient
	}
	return c
}

// ─────────────────────────────────────────────────────────────────
// OpenAIProvider
// ─────────────────────────────────────────────────────────────────

// OpenAIProvider implements AIProvider using the OpenAI Chat Completions API.
type OpenAIProvider struct {
	// APIKey is the OpenAI API key (required).
	APIKey string
	// Model is the model name (default "gpt-4o-mini").
	Model string
	// BaseURL is the API base URL (default "https://api.openai.com/v1").
	// Override for testing with an httptest server.
	BaseURL string
	// HTTPClient is the HTTP client used for requests (default http.DefaultClient).
	HTTPClient *http.Client
}

// NewOpenAIProvider creates an OpenAIProvider with the given API key and defaults.
func NewOpenAIProvider(apiKey string) *OpenAIProvider {
	return &OpenAIProvider{
		APIKey:  apiKey,
		Model:   "gpt-4o-mini",
		BaseURL: "https://api.openai.com/v1",
	}
}

// Name returns the provider name.
func (p *OpenAIProvider) Name() string { return "openai" }

func (p *OpenAIProvider) model() string {
	if p.Model != "" {
		return p.Model
	}
	return "gpt-4o-mini"
}

func (p *OpenAIProvider) baseURL() string {
	if p.BaseURL != "" {
		return strings.TrimRight(p.BaseURL, "/")
	}
	return "https://api.openai.com/v1"
}

// GenerateResponse calls POST {baseURL}/chat/completions and returns
// choices[0].message.content.
func (p *OpenAIProvider) GenerateResponse(ctx context.Context, messages []Message, systemPrompt string) (string, error) {
	chatMessages := make([]map[string]string, 0, len(messages)+1)
	if systemPrompt != "" {
		chatMessages = append(chatMessages, map[string]string{
			"role":    "system",
			"content": systemPrompt,
		})
	}
	for _, msg := range messages {
		chatMessages = append(chatMessages, map[string]string{
			"role":    roleForSender(msg.Sender),
			"content": msg.Content,
		})
	}

	body, err := json.Marshal(map[string]interface{}{
		"model":       p.model(),
		"messages":    chatMessages,
		"max_tokens":  1000,
		"temperature": 0.7,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL()+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.APIKey)

	resp, err := httpClientOr(p.HTTPClient).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("openai: unexpected status %d", resp.StatusCode)
	}

	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", err
	}
	if len(parsed.Choices) == 0 {
		return "", nil
	}
	return parsed.Choices[0].Message.Content, nil
}

// IsAvailable performs a GET {baseURL}/models request with the Authorization header.
func (p *OpenAIProvider) IsAvailable(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL()+"/models", nil)
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+p.APIKey)

	resp, err := httpClientOr(p.HTTPClient).Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

var _ AIProvider = (*OpenAIProvider)(nil)

// ─────────────────────────────────────────────────────────────────
// AnthropicProvider
// ─────────────────────────────────────────────────────────────────

// AnthropicProvider implements AIProvider using the Anthropic Messages API.
type AnthropicProvider struct {
	// APIKey is the Anthropic API key (required).
	APIKey string
	// Model is the model name (default "claude-sonnet-4-20250514").
	Model string
	// BaseURL is the API base URL (default "https://api.anthropic.com/v1").
	// Override for testing with an httptest server.
	BaseURL string
	// HTTPClient is the HTTP client used for requests (default http.DefaultClient).
	HTTPClient *http.Client
}

// NewAnthropicProvider creates an AnthropicProvider with the given API key and defaults.
func NewAnthropicProvider(apiKey string) *AnthropicProvider {
	return &AnthropicProvider{
		APIKey:  apiKey,
		Model:   "claude-sonnet-4-20250514",
		BaseURL: "https://api.anthropic.com/v1",
	}
}

// Name returns the provider name.
func (p *AnthropicProvider) Name() string { return "anthropic" }

func (p *AnthropicProvider) model() string {
	if p.Model != "" {
		return p.Model
	}
	return "claude-sonnet-4-20250514"
}

func (p *AnthropicProvider) baseURL() string {
	if p.BaseURL != "" {
		return strings.TrimRight(p.BaseURL, "/")
	}
	return "https://api.anthropic.com/v1"
}

// GenerateResponse calls POST {baseURL}/messages and returns content[0].text.
func (p *AnthropicProvider) GenerateResponse(ctx context.Context, messages []Message, systemPrompt string) (string, error) {
	system := systemPrompt
	if system == "" {
		system = "You are a helpful customer support assistant."
	}

	chatMessages := make([]map[string]string, 0, len(messages))
	for _, msg := range messages {
		chatMessages = append(chatMessages, map[string]string{
			"role":    roleForSender(msg.Sender),
			"content": msg.Content,
		})
	}

	body, err := json.Marshal(map[string]interface{}{
		"model":      p.model(),
		"max_tokens": 1000,
		"system":     system,
		"messages":   chatMessages,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL()+"/messages", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", p.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := httpClientOr(p.HTTPClient).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("anthropic: unexpected status %d", resp.StatusCode)
	}

	var parsed struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", err
	}
	if len(parsed.Content) == 0 {
		return "", nil
	}
	return parsed.Content[0].Text, nil
}

// IsAvailable returns true if an API key is set (no health endpoint).
func (p *AnthropicProvider) IsAvailable(ctx context.Context) bool {
	return p.APIKey != ""
}

var _ AIProvider = (*AnthropicProvider)(nil)

// ─────────────────────────────────────────────────────────────────
// GeminiProvider
// ─────────────────────────────────────────────────────────────────

// GeminiProvider implements AIProvider using the Google Gemini API.
type GeminiProvider struct {
	// APIKey is the Gemini API key (required).
	APIKey string
	// Model is the model name (default "gemini-1.5-flash").
	Model string
	// BaseURL is the API base host (default "https://generativelanguage.googleapis.com/v1beta").
	// Override for testing with an httptest server.
	BaseURL string
	// HTTPClient is the HTTP client used for requests (default http.DefaultClient).
	HTTPClient *http.Client
}

// NewGeminiProvider creates a GeminiProvider with the given API key and defaults.
func NewGeminiProvider(apiKey string) *GeminiProvider {
	return &GeminiProvider{
		APIKey:  apiKey,
		Model:   "gemini-1.5-flash",
		BaseURL: "https://generativelanguage.googleapis.com/v1beta",
	}
}

// Name returns the provider name.
func (p *GeminiProvider) Name() string { return "gemini" }

func (p *GeminiProvider) model() string {
	if p.Model != "" {
		return p.Model
	}
	return "gemini-1.5-flash"
}

func (p *GeminiProvider) baseURL() string {
	if p.BaseURL != "" {
		return strings.TrimRight(p.BaseURL, "/")
	}
	return "https://generativelanguage.googleapis.com/v1beta"
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiContent struct {
	Role  string       `json:"role"`
	Parts []geminiPart `json:"parts"`
}

// GenerateResponse calls POST {baseURL}/models/{model}:generateContent and
// returns candidates[0].content.parts[0].text.
func (p *GeminiProvider) GenerateResponse(ctx context.Context, messages []Message, systemPrompt string) (string, error) {
	contents := make([]geminiContent, 0, len(messages))
	for _, msg := range messages {
		role := "user"
		if msg.Sender != SenderVisitor {
			role = "model"
		}
		contents = append(contents, geminiContent{
			Role:  role,
			Parts: []geminiPart{{Text: msg.Content}},
		})
	}

	// If a system prompt is set and the first content is a user turn, prepend
	// the system prompt to its first part text.
	if systemPrompt != "" && len(contents) > 0 && contents[0].Role == "user" && len(contents[0].Parts) > 0 {
		contents[0].Parts[0].Text = systemPrompt + "\n\nUser: " + contents[0].Parts[0].Text
	}

	body, err := json.Marshal(map[string]interface{}{
		"contents": contents,
		"generationConfig": map[string]interface{}{
			"maxOutputTokens": 1000,
			"temperature":     0.7,
		},
	})
	if err != nil {
		return "", err
	}

	url := fmt.Sprintf("%s/models/%s:generateContent?key=%s", p.baseURL(), p.model(), p.APIKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClientOr(p.HTTPClient).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("gemini: unexpected status %d", resp.StatusCode)
	}

	var parsed struct {
		Candidates []struct {
			Content struct {
				Parts []geminiPart `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", err
	}
	if len(parsed.Candidates) == 0 || len(parsed.Candidates[0].Content.Parts) == 0 {
		return "", nil
	}
	return parsed.Candidates[0].Content.Parts[0].Text, nil
}

// IsAvailable returns true if an API key is set.
func (p *GeminiProvider) IsAvailable(ctx context.Context) bool {
	return p.APIKey != ""
}

var _ AIProvider = (*GeminiProvider)(nil)

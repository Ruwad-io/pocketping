package pocketping

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// UaFilterMode defines the filtering mode.
type UaFilterMode string

const (
	UaFilterModeAllowlist UaFilterMode = "allowlist"
	UaFilterModeBlocklist UaFilterMode = "blocklist"
	UaFilterModeBoth      UaFilterMode = "both"
)

// UaFilterReason describes why a user-agent was allowed or blocked.
type UaFilterReason string

const (
	UaFilterReasonAllowlist      UaFilterReason = "allowlist"
	UaFilterReasonBlocklist      UaFilterReason = "blocklist"
	UaFilterReasonDefaultBot     UaFilterReason = "default_bot"
	UaFilterReasonCustom         UaFilterReason = "custom"
	UaFilterReasonNotInAllowlist UaFilterReason = "not_in_allowlist"
	UaFilterReasonDefault        UaFilterReason = "default"
)

// DefaultBotPatterns contains known bot patterns to block by default.
var DefaultBotPatterns = []string{
	// Search Engine Crawlers
	"googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
	"yandexbot", "sogou", "exabot", "facebot", "ia_archiver",
	// SEO/Analytics Tools
	"semrushbot", "ahrefsbot", "mj12bot", "dotbot", "rogerbot",
	"screaming frog", "seokicks", "sistrix", "linkdexbot", "blexbot",
	// Generic Bot Indicators
	"bot/", "crawler", "spider", "scraper", "headless",
	"phantomjs", "selenium", "puppeteer", "playwright", "webdriver",
	// Monitoring/Uptime Services
	"pingdom", "uptimerobot", "statuscake", "site24x7", "newrelic",
	"datadog", "gtmetrix", "pagespeed",
	// Social Media Crawlers
	"twitterbot", "linkedinbot", "pinterestbot", "telegrambot",
	"whatsapp", "slackbot", "discordbot", "applebot",
	// AI/LLM Crawlers
	"gptbot", "chatgpt-user", "anthropic-ai", "claude-web",
	"perplexitybot", "ccbot", "bytespider", "cohere-ai",
	// HTTP Libraries (automated requests)
	"curl/", "wget/", "httpie/", "python-requests", "python-urllib",
	"axios/", "node-fetch", "go-http-client", "java/", "okhttp",
	"libwww-perl", "httpclient",
	// Archive/Research Bots
	"archive.org_bot", "wayback", "commoncrawl",
	// Security Scanners
	"nmap", "nikto", "sqlmap", "masscan", "zgrab",
}

// UaFilterLogEvent represents a log event for UA filtering actions.
type UaFilterLogEvent struct {
	Type           string         `json:"type"` // "blocked" or "allowed"
	UserAgent      string         `json:"userAgent"`
	Reason         UaFilterReason `json:"reason"`
	MatchedPattern string         `json:"matchedPattern,omitempty"`
	Path           string         `json:"path"`
	Timestamp      time.Time      `json:"timestamp"`
	SessionID      string         `json:"sessionId,omitempty"`
}

// UaFilterResult represents the result of a UA filter check.
type UaFilterResult struct {
	Allowed        bool
	Reason         UaFilterReason
	MatchedPattern string
}

// UaFilterCallback is a custom filter function.
// Return true to allow, false to block, nil to defer to list-based filtering.
type UaFilterCallback func(userAgent string, requestInfo map[string]interface{}) *bool

// UaFilterConfig holds the configuration for User-Agent filtering.
type UaFilterConfig struct {
	// Enabled enables/disables UA filtering (default: false)
	Enabled bool

	// Mode is the filter mode (default: blocklist)
	Mode UaFilterMode

	// Allowlist contains UA patterns to allow
	Allowlist []string

	// Blocklist contains UA patterns to block
	Blocklist []string

	// UseDefaultBots includes default bot patterns in blocklist (default: true)
	UseDefaultBots bool

	// CustomFilter is an optional custom filter callback
	CustomFilter UaFilterCallback

	// LogBlocked logs blocked requests (default: true)
	LogBlocked bool

	// Logger is a custom logger function
	Logger func(event UaFilterLogEvent)

	// BlockedStatusCode is the HTTP status code for blocked requests (default: 403)
	BlockedStatusCode int

	// BlockedMessage is the response message for blocked requests (default: "Forbidden")
	BlockedMessage string
}

// DefaultUaFilterConfig returns a default UA filter configuration.
func DefaultUaFilterConfig() *UaFilterConfig {
	return &UaFilterConfig{
		Enabled:           false,
		Mode:              UaFilterModeBlocklist,
		Allowlist:         []string{},
		Blocklist:         []string{},
		UseDefaultBots:    true,
		LogBlocked:        true,
		BlockedStatusCode: http.StatusForbidden,
		BlockedMessage:    "Forbidden",
	}
}

// isRegexPattern checks if a pattern is a regex (starts and ends with /).
func isRegexPattern(pattern string) bool {
	return len(pattern) > 2 && pattern[0] == '/' && pattern[len(pattern)-1] == '/'
}

// extractRegex extracts regex from pattern string (removes leading/trailing /).
func extractRegex(pattern string) (*regexp.Regexp, error) {
	regexStr := pattern[1 : len(pattern)-1]
	return regexp.Compile("(?i)" + regexStr) // Case-insensitive
}

// matchesAnyPattern checks if a user-agent matches any pattern in the list.
// Supports both substring matching and regex patterns (e.g., /bot-\d+/).
// Returns the matched pattern or empty string.
func matchesAnyPattern(userAgent string, patterns []string) string {
	uaLower := strings.ToLower(userAgent)
	for _, pattern := range patterns {
		// Check if pattern is a regex
		if isRegexPattern(pattern) {
			regex, err := extractRegex(pattern)
			if err == nil && regex.MatchString(uaLower) {
				return pattern
			}
		} else {
			// Simple substring match (case-insensitive)
			if strings.Contains(uaLower, strings.ToLower(pattern)) {
				return pattern
			}
		}
	}
	return ""
}

// ShouldAllowUA determines if a user-agent should be allowed based on the filter config.
func ShouldAllowUA(userAgent string, config *UaFilterConfig) UaFilterResult {
	if config == nil {
		return UaFilterResult{Allowed: true, Reason: UaFilterReasonDefault}
	}

	mode := config.Mode
	if mode == "" {
		mode = UaFilterModeBlocklist
	}

	allowlist := config.Allowlist
	blocklist := make([]string, len(config.Blocklist))
	copy(blocklist, config.Blocklist)

	// Add default bot patterns if enabled
	if config.UseDefaultBots {
		blocklist = append(blocklist, DefaultBotPatterns...)
	}

	switch mode {
	case UaFilterModeAllowlist:
		// Only allow if in allowlist
		matched := matchesAnyPattern(userAgent, allowlist)
		if matched != "" {
			return UaFilterResult{Allowed: true, Reason: UaFilterReasonAllowlist, MatchedPattern: matched}
		}
		return UaFilterResult{Allowed: false, Reason: UaFilterReasonNotInAllowlist}

	case UaFilterModeBlocklist:
		// Block if in blocklist, allow otherwise
		matched := matchesAnyPattern(userAgent, blocklist)
		if matched != "" {
			// Determine if it's a default bot or custom blocklist
			isDefaultBot := matchesAnyPattern(userAgent, config.Blocklist) == ""
			reason := UaFilterReasonBlocklist
			if isDefaultBot {
				reason = UaFilterReasonDefaultBot
			}
			return UaFilterResult{Allowed: false, Reason: reason, MatchedPattern: matched}
		}
		return UaFilterResult{Allowed: true, Reason: UaFilterReasonDefault}

	case UaFilterModeBoth:
		// Allowlist takes precedence, then check blocklist
		allowMatched := matchesAnyPattern(userAgent, allowlist)
		if allowMatched != "" {
			return UaFilterResult{Allowed: true, Reason: UaFilterReasonAllowlist, MatchedPattern: allowMatched}
		}
		blockMatched := matchesAnyPattern(userAgent, blocklist)
		if blockMatched != "" {
			isDefaultBot := matchesAnyPattern(userAgent, config.Blocklist) == ""
			reason := UaFilterReasonBlocklist
			if isDefaultBot {
				reason = UaFilterReasonDefaultBot
			}
			return UaFilterResult{Allowed: false, Reason: reason, MatchedPattern: blockMatched}
		}
		return UaFilterResult{Allowed: true, Reason: UaFilterReasonDefault}

	default:
		return UaFilterResult{Allowed: true, Reason: UaFilterReasonDefault}
	}
}

// CheckUAFilter checks the UA filter with support for custom filter callback.
func CheckUAFilter(ctx context.Context, userAgent string, config *UaFilterConfig, requestInfo map[string]interface{}) UaFilterResult {
	// No user-agent = allow (could be internal request)
	if userAgent == "" {
		return UaFilterResult{Allowed: true, Reason: UaFilterReasonDefault}
	}

	// Disabled = allow all
	if config == nil || !config.Enabled {
		return UaFilterResult{Allowed: true, Reason: UaFilterReasonDefault}
	}

	// 1. Check custom filter first
	if config.CustomFilter != nil {
		result := config.CustomFilter(userAgent, requestInfo)
		if result != nil {
			if *result {
				return UaFilterResult{Allowed: true, Reason: UaFilterReasonCustom}
			}
			return UaFilterResult{Allowed: false, Reason: UaFilterReasonCustom}
		}
		// nil = fall through to list-based filtering
	}

	// 2. Apply list-based filtering
	return ShouldAllowUA(userAgent, config)
}

// LogUAFilterEvent logs a UA filter event.
func (pp *PocketPing) LogUAFilterEvent(event UaFilterLogEvent) {
	if pp.config.UaFilter == nil {
		return
	}

	if pp.config.UaFilter.Logger != nil {
		pp.config.UaFilter.Logger(event)
	} else if pp.config.UaFilter.LogBlocked {
		fmt.Printf("[PocketPing] UA %s: %s - reason: %s (pattern: %s, path: %s)\n",
			event.Type, event.UserAgent, event.Reason, event.MatchedPattern, event.Path)
	}
}

// CreateUAFilterLogEvent creates a UA filter log event.
func CreateUAFilterLogEvent(eventType, userAgent string, reason UaFilterReason, matchedPattern, path, sessionID string) UaFilterLogEvent {
	return UaFilterLogEvent{
		Type:           eventType,
		UserAgent:      userAgent,
		Reason:         reason,
		MatchedPattern: matchedPattern,
		Path:           path,
		Timestamp:      time.Now().UTC(),
		SessionID:      sessionID,
	}
}

// CheckUAFilterRequest checks if an HTTP request should be allowed based on UA filter config.
// Returns (allowed, userAgent) - if not allowed, the caller should return a 403 response.
func (pp *PocketPing) CheckUAFilterRequest(r *http.Request) (bool, string) {
	if pp.config.UaFilter == nil || !pp.config.UaFilter.Enabled {
		return true, ""
	}

	userAgent := r.UserAgent()
	result := CheckUAFilter(r.Context(), userAgent, pp.config.UaFilter, map[string]interface{}{
		"path":   r.URL.Path,
		"method": r.Method,
	})

	if !result.Allowed {
		if pp.config.UaFilter.LogBlocked {
			event := CreateUAFilterLogEvent("blocked", userAgent, result.Reason, result.MatchedPattern, r.URL.Path, "")
			pp.LogUAFilterEvent(event)
		}
		return false, userAgent
	}

	return true, userAgent
}

// WriteUAFilterBlockedResponse writes a blocked response to the HTTP response writer.
func (pp *PocketPing) WriteUAFilterBlockedResponse(w http.ResponseWriter) {
	statusCode := http.StatusForbidden
	message := "Forbidden"

	if pp.config.UaFilter != nil {
		if pp.config.UaFilter.BlockedStatusCode > 0 {
			statusCode = pp.config.UaFilter.BlockedStatusCode
		}
		if pp.config.UaFilter.BlockedMessage != "" {
			message = pp.config.UaFilter.BlockedMessage
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	fmt.Fprintf(w, `{"error":"%s"}`, message)
}

// IsBot checks if a user-agent looks like a bot based on default patterns.
func IsBot(userAgent string) bool {
	return matchesAnyPattern(userAgent, DefaultBotPatterns) != ""
}

package pocketping

import (
	"strings"
	"testing"
)

// ─────────────────────────────────────────────────────────────────
// version.go
// ─────────────────────────────────────────────────────────────────

func TestVersionString(t *testing.T) {
	v := Version{Major: 1, Minor: 2, Patch: 3}
	if got := v.String(); got != "1.2.3" {
		t.Errorf("String() = %q, want 1.2.3", got)
	}
}

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		{"1.0.0", "1.0.0", 0},
		{"1.0.0", "2.0.0", -1},
		{"2.0.0", "1.0.0", 1},
		{"1.1.0", "1.0.0", 1},
		{"1.0.1", "1.0.2", -1},
		{"v1.2.3", "1.2.3", 0},
		{"1.0.0-beta", "1.0.0", 0},
	}
	for _, tt := range tests {
		if got := CompareVersions(tt.a, tt.b); got != tt.want {
			t.Errorf("CompareVersions(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
		}
	}
}

func TestGetVersionHeaders(t *testing.T) {
	result := VersionCheckResult{
		Status:        VersionStatusDeprecated,
		Message:       "please update",
		MinVersion:    "1.0.0",
		LatestVersion: "2.0.0",
	}
	headers := GetVersionHeaders(result)
	if headers["X-PocketPing-Version-Status"] != "deprecated" {
		t.Errorf("status header = %q", headers["X-PocketPing-Version-Status"])
	}
	if headers["X-PocketPing-Min-Version"] != "1.0.0" {
		t.Errorf("min header = %q", headers["X-PocketPing-Min-Version"])
	}
	if headers["X-PocketPing-Latest-Version"] != "2.0.0" {
		t.Errorf("latest header = %q", headers["X-PocketPing-Latest-Version"])
	}
	if headers["X-PocketPing-Version-Message"] != "please update" {
		t.Errorf("message header = %q", headers["X-PocketPing-Version-Message"])
	}

	// Empty fields should be omitted.
	minimal := GetVersionHeaders(VersionCheckResult{Status: VersionStatusOK})
	if _, ok := minimal["X-PocketPing-Min-Version"]; ok {
		t.Error("min version header should be absent when empty")
	}
	if _, ok := minimal["X-PocketPing-Version-Message"]; ok {
		t.Error("message header should be absent when empty")
	}
}

func TestCreateVersionWarning(t *testing.T) {
	tests := []struct {
		status       VersionStatus
		wantSeverity string
	}{
		{VersionStatusDeprecated, "warning"},
		{VersionStatusUnsupported, "error"},
		{VersionStatusOutdated, "info"},
		{VersionStatusOK, "info"},
	}
	for _, tt := range tests {
		w := CreateVersionWarning(VersionCheckResult{Status: tt.status, CanContinue: true}, "1.0.0", "")
		if w.Severity != tt.wantSeverity {
			t.Errorf("status %q: severity = %q, want %q", tt.status, w.Severity, tt.wantSeverity)
		}
		if w.UpgradeURL != "https://docs.pocketping.io/widget/installation" {
			t.Errorf("default upgrade URL = %q", w.UpgradeURL)
		}
		if w.CurrentVersion != "1.0.0" {
			t.Errorf("current version = %q", w.CurrentVersion)
		}
	}

	// Custom upgrade URL is respected.
	w := CreateVersionWarning(VersionCheckResult{Status: VersionStatusDeprecated}, "1.0.0", "https://example.com/upgrade")
	if w.UpgradeURL != "https://example.com/upgrade" {
		t.Errorf("custom upgrade URL = %q", w.UpgradeURL)
	}
}

// ─────────────────────────────────────────────────────────────────
// errors.go
// ─────────────────────────────────────────────────────────────────

func TestNewSetupErrorWithGuide(t *testing.T) {
	err := NewSetupErrorWithGuide("Slack", "valid bot_token", "use xoxb- prefix")
	if err.Bridge != "Slack" || err.Missing != "valid bot_token" {
		t.Errorf("unexpected fields: %+v", err)
	}
	if err.Guide != "use xoxb- prefix" {
		t.Errorf("guide = %q", err.Guide)
	}
	if !strings.Contains(err.DocsURL, "slack") {
		t.Errorf("docs URL = %q", err.DocsURL)
	}
}

func TestSetupErrorError(t *testing.T) {
	err := NewSetupError("Telegram", "bot_token")
	msg := err.Error()
	if !strings.Contains(msg, "Telegram") || !strings.Contains(msg, "bot_token") {
		t.Errorf("Error() = %q", msg)
	}
	if err.Guide == "" {
		t.Error("expected a guide to be populated from SetupGuides")
	}
}

func TestSetupErrorFormattedGuide(t *testing.T) {
	err := NewSetupError("Discord", "bot_token")
	guide := err.FormattedGuide()
	if !strings.Contains(guide, "Discord") {
		t.Errorf("formatted guide missing bridge name: %q", guide)
	}
	if !strings.Contains(guide, "bot_token") {
		t.Errorf("formatted guide missing missing-field: %q", guide)
	}
	// Each guide line should be prefixed with the box-drawing char.
	if !strings.Contains(guide, "│") {
		t.Errorf("formatted guide missing box formatting: %q", guide)
	}
}

func TestValidateTelegramConfig(t *testing.T) {
	if err := ValidateTelegramConfig("token", "chat"); err != nil {
		t.Errorf("valid config should pass, got %v", err)
	}
	if err := ValidateTelegramConfig("", "chat"); err == nil {
		t.Error("expected error for missing bot token")
	}
	if err := ValidateTelegramConfig("token", ""); err == nil {
		t.Error("expected error for missing chat id")
	}
}

func TestValidateDiscordBotConfig(t *testing.T) {
	if err := ValidateDiscordBotConfig("token", "channel"); err != nil {
		t.Errorf("valid config should pass, got %v", err)
	}
	if err := ValidateDiscordBotConfig("", "channel"); err == nil {
		t.Error("expected error for missing bot token")
	}
	if err := ValidateDiscordBotConfig("token", ""); err == nil {
		t.Error("expected error for missing channel id")
	}
}

func TestValidateDiscordWebhookConfig(t *testing.T) {
	if err := ValidateDiscordWebhookConfig("https://discord.com/api/webhooks/123/abc"); err != nil {
		t.Errorf("valid webhook should pass, got %v", err)
	}
	if err := ValidateDiscordWebhookConfig(""); err == nil {
		t.Error("expected error for empty webhook URL")
	}
	if err := ValidateDiscordWebhookConfig("https://example.com/webhook"); err == nil {
		t.Error("expected error for invalid webhook host")
	}
}

func TestValidateSlackBotConfig(t *testing.T) {
	if err := ValidateSlackBotConfig("xoxb-token", "channel"); err != nil {
		t.Errorf("valid config should pass, got %v", err)
	}
	if err := ValidateSlackBotConfig("", "channel"); err == nil {
		t.Error("expected error for missing bot token")
	}
	if err := ValidateSlackBotConfig("bad-token", "channel"); err == nil {
		t.Error("expected error for bot token without xoxb- prefix")
	}
	if err := ValidateSlackBotConfig("xoxb-token", ""); err == nil {
		t.Error("expected error for missing channel id")
	}
}

func TestValidateSlackWebhookConfig(t *testing.T) {
	if err := ValidateSlackWebhookConfig("https://hooks.slack.com/services/T/B/x"); err != nil {
		t.Errorf("valid webhook should pass, got %v", err)
	}
	if err := ValidateSlackWebhookConfig(""); err == nil {
		t.Error("expected error for empty webhook URL")
	}
	if err := ValidateSlackWebhookConfig("https://example.com/webhook"); err == nil {
		t.Error("expected error for invalid webhook host")
	}
}

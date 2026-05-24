package pocketping

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ─────────────────────────────────────────────────────────────────
// ip_filter.go — config + PocketPing receiver methods
// ─────────────────────────────────────────────────────────────────

func TestDefaultIpFilterConfig(t *testing.T) {
	cfg := DefaultIpFilterConfig()
	if cfg.Enabled {
		t.Error("default config should be disabled")
	}
	if cfg.Mode != IpFilterModeBlocklist {
		t.Errorf("mode = %q, want blocklist", cfg.Mode)
	}
	if cfg.BlockedStatusCode != http.StatusForbidden {
		t.Errorf("status code = %d, want 403", cfg.BlockedStatusCode)
	}
	if !cfg.TrustProxy {
		t.Error("default config should trust proxy")
	}
	if len(cfg.ProxyHeaders) == 0 {
		t.Error("expected default proxy headers")
	}
}

func TestGetClientIP(t *testing.T) {
	t.Run("from proxy header", func(t *testing.T) {
		cfg := DefaultIpFilterConfig()
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("X-Forwarded-For", "203.0.113.1, 10.0.0.1")
		if got := GetClientIP(r, cfg); got != "203.0.113.1" {
			t.Errorf("GetClientIP = %q, want 203.0.113.1", got)
		}
	})

	t.Run("cf header preferred", func(t *testing.T) {
		cfg := DefaultIpFilterConfig()
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("Cf-Connecting-Ip", "198.51.100.5")
		r.Header.Set("X-Forwarded-For", "203.0.113.1")
		if got := GetClientIP(r, cfg); got != "198.51.100.5" {
			t.Errorf("GetClientIP = %q, want 198.51.100.5", got)
		}
	})

	t.Run("fallback to remote addr with port", func(t *testing.T) {
		cfg := DefaultIpFilterConfig()
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = "192.0.2.10:54321"
		if got := GetClientIP(r, cfg); got != "192.0.2.10" {
			t.Errorf("GetClientIP = %q, want 192.0.2.10", got)
		}
	})

	t.Run("ipv6 remote addr", func(t *testing.T) {
		cfg := DefaultIpFilterConfig()
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = "[::1]:54321"
		if got := GetClientIP(r, cfg); got != "::1" {
			t.Errorf("GetClientIP = %q, want ::1", got)
		}
	})

	t.Run("trust proxy disabled ignores headers", func(t *testing.T) {
		cfg := DefaultIpFilterConfig()
		cfg.TrustProxy = false
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("X-Forwarded-For", "203.0.113.1")
		r.RemoteAddr = "192.0.2.10:1234"
		if got := GetClientIP(r, cfg); got != "192.0.2.10" {
			t.Errorf("GetClientIP = %q, want 192.0.2.10 (proxy untrusted)", got)
		}
	})

	t.Run("nil config uses defaults", func(t *testing.T) {
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("X-Real-Ip", "203.0.113.99")
		if got := GetClientIP(r, nil); got != "203.0.113.99" {
			t.Errorf("GetClientIP = %q, want 203.0.113.99", got)
		}
	})
}

func TestGetClientIPSimple(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.0.2.55:8080"
	if got := GetClientIPSimple(r); got != "192.0.2.55" {
		t.Errorf("GetClientIPSimple = %q, want 192.0.2.55", got)
	}
}

func TestCheckIPFilterRequest(t *testing.T) {
	t.Run("disabled allows", func(t *testing.T) {
		pp := New(Config{})
		r := httptest.NewRequest("GET", "/", nil)
		allowed, _ := pp.CheckIPFilterRequest(r)
		if !allowed {
			t.Error("expected allowed when filter disabled")
		}
	})

	t.Run("blocked logs and reports", func(t *testing.T) {
		var logged *IpFilterLogEvent
		pp := New(Config{
			IpFilter: &IpFilterConfig{
				Enabled:    true,
				Mode:       IpFilterModeBlocklist,
				Blocklist:  []string{"203.0.113.0/24"},
				LogBlocked: true,
				TrustProxy: true,
				Logger:     func(e IpFilterLogEvent) { logged = &e },
			},
		})
		r := httptest.NewRequest("GET", "/path", nil)
		r.Header.Set("X-Forwarded-For", "203.0.113.5")
		allowed, ip := pp.CheckIPFilterRequest(r)
		if allowed {
			t.Error("expected blocked")
		}
		if ip != "203.0.113.5" {
			t.Errorf("ip = %q", ip)
		}
		if logged == nil || logged.Type != "blocked" {
			t.Errorf("expected blocked log event, got %+v", logged)
		}
	})

	t.Run("allowed passes", func(t *testing.T) {
		pp := New(Config{
			IpFilter: &IpFilterConfig{
				Enabled:   true,
				Mode:      IpFilterModeBlocklist,
				Blocklist: []string{"203.0.113.0/24"},
			},
		})
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("X-Forwarded-For", "10.0.0.1")
		allowed, _ := pp.CheckIPFilterRequest(r)
		if !allowed {
			t.Error("expected allowed")
		}
	})
}

func TestWriteIPFilterBlockedResponse(t *testing.T) {
	t.Run("custom status and message", func(t *testing.T) {
		pp := New(Config{
			IpFilter: &IpFilterConfig{
				Enabled:           true,
				BlockedStatusCode: http.StatusTeapot,
				BlockedMessage:    "Nope",
			},
		})
		w := httptest.NewRecorder()
		pp.WriteIPFilterBlockedResponse(w)
		if w.Code != http.StatusTeapot {
			t.Errorf("status = %d, want 418", w.Code)
		}
		if !strings.Contains(w.Body.String(), "Nope") {
			t.Errorf("body = %q", w.Body.String())
		}
	})

	t.Run("defaults when nil config", func(t *testing.T) {
		pp := New(Config{})
		w := httptest.NewRecorder()
		pp.WriteIPFilterBlockedResponse(w)
		if w.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", w.Code)
		}
		if !strings.Contains(w.Body.String(), "Forbidden") {
			t.Errorf("body = %q", w.Body.String())
		}
	})
}

func TestLogIPFilterEvent(t *testing.T) {
	t.Run("nil filter no panic", func(t *testing.T) {
		pp := New(Config{})
		pp.LogIPFilterEvent(CreateIPFilterLogEvent("blocked", "1.2.3.4", IpFilterReasonBlocklist, "/", ""))
	})

	t.Run("custom logger invoked", func(t *testing.T) {
		var called bool
		pp := New(Config{IpFilter: &IpFilterConfig{Enabled: true, Logger: func(e IpFilterLogEvent) { called = true }}})
		pp.LogIPFilterEvent(CreateIPFilterLogEvent("blocked", "1.2.3.4", IpFilterReasonBlocklist, "/", ""))
		if !called {
			t.Error("expected custom logger to be called")
		}
	})

	t.Run("default print path", func(t *testing.T) {
		pp := New(Config{IpFilter: &IpFilterConfig{Enabled: true, LogBlocked: true}})
		pp.LogIPFilterEvent(CreateIPFilterLogEvent("blocked", "1.2.3.4", IpFilterReasonBlocklist, "/", "s1"))
	})
}

func TestCreateIPFilterLogEvent(t *testing.T) {
	e := CreateIPFilterLogEvent("blocked", "1.2.3.4", IpFilterReasonBlocklist, "/x", "sess")
	if e.Type != "blocked" || e.IP != "1.2.3.4" || e.Path != "/x" || e.SessionID != "sess" {
		t.Errorf("unexpected event: %+v", e)
	}
	if e.Timestamp.IsZero() {
		t.Error("expected timestamp to be set")
	}
}

// ─────────────────────────────────────────────────────────────────
// user_agent_filter.go
// ─────────────────────────────────────────────────────────────────

func TestDefaultUaFilterConfig(t *testing.T) {
	cfg := DefaultUaFilterConfig()
	if cfg.Enabled {
		t.Error("default UA config should be disabled")
	}
	if !cfg.UseDefaultBots {
		t.Error("default UA config should use default bots")
	}
	if cfg.BlockedStatusCode != http.StatusForbidden {
		t.Errorf("status code = %d", cfg.BlockedStatusCode)
	}
}

func TestIsRegexPatternAndExtract(t *testing.T) {
	if !isRegexPattern("/bot-\\d+/") {
		t.Error("expected regex pattern detection")
	}
	if isRegexPattern("googlebot") {
		t.Error("plain string is not a regex pattern")
	}
	if isRegexPattern("/") {
		t.Error("single slash is not a regex pattern")
	}
	re, err := extractRegex("/bot-\\d+/")
	if err != nil {
		t.Fatalf("extractRegex error: %v", err)
	}
	if !re.MatchString("bot-123") {
		t.Error("expected regex to match bot-123")
	}
}

func TestMatchesAnyPattern(t *testing.T) {
	patterns := []string{"googlebot", "/crawler-\\d+/"}
	if matchesAnyPattern("Mozilla GoogleBot/2.1", patterns) != "googlebot" {
		t.Error("expected substring match for googlebot")
	}
	if matchesAnyPattern("crawler-99 here", patterns) != "/crawler-\\d+/" {
		t.Error("expected regex match")
	}
	if matchesAnyPattern("regular browser", patterns) != "" {
		t.Error("expected no match")
	}
}

func TestShouldAllowUA(t *testing.T) {
	t.Run("nil config allows", func(t *testing.T) {
		if !ShouldAllowUA("anything", nil).Allowed {
			t.Error("nil config should allow")
		}
	})

	t.Run("blocklist default bot", func(t *testing.T) {
		cfg := &UaFilterConfig{Enabled: true, Mode: UaFilterModeBlocklist, UseDefaultBots: true}
		res := ShouldAllowUA("Mozilla/5.0 (compatible; Googlebot/2.1)", cfg)
		if res.Allowed {
			t.Error("expected googlebot to be blocked")
		}
		if res.Reason != UaFilterReasonDefaultBot {
			t.Errorf("reason = %q, want default_bot", res.Reason)
		}
	})

	t.Run("blocklist custom pattern", func(t *testing.T) {
		cfg := &UaFilterConfig{Enabled: true, Mode: UaFilterModeBlocklist, Blocklist: []string{"evilcorp"}}
		res := ShouldAllowUA("evilcorp scanner", cfg)
		if res.Allowed || res.Reason != UaFilterReasonBlocklist {
			t.Errorf("expected custom blocklist block, got %+v", res)
		}
	})

	t.Run("blocklist allows normal", func(t *testing.T) {
		cfg := &UaFilterConfig{Enabled: true, Mode: UaFilterModeBlocklist}
		res := ShouldAllowUA("Mozilla/5.0 Chrome", cfg)
		if !res.Allowed {
			t.Error("expected normal UA to be allowed")
		}
	})

	t.Run("allowlist mode", func(t *testing.T) {
		cfg := &UaFilterConfig{Enabled: true, Mode: UaFilterModeAllowlist, Allowlist: []string{"MyApp"}}
		if !ShouldAllowUA("MyApp/1.0", cfg).Allowed {
			t.Error("expected allowlisted UA to be allowed")
		}
		res := ShouldAllowUA("Other/1.0", cfg)
		if res.Allowed || res.Reason != UaFilterReasonNotInAllowlist {
			t.Errorf("expected not_in_allowlist, got %+v", res)
		}
	})

	t.Run("both mode allowlist priority", func(t *testing.T) {
		cfg := &UaFilterConfig{Enabled: true, Mode: UaFilterModeBoth, Allowlist: []string{"GoodBot"}, Blocklist: []string{"GoodBot"}}
		res := ShouldAllowUA("GoodBot/1.0", cfg)
		if !res.Allowed || res.Reason != UaFilterReasonAllowlist {
			t.Errorf("expected allowlist priority, got %+v", res)
		}
	})

	t.Run("both mode blocklist applies", func(t *testing.T) {
		cfg := &UaFilterConfig{Enabled: true, Mode: UaFilterModeBoth, Blocklist: []string{"badbot"}}
		res := ShouldAllowUA("badbot/1.0", cfg)
		if res.Allowed || res.Reason != UaFilterReasonBlocklist {
			t.Errorf("expected blocklist block, got %+v", res)
		}
	})

	t.Run("both mode default allow", func(t *testing.T) {
		cfg := &UaFilterConfig{Enabled: true, Mode: UaFilterModeBoth, UseDefaultBots: false}
		if !ShouldAllowUA("normal browser", cfg).Allowed {
			t.Error("expected default allow in both mode")
		}
	})

	t.Run("unknown mode allows", func(t *testing.T) {
		cfg := &UaFilterConfig{Enabled: true, Mode: UaFilterMode("weird")}
		if !ShouldAllowUA("anything", cfg).Allowed {
			t.Error("expected default allow for unknown mode")
		}
	})
}

func TestCheckUAFilter(t *testing.T) {
	t.Run("empty ua allows", func(t *testing.T) {
		if !CheckUAFilter(context.Background(), "", &UaFilterConfig{Enabled: true}, nil).Allowed {
			t.Error("empty UA should be allowed")
		}
	})

	t.Run("disabled allows", func(t *testing.T) {
		if !CheckUAFilter(context.Background(), "Googlebot", &UaFilterConfig{Enabled: false}, nil).Allowed {
			t.Error("disabled filter should allow")
		}
	})

	t.Run("custom filter blocks", func(t *testing.T) {
		falseVal := false
		cfg := &UaFilterConfig{Enabled: true, CustomFilter: func(ua string, info map[string]interface{}) *bool { return &falseVal }}
		res := CheckUAFilter(context.Background(), "anything", cfg, nil)
		if res.Allowed || res.Reason != UaFilterReasonCustom {
			t.Errorf("expected custom block, got %+v", res)
		}
	})

	t.Run("custom filter allows", func(t *testing.T) {
		trueVal := true
		cfg := &UaFilterConfig{Enabled: true, UseDefaultBots: true, CustomFilter: func(ua string, info map[string]interface{}) *bool { return &trueVal }}
		res := CheckUAFilter(context.Background(), "Googlebot", cfg, nil)
		if !res.Allowed || res.Reason != UaFilterReasonCustom {
			t.Errorf("expected custom allow, got %+v", res)
		}
	})

	t.Run("custom filter defers", func(t *testing.T) {
		cfg := &UaFilterConfig{Enabled: true, UseDefaultBots: true, CustomFilter: func(ua string, info map[string]interface{}) *bool { return nil }}
		res := CheckUAFilter(context.Background(), "Googlebot/2.1", cfg, nil)
		if res.Allowed {
			t.Error("expected deferral to block googlebot")
		}
	})
}

func TestCheckUAFilterRequest(t *testing.T) {
	t.Run("disabled allows", func(t *testing.T) {
		pp := New(Config{})
		r := httptest.NewRequest("GET", "/", nil)
		allowed, _ := pp.CheckUAFilterRequest(r)
		if !allowed {
			t.Error("expected allowed when disabled")
		}
	})

	t.Run("blocks bot and logs", func(t *testing.T) {
		var logged bool
		pp := New(Config{UaFilter: &UaFilterConfig{
			Enabled:        true,
			Mode:           UaFilterModeBlocklist,
			UseDefaultBots: true,
			LogBlocked:     true,
			Logger:         func(e UaFilterLogEvent) { logged = true },
		}})
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("User-Agent", "Mozilla/5.0 (compatible; Googlebot/2.1)")
		allowed, ua := pp.CheckUAFilterRequest(r)
		if allowed {
			t.Error("expected bot to be blocked")
		}
		if ua == "" {
			t.Error("expected the UA string to be returned")
		}
		if !logged {
			t.Error("expected blocked event to be logged")
		}
	})

	t.Run("allows normal browser", func(t *testing.T) {
		pp := New(Config{UaFilter: &UaFilterConfig{Enabled: true, Mode: UaFilterModeBlocklist, UseDefaultBots: true}})
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh) Chrome/120.0")
		allowed, _ := pp.CheckUAFilterRequest(r)
		if !allowed {
			t.Error("expected normal browser to be allowed")
		}
	})
}

func TestWriteUAFilterBlockedResponse(t *testing.T) {
	t.Run("custom", func(t *testing.T) {
		pp := New(Config{UaFilter: &UaFilterConfig{Enabled: true, BlockedStatusCode: http.StatusTeapot, BlockedMessage: "Bots banned"}})
		w := httptest.NewRecorder()
		pp.WriteUAFilterBlockedResponse(w)
		if w.Code != http.StatusTeapot {
			t.Errorf("status = %d", w.Code)
		}
		if !strings.Contains(w.Body.String(), "Bots banned") {
			t.Errorf("body = %q", w.Body.String())
		}
	})

	t.Run("default", func(t *testing.T) {
		pp := New(Config{})
		w := httptest.NewRecorder()
		pp.WriteUAFilterBlockedResponse(w)
		if w.Code != http.StatusForbidden {
			t.Errorf("status = %d", w.Code)
		}
	})
}

func TestLogUAFilterEvent(t *testing.T) {
	t.Run("nil filter no panic", func(t *testing.T) {
		pp := New(Config{})
		pp.LogUAFilterEvent(CreateUAFilterLogEvent("blocked", "ua", UaFilterReasonDefaultBot, "p", "/", ""))
	})
	t.Run("custom logger", func(t *testing.T) {
		var called bool
		pp := New(Config{UaFilter: &UaFilterConfig{Enabled: true, Logger: func(e UaFilterLogEvent) { called = true }}})
		pp.LogUAFilterEvent(CreateUAFilterLogEvent("blocked", "ua", UaFilterReasonDefaultBot, "p", "/", ""))
		if !called {
			t.Error("expected custom logger called")
		}
	})
	t.Run("default print", func(t *testing.T) {
		pp := New(Config{UaFilter: &UaFilterConfig{Enabled: true, LogBlocked: true}})
		pp.LogUAFilterEvent(CreateUAFilterLogEvent("blocked", "ua", UaFilterReasonDefaultBot, "p", "/", "s"))
	})
}

func TestCreateUAFilterLogEvent(t *testing.T) {
	e := CreateUAFilterLogEvent("blocked", "ua-str", UaFilterReasonBlocklist, "pat", "/path", "sess")
	if e.Type != "blocked" || e.UserAgent != "ua-str" || e.MatchedPattern != "pat" || e.Path != "/path" || e.SessionID != "sess" {
		t.Errorf("unexpected event: %+v", e)
	}
	if e.Timestamp.IsZero() {
		t.Error("expected timestamp to be set")
	}
}

func TestIsBot(t *testing.T) {
	if !IsBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)") {
		t.Error("expected Googlebot to be detected as a bot")
	}
	if IsBot("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0 Safari/537.36") {
		t.Error("expected normal browser not to be a bot")
	}
}

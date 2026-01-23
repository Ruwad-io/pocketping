package pocketping

import (
	"context"
	"testing"
)

func TestIpMatchesCidr(t *testing.T) {
	tests := []struct {
		name     string
		ip       string
		cidr     string
		expected bool
	}{
		// Exact IP match
		{"exact match", "192.168.1.1", "192.168.1.1", true},
		{"exact no match", "192.168.1.2", "192.168.1.1", false},

		// /24 subnet
		{"/24 match start", "192.168.1.0", "192.168.1.0/24", true},
		{"/24 match middle", "192.168.1.1", "192.168.1.0/24", true},
		{"/24 match end", "192.168.1.255", "192.168.1.0/24", true},
		{"/24 no match", "192.168.2.0", "192.168.1.0/24", false},

		// /16 subnet
		{"/16 match", "192.168.0.0", "192.168.0.0/16", true},
		{"/16 match high", "192.168.255.255", "192.168.0.0/16", true},
		{"/16 no match", "192.169.0.0", "192.168.0.0/16", false},

		// /8 subnet
		{"/8 match low", "10.0.0.1", "10.0.0.0/8", true},
		{"/8 match high", "10.255.255.255", "10.0.0.0/8", true},
		{"/8 no match", "11.0.0.0", "10.0.0.0/8", false},

		// /32 (single IP)
		{"/32 match", "203.0.113.50", "203.0.113.50/32", true},
		{"/32 no match", "203.0.113.51", "203.0.113.50/32", false},

		// /0 (all IPs)
		{"/0 match any", "1.2.3.4", "0.0.0.0/0", true},
		{"/0 match all", "255.255.255.255", "0.0.0.0/0", true},

		// Invalid inputs
		{"invalid ip", "invalid", "192.168.1.0/24", false},
		{"invalid cidr", "192.168.1.1", "invalid/24", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ipMatchesCidr(tt.ip, tt.cidr)
			if result != tt.expected {
				t.Errorf("ipMatchesCidr(%q, %q) = %v, want %v", tt.ip, tt.cidr, result, tt.expected)
			}
		})
	}
}

func TestIpMatchesAny(t *testing.T) {
	entries := []string{"192.168.1.0/24", "10.0.0.0/8", "203.0.113.50"}

	tests := []struct {
		name     string
		ip       string
		expected bool
	}{
		{"matches first range", "192.168.1.100", true},
		{"matches second range", "10.50.25.1", true},
		{"matches exact ip", "203.0.113.50", true},
		{"no match", "172.16.0.1", false},
		{"no match 2", "8.8.8.8", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ipMatchesAny(tt.ip, entries)
			if result != tt.expected {
				t.Errorf("ipMatchesAny(%q, entries) = %v, want %v", tt.ip, result, tt.expected)
			}
		})
	}

	// Empty list test
	t.Run("empty list", func(t *testing.T) {
		result := ipMatchesAny("192.168.1.1", []string{})
		if result != false {
			t.Errorf("ipMatchesAny with empty list = %v, want false", result)
		}
	})
}

func TestShouldAllowIP(t *testing.T) {
	t.Run("blocklist mode blocks", func(t *testing.T) {
		config := &IpFilterConfig{
			Enabled:   true,
			Mode:      IpFilterModeBlocklist,
			Blocklist: []string{"192.168.1.0/24", "203.0.113.0/24"},
		}
		result := ShouldAllowIP("192.168.1.50", config)
		if result.Allowed != false || result.Reason != IpFilterReasonBlocklist {
			t.Errorf("Expected blocked with blocklist reason, got allowed=%v, reason=%v", result.Allowed, result.Reason)
		}
	})

	t.Run("blocklist mode allows", func(t *testing.T) {
		config := &IpFilterConfig{
			Enabled:   true,
			Mode:      IpFilterModeBlocklist,
			Blocklist: []string{"192.168.1.0/24"},
		}
		result := ShouldAllowIP("10.0.0.1", config)
		if result.Allowed != true || result.Reason != IpFilterReasonDefault {
			t.Errorf("Expected allowed with default reason, got allowed=%v, reason=%v", result.Allowed, result.Reason)
		}
	})

	t.Run("allowlist mode allows", func(t *testing.T) {
		config := &IpFilterConfig{
			Enabled:   true,
			Mode:      IpFilterModeAllowlist,
			Allowlist: []string{"10.0.0.0/8", "192.168.0.0/16"},
		}
		result := ShouldAllowIP("10.0.0.50", config)
		if result.Allowed != true || result.Reason != IpFilterReasonAllowlist {
			t.Errorf("Expected allowed with allowlist reason, got allowed=%v, reason=%v", result.Allowed, result.Reason)
		}
	})

	t.Run("allowlist mode blocks", func(t *testing.T) {
		config := &IpFilterConfig{
			Enabled:   true,
			Mode:      IpFilterModeAllowlist,
			Allowlist: []string{"10.0.0.0/8"},
		}
		result := ShouldAllowIP("192.168.1.1", config)
		if result.Allowed != false || result.Reason != IpFilterReasonNotInAllowlist {
			t.Errorf("Expected blocked with not_in_allowlist reason, got allowed=%v, reason=%v", result.Allowed, result.Reason)
		}
	})

	t.Run("both mode allowlist priority", func(t *testing.T) {
		config := &IpFilterConfig{
			Enabled:   true,
			Mode:      IpFilterModeBoth,
			Allowlist: []string{"10.0.0.1"},
			Blocklist: []string{"10.0.0.0/24"},
		}
		result := ShouldAllowIP("10.0.0.1", config)
		if result.Allowed != true || result.Reason != IpFilterReasonAllowlist {
			t.Errorf("Expected allowed with allowlist reason, got allowed=%v, reason=%v", result.Allowed, result.Reason)
		}
	})

	t.Run("both mode blocklist applies", func(t *testing.T) {
		config := &IpFilterConfig{
			Enabled:   true,
			Mode:      IpFilterModeBoth,
			Allowlist: []string{"10.0.0.1"},
			Blocklist: []string{"10.0.0.0/24"},
		}
		result := ShouldAllowIP("10.0.0.2", config)
		if result.Allowed != false || result.Reason != IpFilterReasonBlocklist {
			t.Errorf("Expected blocked with blocklist reason, got allowed=%v, reason=%v", result.Allowed, result.Reason)
		}
	})

	t.Run("nil config allows", func(t *testing.T) {
		result := ShouldAllowIP("192.168.1.1", nil)
		if result.Allowed != true {
			t.Errorf("Expected allowed for nil config, got allowed=%v", result.Allowed)
		}
	})
}

func TestCheckIPFilter(t *testing.T) {
	t.Run("custom filter blocks", func(t *testing.T) {
		falseVal := false
		config := &IpFilterConfig{
			Enabled:   true,
			Mode:      IpFilterModeBlocklist,
			Blocklist: []string{"192.168.1.0/24"},
			CustomFilter: func(ip string, requestInfo map[string]interface{}) *bool {
				// Block all IPs starting with "10."
				if len(ip) >= 3 && ip[:3] == "10." {
					return &falseVal
				}
				return nil // Defer to list-based
			},
		}

		result := CheckIPFilter(context.Background(), "10.0.0.1", config, nil)
		if result.Allowed != false || result.Reason != IpFilterReasonCustom {
			t.Errorf("Expected blocked with custom reason, got allowed=%v, reason=%v", result.Allowed, result.Reason)
		}
	})

	t.Run("custom filter allows", func(t *testing.T) {
		trueVal := true
		config := &IpFilterConfig{
			Enabled:   true,
			Mode:      IpFilterModeBlocklist,
			Blocklist: []string{"192.168.1.0/24"},
			CustomFilter: func(ip string, requestInfo map[string]interface{}) *bool {
				if ip == "8.8.8.8" {
					return &trueVal
				}
				return nil
			},
		}

		result := CheckIPFilter(context.Background(), "8.8.8.8", config, nil)
		if result.Allowed != true || result.Reason != IpFilterReasonCustom {
			t.Errorf("Expected allowed with custom reason, got allowed=%v, reason=%v", result.Allowed, result.Reason)
		}
	})

	t.Run("custom filter defers", func(t *testing.T) {
		config := &IpFilterConfig{
			Enabled:   true,
			Mode:      IpFilterModeBlocklist,
			Blocklist: []string{"192.168.1.0/24"},
			CustomFilter: func(ip string, requestInfo map[string]interface{}) *bool {
				return nil // Defer
			},
		}

		result := CheckIPFilter(context.Background(), "192.168.1.50", config, nil)
		if result.Allowed != false || result.Reason != IpFilterReasonBlocklist {
			t.Errorf("Expected blocked with blocklist reason, got allowed=%v, reason=%v", result.Allowed, result.Reason)
		}
	})

	t.Run("disabled config allows", func(t *testing.T) {
		config := &IpFilterConfig{
			Enabled:   false,
			Mode:      IpFilterModeBlocklist,
			Blocklist: []string{"192.168.1.0/24"},
		}

		result := CheckIPFilter(context.Background(), "192.168.1.50", config, nil)
		if result.Allowed != true {
			t.Errorf("Expected allowed for disabled config, got allowed=%v", result.Allowed)
		}
	})
}

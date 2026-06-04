package pocketping

import "testing"

const realChromeUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

func TestIsDatacenterIP(t *testing.T) {
	datacenter := []string{
		"34.72.176.129", "34.123.170.104", "104.197.69.115", // GCP
		"51.75.1.1",             // OVH
		"5.9.1.1",               // Hetzner
		"159.65.1.1",            // DigitalOcean
		"2001:41d0:350:1400::1", // OVH v6
		"[2a01:4f8::1]",         // Hetzner v6, bracketed
	}
	for _, ip := range datacenter {
		if !IsDatacenterIP(ip) {
			t.Errorf("IsDatacenterIP(%q) = false, want true", ip)
		}
	}

	residential := []string{"86.247.12.34", "unknown", "", "not-an-ip"}
	for _, ip := range residential {
		if IsDatacenterIP(ip) {
			t.Errorf("IsDatacenterIP(%q) = true, want false", ip)
		}
	}
}

func TestIsHeadlessUserAgent(t *testing.T) {
	if !IsHeadlessUserAgent("Mozilla/5.0 HeadlessChrome/120") {
		t.Error("expected HeadlessChrome to be flagged")
	}
	if !IsHeadlessUserAgent("python-requests/2.31") {
		t.Error("expected python-requests to be flagged")
	}
	if IsHeadlessUserAgent(realChromeUA) {
		t.Error("real Chrome UA should not be flagged")
	}
	if IsHeadlessUserAgent("") {
		t.Error("empty UA should not be flagged")
	}
}

func TestIsHostingOrg(t *testing.T) {
	for _, org := range []string{"Hetzner Online GmbH", "DigitalOcean, LLC", "Vultr Holdings"} {
		if !IsHostingOrg(org) {
			t.Errorf("IsHostingOrg(%q) = false, want true", org)
		}
	}
	// Broad consumer brands rely on CIDR, not org matching.
	for _, org := range []string{"Google Fiber Inc.", "Google LLC", "AMAZON-02", "Orange S.A.", ""} {
		if IsHostingOrg(org) {
			t.Errorf("IsHostingOrg(%q) = true, want false", org)
		}
	}
}

func TestDetectBot(t *testing.T) {
	cases := []struct {
		name    string
		signal  BotSignal
		wantBot bool
		reason  string
	}{
		{"datacenter ip + spoofed UA", BotSignal{IP: "34.72.176.129", UserAgent: realChromeUA, Org: "Google LLC"}, true, "datacenter_ip"},
		{"hosting ASN, unlisted IP", BotSignal{IP: "203.0.113.7", UserAgent: realChromeUA, Org: "Vultr Holdings"}, true, "hosting_asn"},
		{"headless UA", BotSignal{IP: "86.247.12.34", UserAgent: "HeadlessChrome/120", Org: "Orange"}, true, "headless_ua"},
		{"real residential visitor", BotSignal{IP: "86.247.12.34", UserAgent: realChromeUA, Org: "Orange S.A."}, false, ""},
	}
	for _, c := range cases {
		got := DetectBot(c.signal)
		if got.IsBot != c.wantBot || got.Reason != c.reason {
			t.Errorf("%s: DetectBot = {%v %q}, want {%v %q}", c.name, got.IsBot, got.Reason, c.wantBot, c.reason)
		}
	}
}

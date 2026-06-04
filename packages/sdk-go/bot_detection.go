package pocketping

import (
	"net"
	"strings"
)

// Heuristic bot detection for widget connections.
//
// Many widget sessions are bots that load the page (running JS, so the widget
// connects) but never send a message. They spoof real-browser User-Agents — so
// UA-pattern filtering does NOT catch them — but they originate from datacenter
// / cloud IP ranges. This lets callers flag such connections and skip the
// operator "new visitor" notification (the session can still be created, and a
// thread created on-demand if the visitor ever actually sends a message, so
// false positives self-heal).
//
// Dependency-free: a bundled list of well-known cloud/datacenter CIDR ranges
// plus obvious headless/automation UA markers, and an optional ASN org-name
// signal. Mirrors the SaaS lib/bot-detection.ts for cross-mode parity.

// DefaultDatacenterCIDRs is a curated (non-exhaustive) list of cloud/datacenter
// ranges that dominate scraper / headless-browser traffic. Refresh periodically
// from providers' published ranges.
var DefaultDatacenterCIDRs = []string{
	// Google Cloud (the 34.x / 35.x ranges seen dominating real traffic)
	"34.0.0.0/9", "34.128.0.0/10", "35.184.0.0/13", "35.192.0.0/14",
	"35.196.0.0/15", "35.198.0.0/16", "35.200.0.0/13", "35.208.0.0/12",
	"35.224.0.0/12", "35.240.0.0/13", "104.196.0.0/14", "104.154.0.0/15",
	"130.211.0.0/16", "146.148.0.0/17",
	// Amazon AWS
	"3.0.0.0/9", "13.32.0.0/15", "15.177.0.0/18", "18.32.0.0/11",
	"52.0.0.0/11", "54.64.0.0/11", "99.77.0.0/18",
	// Microsoft Azure
	"13.64.0.0/11", "20.0.0.0/11", "40.64.0.0/10", "52.224.0.0/11", "104.40.0.0/13",
	// DigitalOcean
	"104.131.0.0/16", "138.197.0.0/16", "142.93.0.0/16", "159.65.0.0/16",
	"165.227.0.0/16", "167.71.0.0/16", "167.99.0.0/16", "178.62.0.0/16",
	"188.166.0.0/16",
	// OVH
	"51.68.0.0/14", "51.75.0.0/16", "51.81.0.0/16", "54.36.0.0/16",
	"145.239.0.0/16", "147.135.0.0/16", "198.27.64.0/18",
	// Hetzner
	"5.9.0.0/16", "78.46.0.0/15", "88.99.0.0/16", "94.130.0.0/16",
	"116.202.0.0/15", "135.181.0.0/16", "136.243.0.0/16", "142.132.0.0/16",
	"157.90.0.0/16", "159.69.0.0/16", "167.235.0.0/16", "168.119.0.0/16",
	"188.40.0.0/16",
	// Linode / Akamai
	"45.33.0.0/16", "45.56.0.0/16", "45.79.0.0/16", "139.144.0.0/16",
	"172.104.0.0/15", "173.255.192.0/18",
	// Scaleway / Online.net
	"51.15.0.0/16", "51.158.0.0/15", "163.172.0.0/16", "195.154.0.0/16",
	"212.83.128.0/19",
	// Datacenter IPv6 prefixes
	"2600:1f00::/24", "2a05:d000::/24", "2001:41d0::/32", "2a01:4f8::/29",
	"2604:a880::/32", "2a03:b0c0::/32", "2607:f8b0::/32", "2a00:1450::/32",
}

var datacenterNets = parseCIDRs(DefaultDatacenterCIDRs)

func parseCIDRs(cidrs []string) []*net.IPNet {
	nets := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		if _, n, err := net.ParseCIDR(c); err == nil {
			nets = append(nets, n)
		}
	}
	return nets
}

// headlessUAMarkers are obvious automation/headless User-Agent substrings.
var headlessUAMarkers = []string{
	"headlesschrome", "phantomjs", "electron", "puppeteer", "playwright",
	"selenium", "webdriver", "python-requests", "curl/", "wget/",
	"go-http-client", "node-fetch", "axios/", "java/", "okhttp",
}

// hostingOrgMarkers are UNAMBIGUOUS hosting/datacenter ASN org-name substrings.
// Broad consumer brands (google/amazon/microsoft/cloudflare) are intentionally
// excluded — they also run residential ASNs (e.g. "Google Fiber") and their
// cloud ranges are covered by DefaultDatacenterCIDRs instead.
var hostingOrgMarkers = []string{
	"digitalocean", "ovh", "hetzner", "linode", "scaleway", "vultr",
	"leaseweb", "contabo", "datacamp", "m247", "choopa", "datacenter",
	"data center", "hosting",
}

// IsDatacenterIP reports whether ip belongs to a known datacenter/cloud range.
func IsDatacenterIP(ip string) bool {
	ip = strings.TrimSpace(ip)
	if ip == "" || strings.EqualFold(ip, "unknown") {
		return false
	}
	ip = strings.Trim(ip, "[]")
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	for _, n := range datacenterNets {
		if n.Contains(parsed) {
			return true
		}
	}
	return false
}

// IsHeadlessUserAgent reports whether ua contains an obvious automation marker.
func IsHeadlessUserAgent(ua string) bool {
	if ua == "" {
		return false
	}
	lower := strings.ToLower(ua)
	for _, m := range headlessUAMarkers {
		if strings.Contains(lower, m) {
			return true
		}
	}
	return false
}

// IsHostingOrg reports whether org is an unambiguous hosting/cloud provider.
func IsHostingOrg(org string) bool {
	if org == "" {
		return false
	}
	lower := strings.ToLower(org)
	for _, m := range hostingOrgMarkers {
		if strings.Contains(lower, m) {
			return true
		}
	}
	return false
}

// BotSignal carries the inputs to DetectBot.
type BotSignal struct {
	IP        string
	UserAgent string
	Org       string // ASN org name, when available
}

// BotVerdict is the result of DetectBot.
type BotVerdict struct {
	IsBot  bool
	Reason string // "datacenter_ip" | "hosting_asn" | "headless_ua" | ""
}

// DetectBot returns a heuristic verdict for a widget connection. A connection is
// flagged when it comes from a datacenter IP (or hosting ASN) or carries a
// headless UA marker.
func DetectBot(signal BotSignal) BotVerdict {
	if IsDatacenterIP(signal.IP) {
		return BotVerdict{IsBot: true, Reason: "datacenter_ip"}
	}
	if IsHostingOrg(signal.Org) {
		return BotVerdict{IsBot: true, Reason: "hosting_asn"}
	}
	if IsHeadlessUserAgent(signal.UserAgent) {
		return BotVerdict{IsBot: true, Reason: "headless_ua"}
	}
	return BotVerdict{IsBot: false, Reason: ""}
}

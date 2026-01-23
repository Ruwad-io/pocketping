package pocketping

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

// IpFilterMode defines the filtering mode.
type IpFilterMode string

const (
	IpFilterModeAllowlist IpFilterMode = "allowlist"
	IpFilterModeBlocklist IpFilterMode = "blocklist"
	IpFilterModeBoth      IpFilterMode = "both"
)

// IpFilterReason describes why an IP was allowed or blocked.
type IpFilterReason string

const (
	IpFilterReasonAllowlist      IpFilterReason = "allowlist"
	IpFilterReasonBlocklist      IpFilterReason = "blocklist"
	IpFilterReasonCustom         IpFilterReason = "custom"
	IpFilterReasonNotInAllowlist IpFilterReason = "not_in_allowlist"
	IpFilterReasonDefault        IpFilterReason = "default"
)

// IpFilterLogEvent represents a log event for IP filtering actions.
type IpFilterLogEvent struct {
	Type      string         `json:"type"` // "blocked" or "allowed"
	IP        string         `json:"ip"`
	Reason    IpFilterReason `json:"reason"`
	Path      string         `json:"path"`
	Timestamp time.Time      `json:"timestamp"`
	SessionID string         `json:"sessionId,omitempty"`
}

// IpFilterResult represents the result of an IP filter check.
type IpFilterResult struct {
	Allowed bool
	Reason  IpFilterReason
}

// IpFilterCallback is a custom filter function.
// Return true to allow, false to block, nil to defer to list-based filtering.
type IpFilterCallback func(ip string, requestInfo map[string]interface{}) *bool

// IpFilterConfig holds the configuration for IP filtering.
type IpFilterConfig struct {
	// Enabled enables/disables IP filtering (default: false)
	Enabled bool

	// Mode is the filter mode (default: blocklist)
	Mode IpFilterMode

	// Allowlist contains IPs/CIDRs to allow
	Allowlist []string

	// Blocklist contains IPs/CIDRs to block
	Blocklist []string

	// CustomFilter is an optional custom filter callback
	CustomFilter IpFilterCallback

	// LogBlocked logs blocked requests (default: true)
	LogBlocked bool

	// Logger is a custom logger function
	Logger func(event IpFilterLogEvent)

	// BlockedStatusCode is the HTTP status code for blocked requests (default: 403)
	BlockedStatusCode int

	// BlockedMessage is the response message for blocked requests (default: "Forbidden")
	BlockedMessage string

	// TrustProxy trusts proxy headers (default: true)
	TrustProxy bool

	// ProxyHeaders is the list of headers to check for client IP
	ProxyHeaders []string
}

// DefaultIpFilterConfig returns a default IP filter configuration.
func DefaultIpFilterConfig() *IpFilterConfig {
	return &IpFilterConfig{
		Enabled:           false,
		Mode:              IpFilterModeBlocklist,
		Allowlist:         []string{},
		Blocklist:         []string{},
		LogBlocked:        true,
		BlockedStatusCode: http.StatusForbidden,
		BlockedMessage:    "Forbidden",
		TrustProxy:        true,
		ProxyHeaders:      []string{"Cf-Connecting-Ip", "X-Forwarded-For", "X-Real-Ip"},
	}
}

// ipMatchesCidr checks if an IP matches a CIDR range or exact IP.
func ipMatchesCidr(ipStr, cidr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}

	// If no CIDR suffix, treat as single IP (/32 or /128)
	if !strings.Contains(cidr, "/") {
		cidrIP := net.ParseIP(cidr)
		if cidrIP == nil {
			return false
		}
		return ip.Equal(cidrIP)
	}

	_, network, err := net.ParseCIDR(cidr)
	if err != nil {
		return false
	}

	return network.Contains(ip)
}

// ipMatchesAny checks if an IP matches any entry in the list.
func ipMatchesAny(ip string, entries []string) bool {
	for _, entry := range entries {
		if ipMatchesCidr(ip, entry) {
			return true
		}
	}
	return false
}

// ShouldAllowIP determines if an IP should be allowed based on the filter config.
func ShouldAllowIP(ip string, config *IpFilterConfig) IpFilterResult {
	if config == nil {
		return IpFilterResult{Allowed: true, Reason: IpFilterReasonDefault}
	}

	mode := config.Mode
	if mode == "" {
		mode = IpFilterModeBlocklist
	}

	allowlist := config.Allowlist
	blocklist := config.Blocklist

	switch mode {
	case IpFilterModeAllowlist:
		// Only allow if in allowlist
		if ipMatchesAny(ip, allowlist) {
			return IpFilterResult{Allowed: true, Reason: IpFilterReasonAllowlist}
		}
		return IpFilterResult{Allowed: false, Reason: IpFilterReasonNotInAllowlist}

	case IpFilterModeBlocklist:
		// Block if in blocklist, allow otherwise
		if ipMatchesAny(ip, blocklist) {
			return IpFilterResult{Allowed: false, Reason: IpFilterReasonBlocklist}
		}
		return IpFilterResult{Allowed: true, Reason: IpFilterReasonDefault}

	case IpFilterModeBoth:
		// Allowlist takes precedence, then check blocklist
		if ipMatchesAny(ip, allowlist) {
			return IpFilterResult{Allowed: true, Reason: IpFilterReasonAllowlist}
		}
		if ipMatchesAny(ip, blocklist) {
			return IpFilterResult{Allowed: false, Reason: IpFilterReasonBlocklist}
		}
		return IpFilterResult{Allowed: true, Reason: IpFilterReasonDefault}

	default:
		return IpFilterResult{Allowed: true, Reason: IpFilterReasonDefault}
	}
}

// CheckIPFilter checks the IP filter with support for custom filter callback.
func CheckIPFilter(ctx context.Context, ip string, config *IpFilterConfig, requestInfo map[string]interface{}) IpFilterResult {
	if config == nil || !config.Enabled {
		return IpFilterResult{Allowed: true, Reason: IpFilterReasonDefault}
	}

	// 1. Check custom filter first
	if config.CustomFilter != nil {
		result := config.CustomFilter(ip, requestInfo)
		if result != nil {
			if *result {
				return IpFilterResult{Allowed: true, Reason: IpFilterReasonCustom}
			}
			return IpFilterResult{Allowed: false, Reason: IpFilterReasonCustom}
		}
		// nil = fall through to list-based filtering
	}

	// 2. Apply list-based filtering
	return ShouldAllowIP(ip, config)
}

// LogIPFilterEvent logs an IP filter event.
func (pp *PocketPing) LogIPFilterEvent(event IpFilterLogEvent) {
	if pp.config.IpFilter == nil {
		return
	}

	if pp.config.IpFilter.Logger != nil {
		pp.config.IpFilter.Logger(event)
	} else if pp.config.IpFilter.LogBlocked {
		fmt.Printf("[PocketPing] IP %s: %s - reason: %s (path: %s)\n",
			event.Type, event.IP, event.Reason, event.Path)
	}
}

// CreateIPFilterLogEvent creates an IP filter log event.
func CreateIPFilterLogEvent(eventType, ip string, reason IpFilterReason, path, sessionID string) IpFilterLogEvent {
	return IpFilterLogEvent{
		Type:      eventType,
		IP:        ip,
		Reason:    reason,
		Path:      path,
		Timestamp: time.Now().UTC(),
		SessionID: sessionID,
	}
}

// CheckIPFilterRequest checks if an HTTP request should be allowed based on IP filter config.
// Returns (allowed, clientIP) - if not allowed, the caller should return a 403 response.
func (pp *PocketPing) CheckIPFilterRequest(r *http.Request) (bool, string) {
	if pp.config.IpFilter == nil || !pp.config.IpFilter.Enabled {
		return true, ""
	}

	clientIP := GetClientIP(r, pp.config.IpFilter)
	result := CheckIPFilter(r.Context(), clientIP, pp.config.IpFilter, map[string]interface{}{
		"path":   r.URL.Path,
		"method": r.Method,
	})

	if !result.Allowed {
		if pp.config.IpFilter.LogBlocked {
			event := CreateIPFilterLogEvent("blocked", clientIP, result.Reason, r.URL.Path, "")
			pp.LogIPFilterEvent(event)
		}
		return false, clientIP
	}

	return true, clientIP
}

// WriteIPFilterBlockedResponse writes a blocked response to the HTTP response writer.
func (pp *PocketPing) WriteIPFilterBlockedResponse(w http.ResponseWriter) {
	statusCode := http.StatusForbidden
	message := "Forbidden"

	if pp.config.IpFilter != nil {
		if pp.config.IpFilter.BlockedStatusCode > 0 {
			statusCode = pp.config.IpFilter.BlockedStatusCode
		}
		if pp.config.IpFilter.BlockedMessage != "" {
			message = pp.config.IpFilter.BlockedMessage
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	fmt.Fprintf(w, `{"error":"%s"}`, message)
}

// GetClientIP extracts the client IP from an HTTP request.
func GetClientIP(r *http.Request, config *IpFilterConfig) string {
	var headers []string
	if config != nil && len(config.ProxyHeaders) > 0 {
		headers = config.ProxyHeaders
	} else {
		headers = []string{"Cf-Connecting-Ip", "X-Forwarded-For", "X-Real-Ip"}
	}

	trustProxy := config == nil || config.TrustProxy

	if trustProxy {
		for _, header := range headers {
			value := r.Header.Get(header)
			if value != "" {
				// X-Forwarded-For can contain multiple IPs, take the first one
				if strings.Contains(value, ",") {
					value = strings.TrimSpace(strings.Split(value, ",")[0])
				}
				return value
			}
		}
	}

	// Fall back to RemoteAddr
	ip := r.RemoteAddr
	// RemoteAddr might include port, strip it
	if colonIdx := strings.LastIndex(ip, ":"); colonIdx != -1 {
		// Check if it's IPv6 [::1]:port format
		if ip[0] == '[' {
			if bracketIdx := strings.Index(ip, "]"); bracketIdx != -1 {
				ip = ip[1:bracketIdx]
			}
		} else {
			ip = ip[:colonIdx]
		}
	}

	return ip
}

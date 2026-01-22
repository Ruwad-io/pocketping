package pocketping

import (
	"fmt"
	"strconv"
	"strings"
)

// SDKVersion is the current version of the Go SDK.
const SDKVersion = "0.1.0"

// Version represents a parsed semantic version.
type Version struct {
	Major int
	Minor int
	Patch int
}

// ParseVersion parses a semver string into a Version struct.
// Supports formats like "0.2.1", "v0.2.1", "1.0.0-beta".
func ParseVersion(version string) Version {
	// Remove leading 'v' if present
	version = strings.TrimPrefix(version, "v")

	// Split on '-' to handle pre-release versions
	version = strings.Split(version, "-")[0]

	parts := strings.Split(version, ".")
	v := Version{}

	if len(parts) > 0 {
		v.Major, _ = strconv.Atoi(parts[0])
	}
	if len(parts) > 1 {
		v.Minor, _ = strconv.Atoi(parts[1])
	}
	if len(parts) > 2 {
		v.Patch, _ = strconv.Atoi(parts[2])
	}

	return v
}

// Compare compares two versions.
// Returns -1 if v < other, 0 if v == other, 1 if v > other.
func (v Version) Compare(other Version) int {
	if v.Major < other.Major {
		return -1
	}
	if v.Major > other.Major {
		return 1
	}
	if v.Minor < other.Minor {
		return -1
	}
	if v.Minor > other.Minor {
		return 1
	}
	if v.Patch < other.Patch {
		return -1
	}
	if v.Patch > other.Patch {
		return 1
	}
	return 0
}

// String returns the version as a string.
func (v Version) String() string {
	return fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch)
}

// CompareVersions compares two version strings.
// Returns -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2.
func CompareVersions(v1, v2 string) int {
	return ParseVersion(v1).Compare(ParseVersion(v2))
}

// CheckWidgetVersion checks widget version against configured min/latest versions.
func CheckWidgetVersion(widgetVersion string, minVersion string, latestVersion string, customMessage string) VersionCheckResult {
	// No version header = unknown (treat as OK for compatibility)
	if widgetVersion == "" {
		return VersionCheckResult{
			Status:        VersionStatusOK,
			CanContinue:   true,
			MinVersion:    minVersion,
			LatestVersion: latestVersion,
		}
	}

	// No version constraints configured
	if minVersion == "" && latestVersion == "" {
		return VersionCheckResult{
			Status:      VersionStatusOK,
			CanContinue: true,
		}
	}

	widgetVer := ParseVersion(widgetVersion)

	// Check against minimum version
	if minVersion != "" {
		minVer := ParseVersion(minVersion)
		if widgetVer.Compare(minVer) < 0 {
			message := customMessage
			if message == "" {
				message = fmt.Sprintf("Widget version %s is no longer supported. Minimum version: %s", widgetVersion, minVersion)
			}
			return VersionCheckResult{
				Status:        VersionStatusUnsupported,
				Message:       message,
				MinVersion:    minVersion,
				LatestVersion: latestVersion,
				CanContinue:   false,
			}
		}
	}

	// Check against latest version (for deprecation warnings)
	if latestVersion != "" {
		latestVer := ParseVersion(latestVersion)
		if widgetVer.Compare(latestVer) < 0 {
			// Check how far behind
			if widgetVer.Major < latestVer.Major {
				// Major version behind = deprecated
				message := customMessage
				if message == "" {
					message = fmt.Sprintf("Widget version %s is deprecated. Please update to %s", widgetVersion, latestVersion)
				}
				return VersionCheckResult{
					Status:        VersionStatusDeprecated,
					Message:       message,
					MinVersion:    minVersion,
					LatestVersion: latestVersion,
					CanContinue:   true,
				}
			}

			// Minor/patch behind = just outdated (info only)
			return VersionCheckResult{
				Status:        VersionStatusOutdated,
				Message:       fmt.Sprintf("A newer widget version %s is available", latestVersion),
				MinVersion:    minVersion,
				LatestVersion: latestVersion,
				CanContinue:   true,
			}
		}
	}

	return VersionCheckResult{
		Status:        VersionStatusOK,
		MinVersion:    minVersion,
		LatestVersion: latestVersion,
		CanContinue:   true,
	}
}

// GetVersionHeaders returns HTTP headers to set for version information.
func GetVersionHeaders(result VersionCheckResult) map[string]string {
	headers := map[string]string{
		"X-PocketPing-Version-Status": string(result.Status),
	}

	if result.MinVersion != "" {
		headers["X-PocketPing-Min-Version"] = result.MinVersion
	}

	if result.LatestVersion != "" {
		headers["X-PocketPing-Latest-Version"] = result.LatestVersion
	}

	if result.Message != "" {
		headers["X-PocketPing-Version-Message"] = result.Message
	}

	return headers
}

// CreateVersionWarning creates a version warning for WebSocket notification.
func CreateVersionWarning(result VersionCheckResult, currentVersion string, upgradeURL string) VersionWarning {
	severity := "info"
	switch result.Status {
	case VersionStatusDeprecated:
		severity = "warning"
	case VersionStatusUnsupported:
		severity = "error"
	}

	if upgradeURL == "" {
		upgradeURL = "https://docs.pocketping.io/widget/installation"
	}

	return VersionWarning{
		Severity:       severity,
		Message:        result.Message,
		CurrentVersion: currentVersion,
		MinVersion:     result.MinVersion,
		LatestVersion:  result.LatestVersion,
		CanContinue:    result.CanContinue,
		UpgradeURL:     upgradeURL,
	}
}

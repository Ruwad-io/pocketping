# frozen_string_literal: true

module PocketPing
  # Version checking utilities for widget compatibility
  module VersionChecker
    module_function

    # Parse a semver string into a comparable array
    #
    # @param version [String] Version string (e.g., "0.2.1", "v1.0.0")
    # @return [Array<Integer>] [major, minor, patch]
    #
    # @example
    #   parse_version("0.2.1") # => [0, 2, 1]
    #   parse_version("v1.0.0") # => [1, 0, 0]
    #   parse_version("1.2.3-beta") # => [1, 2, 3]
    def parse_version(version)
      return [0, 0, 0] if version.nil? || version.empty?

      # Remove leading 'v' and split by '.'
      parts = version.gsub(/^v/, "").split(".")

      [
        parts[0]&.to_i || 0,
        parts[1]&.to_i || 0,
        parts[2]&.split("-")&.first&.to_i || 0 # Handle pre-release versions
      ]
    end

    # Compare two semver strings
    #
    # @param v1 [String] First version
    # @param v2 [String] Second version
    # @return [Integer] -1 if v1 < v2, 0 if equal, 1 if v1 > v2
    #
    # @example
    #   compare_versions("0.2.0", "0.3.0") # => -1
    #   compare_versions("1.0.0", "1.0.0") # => 0
    #   compare_versions("2.0.0", "1.0.0") # => 1
    def compare_versions(v1, v2)
      p1 = parse_version(v1)
      p2 = parse_version(v2)

      p1 <=> p2
    end

    # Check widget version against configured requirements
    #
    # @param widget_version [String, nil] Version from X-PocketPing-Version header
    # @param min_version [String, nil] Minimum supported version
    # @param latest_version [String, nil] Latest available version
    # @param warning_message [String, nil] Custom warning message
    # @return [VersionCheckResult] Result with status and message
    def check_version(widget_version, min_version: nil, latest_version: nil, warning_message: nil)
      # No version provided - allow but could be unknown
      if widget_version.nil? || widget_version.empty?
        return VersionCheckResult.new(
          status: VersionStatus::OK,
          min_version: min_version,
          latest_version: latest_version,
          can_continue: true
        )
      end

      # No version constraints configured
      if min_version.nil? && latest_version.nil?
        return VersionCheckResult.new(
          status: VersionStatus::OK,
          min_version: nil,
          latest_version: nil,
          can_continue: true
        )
      end

      # Check against minimum version
      if min_version && compare_versions(widget_version, min_version) < 0
        default_msg = "Widget version #{widget_version} is no longer supported. " \
                      "Please upgrade to #{min_version} or later."

        return VersionCheckResult.new(
          status: VersionStatus::UNSUPPORTED,
          message: warning_message || default_msg,
          min_version: min_version,
          latest_version: latest_version,
          can_continue: false
        )
      end

      # Check if outdated (behind latest)
      if latest_version && compare_versions(widget_version, latest_version) < 0
        current = parse_version(widget_version)
        latest = parse_version(latest_version)

        if current[0] < latest[0]
          # Major version behind - deprecated
          default_msg = "Widget version #{widget_version} is deprecated. " \
                        "Please upgrade to #{latest_version}."

          return VersionCheckResult.new(
            status: VersionStatus::DEPRECATED,
            message: warning_message || default_msg,
            min_version: min_version,
            latest_version: latest_version,
            can_continue: true
          )
        else
          # Minor/patch behind - outdated (info only)
          return VersionCheckResult.new(
            status: VersionStatus::OUTDATED,
            message: "A newer widget version (#{latest_version}) is available.",
            min_version: min_version,
            latest_version: latest_version,
            can_continue: true
          )
        end
      end

      # Version is OK
      VersionCheckResult.new(
        status: VersionStatus::OK,
        min_version: min_version,
        latest_version: latest_version,
        can_continue: true
      )
    end

    # Get HTTP headers for version information
    #
    # @param version_check [VersionCheckResult] Result from check_version
    # @return [Hash<String, String>] Header name => value
    def get_version_headers(version_check)
      headers = {
        "X-PocketPing-Version-Status" => version_check.status
      }

      headers["X-PocketPing-Min-Version"] = version_check.min_version if version_check.min_version
      headers["X-PocketPing-Latest-Version"] = version_check.latest_version if version_check.latest_version
      headers["X-PocketPing-Version-Message"] = version_check.message if version_check.message

      headers
    end

    # Get severity level for a version status
    #
    # @param status [String] Version status
    # @return [String] Severity level (info, warning, error)
    def severity_for_status(status)
      case status
      when VersionStatus::UNSUPPORTED
        "error"
      when VersionStatus::DEPRECATED
        "warning"
      else
        "info"
      end
    end

    # Create a version warning object for WebSocket broadcast
    #
    # @param version_check [VersionCheckResult] Result from check_version
    # @param current_version [String] The widget's current version
    # @param upgrade_url [String, nil] URL to upgrade instructions
    # @return [VersionWarning]
    def create_version_warning(version_check, current_version, upgrade_url: nil)
      VersionWarning.new(
        severity: severity_for_status(version_check.status),
        message: version_check.message || "",
        current_version: current_version,
        min_version: version_check.min_version,
        latest_version: version_check.latest_version,
        can_continue: version_check.can_continue,
        upgrade_url: upgrade_url || "https://docs.pocketping.io/widget/installation"
      )
    end
  end
end

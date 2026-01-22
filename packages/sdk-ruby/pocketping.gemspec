# frozen_string_literal: true

require_relative "lib/pocketping/version"

Gem::Specification.new do |spec|
  spec.name = "pocketping"
  spec.version = PocketPing::VERSION
  spec.authors = ["PocketPing Team"]
  spec.email = ["support@pocketping.io"]

  spec.summary = "Ruby SDK for PocketPing - real-time customer chat with mobile notifications"
  spec.description = "PocketPing SDK enables real-time customer chat with AI fallback, " \
                     "notification bridges (Telegram, Discord, Slack), and seamless integration " \
                     "with Ruby applications."
  spec.homepage = "https://github.com/Ruwad-io/pocketping"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.1.0"

  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = "https://github.com/Ruwad-io/pocketping/tree/main/packages/sdk-ruby"
  spec.metadata["changelog_uri"] = "https://github.com/Ruwad-io/pocketping/blob/main/packages/sdk-ruby/CHANGELOG.md"
  spec.metadata["documentation_uri"] = "https://docs.pocketping.io/sdks/ruby"
  spec.metadata["rubygems_mfa_required"] = "true"

  # Specify which files should be added to the gem
  spec.files = Dir[
    "lib/**/*.rb",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ]

  spec.bindir = "exe"
  spec.executables = spec.files.grep(%r{\Aexe/}) { |f| File.basename(f) }
  spec.require_paths = ["lib"]

  # Runtime dependencies
  spec.add_dependency "async", "~> 2.0"
  spec.add_dependency "securerandom", "~> 0.3"

  # Optional dependencies (for specific features)
  # spec.add_dependency "faraday", "~> 2.0"  # For HTTP requests (webhooks)
  # spec.add_dependency "faye-websocket", "~> 0.11"  # For WebSocket support

  # Development dependencies
  spec.add_development_dependency "bundler", "~> 2.0"
  spec.add_development_dependency "rake", "~> 13.0"
  spec.add_development_dependency "rspec", "~> 3.12"
  spec.add_development_dependency "rubocop", "~> 1.50"
  spec.add_development_dependency "rubocop-rspec", "~> 3.9"
  spec.add_development_dependency "simplecov", "~> 0.22"
  spec.add_development_dependency "webmock", "~> 3.18"
  spec.add_development_dependency "yard", "~> 0.9"
end

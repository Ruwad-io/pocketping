# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-01-22

### Added

- Initial release of PocketPing Ruby SDK
- Session management (connect, create, resume)
- Message handling (visitor, operator, AI)
- Read receipts (delivered, read status)
- User identification (identify, custom fields)
- Custom events (bidirectional communication)
- Tracked elements support (SaaS auto-tracking)
- Version management (check widget compatibility)
- WebSocket connection management
- Bridge interface for notification channels
- Memory storage adapter
- Webhook forwarding with HMAC signatures
- Comprehensive test suite with RSpec

### Features

- Ruby 3.1+ support with modern patterns
- Frozen string literals for performance
- Thread-safe memory storage
- Keyword arguments throughout
- Proper module namespacing (PocketPing::)
- Feature parity with sdk-node and sdk-python

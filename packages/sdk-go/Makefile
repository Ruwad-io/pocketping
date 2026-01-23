.PHONY: test lint lint-fix fmt build clean

# Run tests
test:
	go test -v -race ./...

# Run tests with coverage
test-coverage:
	go test -v -race -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html

# Run linter
lint:
	golangci-lint run

# Run linter with auto-fix
lint-fix:
	golangci-lint run --fix

# Format code
fmt:
	go fmt ./...
	goimports -w .

# Build
build:
	go build ./...

# Clean
clean:
	rm -f coverage.out coverage.html

# Install dev dependencies
setup:
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	go install golang.org/x/tools/cmd/goimports@latest

# Run all checks (lint + test)
check: lint test

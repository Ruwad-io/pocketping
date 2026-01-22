# PocketPing Makefile
# Development and testing commands

.PHONY: dev dev-up dev-down dev-logs dev-build \
        test test-all test-node test-python test-go test-php test-ruby \
        test-e2e clean help

# ─────────────────────────────────────────────────────────────────
# Development Environment
# ─────────────────────────────────────────────────────────────────

# Start dev environment (demo + bridge + watchers)
dev:
	docker compose -f docker-compose.dev.yml up --build

# Start dev with all SDK watchers (Python, Go, PHP, Ruby)
dev-sdk-all:
	docker compose -f docker-compose.dev.yml --profile sdk-all up --build

# Start individual SDK watchers
dev-node:
	docker compose -f docker-compose.dev.yml up --build sdk-watcher

dev-python:
	docker compose -f docker-compose.dev.yml --profile sdk-all up --build sdk-python-watcher

dev-go:
	docker compose -f docker-compose.dev.yml --profile sdk-all up --build sdk-go-watcher

dev-php:
	docker compose -f docker-compose.dev.yml --profile sdk-all up --build sdk-php-watcher

dev-ruby:
	docker compose -f docker-compose.dev.yml --profile sdk-all up --build sdk-ruby-watcher

# Start dev with docs site
dev-docs:
	docker compose -f docker-compose.dev.yml --profile docs up --build

# Start in background
dev-up:
	docker compose -f docker-compose.dev.yml up -d --build

# Stop dev environment
dev-down:
	docker compose -f docker-compose.dev.yml down

# View logs
dev-logs:
	docker compose -f docker-compose.dev.yml logs -f

# Rebuild containers
dev-build:
	docker compose -f docker-compose.dev.yml build --no-cache

# ─────────────────────────────────────────────────────────────────
# SDK Unit Tests
# ─────────────────────────────────────────────────────────────────

# Run all SDK tests in parallel
test-all:
	docker compose -f packages/docker-compose.test.yml up --build --abort-on-container-exit

# Run specific SDK tests
test-node:
	docker compose -f packages/docker-compose.test.yml up --build sdk-node

test-python:
	docker compose -f packages/docker-compose.test.yml up --build sdk-python

test-go:
	docker compose -f packages/docker-compose.test.yml up --build sdk-go

test-php:
	docker compose -f packages/docker-compose.test.yml up --build sdk-php

test-ruby:
	docker compose -f packages/docker-compose.test.yml up --build sdk-ruby

# Shortcut for all unit tests
test: test-all

# Run tests with fresh containers (no cache)
test-fresh:
	docker compose -f packages/docker-compose.test.yml build --no-cache
	docker compose -f packages/docker-compose.test.yml up --abort-on-container-exit

# ─────────────────────────────────────────────────────────────────
# E2E Tests (Playwright)
# ─────────────────────────────────────────────────────────────────

test-e2e:
	docker compose -f docker-compose.dev.yml --profile e2e up --build --abort-on-container-exit e2e

# ─────────────────────────────────────────────────────────────────
# Cleanup
# ─────────────────────────────────────────────────────────────────

# Clean up all Docker resources
clean:
	docker compose -f packages/docker-compose.test.yml down --rmi local -v
	docker compose -f docker-compose.dev.yml down --rmi local -v

# ─────────────────────────────────────────────────────────────────
# Help
# ─────────────────────────────────────────────────────────────────

help:
	@echo "PocketPing Development Commands"
	@echo ""
	@echo "Development:"
	@echo "  make dev          Start dev environment (demo + bridge + Node/Widget watchers)"
	@echo "  make dev-sdk-all  Start with all SDK watchers (Python, Go, PHP, Ruby)"
	@echo "  make dev-node     Start Node SDK watcher only"
	@echo "  make dev-python   Start Python SDK watcher"
	@echo "  make dev-go       Start Go SDK watcher"
	@echo "  make dev-php      Start PHP SDK watcher"
	@echo "  make dev-ruby     Start Ruby SDK watcher"
	@echo "  make dev-docs     Start dev environment with docs site"
	@echo "  make dev-up       Start dev environment in background"
	@echo "  make dev-down     Stop dev environment"
	@echo "  make dev-logs     View dev logs"
	@echo "  make dev-build    Rebuild dev containers"
	@echo ""
	@echo "Unit Tests:"
	@echo "  make test         Run all SDK tests"
	@echo "  make test-node    Run Node.js SDK tests"
	@echo "  make test-python  Run Python SDK tests"
	@echo "  make test-go      Run Go SDK tests"
	@echo "  make test-php     Run PHP SDK tests"
	@echo "  make test-ruby    Run Ruby SDK tests"
	@echo "  make test-fresh   Run tests with no Docker cache"
	@echo ""
	@echo "E2E Tests:"
	@echo "  make test-e2e     Run Playwright e2e tests"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean        Remove all Docker containers and images"
	@echo ""
	@echo "Services (when running 'make dev'):"
	@echo "  Demo:   http://localhost:3000"
	@echo "  Bridge: http://localhost:3001"
	@echo "  Widget: http://localhost:5173"
	@echo "  Docs:   http://localhost:3002 (with --profile docs)"

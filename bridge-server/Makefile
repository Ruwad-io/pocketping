.PHONY: build run test lint clean docker

# Build the server
build:
	go build -o bin/bridge-server ./cmd/server

# Run the server
run:
	go run ./cmd/server

# Run tests
test:
	go test -v ./...

# Run linter
lint:
	golangci-lint run ./...

# Format code
fmt:
	go fmt ./...
	goimports -w .

# Clean build artifacts
clean:
	rm -rf bin/

# Build Docker image
docker:
	docker build -t pocketping/bridge-server-go .

# Run with Docker
docker-run:
	docker run --env-file .env -p 3001:3001 pocketping/bridge-server-go

# Download dependencies
deps:
	go mod download
	go mod tidy

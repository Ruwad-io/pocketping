# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /build

# Copy sdk-go first (dependency)
COPY packages/sdk-go ./packages/sdk-go

# Copy bridge-server
COPY bridge-server/go.mod bridge-server/go.sum* ./bridge-server/

WORKDIR /build/bridge-server

# Download dependencies
RUN go mod download

# Copy source
COPY bridge-server/ .

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /bridge-server ./cmd/server

# Runtime stage
FROM alpine:3.19

RUN apk --no-cache add ca-certificates curl

WORKDIR /app

COPY --from=builder /bridge-server .

EXPOSE 3001

CMD ["./bridge-server"]

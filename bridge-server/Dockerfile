# PocketPing Bridge Server Dockerfile
# Pin to specific Bun version for reproducible builds
# Use Debian-based image to match runtime libc (avoids musl/glibc incompatibility)
FROM oven/bun:1.3.6-debian as builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Build (compile to single file)
RUN bun build src/index.ts --compile --outfile bridge-server

# Production image - pin to specific version
FROM debian:bookworm-20250113-slim

# Install CA certificates for HTTPS requests
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary
COPY --from=builder /app/bridge-server ./bridge-server

# Expose port
EXPOSE 3001

# Run the server
CMD ["./bridge-server"]

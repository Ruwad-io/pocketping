---
sidebar_position: 4
title: Docker Deployment
description: Deploy the PocketPing bridge server with Docker
---

# Docker Deployment

Deploy the PocketPing bridge server using Docker for production use.

## Quick Start

```bash
docker run -d \
  --name pocketping-bridge \
  -p 3001:3001 \
  -e TELEGRAM_BOT_TOKEN=your_token \
  -e TELEGRAM_FORUM_CHAT_ID=your_chat_id \
  ghcr.io/pocketping/pocketping-bridge:latest
```

## Docker Compose

For production, use Docker Compose:

```yaml title="docker-compose.yml"
services:
  bridge:
    image: ghcr.io/pocketping/pocketping-bridge:latest
    container_name: pocketping-bridge
    ports:
      - "3001:3001"
    environment:
      # Server
      - PORT=3001
      - API_KEY=${API_KEY}

      # Telegram (optional)
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_FORUM_CHAT_ID=${TELEGRAM_FORUM_CHAT_ID}

      # Discord (optional)
      - DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
      - DISCORD_CHANNEL_ID=${DISCORD_CHANNEL_ID}

      # Slack (optional)
      - SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}
      - SLACK_CHANNEL_ID=${SLACK_CHANNEL_ID}

      # AI (optional)
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - AI_SYSTEM_PROMPT=${AI_SYSTEM_PROMPT}

    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

Create a `.env` file:

```bash title=".env"
API_KEY=your_secret_api_key

# Telegram
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_FORUM_CHAT_ID=-1001234567890

# Discord
DISCORD_BOT_TOKEN=your_discord_token
DISCORD_CHANNEL_ID=123456789012345678
```

Run:

```bash
docker compose up -d
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3001) |
| `API_KEY` | No | Secret key for API authentication |
| `TELEGRAM_BOT_TOKEN` | If using Telegram | Bot token from BotFather |
| `TELEGRAM_FORUM_CHAT_ID` | If using Telegram | Supergroup ID (starts with -100) |
| `DISCORD_BOT_TOKEN` | If using Discord | Discord bot token |
| `DISCORD_CHANNEL_ID` | If using Discord | Channel ID for threads |
| `SLACK_BOT_TOKEN` | If using Slack | Slack bot token (xoxb-) |
| `SLACK_CHANNEL_ID` | If using Slack | Slack channel ID |
| `OPENAI_API_KEY` | If using AI | OpenAI API key for AI fallback |

## With Traefik (HTTPS)

```yaml title="docker-compose.yml"
services:
  bridge:
    image: ghcr.io/pocketping/pocketping-bridge:latest
    environment:
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_FORUM_CHAT_ID=${TELEGRAM_FORUM_CHAT_ID}
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.pocketping.rule=Host(`bridge.yourdomain.com`)"
      - "traefik.http.routers.pocketping.tls.certresolver=letsencrypt"
    restart: unless-stopped

  traefik:
    image: traefik:v2.10
    command:
      - "--providers.docker=true"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.tlschallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.email=you@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "443:443"
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
      - "./letsencrypt:/letsencrypt"
```

## Health Checks

The bridge server exposes a health endpoint:

```bash
curl http://localhost:3001/health
# {"status":"ok","bridges":{"telegram":true,"discord":false,"slack":false}}
```

## Logs

View logs:

```bash
docker logs pocketping-bridge -f
```

## Updating

```bash
docker compose pull
docker compose up -d
```

## Next Steps

- [Telegram Setup](/bridges/telegram) - Configure Telegram bridge
- [Discord Setup](/bridges/discord) - Configure Discord bridge
- [Self-Hosting](/self-hosting) - Full self-hosting guide

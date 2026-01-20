---
slug: /
sidebar_position: 1
title: Introduction
---

# PocketPing Documentation

Welcome to the PocketPing documentation! PocketPing is an open-source customer chat solution that sends instant notifications to your phone via Telegram, Discord, or Slack.

## What is PocketPing?

Unlike traditional live chat tools that require you to keep a dashboard open, PocketPing brings conversations to where you already are. Get notified on your phone, reply from any platform, and never miss a customer message.

## Key Features

- **Mobile-first notifications** - Get instant alerts on Telegram, Discord, or Slack
- **Lightweight widget** - Only 7KB gzipped, built with Preact
- **AI fallback** - Let AI handle conversations when you're unavailable
- **Self-hosted option** - Keep your data on your own servers
- **Multi-platform sync** - Reply from any bridge, all stay in sync

## Architecture Overview

PocketPing consists of three main components:

```
┌─────────────────┐     WebSocket/HTTP     ┌──────────────────┐
│   Chat Widget   │◄─────────────────────► │   Bridge Server  │
│    (Preact)     │                        │     (Bun.js)     │
└─────────────────┘                        └────────┬─────────┘
                                                    │
                          ┌────────────────────────┼────────────────────────┐
                          ▼                        ▼                        ▼
                    ┌──────────┐            ┌──────────┐            ┌──────────┐
                    │ Telegram │            │ Discord  │            │  Slack   │
                    └──────────┘            └──────────┘            └──────────┘
```

1. **Widget** - The chat interface embedded on your website
2. **Bridge Server** - Manages notifications and routes messages
3. **Bridges** - Platform connectors for Telegram, Discord, and Slack

## Getting Started

Choose your path:

- **[Quick Start](/quickstart)** - Get running in 5 minutes with the hosted SaaS
- **[Self-Hosting Guide](/self-hosting)** - Deploy on your own infrastructure
- **[API Reference](/api)** - Full protocol specification

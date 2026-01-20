---
sidebar_position: 9
title: API Reference
description: Complete REST API documentation for PocketPing
---

# API Reference

Complete REST API documentation for the PocketPing bridge server.

## Base URL

- **SaaS**: `https://api.pocketping.io/v1`
- **Self-hosted**: `http://localhost:3001` (or your bridge URL)

## Authentication

Include your API key in the header:

```bash
Authorization: Bearer your_api_key
```

## Endpoints

### Sessions

#### List Sessions

```http
GET /sessions
```

Response:

```json
{
  "sessions": [
    {
      "id": "sess_abc123",
      "visitorId": "vis_xyz789",
      "projectId": "proj_def456",
      "status": "active",
      "createdAt": "2024-01-15T10:30:00Z",
      "lastActivity": "2024-01-15T10:35:00Z",
      "metadata": {
        "pageUrl": "https://example.com/pricing",
        "userAgent": "Mozilla/5.0..."
      }
    }
  ]
}
```

#### Get Session

```http
GET /sessions/:sessionId
```

#### Close Session

```http
POST /sessions/:sessionId/close
```

### Messages

#### List Messages

```http
GET /sessions/:sessionId/messages
```

Response:

```json
{
  "messages": [
    {
      "id": "msg_001",
      "sessionId": "sess_abc123",
      "content": "Hello, I have a question",
      "type": "visitor",
      "createdAt": "2024-01-15T10:30:00Z"
    },
    {
      "id": "msg_002",
      "sessionId": "sess_abc123",
      "content": "Hi! How can I help?",
      "type": "operator",
      "createdAt": "2024-01-15T10:31:00Z"
    }
  ]
}
```

#### Send Message

```http
POST /sessions/:sessionId/messages
```

Request:

```json
{
  "content": "Thanks for reaching out!",
  "type": "operator"
}
```

### Visitor Identification

#### Identify Visitor

```http
POST /sessions/:sessionId/identify
```

Request:

```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "customerId": "cust_123",
  "metadata": {
    "plan": "pro",
    "company": "Acme Inc"
  }
}
```

### AI Control

#### Toggle AI

```http
POST /sessions/:sessionId/ai
```

Request:

```json
{
  "enabled": false
}
```

### WebSocket

Connect to receive real-time updates:

```javascript
const ws = new WebSocket('wss://api.pocketping.io/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    apiKey: 'your_api_key'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'session.created':
      console.log('New session:', data.session);
      break;
    case 'message.created':
      console.log('New message:', data.message);
      break;
    case 'session.closed':
      console.log('Session closed:', data.sessionId);
      break;
  }
};
```

## Message Types

| Type | Description |
|------|-------------|
| `visitor` | Message from website visitor |
| `operator` | Message from human operator |
| `ai` | Message from AI fallback |
| `system` | System message (e.g., "Session closed") |

## Error Responses

```json
{
  "error": "Not found",
  "message": "Session not found",
  "code": "SESSION_NOT_FOUND"
}
```

| Status | Description |
|--------|-------------|
| 400 | Bad request (invalid parameters) |
| 401 | Unauthorized (missing or invalid API key) |
| 404 | Not found |
| 429 | Rate limited |
| 500 | Internal server error |

## Rate Limits

- **SaaS Free**: 100 requests/minute
- **SaaS Pro**: 1000 requests/minute
- **SaaS Team**: 10000 requests/minute
- **Self-hosted**: No limits

## Webhooks

Configure webhooks to receive events:

```http
POST /webhooks
```

Request:

```json
{
  "url": "https://yoursite.com/webhook",
  "events": ["session.created", "message.created", "session.closed"]
}
```

Webhook payload:

```json
{
  "event": "message.created",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "sessionId": "sess_abc123",
    "message": {
      "id": "msg_001",
      "content": "Hello!",
      "type": "visitor"
    }
  }
}
```

## SDKs

For easier integration, use our official SDKs:

- [Node.js SDK](/sdk/nodejs)
- [Python SDK](/sdk/python)

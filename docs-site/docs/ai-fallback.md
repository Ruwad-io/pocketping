---
sidebar_position: 8
title: AI Fallback
description: Configure AI to handle conversations when you're unavailable
---

# AI Fallback

Let AI handle customer conversations when you're away or busy.

## How It Works

1. Customer sends a message
2. If you don't respond within X minutes, AI takes over
3. AI responds based on your custom prompt and context
4. You can take over anytime by sending a message
5. All AI responses are marked so customers know

## Configuration

### SaaS Users

Go to your [AI Settings](https://app.pocketping.io/settings/ai) to configure:

- Enable/disable AI fallback
- Set response delay (how long to wait before AI responds)
- Customize the AI system prompt
- Set business hours (AI only active outside hours)

### Self-Hosted Users

Add to your `.env` file:

```bash title=".env"
# OpenAI API key
OPENAI_API_KEY=sk-...

# AI Configuration
AI_ENABLED=true
AI_RESPONSE_DELAY=60  # seconds
AI_MODEL=gpt-4o-mini  # or gpt-4o

# Custom system prompt
AI_SYSTEM_PROMPT="You are a helpful customer support agent for Acme Inc. Be friendly and concise. If you don't know something, say so."
```

## Custom System Prompt

Write a prompt that defines your AI's personality and knowledge:

```text
You are a friendly customer support agent for PocketPing, a customer chat tool.

Key information:
- PocketPing costs $19/month for Pro, $49/month for Team
- Free tier includes 100 sessions per month
- We support Telegram, Discord, and Slack

Guidelines:
- Be concise and helpful
- If asked about pricing, provide the above information
- If you don't know something, say "I'll have a team member get back to you"
- Never make up features or pricing
```

## Context Variables

Include dynamic context in your prompts:

```text
You are helping a visitor on {{page_url}}.

Visitor info:
- Name: {{visitor_name}}
- Email: {{visitor_email}}
- Plan: {{visitor_plan}}

Previous messages in this conversation are provided below.
```

Available variables:
- `{{page_url}}` - Current page URL
- `{{visitor_name}}` - Visitor name (if identified)
- `{{visitor_email}}` - Visitor email (if identified)
- `{{visitor_plan}}` - Customer plan (if identified)
- `{{company_name}}` - Your company name
- `{{current_time}}` - Current time

## Business Hours

Configure AI to only respond outside business hours:

```bash title=".env"
AI_BUSINESS_HOURS_ONLY=true
AI_BUSINESS_START=09:00
AI_BUSINESS_END=17:00
AI_BUSINESS_TIMEZONE=America/New_York
AI_BUSINESS_DAYS=1,2,3,4,5  # Monday to Friday
```

## Manual Override

### From Telegram

In a conversation topic, use:

```
/ai off   # Disable AI for this conversation
/ai on    # Re-enable AI for this conversation
```

### From Discord

```
/ai off
/ai on
```

### From the API

```bash
POST /api/sessions/{sessionId}/ai
{
  "enabled": false
}
```

## Monitoring AI Responses

All AI responses include metadata:

```json
{
  "id": "msg_xxx",
  "content": "Hello! I'd be happy to help...",
  "type": "ai",
  "metadata": {
    "ai_model": "gpt-4o-mini",
    "ai_latency_ms": 1234
  }
}
```

In Telegram/Discord, AI responses are prefixed with 🤖.

## Best Practices

1. **Start with a delay** - Give yourself 1-2 minutes to respond before AI kicks in
2. **Be specific in prompts** - Include pricing, features, and common questions
3. **Set boundaries** - Tell AI what it shouldn't do (e.g., don't promise refunds)
4. **Monitor responses** - Review AI conversations periodically
5. **Use business hours** - Let AI handle off-hours inquiries

## Example Prompts

### E-commerce Support

```text
You are a customer support agent for an online store.

Handle these common questions:
- Shipping: We ship within 2-3 business days. Free shipping over $50.
- Returns: 30-day return policy. Items must be unused.
- Order status: Direct customers to check their email for tracking.

For refund or complaint issues, say "I'll have our team look into this right away."
```

### SaaS Support

```text
You are a support agent for a SaaS product.

Pricing:
- Free: Up to 5 users
- Pro ($29/mo): Up to 25 users
- Enterprise: Contact sales

For technical issues, collect details and say a developer will follow up.
```

## Next Steps

- [API Reference](/api) - Full API documentation
- [Self-Hosting](/self-hosting) - Deploy your own instance

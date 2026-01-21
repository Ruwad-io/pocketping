---
sidebar_position: 8
title: AI Fallback
description: Configure AI to handle conversations when you're unavailable
---

# AI Fallback

Let AI handle customer conversations when you're away or busy. Never miss a lead again.

```
┌─────────────────────────────────────────────────────────────────┐
│                    HOW AI FALLBACK WORKS                         │
│                                                                 │
│   1. Visitor sends message                                      │
│      │                                                          │
│      ▼                                                          │
│   2. Message delivered to Telegram/Discord/Slack                │
│      │                                                          │
│      ▼                                                          │
│   3. Timer starts (configurable, default: 2 min)                │
│      │                                                          │
│      ├──► You reply within time?                                │
│      │           │                                              │
│      │           └──► Normal conversation (AI stays off)        │
│      │                                                          │
│      └──► No reply?                                             │
│                  │                                              │
│                  ▼                                              │
│   4. AI takes over                                              │
│      ├── Uses your custom instructions                          │
│      ├── References conversation history                        │
│      └── Responds as your brand                                 │
│                                                                 │
│   5. You can jump back in anytime                               │
│      └── Send a message → AI stops for this conversation        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Why Use AI Fallback?

| Scenario | Without AI | With AI Fallback |
|----------|------------|------------------|
| After hours | Visitor waits until morning | Instant response, even at 3am |
| High volume | Some chats get delayed | Every visitor gets immediate attention |
| You're in a meeting | Visitor leaves frustrated | AI handles it, you review later |
| Weekend inquiry | Lost lead | AI qualifies and schedules follow-up |

---

## Configuration

### SaaS Users

1. Go to [app.pocketping.io/settings/ai](https://app.pocketping.io/settings/ai)
2. Toggle "Enable AI Fallback"
3. Configure:
   - **Response delay:** Wait before AI responds
   - **System prompt:** AI's personality and knowledge
   - **Business hours:** When AI should activate

### Self-Hosted Users

Add to your `.env` file:

```bash title=".env"
# Required: OpenAI API key
OPENAI_API_KEY=sk-...

# AI Configuration
AI_ENABLED=true
AI_RESPONSE_DELAY=120          # Seconds to wait (default: 120 = 2 min)
AI_MODEL=gpt-4o-mini           # gpt-4o-mini (fast) or gpt-4o (powerful)

# Custom system prompt (see below)
AI_SYSTEM_PROMPT="You are a helpful support agent for Acme Inc..."
```

Then restart your bridge server:

```bash
docker compose restart bridge
```

---

## System Prompt

The system prompt defines your AI's personality, knowledge, and behavior.

### Basic Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ Good system prompts have:                                       │
│                                                                 │
│ 1. Role definition      → "You are a support agent for X..."   │
│ 2. Knowledge/facts      → Pricing, features, policies          │
│ 3. Behavior guidelines  → Tone, what to do/not do              │
│ 4. Escalation rules     → When to hand off to human            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Example Prompt

```text
You are a friendly customer support agent for PocketPing, a customer chat tool.

## About PocketPing
- Chat widget for websites (~14KB gzipped, very lightweight)
- Messages go to Telegram, Discord, and Slack
- AI fallback when team is away (that's you!)
- Plans: Free (100 sessions/mo), Pro ($19/mo), Team ($49/mo)

## Your Guidelines
- Be concise and helpful (2-3 sentences per response)
- Be friendly but professional
- If you don't know something, say "I'll have a team member follow up"
- Never make up features or pricing
- Don't discuss competitors

## Common Questions
Q: How do I install the widget?
A: Add 2 lines of code before </body>. See docs.pocketping.io/quickstart

Q: Do you have a free tier?
A: Yes! Free includes 100 sessions/month. Upgrade to Pro for unlimited.

Q: Can I self-host?
A: Yes, we offer a self-hosted option. See docs.pocketping.io/self-hosting

## Escalation
For these topics, say you'll connect them with the team:
- Billing disputes or refund requests
- Technical bugs or errors
- Enterprise pricing negotiations
- Security or compliance questions
```

---

## Context Variables

Include dynamic information in your prompts:

```text
You are helping a visitor on {{page_url}}.

Visitor info:
- Name: {{visitor_name}}
- Email: {{visitor_email}}
- Plan: {{visitor_plan}}
- Location: {{visitor_country}}

Current time: {{current_time}}

The conversation history is provided below.
```

### Available Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{{page_url}}` | Page they're on | `https://yoursite.com/pricing` |
| `{{visitor_name}}` | Name (if identified) | `John Doe` |
| `{{visitor_email}}` | Email (if identified) | `john@example.com` |
| `{{visitor_plan}}` | Plan (if identified) | `pro` |
| `{{visitor_country}}` | Location from IP | `France` |
| `{{company_name}}` | Your company name | `Acme Inc` |
| `{{current_time}}` | Current time | `2024-01-15 10:30 AM EST` |

---

## Business Hours Mode

Configure AI to only activate outside business hours:

```bash title=".env"
AI_BUSINESS_HOURS_ONLY=true

# When you're available (AI stays off during these hours)
AI_BUSINESS_START=09:00        # 9 AM
AI_BUSINESS_END=18:00          # 6 PM
AI_BUSINESS_TIMEZONE=America/New_York
AI_BUSINESS_DAYS=1,2,3,4,5     # Monday (1) to Friday (5)
```

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    BUSINESS HOURS MODE                           │
│                                                                 │
│   Monday-Friday, 9am-6pm EST                                    │
│   ├── Message received → Normal flow (AI off)                   │
│   └── You have 2 minutes to reply                               │
│                                                                 │
│   Nights, weekends, holidays                                    │
│   ├── Message received → AI responds immediately                │
│   └── You can still jump in anytime                             │
│                                                                 │
│   Timeline:                                                     │
│   ──────────────────────────────────────────────────────────    │
│   |  9am    |    6pm    |    9am    |    6pm    |               │
│   |---YOU---|----AI-----|---YOU-----|----AI-----|               │
│      Mon         Mon-Tue     Tue        Tue-Wed                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Manual Override

Sometimes you want to disable AI for a specific conversation.

### From Telegram

In the visitor's topic:

```
/ai off   # Disable AI for this conversation
/ai on    # Re-enable AI for this conversation
```

### From Discord

In the visitor's thread:

```
/ai off
/ai on
```

### From Slack

In the visitor's thread:

```
@PocketPing ai off
@PocketPing ai on
```

### From the API

```bash
# Disable AI for a session
curl -X POST https://api.pocketping.io/sessions/sess_xxx/ai \
  -H "Authorization: Bearer sk_xxx" \
  -d '{"enabled": false}'
```

---

## AI Response Markers

All AI responses are clearly marked so customers know:

### In Messaging Platforms

```
┌─────────────────────────────────────────────────────────────────┐
│ Visitor Topic                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Visitor: Hi, what are your pricing plans?                      │
│                                                                 │
│  🤖 AI: Hello! We have three plans:                             │
│  - Free: 100 sessions/month                                     │
│  - Pro ($19/mo): Unlimited sessions                             │
│  - Team ($49/mo): Multiple operators                            │
│                                                                 │
│  Would you like details on any specific plan?                   │
│                                                                 │
│  ↑ 🤖 prefix indicates AI response                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### In Widget

The visitor sees a subtle indicator that they're talking to AI.

### In Message Data

```json
{
  "id": "msg_xxx",
  "content": "Hello! I'd be happy to help...",
  "sender": {
    "type": "ai",
    "name": "AI Assistant"
  },
  "metadata": {
    "ai_model": "gpt-4o-mini",
    "ai_latency_ms": 1234
  }
}
```

---

## Example Prompts by Industry

### E-commerce

```text
You are a customer support agent for an online clothing store.

## Policies
- Shipping: 2-3 business days (US), 5-7 international. Free over $50.
- Returns: 30 days, unworn with tags. Free return shipping.
- Exchanges: Same as returns, we'll ship the new item free.

## Common Questions
Q: Where's my order?
A: Check your email for tracking. If no email, I'll have our team look it up.

Q: Can I change my order?
A: If not shipped yet, yes! Tell me your order number.

## Boundaries
- Don't process returns/refunds directly - collect info and escalate
- Don't promise discounts unless explicitly listed above
- For damaged items, always escalate to human
```

### SaaS

```text
You are a support agent for TaskFlow, a project management tool.

## Plans
- Free: Up to 3 projects, 2 users
- Pro ($12/user/mo): Unlimited projects, 50GB storage
- Enterprise: Contact sales

## Features
- Task boards, timelines, calendars
- File attachments (up to 100MB per file)
- Integrations: Slack, GitHub, Figma
- API access on Pro and above

## Common Issues
- Login problems: Suggest password reset, check spam for verification
- Slow performance: Check browser extensions, try incognito
- Missing features: Note it and say we'll share with product team

## Escalate to human for:
- Billing disputes
- Data export requests
- Security concerns
- Bug reports with error messages
```

### Agency/Consulting

```text
You are the virtual assistant for a digital marketing agency.

## About Us
- Full-service agency: SEO, PPC, Social, Content
- Founded 2018, 25+ employees, 100+ clients
- Industries: SaaS, E-commerce, Healthcare

## Services
- SEO Audit: $2,000 one-time
- Monthly SEO: Starting $3,000/mo
- PPC Management: 15% of ad spend, $1,500 minimum
- Social Media: Starting $2,500/mo

## Your Job
- Answer general questions about services
- Collect lead info: name, email, company, what they need
- Schedule discovery calls (offer Mon-Fri 10am-4pm EST)

## Don't
- Promise specific results (rankings, ROI)
- Negotiate pricing
- Bad-mouth competitors
```

---

## Best Practices

### Do

| Practice | Why |
|----------|-----|
| Set a 1-2 minute delay | Gives you time to respond first |
| Be specific in prompts | Reduces hallucinations |
| Include pricing/policies | Most common questions answered correctly |
| Define escalation rules | AI knows when to defer |
| Review conversations weekly | Improve prompts over time |

### Don't

| Avoid | Why |
|-------|-----|
| Zero delay | Visitors prefer human response |
| Vague prompts | AI will make things up |
| Promising AI can't deliver | "I'll process your refund" when it can't |
| Ignoring AI conversations | Still need human follow-up |

---

## Monitoring

### View AI Conversations

1. Go to your dashboard
2. Filter by "AI responses"
3. Review for accuracy and tone

### Metrics to Track

| Metric | Good Range | Action if Outside |
|--------|------------|-------------------|
| AI activation rate | 10-30% | If higher, you might need more staff |
| Customer satisfaction | 4+ stars | Review and improve prompt |
| Escalation rate | 15-25% | Too low = AI promising too much |
| Resolution rate | 50-70% | Improve knowledge in prompt |

---

## Troubleshooting

### AI not activating?

| Check | Solution |
|-------|----------|
| `AI_ENABLED=true` | Set in .env and restart |
| OpenAI API key valid | Test with `curl` or check OpenAI dashboard |
| Business hours config | Verify timezone and days |
| Response delay too long | Try shorter delay for testing |

### AI giving wrong answers?

| Issue | Solution |
|-------|----------|
| Making up features | Add "Never make up features" to prompt |
| Wrong pricing | Add explicit pricing in prompt |
| Too verbose | Add "Be concise, 2-3 sentences max" |
| Too formal/informal | Adjust tone instructions |

### AI not stopping when you reply?

| Check | Solution |
|-------|----------|
| Reply in correct thread | Must be in visitor's topic/thread |
| Bot permissions | Bot needs to read your messages |
| Reply fast enough | Reply within same "conversation window" |

---

## Next Steps

- **[Node.js SDK](/sdk/nodejs)** - Handle events and customize behavior
- **[Telegram Bridge](/bridges/telegram)** - Set up Telegram
- **[Self-Hosting](/self-hosting)** - Deploy your own instance
- **[API Reference](/api)** - Full API documentation

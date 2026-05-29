# Admin Dashboard & Backoffice

This document outlines strategies for building an admin dashboard for PocketPing.

## Overview

PocketPing is designed as a **protocol-first library**, not a hosted SaaS. This means:

1. **You own your data** - sessions and messages live in your database
2. **You control access** - authentication is your responsibility
3. **You build the UI** - we provide the API, you build what you need

## Architecture Options

### Option 1: Integrated Admin Routes (Recommended for Small Teams)

Add admin routes directly to your existing backend:

```python
# Python/FastAPI example
from fastapi import FastAPI, Depends
from pocketping import PocketPing
from your_auth import require_admin  # Your auth middleware

app = FastAPI()
pp = PocketPing(...)

@app.get("/admin/sessions")
async def list_sessions(user = Depends(require_admin)):
    """List active chat sessions.

    Note: the SDK storage interface exposes per-record lookups
    (`get_session(id)` / `get_session_by_visitor_id(...)`), not a list-all
    method. To list every session, query your storage backend directly
    (e.g. a SQL `SELECT` on your sessions table, or iterating your store).
    """
    sessions = await query_my_sessions_table()  # your storage-specific query
    return {"sessions": sessions}

@app.get("/admin/sessions/{session_id}")
async def get_session(session_id: str, user = Depends(require_admin)):
    """Get session details with messages."""
    session = await pp.storage.get_session(session_id)
    messages = await pp.storage.get_messages(session_id)
    return {"session": session, "messages": messages}

@app.post("/admin/sessions/{session_id}/reply")
async def reply_as_operator(session_id: str, content: str, user = Depends(require_admin)):
    """Send a message as the operator."""
    message = await pp.send_operator_message(session_id, content)
    return {"message": message}

@app.post("/admin/presence")
async def set_presence(online: bool, user = Depends(require_admin)):
    """Set operator online/offline status."""
    pp.set_operator_online(online)
    return {"online": online}
```

**Pros:**
- Simple to implement
- Uses your existing auth
- No extra infrastructure

**Cons:**
- Basic UI (unless you build one)
- Mixed with your main codebase

### Option 2: Separate Admin Repo (Recommended for Teams)

Create a separate repository for the admin dashboard:

```
pocketping-admin/
├── frontend/           # React/Vue/Svelte dashboard
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Sessions.tsx
│   │   │   ├── Conversations.tsx
│   │   │   └── Settings.tsx
│   │   └── ...
│   └── package.json
├── api/                # Optional: dedicated admin API
│   └── ...
└── README.md
```

**Pros:**
- Clean separation of concerns
- Can be shared across multiple PocketPing installations
- Better for larger teams

**Cons:**
- More infrastructure to manage
- Need to solve cross-origin auth

### Option 3: Mobile-First via Bridges (Current Approach)

Use Telegram/Discord/Slack as your "admin dashboard":

```
┌─────────────────────────────────────────────────────────────┐
│                  Your Phone (Telegram)                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  🆕 New Visitor                                             │
│  Session: abc123...                                         │
│  Page: https://yoursite.com/pricing                         │
│                                                             │
│  💬 Message                                                 │
│  "Hi, I have a question about pricing"                      │
│                                                             │
│  > Just reply to respond!                                   │
│                                                             │
│  Commands:                                                  │
│  /online  - Mark as available                               │
│  /offline - Mark as away                                    │
│  /status  - View stats                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Pros:**
- Zero additional UI to build
- Works immediately
- True mobile-first experience
- Already built!

**Cons:**
- Limited to bridge capabilities
- No advanced analytics

## Security Best Practices

### 1. Protect Admin Routes

```python
# Always require authentication
@app.get("/admin/sessions")
async def list_sessions(user = Depends(require_admin)):  # ← Always require auth
    ...

# Don't expose admin routes publicly
# Consider IP allowlisting for extra security
```

### 2. Separate Admin API

If you need a separate admin API:

```python
# Create a separate FastAPI app for admin
admin_app = FastAPI()

# Mount at a different path or port
app.mount("/admin", admin_app)

# Or run on a different port entirely
# uvicorn admin:app --port 8001
```

### 3. API Key Authentication

For simple admin access:

```python
from fastapi import Header, HTTPException

async def verify_admin_key(x_admin_key: str = Header(...)):
    if x_admin_key != os.getenv("ADMIN_API_KEY"):
        raise HTTPException(status_code=401, detail="Invalid admin key")
    return True

@app.get("/admin/sessions")
async def list_sessions(_: bool = Depends(verify_admin_key)):
    ...
```

### 4. JWT Authentication

For a proper dashboard:

```python
from jose import jwt
from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

async def get_current_admin(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        if not payload.get("is_admin"):
            raise HTTPException(status_code=403, detail="Not an admin")
        return payload
    except:
        raise HTTPException(status_code=401, detail="Invalid token")
```

## Admin Dashboard Features

If building a custom dashboard, consider these features:

### Core Features
- [ ] List all active sessions
- [ ] View conversation history
- [ ] Reply to conversations
- [ ] Set online/offline status
- [ ] AI takeover controls

### Analytics
- [ ] Session count over time
- [ ] Average response time
- [ ] AI vs human response ratio
- [ ] Popular pages where chat is opened
- [ ] Peak hours

### Team Features
- [ ] Multiple operators
- [ ] Assignment/routing
- [ ] Canned responses
- [ ] Internal notes
- [ ] Handoff between operators

### Settings
- [ ] Welcome message
- [ ] AI system prompt
- [ ] Takeover delay
- [ ] Bridge configuration

## Example: Minimal React Dashboard

```tsx
// SessionList.tsx
import { useEffect, useState } from 'react';

export function SessionList() {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    fetch('/admin/sessions', {
      headers: { 'X-Admin-Key': localStorage.getItem('adminKey') }
    })
      .then(r => r.json())
      .then(data => setSessions(data.sessions));
  }, []);

  return (
    <div>
      <h1>Active Sessions</h1>
      {sessions.map(session => (
        <div key={session.id}>
          <a href={`/admin/sessions/${session.id}`}>
            {session.id.slice(0, 8)}... - {session.metadata?.url}
          </a>
        </div>
      ))}
    </div>
  );
}
```

## Recommendation

For most use cases, we recommend:

1. **Start with bridges** (Telegram/Discord) - zero UI work
2. **Add basic admin routes** to your backend as needed
3. **Build a dashboard** only when bridges aren't enough

The bridges give you 80% of what you need with 0% of the work. Build a dashboard only when you need features like:
- Team management
- Advanced analytics
- Custom workflows
- White-labeling

## Future: PocketPing Cloud (Optional)

We're considering a hosted admin dashboard for those who want it:

```
┌─────────────────────────────────────────────────────────────┐
│                  PocketPing Cloud                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Your PocketPing  ←──API Key──→  Hosted Dashboard           │
│   (self-hosted)                   (app.pocketping.io)       │
│                                                             │
│  Features:                                                  │
│  - Web dashboard                                            │
│  - Team management                                          │
│  - Analytics                                                │
│  - No code required                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

This would be **optional** - the core library remains self-hosted and free.

Interested? Let us know by opening an issue!

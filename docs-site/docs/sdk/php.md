---
sidebar_position: 5
title: PHP SDK
description: Backend integration with the PocketPing PHP SDK
---

# PHP SDK

Integrate PocketPing into your PHP backend.

## Installation

```bash
composer require pocketping/sdk
```

## Quick Start

### Laravel

```php
<?php
// app/Http/Controllers/ChatController.php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use PocketPing\PocketPing;
use PocketPing\Models\ConnectRequest;

class ChatController extends Controller
{
    public function __construct(private PocketPing $pp)
    {
    }

    // POST /pocketping/connect
    public function connect(Request $request)
    {
        $connectRequest = ConnectRequest::fromArray($request->all());
        $response = $this->pp->handleConnect($connectRequest);

        return response()->json($response);
    }
}
```

The `PocketPing` instance is wired once (e.g. in a service provider) and
injected — see [Configuration](#configuration) for the constructor options. It
is a library: you call its handlers from your own routes — there is no
`handleRequest()`/`bridgeUrl`.

### Symfony

```php
<?php
// src/Controller/PocketPingController.php
namespace App\Controller;

use PocketPing\PocketPing;
use PocketPing\Models\ConnectRequest;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Annotation\Route;

class PocketPingController
{
    public function __construct(private PocketPing $pp)
    {
    }

    #[Route('/pocketping/connect', methods: ['POST'])]
    public function connect(Request $request): JsonResponse
    {
        $data = json_decode($request->getContent(), true);
        $connectRequest = ConnectRequest::fromArray($data);
        $response = $this->pp->handleConnect($connectRequest);

        return new JsonResponse($response);
    }
}
```

### Plain PHP

```php
<?php
require 'vendor/autoload.php';

use PocketPing\PocketPing;
use PocketPing\Models\ConnectRequest;

$pp = new PocketPing(
    welcomeMessage: 'Hi! How can we help?',
);

// Read the JSON body the widget posted and call the matching handler.
$body = json_decode(file_get_contents('php://input'), true) ?? [];
$response = $pp->handleConnect(ConnectRequest::fromArray($body));

header('Content-Type: application/json');
echo json_encode($response);
```

## Built-in Bridges

The SDK includes built-in bridges for Telegram, Discord, and Slack with automatic validation and helpful setup guides.

```php
<?php
use PocketPing\PocketPing;
use PocketPing\Bridges\TelegramBridge;
use PocketPing\Bridges\DiscordBridge;
use PocketPing\Bridges\SlackBridge;
use PocketPing\Exceptions\SetupException;

$pp = new PocketPing();

// Add Telegram bridge
try {
    $pp->addBridge(new TelegramBridge(
        botToken: $_ENV['TELEGRAM_BOT_TOKEN'],
        chatId: $_ENV['TELEGRAM_CHAT_ID']
    ));
} catch (SetupException $e) {
    // Helpful error with setup guide
    echo $e->getFormattedGuide();
    exit(1);
}

// Add Discord bridge (bot mode)
try {
    $pp->addBridge(DiscordBridge::bot(
        botToken: $_ENV['DISCORD_BOT_TOKEN'],
        channelId: $_ENV['DISCORD_CHANNEL_ID']
    ));
} catch (SetupException $e) {
    echo $e->getFormattedGuide();
    exit(1);
}

// Add Slack bridge (bot mode)
try {
    $pp->addBridge(SlackBridge::bot(
        botToken: $_ENV['SLACK_BOT_TOKEN'],
        channelId: $_ENV['SLACK_CHANNEL_ID']
    ));
} catch (SetupException $e) {
    echo $e->getFormattedGuide();
    exit(1);
}
```

### Validation Errors

If configuration is missing or invalid, you'll see a helpful setup guide:

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️  Slack Setup Required
├─────────────────────────────────────────────────────────────┤
│
│  Missing: bot_token
│
│  To set up Slack Bot mode:
│
│  1. Go to https://api.slack.com/apps
│  2. Create New App → From scratch
│  3. OAuth & Permissions → Add Bot Token Scopes:
│     - chat:write, channels:read, channels:join
│     - channels:history, groups:history, users:read
│  4. Install to Workspace → Copy Bot Token (xoxb-...)
│
│  📖 Full guide: https://pocketping.io/docs/slack
│
│  💡 Quick fix: npx @pocketping/cli init slack
│
└─────────────────────────────────────────────────────────────┘
```

### Bridge Modes

| Bridge | Mode | Factory Method | Features |
|--------|------|----------------|----------|
| Telegram | Bot | `new TelegramBridge()` | Send, edit, delete |
| Discord | Webhook | `DiscordBridge::webhook()` | Send only |
| Discord | Bot | `DiscordBridge::bot()` | Send, edit, delete |
| Slack | Webhook | `SlackBridge::webhook()` | Send only |
| Slack | Bot | `SlackBridge::bot()` | Send, edit, delete |

:::tip Bot vs Webhook
Use **Bot mode** for full bidirectional communication. Webhooks are simpler but only support sending messages.
:::

:::warning Discord Bot requires long-running server
**Discord bot mode** uses the Discord Gateway (WebSocket) to receive operator replies. This only works on **long-running servers** (Apache, nginx + PHP-FPM with Swoole/ReactPHP, etc.).

**Does NOT work with:**
- AWS Lambda
- Vercel PHP
- Any serverless environment

**For serverless + Discord bidirectional:** Use the [Bridge Server](/bridges/docker) instead, or use `DiscordBridge::webhook()` (send-only).
:::

:::info Telegram & Slack work with serverless
**Telegram** and **Slack** use HTTP webhooks (not WebSocket), so they work fully with serverless environments like Lambda, etc.
:::

---

## Configuration

The constructor takes named arguments (PHP 8.1+). Bridges are passed directly
via `bridges:` (or added later with `addBridge()`) — there is no bridge server
URL.

```php
use PocketPing\PocketPing;
use PocketPing\Bridges\TelegramBridge;

$pp = new PocketPing(
    // Custom storage (optional, defaults to in-memory MemoryStorage)
    storage: new PostgresStorage(),

    // Notification bridges (or add later with $pp->addBridge(...))
    bridges: [
        new TelegramBridge(
            botToken: $_ENV['TELEGRAM_BOT_TOKEN'],
            chatId: $_ENV['TELEGRAM_CHAT_ID'],
        ),
    ],

    // Welcome message for new visitors
    welcomeMessage: 'Hi! How can we help?',

    // Widget version management (optional)
    minWidgetVersion: '2.0.0',
    latestWidgetVersion: '2.6.0',

    // Event callbacks
    onNewSession: function ($session) {
        error_log("New session: {$session->id}");
    },
    onMessage: function ($message, $session) {
        error_log("Message: {$message->content}");
    },
    onEvent: function ($event, $session) {
        error_log("Event: {$event->name}");
    },
    onIdentify: function ($session) {
        error_log("User identified: {$session->identity->id}");
    },
);
```

## API

### Sessions

```php
// Get a specific session (returns ?Session)
$session = $pp->getSession('sess_xxx');

// Get session messages (returns ['messages' => [...], 'hasMore' => bool])
$page = $pp->handleGetMessages('sess_xxx', after: null, limit: 50);
$messages = $page['messages'];
```

### Messages

```php
// Send an operator reply to a session
$pp->sendOperatorMessage('sess_xxx', 'Hello from the server!');
```

### Custom Events

```php
// Receive events from widget
$pp = new PocketPing(
    onEvent: function ($event, $session) {
        if ($event->name === 'clicked_pricing') {
            // Track analytics, trigger automation, etc.
        }
    },
);

// Send events to widget
$pp->emitEvent('sess_xxx', 'show_offer', [
    'discount' => 20,
    'code' => 'SAVE20',
]);
```

## Custom Storage

Implement the `StorageInterface` for persistence:

```php
<?php
use PocketPing\Storage\StorageInterface;

class PostgresStorage implements StorageInterface
{
    private PDO $pdo;

    public function __construct(string $dsn)
    {
        $this->pdo = new PDO($dsn);
    }

    public function createSession(array $session): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO sessions (id, visitor_id, created_at) VALUES (?, ?, ?)'
        );
        $stmt->execute([$session['id'], $session['visitorId'], $session['createdAt']]);
    }

    public function getSession(string $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM sessions WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    // Implement other methods...
}
```

## User-Agent Filtering

Block bots and automated requests from creating chat sessions.

### Quick Setup

```php
use PocketPing\PocketPing;
use PocketPing\Utils\UaFilterConfig;

$pp = new PocketPing(
    uaFilter: new UaFilterConfig(
        enabled: true,
        useDefaultBots: true, // Block ~50 known bot patterns
    ),
);
```

### Configuration Options

```php
use PocketPing\Utils\UaFilterConfig;
use PocketPing\Utils\UaFilterMode;

$pp = new PocketPing(
    uaFilter: new UaFilterConfig(
        enabled: true,
        mode: UaFilterMode::BLOCKLIST, // BLOCKLIST | ALLOWLIST | BOTH
        useDefaultBots: true,
        blocklist: [
            'my-custom-scraper',
            'bad-bot',
            '/spam-\\d+/', // Regex pattern
        ],
        allowlist: [
            'my-monitoring-bot',
            '/internal-.*/', // Regex: allow internal tools
        ],
        logBlocked: true,
        blockedStatusCode: 403,
        blockedMessage: 'Forbidden',
    ),
);
```

### Manual Filtering

```php
use PocketPing\Utils\UserAgentFilter;
use PocketPing\Utils\UaFilterConfig;

// Quick bot check
if (UserAgentFilter::isBot($_SERVER['HTTP_USER_AGENT'] ?? '')) {
    http_response_code(403);
    echo json_encode(['error' => 'Bots not allowed']);
    exit;
}

// Full filter check
$result = UserAgentFilter::checkUaFilter(
    $_SERVER['HTTP_USER_AGENT'] ?? null,
    new UaFilterConfig(enabled: true, useDefaultBots: true),
    ['path' => $_SERVER['REQUEST_URI']]
);

if (!$result->allowed) {
    error_log("Blocked: {$result->reason->value}, pattern: {$result->matchedPattern}");
}
```

---

## Next Steps

- [Python SDK](/sdk/python) - Backend integration for Python
- [Node.js SDK](/sdk/nodejs) - Backend integration for Node.js
- [API Reference](/api) - Full REST API documentation

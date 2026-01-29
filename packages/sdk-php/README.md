# PocketPing PHP SDK

The official PHP SDK for PocketPing - embed live chat support directly from your backend.

> **Tip:** Use the CLI for guided bridge setup: `npx @pocketping/cli init`

## Requirements

- PHP 8.1 or higher
- PSR-3 compatible logger (optional)

## Installation

```bash
composer require pocketping/sdk
```

## Quick Start

```php
<?php

use PocketPing\PocketPing;
use PocketPing\Models\ConnectRequest;
use PocketPing\Models\SendMessageRequest;
use PocketPing\Models\Sender;

// Initialize PocketPing
$pocketPing = new PocketPing(
    welcomeMessage: 'Hello! How can we help you today?',
);

// Handle a connection request
$connectRequest = ConnectRequest::fromArray([
    'visitorId' => 'visitor-123',
    'metadata' => [
        'url' => 'https://example.com/pricing',
        'userAgent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
    ],
]);

$response = $pocketPing->handleConnect($connectRequest);

// Response contains sessionId, messages, etc.
echo json_encode($response);
```

## Configuration

```php
use PocketPing\PocketPing;
use PocketPing\Storage\MemoryStorage;
use PocketPing\Utils\IpFilterConfig;
use PocketPing\Utils\IpFilterMode;
use Monolog\Logger;
use Monolog\Handler\StreamHandler;

// Create a PSR-3 logger (optional)
$logger = new Logger('pocketping');
$logger->pushHandler(new StreamHandler('php://stderr', Logger::WARNING));

// Initialize with full configuration
$pocketPing = new PocketPing(
    storage: new MemoryStorage(),          // Storage adapter
    bridges: [],                           // Notification bridges
    welcomeMessage: 'Hello! How can we help?',
    minWidgetVersion: '0.2.0',             // Minimum widget version
    latestWidgetVersion: '0.3.0',          // Latest widget version
    versionWarningMessage: null,           // Custom warning message
    versionUpgradeUrl: 'https://docs.pocketping.io/widget/installation',
    onNewSession: function ($session) {
        // Called when a new session is created
        error_log("New session: {$session->id}");
    },
    onMessage: function ($message, $session) {
        // Called when a message is received
        error_log("Message from {$message->sender->value}: {$message->content}");
    },
    onEvent: function ($event, $session) {
        // Called when a custom event is received
        error_log("Event: {$event->name}");
    },
    onIdentify: function ($session) {
        // Called when a user identifies themselves
        error_log("User identified: {$session->identity->id}");
    },
    logger: $logger,
    // IP filtering (see IP Filtering section below)
    ipFilter: new IpFilterConfig(
        enabled: true,
        mode: IpFilterMode::BLOCKLIST,
        blocklist: ['203.0.113.0/24'],
    ),
);
```

## IP Filtering

Block or allow specific IP addresses or CIDR ranges:

```php
use PocketPing\PocketPing;
use PocketPing\Utils\IpFilterConfig;
use PocketPing\Utils\IpFilterMode;

$pocketPing = new PocketPing(
    ipFilter: new IpFilterConfig(
        enabled: true,
        mode: IpFilterMode::BLOCKLIST,  // BLOCKLIST | ALLOWLIST | BOTH
        blocklist: [
            '203.0.113.0/24',   // CIDR range
            '198.51.100.50',    // Single IP
        ],
        allowlist: [
            '10.0.0.0/8',       // Internal network
        ],
        logBlocked: true,       // Log blocked requests (default: true)
        blockedStatusCode: 403,
        blockedMessage: 'Forbidden',
    ),
);

// Or with a custom filter callback
$pocketPing = new PocketPing(
    ipFilter: new IpFilterConfig(
        enabled: true,
        mode: IpFilterMode::BLOCKLIST,
        customFilter: function (string $ip, ?array $requestInfo): ?bool {
            // Return true to allow, false to block, null to defer to list-based filtering
            if (str_starts_with($ip, '192.168.')) {
                return true;  // Always allow local
            }
            return null;  // Use blocklist/allowlist
        },
    ),
);
```

### Modes

| Mode | Behavior |
|------|----------|
| `IpFilterMode::BLOCKLIST` | Block IPs in blocklist, allow all others (default) |
| `IpFilterMode::ALLOWLIST` | Only allow IPs in allowlist, block all others |
| `IpFilterMode::BOTH` | Allowlist takes precedence, then blocklist is applied |

### CIDR Support

The SDK supports CIDR notation using `ip2long()` and bitmask operations:
- Single IP: `192.168.1.1` (treated as `/32`)
- Class C: `192.168.1.0/24` (256 addresses)
- Class B: `172.16.0.0/16` (65,536 addresses)
- Class A: `10.0.0.0/8` (16M addresses)

### Manual IP Check

```php
use PocketPing\Utils\IpFilter;

// Check IP manually
$result = $pocketPing->checkIpFilter('192.168.1.50');
// IpFilterResult with: allowed, reason, matchedRule

// Get client IP from headers
$clientIp = $pocketPing->getClientIp($_SERVER);
// Checks: CF-Connecting-IP, X-Real-IP, X-Forwarded-For

// Create a blocked response
if (!$result->allowed) {
    $response = $pocketPing->createBlockedResponse();
    // Returns: ['status' => 403, 'body' => ['error' => 'Forbidden']]
}
```

## User-Agent Filtering

Block bots and automated requests from creating chat sessions:

```php
use PocketPing\PocketPing;
use PocketPing\Utils\UaFilterConfig;
use PocketPing\Utils\UaFilterMode;

$pp = new PocketPing([
    'uaFilter' => new UaFilterConfig(
        enabled: true,
        mode: UaFilterMode::BLOCKLIST,  // BLOCKLIST | ALLOWLIST | BOTH
        useDefaultBots: true,  // Include ~50 default bot patterns
        blocklist: ['my-custom-scraper', '/spam-\\d+/'],  // Custom patterns
        allowlist: ['my-monitoring-bot'],  // Always allow these
        logBlocked: true,
    ),
]);
```

### Filter Modes

| Mode | Behavior |
|------|----------|
| `BLOCKLIST` | Block matching UAs, allow all others |
| `ALLOWLIST` | Only allow matching UAs, block all others |
| `BOTH` | Allowlist takes precedence, then blocklist is applied |

### Pattern Matching

- **Substring**: `googlebot` matches any UA containing "googlebot" (case-insensitive)
- **Regex**: `/bot-\d+/` - wrap pattern in `/` for regex matching

### Manual UA Check

```php
use PocketPing\Utils\UserAgentFilter;

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
// UaFilterResult with: allowed, reason, matchedPattern
```

## API Reference

### Session Management

#### handleConnect(ConnectRequest $request): ConnectResponse

Handle a connection request from the widget.

```php
use PocketPing\Models\ConnectRequest;

$request = ConnectRequest::fromArray([
    'visitorId' => 'visitor-123',
    'sessionId' => 'existing-session-id',  // Optional
    'metadata' => [
        'url' => 'https://example.com',
        'userAgent' => 'Mozilla/5.0...',
    ],
    'identity' => [
        'id' => 'user-456',
        'email' => 'user@example.com',
        'name' => 'John Doe',
    ],
]);

$response = $pocketPing->handleConnect($request);

// ConnectResponse properties:
// - sessionId: string
// - visitorId: string
// - operatorOnline: bool
// - welcomeMessage: ?string
// - messages: Message[]
// - trackedElements: ?TrackedElement[]
```

### Message Handling

#### handleMessage(SendMessageRequest $request): SendMessageResponse

Handle a message from visitor or operator.

```php
use PocketPing\Models\SendMessageRequest;
use PocketPing\Models\Sender;

$request = new SendMessageRequest(
    sessionId: 'session-123',
    content: 'Hello, I need help!',
    sender: Sender::VISITOR,
    replyTo: null,  // Optional message ID to reply to
);

$response = $pocketPing->handleMessage($request);

// SendMessageResponse properties:
// - messageId: string
// - timestamp: DateTimeImmutable
```

#### Reply Behavior

- **Telegram:** native replies when `replyTo` is set and Telegram message ID is known.
- **Discord:** native replies via `message_reference` when Discord message ID is known.
- **Slack:** quoted block (left bar) inside the thread.

#### sendOperatorMessage(string $sessionId, string $content, ?string $sourceBridge, ?string $operatorName): Message

Send a message as the operator.

```php
$message = $pocketPing->sendOperatorMessage(
    sessionId: 'session-123',
    content: 'Hi! How can I help you today?',
    sourceBridge: 'telegram',  // Optional: for cross-bridge sync
    operatorName: 'John',       // Optional: operator's name
);
```

### Read Receipts

#### handleRead(ReadRequest $request): ReadResponse

Handle message read/delivered status updates.

```php
use PocketPing\Models\ReadRequest;
use PocketPing\Models\MessageStatus;

$request = new ReadRequest(
    sessionId: 'session-123',
    messageIds: ['msg-1', 'msg-2'],
    status: MessageStatus::READ,
);

$response = $pocketPing->handleRead($request);

// ReadResponse properties:
// - updated: int (number of messages updated)
```

### User Identity

#### handleIdentify(IdentifyRequest $request): IdentifyResponse

Handle user identification from widget.

```php
use PocketPing\Models\IdentifyRequest;
use PocketPing\Models\UserIdentity;

$request = new IdentifyRequest(
    sessionId: 'session-123',
    identity: new UserIdentity(
        id: 'user-456',
        email: 'user@example.com',
        name: 'John Doe',
        customFields: [
            'plan' => 'premium',
            'company' => 'Acme Inc',
        ],
    ),
);

$response = $pocketPing->handleIdentify($request);
```

### Custom Events

#### onEventHandler(string $eventName, callable $handler): callable

Subscribe to custom events.

```php
// Subscribe to a specific event
$unsubscribe = $pocketPing->onEventHandler('clicked_pricing', function ($event, $session) {
    error_log("User clicked pricing: " . json_encode($event->data));
});

// Subscribe to all events (wildcard)
$pocketPing->onEventHandler('*', function ($event, $session) {
    error_log("Event received: {$event->name}");
});

// Unsubscribe
$unsubscribe();
```

#### emitEvent(string $sessionId, string $eventName, ?array $data): void

Emit a custom event to a specific session.

```php
$pocketPing->emitEvent('session-123', 'show_offer', [
    'discount' => 20,
    'code' => 'SAVE20',
]);
```

#### broadcastEvent(string $eventName, ?array $data): void

Broadcast a custom event to all connected sessions.

```php
$pocketPing->broadcastEvent('maintenance_notice', [
    'message' => 'Scheduled maintenance in 30 minutes',
]);
```

### Operator Functions

```php
// Set operator online/offline
$pocketPing->setOperatorOnline(true);

// Check if operator is online
$isOnline = $pocketPing->isOperatorOnline();

// Get presence status
$presence = $pocketPing->handlePresence();
```

### WebSocket Management

```php
// Register a WebSocket connection
$pocketPing->registerWebsocket('session-123', $websocket);

// Unregister a WebSocket connection
$pocketPing->unregisterWebsocket('session-123', $websocket);

// Broadcast to a session
use PocketPing\Models\WebSocketEvent;

$pocketPing->broadcastToSession(
    'session-123',
    new WebSocketEvent('custom', ['key' => 'value'])
);
```

### Version Management

```php
// Check widget version compatibility
$versionCheck = $pocketPing->checkWidgetVersion('0.1.5');

// Get HTTP headers for version info
$headers = $pocketPing->getVersionHeaders($versionCheck);
foreach ($headers as $name => $value) {
    header("{$name}: {$value}");
}

// Send version warning via WebSocket
$pocketPing->sendVersionWarning('session-123', $versionCheck, '0.1.5');
```

## Storage Adapters

The SDK includes an in-memory storage adapter for development and testing. For production, implement the `StorageInterface`:

```php
use PocketPing\Storage\StorageInterface;
use PocketPing\Models\Message;
use PocketPing\Models\Session;

class RedisStorage implements StorageInterface
{
    public function __construct(private \Redis $redis)
    {
    }

    public function createSession(Session $session): void
    {
        $this->redis->set(
            "session:{$session->id}",
            json_encode($session->toArray())
        );
    }

    public function getSession(string $sessionId): ?Session
    {
        $data = $this->redis->get("session:{$sessionId}");
        if ($data === false) {
            return null;
        }
        return Session::fromArray(json_decode($data, true));
    }

    // Implement other methods...
}
```

## Bridge Integration

Bridges allow you to receive notifications via external services (Telegram, Slack, Discord, etc.).

```php
use PocketPing\Bridges\AbstractBridge;
use PocketPing\Models\Message;
use PocketPing\Models\Session;

class SlackBridge extends AbstractBridge
{
    public function __construct(private string $webhookUrl)
    {
    }

    public function getName(): string
    {
        return 'slack';
    }

    public function onNewSession(Session $session): void
    {
        $this->sendToSlack("New chat session: {$session->id}");
    }

    public function onVisitorMessage(Message $message, Session $session): void
    {
        $this->sendToSlack("Message: {$message->content}");
    }

    private function sendToSlack(string $text): void
    {
        // Send to Slack webhook
    }
}

// Use the bridge
$pocketPing = new PocketPing(
    bridges: [new SlackBridge('https://hooks.slack.com/...')],
);
```

## Framework Integration

### Laravel

```php
// config/pocketping.php
return [
    'welcome_message' => env('POCKETPING_WELCOME', 'Hello!'),
    'min_widget_version' => '0.2.0',
];

// app/Providers/PocketPingServiceProvider.php
use PocketPing\PocketPing;

class PocketPingServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(PocketPing::class, function ($app) {
            return new PocketPing(
                welcomeMessage: config('pocketping.welcome_message'),
                minWidgetVersion: config('pocketping.min_widget_version'),
                logger: $app->make('log'),
            );
        });
    }
}

// app/Http/Controllers/ChatController.php
class ChatController extends Controller
{
    public function connect(Request $request, PocketPing $pocketPing)
    {
        $connectRequest = ConnectRequest::fromArray($request->all());
        $response = $pocketPing->handleConnect($connectRequest);
        return response()->json($response);
    }
}
```

### Symfony

```php
// config/services.yaml
services:
    PocketPing\PocketPing:
        arguments:
            $welcomeMessage: '%env(POCKETPING_WELCOME)%'
            $logger: '@logger'

// src/Controller/ChatController.php
class ChatController extends AbstractController
{
    #[Route('/api/chat/connect', methods: ['POST'])]
    public function connect(Request $request, PocketPing $pocketPing): JsonResponse
    {
        $data = json_decode($request->getContent(), true);
        $connectRequest = ConnectRequest::fromArray($data);
        $response = $pocketPing->handleConnect($connectRequest);
        return $this->json($response);
    }
}
```

## Error Handling

The SDK throws `InvalidArgumentException` for validation errors:

```php
try {
    $pocketPing->handleMessage(new SendMessageRequest(
        sessionId: 'invalid-session',
        content: 'Hello',
        sender: Sender::VISITOR,
    ));
} catch (InvalidArgumentException $e) {
    // Handle "Session not found" error
    http_response_code(404);
    echo json_encode(['error' => $e->getMessage()]);
}
```

## License

MIT License - see LICENSE file for details.

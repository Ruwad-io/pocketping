---
sidebar_position: 5
title: PHP SDK
description: Backend integration with the PocketPing PHP SDK
---

# PHP SDK

Integrate PocketPing into your PHP backend.

## Installation

```bash
composer require pocketping/pocketping-php
```

## Quick Start

### Laravel

```php
<?php
// routes/web.php
use PocketPing\PocketPing;

$pp = new PocketPing([
    'bridgeUrl' => env('BRIDGE_URL', 'http://localhost:3001'),
    'welcomeMessage' => 'Hi! How can we help?',
]);

Route::any('/pocketping/{path?}', function ($path = '') use ($pp) {
    return $pp->handleRequest(request());
})->where('path', '.*');
```

### Symfony

```php
<?php
// src/Controller/PocketPingController.php
namespace App\Controller;

use PocketPing\PocketPing;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Annotation\Route;

class PocketPingController
{
    private PocketPing $pp;

    public function __construct()
    {
        $this->pp = new PocketPing([
            'bridgeUrl' => $_ENV['BRIDGE_URL'],
        ]);
    }

    #[Route('/pocketping/{path}', requirements: ['path' => '.*'])]
    public function handle(Request $request)
    {
        return $this->pp->handleSymfonyRequest($request);
    }
}
```

### Plain PHP

```php
<?php
require 'vendor/autoload.php';

use PocketPing\PocketPing;

$pp = new PocketPing([
    'bridgeUrl' => 'http://localhost:3001',
]);

// Handle request
$response = $pp->handleRequest();
$response->send();
```

## Configuration

```php
$pp = new PocketPing([
    // Bridge server URL
    'bridgeUrl' => 'http://localhost:3001',

    // Welcome message for new visitors
    'welcomeMessage' => 'Hi! How can we help?',

    // Event handlers
    'onSessionStart' => function ($session) {
        error_log("New session: {$session->id}");
    },
    'onMessage' => function ($session, $message) {
        error_log("Message: {$message->content}");
    },
    'onEvent' => function ($session, $event) {
        error_log("Event: {$event->name}");
    },

    // Custom storage (optional)
    'storage' => new PostgresStorage(),
]);
```

## API

### Sessions

```php
// Get all active sessions
$sessions = $pp->getSessions();

// Get a specific session
$session = $pp->getSession('sess_xxx');

// Get session messages
$messages = $pp->getMessages('sess_xxx');

// Close a session
$pp->closeSession('sess_xxx');
```

### Messages

```php
// Send a message to a session
$pp->sendMessage('sess_xxx', [
    'content' => 'Hello from the server!',
    'type' => 'operator',
]);
```

### Custom Events

```php
// Receive events from widget
$pp = new PocketPing([
    'onEvent' => function ($session, $event) {
        if ($event->name === 'clicked_pricing') {
            // Track analytics, trigger automation, etc.
        }
    },
]);

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

## Next Steps

- [Python SDK](/sdk/python) - Backend integration for Python
- [Node.js SDK](/sdk/nodejs) - Backend integration for Node.js
- [API Reference](/api) - Full REST API documentation

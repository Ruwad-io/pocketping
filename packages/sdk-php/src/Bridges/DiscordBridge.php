<?php

declare(strict_types=1);

namespace PocketPing\Bridges;

use PocketPing\Http\CurlHttpClient;
use PocketPing\Http\HttpClientInterface;
use PocketPing\Models\BridgeMessageIds;
use PocketPing\Models\BridgeMessageResult;
use PocketPing\Models\CustomEvent;
use PocketPing\Models\Message;
use PocketPing\Models\MessageStatus;
use PocketPing\Models\Session;
use PocketPing\PocketPing;
use PocketPing\Storage\StorageWithBridgeIdsInterface;

/**
 * Discord bridge for sending chat notifications to a Discord channel.
 * Supports both webhook and bot modes.
 * Uses native cURL to call discord.com/api.
 */
class DiscordBridge extends AbstractBridge implements BridgeWithEditDeleteInterface
{
    private const API_BASE = 'https://discord.com/api/v10';

    private readonly bool $isWebhookMode;
    private readonly ?string $webhookUrl;
    private readonly ?string $webhookId;
    private readonly ?string $webhookToken;
    private readonly ?string $botToken;
    private readonly ?string $channelId;
    private readonly ?string $username;
    private readonly ?string $avatarUrl;
    private readonly HttpClientInterface $httpClient;

    private function __construct(
        bool $isWebhookMode,
        ?string $webhookUrl = null,
        ?string $botToken = null,
        ?string $channelId = null,
        ?string $username = null,
        ?string $avatarUrl = null,
        ?HttpClientInterface $httpClient = null,
    ) {
        $this->isWebhookMode = $isWebhookMode;
        $this->webhookUrl = $webhookUrl;
        $this->botToken = $botToken;
        $this->channelId = $channelId;
        $this->username = $username;
        $this->avatarUrl = $avatarUrl;
        $this->httpClient = $httpClient ?? new CurlHttpClient();

        // Parse webhook ID and token from URL
        if ($isWebhookMode && $webhookUrl !== null) {
            $parts = $this->parseWebhookUrl($webhookUrl);
            $this->webhookId = $parts['id'];
            $this->webhookToken = $parts['token'];
        } else {
            $this->webhookId = null;
            $this->webhookToken = null;
        }
    }

    /**
     * Create a Discord bridge using webhook mode.
     * Webhooks are simpler but cannot edit/delete messages.
     */
    public static function webhook(
        string $webhookUrl,
        ?string $username = null,
        ?string $avatarUrl = null,
        ?HttpClientInterface $httpClient = null
    ): self {
        return new self(
            isWebhookMode: true,
            webhookUrl: $webhookUrl,
            username: $username,
            avatarUrl: $avatarUrl,
            httpClient: $httpClient,
        );
    }

    /**
     * Create a Discord bridge using bot mode.
     * Bot mode supports full edit/delete functionality.
     */
    public static function bot(
        string $botToken,
        string $channelId,
        ?HttpClientInterface $httpClient = null
    ): self {
        return new self(
            isWebhookMode: false,
            botToken: $botToken,
            channelId: $channelId,
            httpClient: $httpClient,
        );
    }

    public function getName(): string
    {
        return 'discord';
    }

    public function onNewSession(Session $session): void
    {
        $url = $session->metadata?->url ?? 'Unknown';
        $visitorName = $this->getVisitorName($session);

        $embed = [
            'title' => '🆕 New chat session',
            'color' => 0x5865F2, // Discord blurple
            'fields' => [
                ['name' => '👤 Visitor', 'value' => $visitorName, 'inline' => true],
                ['name' => '📍 URL', 'value' => $url, 'inline' => false],
            ],
            'timestamp' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
        ];

        $this->sendEmbed($embed);
    }

    public function onVisitorMessage(Message $message, Session $session): void
    {
        $visitorName = $this->getVisitorName($session);
        $content = $message->content;

        $text = "💬 **{$visitorName}:**\n{$content}";

        // Add attachments info if present
        if (!empty($message->attachments)) {
            $attachmentCount = count($message->attachments);
            $text .= "\n\n📎 {$attachmentCount} attachment(s)";
        }

        $result = $this->sendMessage($text);

        // Store the message ID for edit/delete support
        if ($result->success && $result->platformMessageId !== null) {
            $this->storeBridgeMessageId($message->id, (string) $result->platformMessageId);
        }
    }

    public function onOperatorMessage(
        Message $message,
        Session $session,
        string $sourceBridge,
        ?string $operatorName = null
    ): void {
        // Skip messages from Discord to avoid echoing
        if ($sourceBridge === 'discord') {
            return;
        }

        $operator = $operatorName ?? 'Operator';
        $content = $message->content;

        $text = "📤 **{$operator}** (via {$sourceBridge}):\n{$content}";

        $this->sendMessage($text);
    }

    public function onMessageRead(
        string $sessionId,
        array $messageIds,
        MessageStatus $status,
        Session $session
    ): void {
        // Optionally notify about read status
        // Most implementations skip this to reduce noise
    }

    public function onCustomEvent(CustomEvent $event, Session $session): void
    {
        $visitorName = $this->getVisitorName($session);

        $embed = [
            'title' => "🔔 Event: {$event->name}",
            'color' => 0xFEE75C, // Yellow
            'fields' => [
                ['name' => '👤 From', 'value' => $visitorName, 'inline' => true],
            ],
            'timestamp' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
        ];

        if (!empty($event->data)) {
            $dataJson = json_encode($event->data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
            $embed['fields'][] = [
                'name' => '📦 Data',
                'value' => "```json\n{$dataJson}\n```",
                'inline' => false,
            ];
        }

        $this->sendEmbed($embed);
    }

    public function onIdentityUpdate(Session $session): void
    {
        if ($session->identity === null) {
            return;
        }

        $identity = $session->identity;
        $fields = [
            ['name' => '🆔 ID', 'value' => $identity->id, 'inline' => true],
        ];

        if ($identity->name !== null) {
            $fields[] = ['name' => '📛 Name', 'value' => $identity->name, 'inline' => true];
        }

        if ($identity->email !== null) {
            $fields[] = ['name' => '📧 Email', 'value' => $identity->email, 'inline' => true];
        }

        $embed = [
            'title' => '👤 Visitor identified',
            'color' => 0x57F287, // Green
            'fields' => $fields,
            'timestamp' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
        ];

        $this->sendEmbed($embed);
    }

    public function onTyping(string $sessionId, bool $isTyping): void
    {
        if ($isTyping && !$this->isWebhookMode && $this->channelId !== null) {
            $this->triggerTypingIndicator();
        }
    }

    public function onAiTakeover(Session $session, string $reason): void
    {
        $visitorName = $this->getVisitorName($session);

        $embed = [
            'title' => '🤖 AI Takeover',
            'color' => 0xEB459E, // Fuchsia
            'fields' => [
                ['name' => '👤 Session', 'value' => $visitorName, 'inline' => true],
                ['name' => '📝 Reason', 'value' => $reason, 'inline' => false],
            ],
            'timestamp' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
        ];

        $this->sendEmbed($embed);
    }

    public function onMessageEdit(
        string $sessionId,
        string $messageId,
        string $content,
        \DateTimeInterface $editedAt
    ): ?BridgeMessageIds {
        // Webhooks cannot edit messages
        if ($this->isWebhookMode) {
            return null;
        }

        $bridgeIds = $this->getBridgeMessageIds($messageId);
        if ($bridgeIds === null || $bridgeIds->discordMessageId === null) {
            return null;
        }

        $text = "💬 *(edited)*\n{$content}";

        $result = $this->editMessage($bridgeIds->discordMessageId, $text);

        if ($result->success) {
            return new BridgeMessageIds(discordMessageId: $bridgeIds->discordMessageId);
        }

        return null;
    }

    public function onMessageDelete(
        string $sessionId,
        string $messageId,
        \DateTimeInterface $deletedAt
    ): void {
        // Webhooks cannot delete messages
        if ($this->isWebhookMode) {
            return;
        }

        $bridgeIds = $this->getBridgeMessageIds($messageId);
        if ($bridgeIds === null || $bridgeIds->discordMessageId === null) {
            return;
        }

        $this->deleteMessage($bridgeIds->discordMessageId);
    }

    /**
     * Send a plain text message.
     */
    private function sendMessage(string $content): BridgeMessageResult
    {
        $payload = ['content' => $content];

        if ($this->username !== null) {
            $payload['username'] = $this->username;
        }

        if ($this->avatarUrl !== null) {
            $payload['avatar_url'] = $this->avatarUrl;
        }

        return $this->doSendMessage($payload);
    }

    /**
     * Send an embed message.
     *
     * @param array<string, mixed> $embed
     */
    private function sendEmbed(array $embed): BridgeMessageResult
    {
        $payload = ['embeds' => [$embed]];

        if ($this->username !== null) {
            $payload['username'] = $this->username;
        }

        if ($this->avatarUrl !== null) {
            $payload['avatar_url'] = $this->avatarUrl;
        }

        return $this->doSendMessage($payload);
    }

    /**
     * Send a message using the appropriate mode (webhook or bot).
     *
     * @param array<string, mixed> $payload
     */
    private function doSendMessage(array $payload): BridgeMessageResult
    {
        if ($this->isWebhookMode) {
            return $this->sendViaWebhook($payload);
        }

        return $this->sendViaBot($payload);
    }

    /**
     * Send a message via webhook.
     *
     * @param array<string, mixed> $payload
     */
    private function sendViaWebhook(array $payload): BridgeMessageResult
    {
        if ($this->webhookUrl === null) {
            return BridgeMessageResult::failure('Webhook URL not configured');
        }

        // Add ?wait=true to get the message ID back
        $url = $this->webhookUrl . '?wait=true';

        $response = $this->httpClient->post($url, $payload);

        if ($response['error'] !== null) {
            $this->logWarning("Discord webhook cURL error: {$response['error']}");
            return BridgeMessageResult::failure($response['error']);
        }

        $httpCode = $response['httpCode'];
        if ($httpCode < 200 || $httpCode >= 300) {
            $this->logWarning("Discord webhook HTTP error: {$httpCode}");
            return BridgeMessageResult::failure("HTTP {$httpCode}");
        }

        if ($response['body'] === null) {
            return BridgeMessageResult::failure('Empty response from Discord');
        }

        $data = json_decode($response['body'], true);
        if (!is_array($data) || !isset($data['id'])) {
            return BridgeMessageResult::failure('Invalid response from Discord');
        }

        return BridgeMessageResult::success($data['id']);
    }

    /**
     * Send a message via bot.
     *
     * @param array<string, mixed> $payload
     */
    private function sendViaBot(array $payload): BridgeMessageResult
    {
        if ($this->botToken === null || $this->channelId === null) {
            return BridgeMessageResult::failure('Bot token or channel ID not configured');
        }

        $url = self::API_BASE . "/channels/{$this->channelId}/messages";

        $response = $this->botApiRequest('POST', $url, $payload);

        if ($response === null || !isset($response['id'])) {
            $error = $response['message'] ?? 'Unknown error';
            $this->logWarning("Failed to send Discord message: {$error}");
            return BridgeMessageResult::failure($error);
        }

        return BridgeMessageResult::success($response['id']);
    }

    /**
     * Edit a message.
     */
    private function editMessage(string $discordMessageId, string $content): BridgeMessageResult
    {
        if ($this->botToken === null || $this->channelId === null) {
            return BridgeMessageResult::failure('Bot token or channel ID not configured');
        }

        $url = self::API_BASE . "/channels/{$this->channelId}/messages/{$discordMessageId}";

        $payload = ['content' => $content];

        $response = $this->botApiRequest('PATCH', $url, $payload);

        if ($response === null || !isset($response['id'])) {
            $error = $response['message'] ?? 'Unknown error';
            $this->logWarning("Failed to edit Discord message: {$error}");
            return BridgeMessageResult::failure($error);
        }

        return BridgeMessageResult::success($response['id']);
    }

    /**
     * Delete a message.
     */
    private function deleteMessage(string $discordMessageId): bool
    {
        if ($this->botToken === null || $this->channelId === null) {
            return false;
        }

        $url = self::API_BASE . "/channels/{$this->channelId}/messages/{$discordMessageId}";

        $response = $this->httpClient->delete($url, [
            'Authorization' => 'Bot ' . $this->botToken,
        ]);

        if ($response['error'] !== null) {
            $this->logWarning("Discord API cURL error: {$response['error']}");
            return false;
        }

        $httpCode = $response['httpCode'];
        // 204 No Content is the expected success response
        if ($httpCode !== 204 && ($httpCode < 200 || $httpCode >= 300)) {
            $this->logWarning("Discord API HTTP error on delete: {$httpCode}");
            return false;
        }

        return true;
    }

    /**
     * Trigger typing indicator in the channel.
     */
    private function triggerTypingIndicator(): bool
    {
        if ($this->botToken === null || $this->channelId === null) {
            return false;
        }

        $url = self::API_BASE . "/channels/{$this->channelId}/typing";

        $response = $this->httpClient->post($url, [], [
            'Authorization' => 'Bot ' . $this->botToken,
        ]);

        $httpCode = $response['httpCode'];
        return $httpCode === 204 || ($httpCode >= 200 && $httpCode < 300);
    }

    /**
     * Make a request to the Discord Bot API.
     *
     * @param array<string, mixed>|null $payload
     * @return array<string, mixed>|null
     */
    private function botApiRequest(string $method, string $url, ?array $payload = null): ?array
    {
        $headers = [
            'Authorization' => 'Bot ' . $this->botToken,
        ];

        if ($method === 'POST') {
            $response = $this->httpClient->post($url, $payload ?? [], $headers);
        } elseif ($method === 'PATCH') {
            $response = $this->httpClient->patch($url, $payload ?? [], $headers);
        } else {
            return null;
        }

        if ($response['error'] !== null) {
            $this->logWarning("Discord API cURL error: {$response['error']}");
            return null;
        }

        if ($response['body'] === null) {
            $this->logWarning("Discord API empty response");
            return null;
        }

        $data = json_decode($response['body'], true);
        if (!is_array($data)) {
            $this->logWarning("Discord API invalid JSON response");
            return null;
        }

        return $data;
    }

    /**
     * Parse webhook URL to extract ID and token.
     *
     * @return array{id: string|null, token: string|null}
     */
    private function parseWebhookUrl(string $url): array
    {
        // URL format: https://discord.com/api/webhooks/{id}/{token}
        $pattern = '#/webhooks/(\d+)/([a-zA-Z0-9_-]+)#';

        if (preg_match($pattern, $url, $matches)) {
            return [
                'id' => $matches[1],
                'token' => $matches[2],
            ];
        }

        return ['id' => null, 'token' => null];
    }

    /**
     * Get visitor name from session identity or visitor ID.
     */
    private function getVisitorName(Session $session): string
    {
        if ($session->identity?->name !== null) {
            return $session->identity->name;
        }

        if ($session->identity?->email !== null) {
            return $session->identity->email;
        }

        return $session->visitorId;
    }

    /**
     * Store bridge message ID for edit/delete support.
     */
    private function storeBridgeMessageId(string $messageId, string $discordMessageId): void
    {
        $storage = $this->pocketPing?->getStorage();
        if ($storage instanceof StorageWithBridgeIdsInterface) {
            $existingIds = $storage->getBridgeMessageIds($messageId);
            $newIds = new BridgeMessageIds(discordMessageId: $discordMessageId);
            if ($existingIds !== null) {
                $newIds = $existingIds->mergeWith($newIds);
            }
            $storage->saveBridgeMessageIds($messageId, $newIds);
        }
    }

    /**
     * Get bridge message IDs from storage.
     */
    private function getBridgeMessageIds(string $messageId): ?BridgeMessageIds
    {
        $storage = $this->pocketPing?->getStorage();
        if ($storage instanceof StorageWithBridgeIdsInterface) {
            return $storage->getBridgeMessageIds($messageId);
        }
        return null;
    }

    /**
     * Log a warning message.
     */
    private function logWarning(string $message): void
    {
        error_log("[PocketPing DiscordBridge] {$message}");
    }
}

<?php

declare(strict_types=1);

namespace PocketPing\Bridges;

use PocketPing\Exceptions\SetupException;
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
 * Slack bridge for sending chat notifications to a Slack channel.
 * Supports both webhook and bot modes.
 * Uses native cURL to call slack.com/api.
 */
class SlackBridge extends AbstractBridge implements BridgeWithEditDeleteInterface
{
    private const API_BASE = 'https://slack.com/api';

    private readonly bool $isWebhookMode;
    private readonly ?string $webhookUrl;
    private readonly ?string $botToken;
    private readonly ?string $channelId;
    private readonly ?string $username;
    private readonly ?string $iconEmoji;
    private readonly HttpClientInterface $httpClient;

    private function __construct(
        bool $isWebhookMode,
        ?string $webhookUrl = null,
        ?string $botToken = null,
        ?string $channelId = null,
        ?string $username = null,
        ?string $iconEmoji = null,
        ?HttpClientInterface $httpClient = null,
    ) {
        $this->isWebhookMode = $isWebhookMode;
        $this->webhookUrl = $webhookUrl;
        $this->botToken = $botToken;
        $this->channelId = $channelId;
        $this->username = $username;
        $this->iconEmoji = $iconEmoji;
        $this->httpClient = $httpClient ?? new CurlHttpClient();
    }

    /**
     * Create a Slack bridge using webhook mode.
     * Webhooks are simpler but cannot edit/delete messages.
     *
     * @throws SetupException if webhookUrl is missing or invalid
     */
    public static function webhook(
        string $webhookUrl,
        ?string $username = null,
        ?string $iconEmoji = null,
        ?HttpClientInterface $httpClient = null
    ): self {
        // Validate webhook URL
        if (empty($webhookUrl)) {
            throw new SetupException('Slack', 'webhook_url');
        }

        if (!str_starts_with($webhookUrl, 'https://hooks.slack.com/')) {
            throw new SetupException(
                'Slack',
                'valid webhook_url',
                "Webhook URL must start with https://hooks.slack.com/\n\n"
                    . SetupException::SETUP_GUIDES['slack']['webhook_url']
            );
        }

        return new self(
            isWebhookMode: true,
            webhookUrl: $webhookUrl,
            username: $username,
            iconEmoji: $iconEmoji,
            httpClient: $httpClient,
        );
    }

    /**
     * Create a Slack bridge using bot mode.
     * Bot mode supports full edit/delete functionality.
     *
     * @throws SetupException if botToken or channelId is missing or invalid
     */
    public static function bot(
        string $botToken,
        string $channelId,
        ?HttpClientInterface $httpClient = null
    ): self {
        // Validate bot token
        if (empty($botToken)) {
            throw new SetupException('Slack', 'bot_token');
        }

        if (!str_starts_with($botToken, 'xoxb-')) {
            throw new SetupException(
                'Slack',
                'valid bot_token',
                "Bot token must start with xoxb-\n\n"
                    . SetupException::SETUP_GUIDES['slack']['bot_token']
            );
        }

        // Validate channel ID
        if (empty($channelId)) {
            throw new SetupException('Slack', 'channel_id');
        }

        return new self(
            isWebhookMode: false,
            botToken: $botToken,
            channelId: $channelId,
            httpClient: $httpClient,
        );
    }

    public function getName(): string
    {
        return 'slack';
    }

    public function onNewSession(Session $session): void
    {
        $blocks = [
            [
                'type' => 'header',
                'text' => [
                    'type' => 'plain_text',
                    'text' => '🆕 New chat session',
                    'emoji' => true,
                ],
            ],
        ];

        // Contact info
        $email = $session->identity?->email;
        $phone = $session->userPhone;
        $userAgent = $session->metadata?->userAgent;

        $contactFields = [];
        if ($email) {
            $contactFields[] = ['type' => 'mrkdwn', 'text' => "*📧 Email:*\n{$email}"];
        }
        if ($phone) {
            $contactFields[] = ['type' => 'mrkdwn', 'text' => "*📱 Phone:*\n{$phone}"];
        }
        if ($userAgent) {
            $contactFields[] = ['type' => 'mrkdwn', 'text' => "*🌐 Device:*\n{$this->parseUserAgent($userAgent)}"];
        }

        if (!empty($contactFields)) {
            $blocks[] = ['type' => 'section', 'fields' => $contactFields];
        }

        $url = $session->metadata?->url;
        if ($url) {
            $blocks[] = [
                'type' => 'section',
                'fields' => [
                    ['type' => 'mrkdwn', 'text' => "*📍 Page:*\n{$url}"],
                ],
            ];
        }

        $visitorName = $email ?? $session->visitorId;
        $this->sendBlocks($blocks, "🆕 New chat session from {$visitorName}");
    }

    private function parseUserAgent(string $ua): string
    {
        $browser = 'Unknown';
        if (str_contains($ua, 'Firefox/')) {
            $browser = 'Firefox';
        } elseif (str_contains($ua, 'Edg/')) {
            $browser = 'Edge';
        } elseif (str_contains($ua, 'Chrome/')) {
            $browser = 'Chrome';
        } elseif (str_contains($ua, 'Safari/') && !str_contains($ua, 'Chrome')) {
            $browser = 'Safari';
        } elseif (str_contains($ua, 'Opera') || str_contains($ua, 'OPR/')) {
            $browser = 'Opera';
        }

        $os = 'Unknown';
        if (str_contains($ua, 'Windows')) {
            $os = 'Windows';
        } elseif (str_contains($ua, 'Mac OS')) {
            $os = 'macOS';
        } elseif (str_contains($ua, 'Linux') && !str_contains($ua, 'Android')) {
            $os = 'Linux';
        } elseif (str_contains($ua, 'Android')) {
            $os = 'Android';
        } elseif (str_contains($ua, 'iPhone') || str_contains($ua, 'iPad')) {
            $os = 'iOS';
        }

        return "{$browser}/{$os}";
    }

    public function onVisitorMessage(Message $message, Session $session): void
    {
        $visitorName = $this->getVisitorName($session);
        $content = $this->escapeSlack($message->content);

        $text = "💬 *{$visitorName}:*\n{$content}";
        $quote = $this->buildReplyQuote($message);
        if ($quote !== null) {
            $text = $quote . "\n" . $text;
        }

        // Add attachments info if present
        if (!empty($message->attachments)) {
            $attachmentCount = count($message->attachments);
            $text .= "\n\n📎 {$attachmentCount} attachment(s)";
        }

        $result = $this->sendMessage($text);

        // Store the message timestamp for edit/delete support
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
        // Skip messages from Slack to avoid echoing
        if ($sourceBridge === 'slack') {
            return;
        }

        $operator = $operatorName ?? 'Operator';
        $content = $this->escapeSlack($message->content);

        $text = "📤 *{$operator}* (via {$sourceBridge}):\n{$content}";

        $this->sendMessage($text);
    }

    private function buildReplyQuote(Message $message): ?string
    {
        if ($message->replyTo === null || $this->pocketPing === null) {
            return null;
        }

        $replyTarget = $this->pocketPing->getStorage()->getMessage($message->replyTo);
        if ($replyTarget === null) {
            return null;
        }

        $senderLabel = match ($replyTarget->sender) {
            'operator' => 'Support',
            'ai' => 'AI',
            default => 'Visitor',
        };

        $preview = $replyTarget->deletedAt !== null ? 'Message deleted' : ($replyTarget->content ?: 'Message');
        if (mb_strlen($preview) > 140) {
            $preview = mb_substr($preview, 0, 140) . '...';
        }

        $preview = $this->escapeSlack($preview);
        return "> *{$senderLabel}* — {$preview}";
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
        $eventName = $this->escapeSlack($event->name);

        $blocks = [
            [
                'type' => 'header',
                'text' => [
                    'type' => 'plain_text',
                    'text' => "🔔 Event: {$event->name}",
                    'emoji' => true,
                ],
            ],
            [
                'type' => 'section',
                'fields' => [
                    [
                        'type' => 'mrkdwn',
                        'text' => "👤 *From:*\n{$visitorName}",
                    ],
                ],
            ],
        ];

        if (!empty($event->data)) {
            $dataJson = json_encode($event->data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
            $blocks[] = [
                'type' => 'section',
                'text' => [
                    'type' => 'mrkdwn',
                    'text' => "📦 *Data:*\n```{$dataJson}```",
                ],
            ];
        }

        $this->sendBlocks($blocks, "🔔 Event: {$eventName} from {$visitorName}");
    }

    public function onIdentityUpdate(Session $session): void
    {
        if ($session->identity === null) {
            return;
        }

        $identity = $session->identity;
        $fields = [
            [
                'type' => 'mrkdwn',
                'text' => "🆔 *ID:*\n{$identity->id}",
            ],
        ];

        if ($identity->name !== null) {
            $fields[] = [
                'type' => 'mrkdwn',
                'text' => "📛 *Name:*\n{$this->escapeSlack($identity->name)}",
            ];
        }

        if ($identity->email !== null) {
            $fields[] = [
                'type' => 'mrkdwn',
                'text' => "📧 *Email:*\n{$this->escapeSlack($identity->email)}",
            ];
        }

        if ($session->userPhone !== null) {
            $fields[] = [
                'type' => 'mrkdwn',
                'text' => "📱 *Phone:*\n{$this->escapeSlack($session->userPhone)}",
            ];
        }

        $blocks = [
            [
                'type' => 'header',
                'text' => [
                    'type' => 'plain_text',
                    'text' => '👤 Visitor identified',
                    'emoji' => true,
                ],
            ],
            [
                'type' => 'section',
                'fields' => $fields,
            ],
        ];

        $this->sendBlocks($blocks, "👤 Visitor identified: {$identity->id}");
    }

    public function onTyping(string $sessionId, bool $isTyping): void
    {
        // Slack doesn't have a typing indicator API for channels
    }

    public function onAiTakeover(Session $session, string $reason): void
    {
        $visitorName = $this->getVisitorName($session);
        $reasonEscaped = $this->escapeSlack($reason);

        $blocks = [
            [
                'type' => 'header',
                'text' => [
                    'type' => 'plain_text',
                    'text' => '🤖 AI Takeover',
                    'emoji' => true,
                ],
            ],
            [
                'type' => 'section',
                'fields' => [
                    [
                        'type' => 'mrkdwn',
                        'text' => "👤 *Session:*\n{$visitorName}",
                    ],
                    [
                        'type' => 'mrkdwn',
                        'text' => "📝 *Reason:*\n{$reasonEscaped}",
                    ],
                ],
            ],
        ];

        $this->sendBlocks($blocks, "🤖 AI Takeover for {$visitorName}");
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
        if ($bridgeIds === null || $bridgeIds->slackMessageTs === null) {
            return null;
        }

        $text = "💬 _(edited)_\n{$this->escapeSlack($content)}";

        $result = $this->updateMessage($bridgeIds->slackMessageTs, $text);

        if ($result->success) {
            return new BridgeMessageIds(slackMessageTs: $bridgeIds->slackMessageTs);
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
        if ($bridgeIds === null || $bridgeIds->slackMessageTs === null) {
            return;
        }

        $this->deleteMessage($bridgeIds->slackMessageTs);
    }

    /**
     * Send a plain text message.
     */
    private function sendMessage(string $text): BridgeMessageResult
    {
        if ($this->isWebhookMode) {
            return $this->sendViaWebhook(['text' => $text]);
        }

        return $this->sendViaBot($text);
    }

    /**
     * Send a message with blocks.
     *
     * @param array<int, array<string, mixed>> $blocks
     */
    private function sendBlocks(array $blocks, string $fallbackText): BridgeMessageResult
    {
        if ($this->isWebhookMode) {
            return $this->sendViaWebhook([
                'text' => $fallbackText,
                'blocks' => $blocks,
            ]);
        }

        return $this->sendViaBotWithBlocks($blocks, $fallbackText);
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

        if ($this->username !== null) {
            $payload['username'] = $this->username;
        }

        if ($this->iconEmoji !== null) {
            $payload['icon_emoji'] = $this->iconEmoji;
        }

        $response = $this->httpClient->post($this->webhookUrl, $payload);

        if ($response['error'] !== null) {
            $this->logWarning("Slack webhook cURL error: {$response['error']}");
            return BridgeMessageResult::failure($response['error']);
        }

        // Slack webhooks return "ok" on success
        if ($response['body'] === 'ok' || $response['httpCode'] === 200) {
            // Webhooks don't return message IDs
            return new BridgeMessageResult(success: true);
        }

        $this->logWarning("Slack webhook error: {$response['body']}");
        return BridgeMessageResult::failure($response['body'] ?? 'Unknown error');
    }

    /**
     * Send a message via bot API.
     */
    private function sendViaBot(string $text): BridgeMessageResult
    {
        if ($this->botToken === null || $this->channelId === null) {
            return BridgeMessageResult::failure('Bot token or channel ID not configured');
        }

        $payload = [
            'channel' => $this->channelId,
            'text' => $text,
        ];

        $response = $this->apiRequest('chat.postMessage', $payload);

        if ($response === null || !isset($response['ok']) || $response['ok'] !== true) {
            $error = $response['error'] ?? 'Unknown error';
            $this->logWarning("Failed to send Slack message: {$error}");
            return BridgeMessageResult::failure($error);
        }

        $ts = $response['ts'] ?? null;
        if ($ts === null) {
            return BridgeMessageResult::failure('No ts in response');
        }

        return BridgeMessageResult::success($ts);
    }

    /**
     * Send a message with blocks via bot API.
     *
     * @param array<int, array<string, mixed>> $blocks
     */
    private function sendViaBotWithBlocks(array $blocks, string $fallbackText): BridgeMessageResult
    {
        if ($this->botToken === null || $this->channelId === null) {
            return BridgeMessageResult::failure('Bot token or channel ID not configured');
        }

        $payload = [
            'channel' => $this->channelId,
            'text' => $fallbackText,
            'blocks' => $blocks,
        ];

        $response = $this->apiRequest('chat.postMessage', $payload);

        if ($response === null || !isset($response['ok']) || $response['ok'] !== true) {
            $error = $response['error'] ?? 'Unknown error';
            $this->logWarning("Failed to send Slack message: {$error}");
            return BridgeMessageResult::failure($error);
        }

        $ts = $response['ts'] ?? null;
        if ($ts === null) {
            return BridgeMessageResult::failure('No ts in response');
        }

        return BridgeMessageResult::success($ts);
    }

    /**
     * Update a message via bot API.
     */
    private function updateMessage(string $ts, string $text): BridgeMessageResult
    {
        if ($this->botToken === null || $this->channelId === null) {
            return BridgeMessageResult::failure('Bot token or channel ID not configured');
        }

        $payload = [
            'channel' => $this->channelId,
            'ts' => $ts,
            'text' => $text,
        ];

        $response = $this->apiRequest('chat.update', $payload);

        if ($response === null || !isset($response['ok']) || $response['ok'] !== true) {
            $error = $response['error'] ?? 'Unknown error';
            $this->logWarning("Failed to update Slack message: {$error}");
            return BridgeMessageResult::failure($error);
        }

        return BridgeMessageResult::success($ts);
    }

    /**
     * Delete a message via bot API.
     */
    private function deleteMessage(string $ts): bool
    {
        if ($this->botToken === null || $this->channelId === null) {
            return false;
        }

        $payload = [
            'channel' => $this->channelId,
            'ts' => $ts,
        ];

        $response = $this->apiRequest('chat.delete', $payload);

        if ($response === null || !isset($response['ok']) || $response['ok'] !== true) {
            $error = $response['error'] ?? 'Unknown error';
            $this->logWarning("Failed to delete Slack message: {$error}");
            return false;
        }

        return true;
    }

    /**
     * Make a request to the Slack API.
     *
     * @param array<string, mixed> $payload
     * @return array<string, mixed>|null
     */
    private function apiRequest(string $method, array $payload): ?array
    {
        $url = self::API_BASE . '/' . $method;

        $response = $this->httpClient->post($url, $payload, [
            'Authorization' => 'Bearer ' . $this->botToken,
        ]);

        if ($response['error'] !== null) {
            $this->logWarning("Slack API cURL error: {$response['error']}");
            return null;
        }

        if ($response['body'] === null) {
            $this->logWarning("Slack API empty response");
            return null;
        }

        $data = json_decode($response['body'], true);
        if (!is_array($data)) {
            $this->logWarning("Slack API invalid JSON response");
            return null;
        }

        return $data;
    }

    /**
     * Escape special characters for Slack mrkdwn format.
     */
    private function escapeSlack(string $text): string
    {
        // Escape &, <, > for Slack
        $text = str_replace('&', '&amp;', $text);
        $text = str_replace('<', '&lt;', $text);
        $text = str_replace('>', '&gt;', $text);

        return $text;
    }

    /**
     * Get visitor name from session identity or visitor ID.
     */
    private function getVisitorName(Session $session): string
    {
        if ($session->identity?->name !== null) {
            return $this->escapeSlack($session->identity->name);
        }

        if ($session->identity?->email !== null) {
            return $this->escapeSlack($session->identity->email);
        }

        return $this->escapeSlack($session->visitorId);
    }

    /**
     * Store bridge message ID for edit/delete support.
     */
    private function storeBridgeMessageId(string $messageId, string $slackMessageTs): void
    {
        $storage = $this->pocketPing?->getStorage();
        if ($storage instanceof StorageWithBridgeIdsInterface) {
            $existingIds = $storage->getBridgeMessageIds($messageId);
            $newIds = new BridgeMessageIds(slackMessageTs: $slackMessageTs);
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
        error_log("[PocketPing SlackBridge] {$message}");
    }
}

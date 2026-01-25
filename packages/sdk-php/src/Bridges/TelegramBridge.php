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
 * Telegram bridge for sending chat notifications to a Telegram chat.
 * Uses native cURL to call api.telegram.org.
 */
class TelegramBridge extends AbstractBridge implements BridgeWithEditDeleteInterface
{
    private const API_BASE = 'https://api.telegram.org/bot';

    private readonly HttpClientInterface $httpClient;

    public function __construct(
        private readonly string $botToken,
        private readonly string|int $chatId,
        private readonly string $parseMode = 'HTML',
        private readonly bool $disableNotification = false,
        ?HttpClientInterface $httpClient = null,
    ) {
        $this->httpClient = $httpClient ?? new CurlHttpClient();
    }

    public function getName(): string
    {
        return 'telegram';
    }

    public function onNewSession(Session $session): void
    {
        $url = $session->metadata?->url ?? 'Unknown';
        $visitorName = $this->getVisitorName($session);

        $text = "🆕 <b>New chat session</b>\n"
            . "👤 Visitor: {$visitorName}\n"
            . "📍 {$url}";

        $this->sendMessage($text);
    }

    public function onVisitorMessage(Message $message, Session $session): void
    {
        $visitorName = $this->getVisitorName($session);
        $content = $this->escapeHtml($message->content);

        $text = "💬 <b>{$visitorName}:</b>\n{$content}";

        // Add attachments info if present
        if (!empty($message->attachments)) {
            $attachmentCount = count($message->attachments);
            $text .= "\n\n📎 {$attachmentCount} attachment(s)";
        }

        $replyToMessageId = null;
        if ($message->replyTo !== null) {
            $replyBridgeIds = $this->getBridgeMessageIds($message->replyTo);
            if ($replyBridgeIds?->telegramMessageId !== null) {
                $replyToMessageId = $replyBridgeIds->telegramMessageId;
            }
        }

        $result = $this->sendMessage($text, $replyToMessageId);

        // Store the message ID for edit/delete support
        if ($result->success && $result->platformMessageId !== null) {
            $this->storeBridgeMessageId($message->id, (int) $result->platformMessageId);
        }
    }

    public function onOperatorMessage(
        Message $message,
        Session $session,
        string $sourceBridge,
        ?string $operatorName = null
    ): void {
        // Skip messages from Telegram to avoid echoing
        if ($sourceBridge === 'telegram') {
            return;
        }

        $operator = $operatorName ?? 'Operator';
        $content = $this->escapeHtml($message->content);

        $text = "📤 <b>{$operator}</b> (via {$sourceBridge}):\n{$content}";

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
        $eventName = $this->escapeHtml($event->name);

        $text = "🔔 <b>Event:</b> {$eventName}\n"
            . "👤 From: {$visitorName}";

        if (!empty($event->data)) {
            $dataJson = json_encode($event->data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
            $text .= "\n<pre>" . $this->escapeHtml($dataJson) . "</pre>";
        }

        $this->sendMessage($text);
    }

    public function onIdentityUpdate(Session $session): void
    {
        if ($session->identity === null) {
            return;
        }

        $identity = $session->identity;
        $text = "👤 <b>Visitor identified</b>\n"
            . "🆔 ID: {$identity->id}";

        if ($identity->name !== null) {
            $text .= "\n📛 Name: " . $this->escapeHtml($identity->name);
        }

        if ($identity->email !== null) {
            $text .= "\n📧 Email: " . $this->escapeHtml($identity->email);
        }

        $this->sendMessage($text);
    }

    public function onTyping(string $sessionId, bool $isTyping): void
    {
        if ($isTyping) {
            $this->sendChatAction('typing');
        }
    }

    public function onAiTakeover(Session $session, string $reason): void
    {
        $visitorName = $this->getVisitorName($session);
        $reasonEscaped = $this->escapeHtml($reason);

        $text = "🤖 <b>AI Takeover</b>\n"
            . "👤 Session: {$visitorName}\n"
            . "📝 Reason: {$reasonEscaped}";

        $this->sendMessage($text);
    }

    public function onMessageEdit(
        string $sessionId,
        string $messageId,
        string $content,
        \DateTimeInterface $editedAt
    ): ?BridgeMessageIds {
        $bridgeIds = $this->getBridgeMessageIds($messageId);
        if ($bridgeIds === null || $bridgeIds->telegramMessageId === null) {
            return null;
        }

        $escapedContent = $this->escapeHtml($content);
        $text = "💬 <i>(edited)</i>\n{$escapedContent}";

        $result = $this->editMessageText($bridgeIds->telegramMessageId, $text);

        if ($result->success) {
            return new BridgeMessageIds(telegramMessageId: $bridgeIds->telegramMessageId);
        }

        return null;
    }

    public function onMessageDelete(
        string $sessionId,
        string $messageId,
        \DateTimeInterface $deletedAt
    ): void {
        $bridgeIds = $this->getBridgeMessageIds($messageId);
        if ($bridgeIds === null || $bridgeIds->telegramMessageId === null) {
            return;
        }

        $this->deleteMessage($bridgeIds->telegramMessageId);
    }

    /**
     * Send a message to the configured chat.
     */
    private function sendMessage(string $text, ?int $replyToMessageId = null): BridgeMessageResult
    {
        $params = [
            'chat_id' => $this->chatId,
            'text' => $text,
            'parse_mode' => $this->parseMode,
        ];

        if ($this->disableNotification) {
            $params['disable_notification'] = true;
        }
        if ($replyToMessageId !== null) {
            $params['reply_to_message_id'] = $replyToMessageId;
        }

        $response = $this->apiRequest('sendMessage', $params);

        if ($response === null || !isset($response['ok']) || $response['ok'] !== true) {
            $error = $response['description'] ?? 'Unknown error';
            $this->logWarning("Failed to send Telegram message: {$error}");
            return BridgeMessageResult::failure($error);
        }

        $messageId = $response['result']['message_id'] ?? null;
        if ($messageId === null) {
            return BridgeMessageResult::failure('No message_id in response');
        }

        return BridgeMessageResult::success((int) $messageId);
    }

    /**
     * Edit a message text.
     */
    private function editMessageText(int $telegramMessageId, string $text): BridgeMessageResult
    {
        $params = [
            'chat_id' => $this->chatId,
            'message_id' => $telegramMessageId,
            'text' => $text,
            'parse_mode' => $this->parseMode,
        ];

        $response = $this->apiRequest('editMessageText', $params);

        if ($response === null || !isset($response['ok']) || $response['ok'] !== true) {
            $error = $response['description'] ?? 'Unknown error';
            $this->logWarning("Failed to edit Telegram message: {$error}");
            return BridgeMessageResult::failure($error);
        }

        return BridgeMessageResult::success($telegramMessageId);
    }

    /**
     * Delete a message.
     */
    private function deleteMessage(int $telegramMessageId): bool
    {
        $params = [
            'chat_id' => $this->chatId,
            'message_id' => $telegramMessageId,
        ];

        $response = $this->apiRequest('deleteMessage', $params);

        if ($response === null || !isset($response['ok']) || $response['ok'] !== true) {
            $error = $response['description'] ?? 'Unknown error';
            $this->logWarning("Failed to delete Telegram message: {$error}");
            return false;
        }

        return true;
    }

    /**
     * Send a chat action (typing indicator).
     */
    private function sendChatAction(string $action): bool
    {
        $params = [
            'chat_id' => $this->chatId,
            'action' => $action,
        ];

        $response = $this->apiRequest('sendChatAction', $params);

        return $response !== null && isset($response['ok']) && $response['ok'] === true;
    }

    /**
     * Make a request to the Telegram Bot API.
     *
     * @param array<string, mixed> $params
     * @return array<string, mixed>|null
     */
    private function apiRequest(string $method, array $params): ?array
    {
        $url = self::API_BASE . $this->botToken . '/' . $method;

        $response = $this->httpClient->post($url, $params);

        if ($response['error'] !== null) {
            $this->logWarning("Telegram API cURL error: {$response['error']}");
            return null;
        }

        if ($response['body'] === null) {
            $this->logWarning("Telegram API empty response");
            return null;
        }

        $data = json_decode($response['body'], true);
        if (!is_array($data)) {
            $this->logWarning("Telegram API invalid JSON response");
            return null;
        }

        return $data;
    }

    /**
     * Escape HTML special characters for Telegram HTML parse mode.
     */
    private function escapeHtml(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    /**
     * Get visitor name from session identity or visitor ID.
     */
    private function getVisitorName(Session $session): string
    {
        if ($session->identity?->name !== null) {
            return $this->escapeHtml($session->identity->name);
        }

        if ($session->identity?->email !== null) {
            return $this->escapeHtml($session->identity->email);
        }

        return $this->escapeHtml($session->visitorId);
    }

    /**
     * Store bridge message ID for edit/delete support.
     */
    private function storeBridgeMessageId(string $messageId, int $telegramMessageId): void
    {
        $storage = $this->pocketPing?->getStorage();
        if ($storage instanceof StorageWithBridgeIdsInterface) {
            $existingIds = $storage->getBridgeMessageIds($messageId);
            $newIds = new BridgeMessageIds(telegramMessageId: $telegramMessageId);
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
        error_log("[PocketPing TelegramBridge] {$message}");
    }
}

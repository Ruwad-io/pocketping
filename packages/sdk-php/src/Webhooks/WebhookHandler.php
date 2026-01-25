<?php

declare(strict_types=1);

namespace PocketPing\Webhooks;

use PocketPing\Http\CurlHttpClient;
use PocketPing\Http\HttpClientInterface;

/**
 * Handles incoming webhooks from bridges (Telegram, Slack, Discord).
 *
 * Usage:
 *   $handler = new WebhookHandler(new WebhookConfig(
 *       telegramBotToken: 'your-telegram-bot-token',
 *       slackBotToken: 'your-slack-bot-token',
 *       onOperatorMessage: function ($sessionId, $content, $operatorName, $sourceBridge, $attachments) {
 *           // Handle the message
 *       },
 *   ));
 *
 *   // In your Telegram webhook endpoint:
 *   $payload = json_decode(file_get_contents('php://input'), true);
 *   $response = $handler->handleTelegramWebhook($payload);
 *   echo json_encode($response);
 */
class WebhookHandler
{
    private ?HttpClientInterface $httpClient = null;

    public function __construct(
        private readonly WebhookConfig $config,
    ) {}

    // ─────────────────────────────────────────────────────────────────
    // Telegram Webhook
    // ─────────────────────────────────────────────────────────────────

    /**
     * Handle an incoming Telegram webhook.
     *
     * @param array<string, mixed> $payload The parsed JSON payload from Telegram
     * @return array<string, mixed> Response to send back
     */
    public function handleTelegramWebhook(array $payload): array
    {
        if ($this->config->telegramBotToken === null) {
            return ['error' => 'Telegram not configured'];
        }

        $editedMessage = $payload['edited_message'] ?? null;
        if (is_array($editedMessage)) {
            $text = $editedMessage['text'] ?? '';
            $caption = $editedMessage['caption'] ?? '';

            if (str_starts_with($text, '/')) {
                return ['ok' => true];
            }

            if ($text === '') {
                $text = $caption;
            }

            if ($text === '') {
                return ['ok' => true];
            }

            $topicId = $editedMessage['message_thread_id'] ?? null;
            if ($topicId === null) {
                return ['ok' => true];
            }

            if ($this->config->onOperatorMessageEdit !== null) {
                $bridgeMessageId = (string) ($editedMessage['message_id'] ?? '');
                if ($bridgeMessageId !== '') {
                    ($this->config->onOperatorMessageEdit)(
                        (string) $topicId,
                        $bridgeMessageId,
                        $text,
                        'telegram'
                    );
                }
            }

            return ['ok' => true];
        }

        $messageReaction = $payload['message_reaction'] ?? null;
        if (is_array($messageReaction)) {
            $newReactions = $messageReaction['new_reaction'] ?? [];
            $emoji = $newReactions[0]['emoji'] ?? null;
            $topicId = $messageReaction['message_thread_id'] ?? null;

            if ($emoji !== null && str_contains($emoji, '🗑') && $topicId !== null) {
                if ($this->config->onOperatorMessageDelete !== null) {
                    $bridgeMessageId = (string) ($messageReaction['message_id'] ?? '');
                    if ($bridgeMessageId !== '') {
                        ($this->config->onOperatorMessageDelete)(
                            (string) $topicId,
                            $bridgeMessageId,
                            'telegram'
                        );
                    }
                }
            }

            return ['ok' => true];
        }

        $message = $payload['message'] ?? null;
        if ($message === null) {
            return ['ok' => true];
        }

        $text = $message['text'] ?? '';
        $caption = $message['caption'] ?? '';

        // Handle /delete command (reply-based)
        if ($text !== '' && str_starts_with($text, '/delete')) {
            $topicId = $message['message_thread_id'] ?? null;
            $replyId = $message['reply_to_message']['message_id'] ?? null;
            if ($topicId !== null && $replyId !== null && $this->config->onOperatorMessageDelete !== null) {
                ($this->config->onOperatorMessageDelete)(
                    (string) $topicId,
                    (string) $replyId,
                    'telegram'
                );
            }
            return ['ok' => true];
        }

        // Skip commands
        if (str_starts_with($text, '/')) {
            return ['ok' => true];
        }

        // Use caption if no text
        if ($text === '') {
            $text = $caption;
        }

        // Parse media
        $media = null;
        if (isset($message['photo']) && is_array($message['photo']) && count($message['photo']) > 0) {
            $largest = end($message['photo']);
            $media = new ParsedMedia(
                fileId: $largest['file_id'],
                filename: 'photo_' . time() . '.jpg',
                mimeType: 'image/jpeg',
                size: $largest['file_size'] ?? 0,
            );
        } elseif (isset($message['document'])) {
            $doc = $message['document'];
            $media = new ParsedMedia(
                fileId: $doc['file_id'],
                filename: $doc['file_name'] ?? 'document_' . time(),
                mimeType: $doc['mime_type'] ?? 'application/octet-stream',
                size: $doc['file_size'] ?? 0,
            );
        } elseif (isset($message['audio'])) {
            $audio = $message['audio'];
            $media = new ParsedMedia(
                fileId: $audio['file_id'],
                filename: $audio['file_name'] ?? 'audio_' . time() . '.mp3',
                mimeType: $audio['mime_type'] ?? 'audio/mpeg',
                size: $audio['file_size'] ?? 0,
            );
        } elseif (isset($message['video'])) {
            $video = $message['video'];
            $media = new ParsedMedia(
                fileId: $video['file_id'],
                filename: $video['file_name'] ?? 'video_' . time() . '.mp4',
                mimeType: $video['mime_type'] ?? 'video/mp4',
                size: $video['file_size'] ?? 0,
            );
        } elseif (isset($message['voice'])) {
            $voice = $message['voice'];
            $media = new ParsedMedia(
                fileId: $voice['file_id'],
                filename: 'voice_' . time() . '.ogg',
                mimeType: $voice['mime_type'] ?? 'audio/ogg',
                size: $voice['file_size'] ?? 0,
            );
        }

        // Skip if no content
        if ($text === '' && $media === null) {
            return ['ok' => true];
        }

        // Get topic ID (session identifier)
        $topicId = $message['message_thread_id'] ?? null;
        if ($topicId === null) {
            return ['ok' => true];
        }

        // Get operator name
        $operatorName = $message['from']['first_name'] ?? 'Operator';

        // Get reply_to_message ID if present (for visual reply linking)
        $replyToBridgeMessageId = $message['reply_to_message']['message_id'] ?? null;

        // Download media if present
        $attachments = [];
        if ($media !== null) {
            $data = $this->downloadTelegramFile($media->fileId);
            if ($data !== null) {
                $attachments[] = new OperatorAttachment(
                    filename: $media->filename,
                    mimeType: $media->mimeType,
                    size: $media->size,
                    data: $data,
                    bridgeFileId: $media->fileId,
                );
            }
        }

        // Call callback
        if ($this->config->onOperatorMessage !== null) {
            ($this->config->onOperatorMessage)(
                (string) $topicId,
                $text,
                $operatorName,
                'telegram',
                $attachments,
                $replyToBridgeMessageId
            );
        }
        if ($this->config->onOperatorMessageWithIds !== null) {
            $bridgeMessageId = (string) ($message['message_id'] ?? '');
            if ($bridgeMessageId !== '') {
                ($this->config->onOperatorMessageWithIds)(
                    (string) $topicId,
                    $text,
                    $operatorName,
                    'telegram',
                    $attachments,
                    $replyToBridgeMessageId,
                    $bridgeMessageId
                );
            }
        }

        return ['ok' => true];
    }

    private function downloadTelegramFile(string $fileId): ?string
    {
        try {
            $botToken = $this->config->telegramBotToken;
            if ($botToken === null) {
                return null;
            }

            // Get file path
            $getFileUrl = "https://api.telegram.org/bot{$botToken}/getFile?file_id=" . urlencode($fileId);
            $response = $this->getHttpClient()->get($getFileUrl);

            if ($response['statusCode'] !== 200) {
                return null;
            }

            $result = json_decode($response['body'], true);
            if (!($result['ok'] ?? false) || !isset($result['result']['file_path'])) {
                return null;
            }

            $filePath = $result['result']['file_path'];

            // Download file
            $downloadUrl = "https://api.telegram.org/file/bot{$botToken}/{$filePath}";
            $fileResponse = $this->getHttpClient()->get($downloadUrl);

            if ($fileResponse['statusCode'] !== 200) {
                return null;
            }

            return $fileResponse['body'];
        } catch (\Throwable $e) {
            error_log('[WebhookHandler] Telegram file download error: ' . $e->getMessage());
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Slack Webhook
    // ─────────────────────────────────────────────────────────────────

    /**
     * Handle an incoming Slack webhook.
     *
     * @param array<string, mixed> $payload The parsed JSON payload from Slack
     * @return array<string, mixed> Response to send back
     */
    public function handleSlackWebhook(array $payload): array
    {
        if ($this->config->slackBotToken === null) {
            return ['error' => 'Slack not configured'];
        }

        // Handle URL verification challenge
        if (($payload['type'] ?? '') === 'url_verification' && isset($payload['challenge'])) {
            return ['challenge' => $payload['challenge']];
        }

        // Handle event callbacks
        if (($payload['type'] ?? '') === 'event_callback' && isset($payload['event'])) {
            $event = $payload['event'];
            $allowedBotIds = $this->config->allowedBotIds ?? [];

            if (($event['type'] ?? '') !== 'message') {
                return ['ok' => true];
            }

            $subtype = $event['subtype'] ?? null;
            if ($subtype === 'message_changed') {
                if ($this->config->onOperatorMessageEdit !== null) {
                    $message = $event['message'] ?? [];
                    $previous = $event['previous_message'] ?? [];
                    $botId = $message['bot_id'] ?? $previous['bot_id'] ?? $event['bot_id'] ?? null;
                    if ($botId !== null && !in_array($botId, $allowedBotIds, true)) {
                        return ['ok' => true];
                    }

                    $threadTs = $message['thread_ts'] ?? $previous['thread_ts'] ?? null;
                    $messageTs = $message['ts'] ?? $previous['ts'] ?? null;
                    $text = $message['text'] ?? '';

                    if ($threadTs !== null && $messageTs !== null) {
                        ($this->config->onOperatorMessageEdit)(
                            $threadTs,
                            $messageTs,
                            $text,
                            'slack'
                        );
                    }
                }

                return ['ok' => true];
            }

            if ($subtype === 'message_deleted') {
                if ($this->config->onOperatorMessageDelete !== null) {
                    $previous = $event['previous_message'] ?? [];
                    $botId = $previous['bot_id'] ?? $event['bot_id'] ?? null;
                    if ($botId !== null && !in_array($botId, $allowedBotIds, true)) {
                        return ['ok' => true];
                    }

                    $threadTs = $previous['thread_ts'] ?? null;
                    $messageTs = $event['deleted_ts'] ?? $previous['ts'] ?? null;

                    if ($threadTs !== null && $messageTs !== null) {
                        ($this->config->onOperatorMessageDelete)(
                            $threadTs,
                            $messageTs,
                            'slack'
                        );
                    }
                }

                return ['ok' => true];
            }

            $hasContent = ($event['type'] ?? '') === 'message'
                && isset($event['thread_ts'])
                && (!isset($event['bot_id']) || in_array($event['bot_id'], $allowedBotIds, true))
                && !isset($event['subtype']);

            $files = $event['files'] ?? [];
            $hasFiles = count($files) > 0;

            if ($hasContent && (($event['text'] ?? '') !== '' || $hasFiles)) {
                $threadTs = $event['thread_ts'];
                $text = $event['text'] ?? '';

                // Download files if present
                $attachments = [];
                if ($hasFiles) {
                    foreach ($files as $file) {
                        $data = $this->downloadSlackFile($file);
                        if ($data !== null) {
                            $attachments[] = new OperatorAttachment(
                                filename: $file['name'] ?? 'file',
                                mimeType: $file['mimetype'] ?? 'application/octet-stream',
                                size: $file['size'] ?? 0,
                                data: $data,
                                bridgeFileId: $file['id'] ?? null,
                            );
                        }
                    }
                }

                // Get operator name
                $operatorName = 'Operator';
                $userId = $event['user'] ?? null;
                if ($userId !== null) {
                    $name = $this->getSlackUserName($userId);
                    if ($name !== null) {
                        $operatorName = $name;
                    }
                }

                // Call callback (Slack reply support TODO)
                if ($this->config->onOperatorMessage !== null) {
                    ($this->config->onOperatorMessage)(
                        $threadTs,
                        $text,
                        $operatorName,
                        'slack',
                        $attachments,
                        null
                    );
                }
                if ($this->config->onOperatorMessageWithIds !== null) {
                    $messageTs = $event['ts'] ?? null;
                    if ($messageTs !== null) {
                        ($this->config->onOperatorMessageWithIds)(
                            $threadTs,
                            $text,
                            $operatorName,
                            'slack',
                            $attachments,
                            null,
                            (string) $messageTs
                        );
                    }
                }
            }
        }

        return ['ok' => true];
    }

    /**
     * @param array<string, mixed> $file
     */
    private function downloadSlackFile(array $file): ?string
    {
        try {
            $downloadUrl = $file['url_private_download'] ?? $file['url_private'] ?? null;
            if ($downloadUrl === null) {
                return null;
            }

            $response = $this->getHttpClient()->get($downloadUrl, [
                'Authorization' => 'Bearer ' . $this->config->slackBotToken,
            ]);

            if ($response['statusCode'] !== 200) {
                return null;
            }

            return $response['body'];
        } catch (\Throwable $e) {
            error_log('[WebhookHandler] Slack file download error: ' . $e->getMessage());
            return null;
        }
    }

    private function getSlackUserName(string $userId): ?string
    {
        try {
            $url = 'https://slack.com/api/users.info?user=' . urlencode($userId);
            $response = $this->getHttpClient()->get($url, [
                'Authorization' => 'Bearer ' . $this->config->slackBotToken,
            ]);

            if ($response['statusCode'] !== 200) {
                return null;
            }

            $result = json_decode($response['body'], true);
            if (!($result['ok'] ?? false)) {
                return null;
            }

            return $result['user']['real_name'] ?? $result['user']['name'] ?? null;
        } catch (\Throwable) {
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Discord Webhook
    // ─────────────────────────────────────────────────────────────────

    /**
     * Handle an incoming Discord webhook (interactions endpoint).
     *
     * @param array<string, mixed> $payload The parsed JSON payload from Discord
     * @return array<string, mixed> Response to send back
     */
    public function handleDiscordWebhook(array $payload): array
    {
        $PING = 1;
        $APPLICATION_COMMAND = 2;
        $PONG = 1;
        $CHANNEL_MESSAGE = 4;

        $interactionType = $payload['type'] ?? 0;

        // Handle PING (verification)
        if ($interactionType === $PING) {
            return ['type' => $PONG];
        }

        // Handle Application Commands (slash commands)
        if ($interactionType === $APPLICATION_COMMAND && isset($payload['data'])) {
            $data = $payload['data'];
            if (($data['name'] ?? '') === 'reply') {
                $threadId = $payload['channel_id'] ?? null;
                $content = null;

                foreach ($data['options'] ?? [] as $opt) {
                    if (($opt['name'] ?? '') === 'message') {
                        $content = $opt['value'] ?? null;
                        break;
                    }
                }

                if ($threadId !== null && $content !== null) {
                    // Get operator name
                    $operatorName = $payload['member']['user']['username']
                        ?? $payload['user']['username']
                        ?? 'Operator';

                    // Call callback (Discord reply support TODO)
                    if ($this->config->onOperatorMessage !== null) {
                        ($this->config->onOperatorMessage)(
                            $threadId,
                            $content,
                            $operatorName,
                            'discord',
                            [],
                            null
                        );
                    }

                    return [
                        'type' => $CHANNEL_MESSAGE,
                        'data' => ['content' => '✅ Message sent to visitor'],
                    ];
                }
            }
        }

        return ['type' => $PONG];
    }

    // ─────────────────────────────────────────────────────────────────
    // HTTP Client
    // ─────────────────────────────────────────────────────────────────

    private function getHttpClient(): HttpClientInterface
    {
        if ($this->httpClient === null) {
            $this->httpClient = new CurlHttpClient();
        }
        return $this->httpClient;
    }
}

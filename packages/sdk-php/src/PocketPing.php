<?php

declare(strict_types=1);

namespace PocketPing;

use PocketPing\AI\AIProviderInterface;
use PocketPing\Bridges\BridgeInterface;
use PocketPing\Bridges\BridgeWithEditDeleteInterface;
use PocketPing\Models\Attachment;
use PocketPing\Models\AttachmentStatus;
use PocketPing\Models\BridgeMessageIds;
use PocketPing\Models\ConnectRequest;
use PocketPing\Models\ConnectResponse;
use PocketPing\Models\CustomEvent;
use PocketPing\Models\DeleteMessageRequest;
use PocketPing\Models\DeleteMessageResponse;
use PocketPing\Models\EditMessageRequest;
use PocketPing\Models\EditMessageResponse;
use PocketPing\Models\IdentifyRequest;
use PocketPing\Models\IdentifyResponse;
use PocketPing\Models\Message;
use PocketPing\Models\MessageStatus;
use PocketPing\Models\PresenceResponse;
use PocketPing\Models\ReadRequest;
use PocketPing\Models\ReadResponse;
use PocketPing\Models\Sender;
use PocketPing\Models\SendMessageRequest;
use PocketPing\Models\SendMessageResponse;
use PocketPing\Models\Session;
use PocketPing\Models\TrackedElement;
use PocketPing\Models\TypingRequest;
use PocketPing\Models\UploadRequest;
use PocketPing\Models\UploadResponse;
use PocketPing\Models\VersionCheckResult;
use PocketPing\Models\VersionWarning;
use PocketPing\Models\WebSocketEvent;
use PocketPing\Storage\MemoryStorage;
use PocketPing\Storage\StorageInterface;
use PocketPing\Storage\StorageWithAttachmentsInterface;
use PocketPing\Storage\StorageWithBridgeIdsInterface;
use PocketPing\Utils\IpFilter;
use PocketPing\Utils\IpFilterConfig;
use PocketPing\Utils\IpFilterResult;
use PocketPing\Utils\UaFilterConfig;
use PocketPing\Utils\UaFilterReason;
use PocketPing\Utils\UaFilterResult;
use PocketPing\Utils\UserAgentFilter;
use PocketPing\Version\VersionChecker;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

/**
 * Main PocketPing class for handling chat sessions.
 */
class PocketPing
{
    /** Default maximum attachment size in bytes (10 MB). */
    public const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

    /** Default base URL for presigned upload URLs. */
    public const DEFAULT_UPLOAD_BASE_URL = 'https://uploads.pocketping.local';

    /** Lifetime of a presigned upload URL in seconds (15 minutes). */
    public const UPLOAD_URL_TTL_SECONDS = 900;

    /** Default system prompt used for AI fallback replies. */
    public const DEFAULT_AI_SYSTEM_PROMPT = "You are a helpful customer support assistant. "
        . "Be friendly, concise, and helpful. If you don't know something, say so and offer "
        . "to connect them with a human.";

    /** Default delay (seconds) before AI takes over when the operator is offline. */
    public const DEFAULT_AI_TAKEOVER_DELAY = 300;

    /** @var list<string> Default allowed MIME types for attachments. */
    public const DEFAULT_ALLOWED_MIME_TYPES = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'text/plain',
        'text/csv',
        'application/zip',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'video/mp4',
        'audio/mpeg',
    ];

    private StorageInterface $storage;
    private VersionChecker $versionChecker;
    private LoggerInterface $logger;
    private ?IpFilterConfig $ipFilter = null;
    private ?UaFilterConfig $uaFilter = null;

    private int $maxAttachmentSize;

    /** @var list<string> */
    private array $allowedMimeTypes;

    private string $uploadBaseUrl;

    /** @var BridgeInterface[] */
    private array $bridges = [];

    /** @var array<string, object[]> WebSocket connections by session ID */
    private array $websocketConnections = [];

    /** @var array<string, float> Last operator activity by session ID */
    private array $lastOperatorActivity = [];

    /** @var array<string, callable[]> Event handlers by event name */
    private array $eventHandlers = [];

    private bool $operatorOnline = false;

    private ?AIProviderInterface $aiProvider = null;
    private string $aiSystemPrompt;
    private int $aiTakeoverDelay;

    /**
     * @param StorageInterface|null $storage Storage adapter
     * @param BridgeInterface[] $bridges Notification bridges
     * @param string|null $welcomeMessage Welcome message for new visitors
     * @param string|null $minWidgetVersion Minimum supported widget version
     * @param string|null $latestWidgetVersion Latest widget version
     * @param string|null $versionWarningMessage Custom version warning message
     * @param string $versionUpgradeUrl URL for upgrade instructions
     * @param callable(Session): void|null $onNewSession Callback for new sessions
     * @param callable(Message, Session): void|null $onMessage Callback for messages
     * @param callable(CustomEvent, Session): void|null $onEvent Callback for custom events
     * @param callable(Session): void|null $onIdentify Callback for identity updates
     * @param LoggerInterface|null $logger PSR-3 logger
     * @param TrackedElement[]|null $trackedElements Elements to track
     * @param IpFilterConfig|array<string, mixed>|null $ipFilter IP filter configuration
     * @param AIProviderInterface|null $aiProvider AI provider for offline fallback replies
     * @param string|null $aiSystemPrompt System prompt for AI fallback replies
     * @param int|null $aiTakeoverDelay Seconds offline before AI takes over (default 300)
     */
    public function __construct(
        ?StorageInterface $storage = null,
        array $bridges = [],
        private readonly ?string $welcomeMessage = null,
        ?string $minWidgetVersion = null,
        ?string $latestWidgetVersion = null,
        ?string $versionWarningMessage = null,
        string $versionUpgradeUrl = 'https://docs.pocketping.io/widget/installation',
        /** @var callable(Session): void|null */
        private $onNewSession = null,
        /** @var callable(Message, Session): void|null */
        private $onMessage = null,
        /** @var callable(CustomEvent, Session): void|null */
        private $onEvent = null,
        /** @var callable(Session): void|null */
        private $onIdentify = null,
        ?LoggerInterface $logger = null,
        /** @var TrackedElement[]|null */
        private ?array $trackedElements = null,
        IpFilterConfig|array|null $ipFilter = null,
        ?UaFilterConfig $uaFilter = null,
        ?int $maxAttachmentSize = null,
        /** @var list<string>|null */
        ?array $allowedMimeTypes = null,
        ?string $uploadBaseUrl = null,
        ?AIProviderInterface $aiProvider = null,
        ?string $aiSystemPrompt = null,
        ?int $aiTakeoverDelay = null,
    ) {
        $this->storage = $storage ?? new MemoryStorage();
        $this->bridges = $bridges;
        $this->logger = $logger ?? new NullLogger();

        $this->versionChecker = new VersionChecker(
            minVersion: $minWidgetVersion,
            latestVersion: $latestWidgetVersion,
            warningMessage: $versionWarningMessage,
            upgradeUrl: $versionUpgradeUrl,
        );

        // IP filtering - accept array or IpFilterConfig
        if ($ipFilter !== null) {
            $this->ipFilter = is_array($ipFilter)
                ? IpFilterConfig::fromArray($ipFilter)
                : $ipFilter;
        }

        // User-Agent filtering
        $this->uaFilter = $uaFilter;

        // Attachment configuration (overridable)
        $this->maxAttachmentSize = $maxAttachmentSize ?? self::MAX_ATTACHMENT_SIZE;
        $this->allowedMimeTypes = $allowedMimeTypes ?? self::DEFAULT_ALLOWED_MIME_TYPES;
        $this->uploadBaseUrl = rtrim($uploadBaseUrl ?? self::DEFAULT_UPLOAD_BASE_URL, '/');

        // AI fallback configuration
        $this->aiProvider = $aiProvider;
        $this->aiSystemPrompt = $aiSystemPrompt ?? self::DEFAULT_AI_SYSTEM_PROMPT;
        $this->aiTakeoverDelay = $aiTakeoverDelay ?? self::DEFAULT_AI_TAKEOVER_DELAY;

        // Initialize bridges
        foreach ($this->bridges as $bridge) {
            $bridge->init($this);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // IP Filtering
    // ─────────────────────────────────────────────────────────────────

    /**
     * Check if an IP address is allowed by the filter.
     *
     * @param array<string, mixed>|null $requestInfo Additional request information
     */
    public function checkIpFilter(string $ip, ?array $requestInfo = null): IpFilterResult
    {
        return IpFilter::checkIpFilter($ip, $this->ipFilter, $requestInfo);
    }

    /**
     * Check IP filter with logging for blocked IPs.
     *
     * @param array<string, mixed>|null $requestInfo Additional request information
     */
    public function checkIpFilterWithLogging(string $ip, ?array $requestInfo = null): IpFilterResult
    {
        $result = $this->checkIpFilter($ip, $requestInfo);
        IpFilter::logFilterEvent($this->ipFilter, $result, $ip, $requestInfo);
        return $result;
    }

    /**
     * Get client IP from headers or $_SERVER.
     *
     * @param array<string, string>|null $headers Optional headers array
     */
    public function getClientIp(?array $headers = null): string
    {
        return IpFilter::getClientIp($headers);
    }

    /**
     * Get the IP filter configuration.
     */
    public function getIpFilter(): ?IpFilterConfig
    {
        return $this->ipFilter;
    }

    /**
     * Create a blocked response for use with HTTP responses.
     *
     * @return array{status: int, headers: array<string, string>, body: string}
     */
    public function createBlockedResponse(): array
    {
        return IpFilter::createBlockedResponse($this->ipFilter);
    }

    // ─────────────────────────────────────────────────────────────────
    // User-Agent Filtering
    // ─────────────────────────────────────────────────────────────────

    /**
     * Check if a user-agent is allowed by the filter.
     *
     * @param array<string, mixed>|null $requestInfo Additional request information
     */
    public function checkUaFilter(?string $userAgent, ?array $requestInfo = null): UaFilterResult
    {
        if ($this->uaFilter === null) {
            return new UaFilterResult(true, UaFilterReason::DEFAULT);
        }

        return UserAgentFilter::checkUaFilter($userAgent, $this->uaFilter, $requestInfo ?? []);
    }

    /**
     * Extract the client user-agent from a headers array or $_SERVER.
     *
     * @param array<string, string>|null $headers Optional headers array
     */
    public function getClientUserAgent(?array $headers = null): ?string
    {
        if ($headers !== null) {
            foreach ($headers as $name => $value) {
                if (strtolower($name) === 'user-agent') {
                    return $value;
                }
            }

            return null;
        }

        return $_SERVER['HTTP_USER_AGENT'] ?? null;
    }

    /**
     * Get the user-agent filter configuration.
     */
    public function getUaFilter(): ?UaFilterConfig
    {
        return $this->uaFilter;
    }

    // ─────────────────────────────────────────────────────────────────
    // Protocol Handlers
    // ─────────────────────────────────────────────────────────────────

    /**
     * Handle a connection request from the widget.
     */
    public function handleConnect(ConnectRequest $request): ConnectResponse
    {
        $session = null;

        // Try to resume existing session by session_id
        if ($request->sessionId !== null) {
            $session = $this->storage->getSession($request->sessionId);
        }

        // Try to find existing session by visitor_id
        if ($session === null) {
            $session = $this->storage->getSessionByVisitorId($request->visitorId);
        }

        // Create new session if needed
        if ($session === null) {
            $session = new Session(
                id: $this->generateId(),
                visitorId: $request->visitorId,
                createdAt: new \DateTimeImmutable(),
                lastActivity: new \DateTimeImmutable(),
                operatorOnline: $this->operatorOnline,
                aiActive: false,
                metadata: $request->metadata,
                identity: $request->identity,
            );

            $this->storage->createSession($session);

            // Notify bridges
            $this->notifyBridgesNewSession($session);

            // Callback
            if ($this->onNewSession !== null) {
                ($this->onNewSession)($session);
            }
        } else {
            $needsUpdate = false;

            // Update metadata if provided
            if ($request->metadata !== null) {
                if ($session->metadata !== null) {
                    // Merge, preserving geo info
                    $session->metadata = $session->metadata->mergeWith($request->metadata);
                } else {
                    $session->metadata = $request->metadata;
                }
                $needsUpdate = true;
            }

            // Update identity if provided
            if ($request->identity !== null) {
                $session->identity = $request->identity;
                $needsUpdate = true;
            }

            if ($needsUpdate) {
                $session->lastActivity = new \DateTimeImmutable();
                $this->storage->updateSession($session);
            }
        }

        // Get existing messages
        $messages = $this->storage->getMessages($session->id);

        return new ConnectResponse(
            sessionId: $session->id,
            visitorId: $session->visitorId,
            operatorOnline: $this->operatorOnline,
            welcomeMessage: $this->welcomeMessage,
            messages: $messages,
            trackedElements: $this->trackedElements,
        );
    }

    /**
     * Handle a message from visitor or operator.
     */
    public function handleMessage(SendMessageRequest $request): SendMessageResponse
    {
        $session = $this->storage->getSession($request->sessionId);
        if ($session === null) {
            throw new \InvalidArgumentException('Session not found');
        }

        $messageId = $this->generateId();

        // Link any referenced attachments to this message before persisting,
        // so bridges and the broadcast see the populated attachments.
        $attachments = $this->linkAttachments($request->attachmentIds, $messageId);

        $message = new Message(
            id: $messageId,
            sessionId: $request->sessionId,
            content: $request->content,
            sender: $request->sender,
            timestamp: new \DateTimeImmutable(),
            replyTo: $request->replyTo,
            attachments: $attachments,
        );

        $this->storage->saveMessage($message);

        // Update session activity
        $session->lastActivity = new \DateTimeImmutable();
        $this->storage->updateSession($session);

        // Track operator activity for presence detection
        if ($request->sender === Sender::OPERATOR) {
            $this->lastOperatorActivity[$request->sessionId] = microtime(true);

            // If operator responds, disable AI for this session
            if ($session->aiActive) {
                $session->aiActive = false;
                $this->storage->updateSession($session);
            }
        }

        // Notify bridges (only for visitor messages)
        if ($request->sender === Sender::VISITOR) {
            $this->notifyBridgesMessage($message, $session);
        }

        // Broadcast to WebSocket clients
        $this->broadcastToSession(
            $request->sessionId,
            new WebSocketEvent('message', $message->toArray())
        );

        // Callback
        if ($this->onMessage !== null) {
            ($this->onMessage)($message, $session);
        }

        // AI fallback: maybe respond with an AI message when the operator is offline.
        if ($request->sender === Sender::VISITOR) {
            $this->maybeAiRespond($session);
        }

        return new SendMessageResponse(
            messageId: $message->id,
            timestamp: $message->timestamp,
        );
    }

    /**
     * Get messages for a session.
     *
     * @return array{messages: array<array<string, mixed>>, hasMore: bool}
     */
    public function handleGetMessages(string $sessionId, ?string $after = null, int $limit = 50): array
    {
        $limit = min($limit, 100);
        $messages = $this->storage->getMessages($sessionId, $after, $limit + 1);

        return [
            'messages' => array_map(fn(Message $m) => $m->toArray(), array_slice($messages, 0, $limit)),
            'hasMore' => count($messages) > $limit,
        ];
    }

    /**
     * Handle typing indicator.
     *
     * @return array{ok: bool}
     */
    public function handleTyping(TypingRequest $request): array
    {
        $this->broadcastToSession(
            $request->sessionId,
            new WebSocketEvent('typing', [
                'sessionId' => $request->sessionId,
                'sender' => $request->sender->value,
                'isTyping' => $request->isTyping,
            ])
        );

        return ['ok' => true];
    }

    /**
     * Get operator presence status.
     */
    public function handlePresence(): PresenceResponse
    {
        return new PresenceResponse(
            online: $this->operatorOnline,
            aiEnabled: $this->aiProvider !== null,
            aiActiveAfter: $this->aiTakeoverDelay,
        );
    }

    /**
     * Handle message read/delivered status update.
     */
    public function handleRead(ReadRequest $request): ReadResponse
    {
        $updated = 0;
        $now = new \DateTimeImmutable();

        foreach ($request->messageIds as $messageId) {
            $message = $this->storage->getMessage($messageId);
            if ($message !== null && $message->sessionId === $request->sessionId) {
                // Update status
                $message->status = $request->status;
                if ($request->status === MessageStatus::DELIVERED) {
                    $message->deliveredAt = $now;
                } elseif ($request->status === MessageStatus::READ) {
                    $message->deliveredAt = $message->deliveredAt ?? $now;
                    $message->readAt = $now;
                }

                $this->storage->saveMessage($message);
                $updated++;
            }
        }

        // Broadcast read event
        if ($updated > 0) {
            $broadcastData = [
                'sessionId' => $request->sessionId,
                'messageIds' => $request->messageIds,
                'status' => $request->status->value,
            ];

            if ($request->status === MessageStatus::DELIVERED) {
                $broadcastData['deliveredAt'] = $now->format(\DateTimeInterface::ATOM);
            } elseif ($request->status === MessageStatus::READ) {
                $broadcastData['readAt'] = $now->format(\DateTimeInterface::ATOM);
                $broadcastData['deliveredAt'] = $now->format(\DateTimeInterface::ATOM);
            }

            $this->broadcastToSession(
                $request->sessionId,
                new WebSocketEvent('read', $broadcastData)
            );

            // Notify bridges
            $session = $this->storage->getSession($request->sessionId);
            if ($session !== null) {
                $this->notifyBridgesRead($request->sessionId, $request->messageIds, $request->status, $session);
            }
        }

        return new ReadResponse(updated: $updated);
    }

    /**
     * Handle editing a visitor's message.
     */
    public function handleEditMessage(EditMessageRequest $request): EditMessageResponse
    {
        if (trim($request->content) === '') {
            throw new \InvalidArgumentException('Content cannot be empty');
        }

        $session = $this->storage->getSession($request->sessionId);
        if ($session === null) {
            throw new \InvalidArgumentException('Session not found');
        }

        $message = $this->storage->getMessage($request->messageId);
        if ($message === null) {
            throw new \InvalidArgumentException('Message not found');
        }

        // Verify message belongs to this session
        if ($message->sessionId !== $request->sessionId) {
            throw new \InvalidArgumentException('Message not found');
        }

        // Only visitors can edit their own messages
        if ($message->sender !== Sender::VISITOR) {
            throw new \InvalidArgumentException('Unauthorized: can only edit own messages');
        }

        // Cannot edit deleted messages
        if ($message->deletedAt !== null) {
            throw new \InvalidArgumentException('Cannot edit deleted message');
        }

        $now = new \DateTimeImmutable();
        $message->content = $request->content;
        $message->editedAt = $now;

        // Use updateMessage if available, otherwise saveMessage
        if ($this->storage instanceof StorageWithBridgeIdsInterface) {
            $this->storage->updateMessage($message);
        } else {
            $this->storage->saveMessage($message);
        }

        // Sync edit to bridges
        $this->syncEditToBridges($request->sessionId, $request->messageId, $request->content, $now);

        // Broadcast to WebSocket
        $this->broadcastToSession(
            $request->sessionId,
            new WebSocketEvent('message_edited', [
                'messageId' => $request->messageId,
                'content' => $request->content,
                'editedAt' => $now->format(\DateTimeInterface::ATOM),
            ])
        );

        return new EditMessageResponse(
            message: [
                'id' => $message->id,
                'content' => $message->content,
                'editedAt' => $now->format(\DateTimeInterface::ATOM),
            ],
        );
    }

    /**
     * Handle deleting a visitor's message.
     */
    public function handleDeleteMessage(DeleteMessageRequest $request): DeleteMessageResponse
    {
        $session = $this->storage->getSession($request->sessionId);
        if ($session === null) {
            throw new \InvalidArgumentException('Session not found');
        }

        $message = $this->storage->getMessage($request->messageId);
        if ($message === null) {
            throw new \InvalidArgumentException('Message not found');
        }

        // Verify message belongs to this session
        if ($message->sessionId !== $request->sessionId) {
            throw new \InvalidArgumentException('Message not found');
        }

        // Only visitors can delete their own messages
        if ($message->sender !== Sender::VISITOR) {
            throw new \InvalidArgumentException('Unauthorized: can only delete own messages');
        }

        // Sync delete to bridges BEFORE soft delete (we need bridge IDs)
        $now = new \DateTimeImmutable();
        $this->syncDeleteToBridges($request->sessionId, $request->messageId, $now);

        // Soft delete the message
        $message->deletedAt = $now;

        // Use updateMessage if available, otherwise saveMessage
        if ($this->storage instanceof StorageWithBridgeIdsInterface) {
            $this->storage->updateMessage($message);
        } else {
            $this->storage->saveMessage($message);
        }

        // Broadcast to WebSocket
        $this->broadcastToSession(
            $request->sessionId,
            new WebSocketEvent('message_deleted', [
                'messageId' => $request->messageId,
                'deletedAt' => $now->format(\DateTimeInterface::ATOM),
            ])
        );

        return new DeleteMessageResponse(deleted: true);
    }

    // ─────────────────────────────────────────────────────────────────
    // File Attachments
    // ─────────────────────────────────────────────────────────────────

    /**
     * Handle a request for a presigned upload URL (presigned URL pattern).
     */
    public function handleUploadRequest(UploadRequest $request): UploadResponse
    {
        // 1. Session must exist
        $session = $this->storage->getSession($request->sessionId);
        if ($session === null) {
            throw new \InvalidArgumentException('Session not found');
        }

        // 2. MIME type must be allowed
        if (!in_array($request->mimeType, $this->allowedMimeTypes, true)) {
            throw new \InvalidArgumentException(
                sprintf('Invalid MIME type: %s', $request->mimeType)
            );
        }

        // 3. Size must be within bounds
        if ($request->size <= 0 || $request->size > $this->maxAttachmentSize) {
            throw new \InvalidArgumentException(
                sprintf('File too large: %d bytes (max %d)', $request->size, $this->maxAttachmentSize)
            );
        }

        // 4. Create the pending attachment
        $id = $this->generateId();
        $uploadUrl = "{$this->uploadBaseUrl}/{$id}";
        $now = new \DateTimeImmutable();

        $attachment = new Attachment(
            id: $id,
            filename: $request->filename,
            mimeType: $request->mimeType,
            size: $request->size,
            url: $uploadUrl,
            messageId: null,
            thumbnailUrl: null,
            status: AttachmentStatus::PENDING,
            createdAt: $now,
        );

        // 5. Persist
        $this->saveAttachment($attachment);

        // 6. Respond with presigned upload details
        return new UploadResponse(
            attachmentId: $id,
            uploadUrl: $uploadUrl,
            expiresAt: $now->add(new \DateInterval('PT' . self::UPLOAD_URL_TTL_SECONDS . 'S')),
        );
    }

    /**
     * Mark an attachment as ready after the upload has completed.
     */
    public function handleUploadComplete(string $attachmentId): Attachment
    {
        $attachment = $this->getAttachment($attachmentId);
        if ($attachment === null) {
            throw new \InvalidArgumentException('Attachment not found');
        }

        $attachment = $attachment->withStatus(AttachmentStatus::READY);
        $this->updateAttachment($attachment);

        return $attachment;
    }

    /**
     * Mark an attachment as failed after an upload error.
     */
    public function handleUploadFailed(string $attachmentId): Attachment
    {
        $attachment = $this->getAttachment($attachmentId);
        if ($attachment === null) {
            throw new \InvalidArgumentException('Attachment not found');
        }

        $attachment = $attachment->withStatus(AttachmentStatus::FAILED);
        $this->updateAttachment($attachment);

        return $attachment;
    }

    /**
     * Link a list of attachment IDs to a message, persisting the link.
     *
     * @param list<string>|null $attachmentIds
     * @return list<Attachment>|null
     */
    private function linkAttachments(?array $attachmentIds, string $messageId): ?array
    {
        if (empty($attachmentIds)) {
            return null;
        }

        $linked = [];
        foreach ($attachmentIds as $attachmentId) {
            $attachment = $this->getAttachment((string) $attachmentId);
            if ($attachment === null) {
                continue;
            }

            $attachment = $attachment->withMessageId($messageId);
            $this->updateAttachment($attachment);
            $linked[] = $attachment;
        }

        return $linked === [] ? null : $linked;
    }

    /**
     * Persist a new attachment via the storage adapter (if supported).
     */
    private function saveAttachment(Attachment $attachment): void
    {
        if ($this->storage instanceof StorageWithAttachmentsInterface) {
            $this->storage->saveAttachment($attachment);
        }
    }

    /**
     * Update an attachment via the storage adapter (if supported).
     */
    private function updateAttachment(Attachment $attachment): void
    {
        if ($this->storage instanceof StorageWithAttachmentsInterface) {
            $this->storage->updateAttachment($attachment);
        }
    }

    /**
     * Fetch an attachment via the storage adapter (if supported).
     */
    private function getAttachment(string $attachmentId): ?Attachment
    {
        if ($this->storage instanceof StorageWithAttachmentsInterface) {
            return $this->storage->getAttachment($attachmentId);
        }

        return null;
    }

    // ─────────────────────────────────────────────────────────────────
    // User Identity
    // ─────────────────────────────────────────────────────────────────

    /**
     * Handle user identification from widget.
     */
    public function handleIdentify(IdentifyRequest $request): IdentifyResponse
    {
        if ($request->identity->id === '') {
            throw new \InvalidArgumentException('identity.id is required');
        }

        $session = $this->storage->getSession($request->sessionId);
        if ($session === null) {
            throw new \InvalidArgumentException('Session not found');
        }

        // Update session with identity
        $session->identity = $request->identity;
        $session->lastActivity = new \DateTimeImmutable();
        $this->storage->updateSession($session);

        // Notify bridges
        $this->notifyBridgesIdentity($session);

        // Callback
        if ($this->onIdentify !== null) {
            ($this->onIdentify)($session);
        }

        return new IdentifyResponse(ok: true);
    }

    /**
     * Get a session by ID.
     */
    public function getSession(string $sessionId): ?Session
    {
        return $this->storage->getSession($sessionId);
    }

    // ─────────────────────────────────────────────────────────────────
    // Operator Actions
    // ─────────────────────────────────────────────────────────────────

    /**
     * Send a message as the operator.
     */
    public function sendOperatorMessage(
        string $sessionId,
        string $content,
        ?string $sourceBridge = null,
        ?string $operatorName = null,
    ): Message {
        $response = $this->handleMessage(new SendMessageRequest(
            sessionId: $sessionId,
            content: $content,
            sender: Sender::OPERATOR,
        ));

        $message = new Message(
            id: $response->messageId,
            sessionId: $sessionId,
            content: $content,
            sender: Sender::OPERATOR,
            timestamp: $response->timestamp,
        );

        // Notify all bridges about this operator message (for cross-bridge sync)
        $session = $this->storage->getSession($sessionId);
        if ($session !== null) {
            $this->notifyBridgesOperatorMessage($message, $session, $sourceBridge ?? 'api', $operatorName);
        }

        return $message;
    }

    /**
     * Set operator online/offline status.
     */
    public function setOperatorOnline(bool $online): void
    {
        $this->operatorOnline = $online;

        // Broadcast to all sessions
        foreach (array_keys($this->websocketConnections) as $sessionId) {
            $this->broadcastToSession(
                $sessionId,
                new WebSocketEvent('presence', ['online' => $online])
            );
        }
    }

    /**
     * Check if operator is online.
     */
    public function isOperatorOnline(): bool
    {
        return $this->operatorOnline;
    }

    // ─────────────────────────────────────────────────────────────────
    // WebSocket Management
    // ─────────────────────────────────────────────────────────────────

    /**
     * Register a WebSocket connection for a session.
     */
    public function registerWebsocket(string $sessionId, object $websocket): void
    {
        if (!isset($this->websocketConnections[$sessionId])) {
            $this->websocketConnections[$sessionId] = [];
        }
        $this->websocketConnections[$sessionId][] = $websocket;
    }

    /**
     * Unregister a WebSocket connection.
     */
    public function unregisterWebsocket(string $sessionId, object $websocket): void
    {
        if (isset($this->websocketConnections[$sessionId])) {
            $this->websocketConnections[$sessionId] = array_filter(
                $this->websocketConnections[$sessionId],
                fn($ws) => $ws !== $websocket
            );
        }
    }

    /**
     * Broadcast an event to all WebSocket connections for a session.
     */
    public function broadcastToSession(string $sessionId, WebSocketEvent $event): void
    {
        $connections = $this->websocketConnections[$sessionId] ?? [];
        $message = $event->toJson();

        $deadConnections = [];
        foreach ($connections as $ws) {
            try {
                if (method_exists($ws, 'send')) {
                    $ws->send($message);
                } elseif (method_exists($ws, 'send_text')) {
                    $ws->send_text($message);
                }
            } catch (\Throwable) {
                $deadConnections[] = $ws;
            }
        }

        // Clean up dead connections
        foreach ($deadConnections as $ws) {
            $this->unregisterWebsocket($sessionId, $ws);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Custom Events
    // ─────────────────────────────────────────────────────────────────

    /**
     * Subscribe to a custom event.
     *
     * @param string $eventName The name of the event (e.g., 'clicked_pricing') or '*' for all events
     * @param callable(CustomEvent, Session): void $handler Callback function to handle the event
     * @return callable(): void Unsubscribe function
     */
    public function onEventHandler(string $eventName, callable $handler): callable
    {
        if (!isset($this->eventHandlers[$eventName])) {
            $this->eventHandlers[$eventName] = [];
        }
        $this->eventHandlers[$eventName][] = $handler;

        return function () use ($eventName, $handler): void {
            $this->eventHandlers[$eventName] = array_filter(
                $this->eventHandlers[$eventName] ?? [],
                fn($h) => $h !== $handler
            );
        };
    }

    /**
     * Unsubscribe from a custom event.
     */
    public function offEventHandler(string $eventName, callable $handler): void
    {
        if (isset($this->eventHandlers[$eventName])) {
            $this->eventHandlers[$eventName] = array_filter(
                $this->eventHandlers[$eventName],
                fn($h) => $h !== $handler
            );
        }
    }

    /**
     * Emit a custom event to a specific session.
     */
    public function emitEvent(string $sessionId, string $eventName, ?array $data = null): void
    {
        $event = new CustomEvent(
            name: $eventName,
            data: $data,
            timestamp: new \DateTimeImmutable(),
            sessionId: $sessionId,
        );

        // Broadcast to WebSocket clients
        $this->broadcastToSession(
            $sessionId,
            new WebSocketEvent('event', $event->toArray())
        );
    }

    /**
     * Broadcast a custom event to all connected sessions.
     */
    public function broadcastEvent(string $eventName, ?array $data = null): void
    {
        foreach (array_keys($this->websocketConnections) as $sessionId) {
            $this->emitEvent($sessionId, $eventName, $data);
        }
    }

    /**
     * Handle an incoming custom event from the widget.
     */
    public function handleCustomEvent(string $sessionId, CustomEvent $event): void
    {
        $session = $this->storage->getSession($sessionId);
        if ($session === null) {
            $this->logger->warning('Session not found for custom event', ['sessionId' => $sessionId]);
            return;
        }

        $event->sessionId = $sessionId;

        // Call specific event handlers
        $handlers = $this->eventHandlers[$event->name] ?? [];
        foreach ($handlers as $handler) {
            try {
                $handler($event, $session);
            } catch (\Throwable $e) {
                $this->logger->error('Error in event handler', [
                    'event' => $event->name,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Call wildcard handlers
        $wildcardHandlers = $this->eventHandlers['*'] ?? [];
        foreach ($wildcardHandlers as $handler) {
            try {
                $handler($event, $session);
            } catch (\Throwable $e) {
                $this->logger->error('Error in wildcard event handler', [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Call the config callback
        if ($this->onEvent !== null) {
            try {
                ($this->onEvent)($event, $session);
            } catch (\Throwable $e) {
                $this->logger->error('Error in onEvent callback', [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Notify bridges
        $this->notifyBridgesEvent($event, $session);
    }

    // ─────────────────────────────────────────────────────────────────
    // Bridge Management
    // ─────────────────────────────────────────────────────────────────

    /**
     * Add a bridge dynamically.
     */
    public function addBridge(BridgeInterface $bridge): void
    {
        $this->bridges[] = $bridge;
        $bridge->init($this);
    }

    /**
     * Get all bridges.
     *
     * @return BridgeInterface[]
     */
    public function getBridges(): array
    {
        return $this->bridges;
    }

    // ─────────────────────────────────────────────────────────────────
    // Version Management
    // ─────────────────────────────────────────────────────────────────

    /**
     * Check widget version compatibility.
     *
     * @param string|null $widgetVersion Version string from X-PocketPing-Version header
     */
    public function checkWidgetVersion(?string $widgetVersion): VersionCheckResult
    {
        return $this->versionChecker->check($widgetVersion);
    }

    /**
     * Get HTTP headers to set for version information.
     *
     * @return array<string, string>
     */
    public function getVersionHeaders(VersionCheckResult $versionCheck): array
    {
        return $this->versionChecker->getHeaders($versionCheck);
    }

    /**
     * Send a version warning via WebSocket.
     */
    public function sendVersionWarning(
        string $sessionId,
        VersionCheckResult $versionCheck,
        string $currentVersion,
    ): void {
        $warning = $this->versionChecker->createWarning($versionCheck, $currentVersion);

        $this->broadcastToSession(
            $sessionId,
            new WebSocketEvent('version_warning', $warning->toArray())
        );
    }

    /**
     * Get the version checker.
     */
    public function getVersionChecker(): VersionChecker
    {
        return $this->versionChecker;
    }

    // ─────────────────────────────────────────────────────────────────
    // Storage Access
    // ─────────────────────────────────────────────────────────────────

    /**
     * Get the storage adapter.
     */
    public function getStorage(): StorageInterface
    {
        return $this->storage;
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal: AI Fallback
    // ─────────────────────────────────────────────────────────────────

    /**
     * Maybe generate an AI fallback reply for a visitor message.
     *
     * Triggers an AI reply when ALL of the following are true:
     *   1. an AI provider is configured;
     *   2. the operator is NOT online;
     *   3. takeover is due (delay <= 0, or enough time has elapsed since the
     *      last operator activity for this session — if no activity has ever
     *      been recorded, takeover is treated as due).
     *
     * Any provider error is caught and logged so message handling never crashes.
     */
    private function maybeAiRespond(Session $session): void
    {
        // 1. AI provider must be configured.
        if ($this->aiProvider === null) {
            return;
        }

        // 2. Operator must be offline.
        if ($this->isOperatorOnline()) {
            return;
        }

        // 3. Takeover must be due.
        if (!$this->isAiTakeoverDue($session->id)) {
            return;
        }

        // Mark the session as AI-handled and persist.
        $session->aiActive = true;
        $this->storage->updateSession($session);

        try {
            $messages = $this->storage->getMessages($session->id);
            $reply = $this->aiProvider->generateResponse($messages, $this->aiSystemPrompt);
        } catch (\Throwable $e) {
            $this->logger->error('AI fallback failed to generate a response', [
                'sessionId' => $session->id,
                'provider' => $this->aiProvider->name(),
                'error' => $e->getMessage(),
            ]);
            return;
        }

        if (trim($reply) === '') {
            return;
        }

        $aiMessage = new Message(
            id: $this->generateId(),
            sessionId: $session->id,
            content: $reply,
            sender: Sender::AI,
            timestamp: new \DateTimeImmutable(),
        );

        $this->storage->saveMessage($aiMessage);

        // Broadcast the AI reply to connected widgets.
        $this->broadcastToSession(
            $session->id,
            new WebSocketEvent('message', $aiMessage->toArray())
        );

        // Notify bridges so the AI reply appears in Telegram/Discord/Slack.
        $this->notifyBridgesOperatorMessage($aiMessage, $session, 'ai', 'AI');

        // Config callback.
        if ($this->onMessage !== null) {
            ($this->onMessage)($aiMessage, $session);
        }
    }

    /**
     * Determine whether AI takeover is due for a session based on operator activity.
     */
    private function isAiTakeoverDue(string $sessionId): bool
    {
        if ($this->aiTakeoverDelay <= 0) {
            return true;
        }

        // No recorded operator activity => operator never showed up => takeover is due.
        if (!isset($this->lastOperatorActivity[$sessionId])) {
            return true;
        }

        $elapsed = microtime(true) - $this->lastOperatorActivity[$sessionId];

        return $elapsed >= $this->aiTakeoverDelay;
    }

    /**
     * Get the configured AI provider, if any.
     */
    public function getAiProvider(): ?AIProviderInterface
    {
        return $this->aiProvider;
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal: Bridge Notifications
    // ─────────────────────────────────────────────────────────────────

    private function notifyBridgesNewSession(Session $session): void
    {
        foreach ($this->bridges as $bridge) {
            try {
                $bridge->onNewSession($session);
            } catch (\Throwable $e) {
                $this->logger->error('Bridge error on new session', [
                    'bridge' => $bridge->getName(),
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    private function notifyBridgesMessage(Message $message, Session $session): void
    {
        foreach ($this->bridges as $bridge) {
            try {
                $bridge->onVisitorMessage($message, $session);
            } catch (\Throwable $e) {
                $this->logger->error('Bridge error on message', [
                    'bridge' => $bridge->getName(),
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    private function notifyBridgesOperatorMessage(
        Message $message,
        Session $session,
        string $sourceBridge,
        ?string $operatorName,
    ): void {
        foreach ($this->bridges as $bridge) {
            try {
                $bridge->onOperatorMessage($message, $session, $sourceBridge, $operatorName);
            } catch (\Throwable $e) {
                $this->logger->error('Bridge sync error', [
                    'bridge' => $bridge->getName(),
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    private function notifyBridgesRead(
        string $sessionId,
        array $messageIds,
        MessageStatus $status,
        Session $session,
    ): void {
        foreach ($this->bridges as $bridge) {
            try {
                $bridge->onMessageRead($sessionId, $messageIds, $status, $session);
            } catch (\Throwable $e) {
                $this->logger->error('Bridge read notification error', [
                    'bridge' => $bridge->getName(),
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    private function notifyBridgesIdentity(Session $session): void
    {
        foreach ($this->bridges as $bridge) {
            try {
                $bridge->onIdentityUpdate($session);
            } catch (\Throwable $e) {
                $this->logger->error('Bridge identity notification error', [
                    'bridge' => $bridge->getName(),
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    private function notifyBridgesEvent(CustomEvent $event, Session $session): void
    {
        foreach ($this->bridges as $bridge) {
            try {
                $bridge->onCustomEvent($event, $session);
            } catch (\Throwable $e) {
                $this->logger->error('Bridge custom event error', [
                    'bridge' => $bridge->getName(),
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    private function syncEditToBridges(
        string $sessionId,
        string $messageId,
        string $content,
        \DateTimeInterface $editedAt,
    ): void {
        foreach ($this->bridges as $bridge) {
            if ($bridge instanceof BridgeWithEditDeleteInterface) {
                try {
                    $bridge->onMessageEdit($sessionId, $messageId, $content, $editedAt);
                } catch (\Throwable $e) {
                    $this->logger->error('Bridge edit sync error', [
                        'bridge' => $bridge->getName(),
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        }
    }

    private function syncDeleteToBridges(
        string $sessionId,
        string $messageId,
        \DateTimeInterface $deletedAt,
    ): void {
        foreach ($this->bridges as $bridge) {
            if ($bridge instanceof BridgeWithEditDeleteInterface) {
                try {
                    $bridge->onMessageDelete($sessionId, $messageId, $deletedAt);
                } catch (\Throwable $e) {
                    $this->logger->error('Bridge delete sync error', [
                        'bridge' => $bridge->getName(),
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal: Utilities
    // ─────────────────────────────────────────────────────────────────

    /**
     * Generate a unique ID.
     */
    private function generateId(): string
    {
        $timestamp = dechex((int) (microtime(true) * 1000));
        $randomPart = bin2hex(random_bytes(4));
        return "{$timestamp}-{$randomPart}";
    }
}

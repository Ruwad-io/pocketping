<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Response after connecting.
 */
final class ConnectResponse implements \JsonSerializable
{
    /**
     * @param string $sessionId Session ID
     * @param string $visitorId Visitor ID
     * @param bool $operatorOnline Whether operator is online
     * @param string|null $welcomeMessage Welcome message to show
     * @param Message[] $messages Existing messages
     * @param TrackedElement[]|null $trackedElements Tracked elements configuration
     */
    public function __construct(
        public readonly string $sessionId,
        public readonly string $visitorId,
        public readonly bool $operatorOnline = false,
        public readonly ?string $welcomeMessage = null,
        public readonly array $messages = [],
        public readonly ?array $trackedElements = null,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = [
            'sessionId' => $this->sessionId,
            'visitorId' => $this->visitorId,
            'operatorOnline' => $this->operatorOnline,
            'messages' => array_map(fn(Message $m) => $m->toArray(), $this->messages),
        ];

        if ($this->welcomeMessage !== null) {
            $data['welcomeMessage'] = $this->welcomeMessage;
        }

        if ($this->trackedElements !== null) {
            $data['trackedElements'] = array_map(fn(TrackedElement $e) => $e->toArray(), $this->trackedElements);
        }

        return $data;
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}

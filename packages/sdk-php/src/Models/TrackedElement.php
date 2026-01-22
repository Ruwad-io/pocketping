<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Tracked element configuration (for SaaS auto-tracking).
 */
final class TrackedElement implements \JsonSerializable
{
    /**
     * @param string $selector CSS selector for the element(s) to track
     * @param string $name Event name sent to backend
     * @param string $event DOM event to listen for (default: 'click')
     * @param string|null $widgetMessage If provided, opens widget with this message when triggered
     * @param array<string, mixed>|null $data Additional data to send with the event
     */
    public function __construct(
        public readonly string $selector,
        public readonly string $name,
        public readonly string $event = 'click',
        public readonly ?string $widgetMessage = null,
        public readonly ?array $data = null,
    ) {
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            selector: (string) ($data['selector'] ?? throw new \InvalidArgumentException('TrackedElement requires selector')),
            name: (string) ($data['name'] ?? throw new \InvalidArgumentException('TrackedElement requires name')),
            event: (string) ($data['event'] ?? 'click'),
            widgetMessage: isset($data['widgetMessage']) ? (string) $data['widgetMessage'] : null,
            data: $data['data'] ?? null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = [
            'selector' => $this->selector,
            'name' => $this->name,
            'event' => $this->event,
        ];

        if ($this->widgetMessage !== null) {
            $data['widgetMessage'] = $this->widgetMessage;
        }

        if ($this->data !== null) {
            $data['data'] = $this->data;
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

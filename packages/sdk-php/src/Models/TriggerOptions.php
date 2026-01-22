<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Options for trigger() method.
 */
final class TriggerOptions implements \JsonSerializable
{
    /**
     * @param string|null $widgetMessage If provided, opens the widget and shows this message
     */
    public function __construct(
        public readonly ?string $widgetMessage = null,
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
            widgetMessage: isset($data['widgetMessage']) ? (string) $data['widgetMessage'] : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = [];

        if ($this->widgetMessage !== null) {
            $data['widgetMessage'] = $this->widgetMessage;
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

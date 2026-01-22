<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * User identity data from PocketPing.identify().
 *
 * The id field is required; all others are optional.
 * Extra fields are allowed for custom data (plan, company, etc.).
 */
final class UserIdentity implements \JsonSerializable
{
    /**
     * @param string $id Required unique user identifier
     * @param string|null $email User's email address
     * @param string|null $name User's display name
     * @param array<string, mixed> $customFields Any custom fields (plan, company, etc.)
     */
    public function __construct(
        public readonly string $id,
        public readonly ?string $email = null,
        public readonly ?string $name = null,
        public readonly array $customFields = [],
    ) {
    }

    /**
     * Create from array data.
     *
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $id = $data['id'] ?? throw new \InvalidArgumentException('UserIdentity requires id field');
        $email = $data['email'] ?? null;
        $name = $data['name'] ?? null;

        // Extract custom fields (everything except id, email, name)
        $customFields = array_diff_key($data, ['id' => 1, 'email' => 1, 'name' => 1]);

        return new self(
            id: (string) $id,
            email: $email !== null ? (string) $email : null,
            name: $name !== null ? (string) $name : null,
            customFields: $customFields,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = ['id' => $this->id];

        if ($this->email !== null) {
            $data['email'] = $this->email;
        }

        if ($this->name !== null) {
            $data['name'] = $this->name;
        }

        return array_merge($data, $this->customFields);
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}

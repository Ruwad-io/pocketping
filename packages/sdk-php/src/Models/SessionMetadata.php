<?php

declare(strict_types=1);

namespace PocketPing\Models;

/**
 * Metadata about the visitor's session.
 */
final class SessionMetadata implements \JsonSerializable
{
    public function __construct(
        // Page info
        public ?string $url = null,
        public ?string $referrer = null,
        public ?string $pageTitle = null,

        // Client info
        public ?string $userAgent = null,
        public ?string $timezone = null,
        public ?string $language = null,
        public ?string $screenResolution = null,

        // Geo info (populated server-side from IP)
        public ?string $ip = null,
        public ?string $country = null,
        public ?string $city = null,

        // Device info (parsed from user agent or sent by client)
        public ?string $deviceType = null, // desktop, mobile, tablet
        public ?string $browser = null,
        public ?string $os = null,
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
            url: isset($data['url']) ? (string) $data['url'] : null,
            referrer: isset($data['referrer']) ? (string) $data['referrer'] : null,
            pageTitle: isset($data['pageTitle']) ? (string) $data['pageTitle'] : null,
            userAgent: isset($data['userAgent']) ? (string) $data['userAgent'] : null,
            timezone: isset($data['timezone']) ? (string) $data['timezone'] : null,
            language: isset($data['language']) ? (string) $data['language'] : null,
            screenResolution: isset($data['screenResolution']) ? (string) $data['screenResolution'] : null,
            ip: isset($data['ip']) ? (string) $data['ip'] : null,
            country: isset($data['country']) ? (string) $data['country'] : null,
            city: isset($data['city']) ? (string) $data['city'] : null,
            deviceType: isset($data['deviceType']) ? (string) $data['deviceType'] : null,
            browser: isset($data['browser']) ? (string) $data['browser'] : null,
            os: isset($data['os']) ? (string) $data['os'] : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = [];

        if ($this->url !== null) {
            $data['url'] = $this->url;
        }
        if ($this->referrer !== null) {
            $data['referrer'] = $this->referrer;
        }
        if ($this->pageTitle !== null) {
            $data['pageTitle'] = $this->pageTitle;
        }
        if ($this->userAgent !== null) {
            $data['userAgent'] = $this->userAgent;
        }
        if ($this->timezone !== null) {
            $data['timezone'] = $this->timezone;
        }
        if ($this->language !== null) {
            $data['language'] = $this->language;
        }
        if ($this->screenResolution !== null) {
            $data['screenResolution'] = $this->screenResolution;
        }
        if ($this->ip !== null) {
            $data['ip'] = $this->ip;
        }
        if ($this->country !== null) {
            $data['country'] = $this->country;
        }
        if ($this->city !== null) {
            $data['city'] = $this->city;
        }
        if ($this->deviceType !== null) {
            $data['deviceType'] = $this->deviceType;
        }
        if ($this->browser !== null) {
            $data['browser'] = $this->browser;
        }
        if ($this->os !== null) {
            $data['os'] = $this->os;
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

    /**
     * Merge with another metadata object, preserving existing geo info.
     */
    public function mergeWith(SessionMetadata $other): self
    {
        return new self(
            url: $other->url ?? $this->url,
            referrer: $other->referrer ?? $this->referrer,
            pageTitle: $other->pageTitle ?? $this->pageTitle,
            userAgent: $other->userAgent ?? $this->userAgent,
            timezone: $other->timezone ?? $this->timezone,
            language: $other->language ?? $this->language,
            screenResolution: $other->screenResolution ?? $this->screenResolution,
            // Preserve server-side geo info
            ip: $this->ip ?? $other->ip,
            country: $this->country ?? $other->country,
            city: $this->city ?? $other->city,
            deviceType: $other->deviceType ?? $this->deviceType,
            browser: $other->browser ?? $this->browser,
            os: $other->os ?? $this->os,
        );
    }
}

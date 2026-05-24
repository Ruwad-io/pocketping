<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\AI\AIProviderInterface;
use PocketPing\AI\AnthropicProvider;
use PocketPing\AI\GeminiProvider;
use PocketPing\AI\OpenAIProvider;
use PocketPing\Models\ConnectRequest;
use PocketPing\Models\Message;
use PocketPing\Models\Sender;
use PocketPing\Models\SendMessageRequest;
use PocketPing\PocketPing;
use PocketPing\Storage\MemoryStorage;

class AiTest extends TestCase
{
    /**
     * Build a Message for provider request tests.
     */
    private function msg(string $content, Sender $sender): Message
    {
        return new Message(
            id: 'm-' . substr(md5($content . $sender->value), 0, 8),
            sessionId: 'sess-1',
            content: $content,
            sender: $sender,
            timestamp: new \DateTimeImmutable(),
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // 1. OpenAIProvider
    // ─────────────────────────────────────────────────────────────────

    public function testOpenAiProviderBuildsRequestAndParsesResponse(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse(json_encode([
            'choices' => [
                ['message' => ['content' => 'Hello from OpenAI']],
            ],
        ]));

        $provider = new OpenAIProvider(
            apiKey: 'sk-test',
            baseUrl: 'https://example.test/v1',
            httpClient: $http,
        );

        $reply = $provider->generateResponse(
            [
                $this->msg('Hi there', Sender::VISITOR),
                $this->msg('Earlier reply', Sender::OPERATOR),
            ],
            'You are helpful.',
        );

        $this->assertSame('Hello from OpenAI', $reply);
        $this->assertSame('openai', $provider->name());

        $request = $http->getLastRequest();
        $this->assertNotNull($request);
        $this->assertSame('POST', $request['method']);
        $this->assertSame('https://example.test/v1/chat/completions', $request['url']);
        $this->assertSame('Bearer sk-test', $request['headers']['Authorization']);
        $this->assertSame('gpt-4o-mini', $request['data']['model']);
        $this->assertSame(1000, $request['data']['max_tokens']);

        // First message is the system prompt, then visitor->user, operator->assistant.
        $messages = $request['data']['messages'];
        $this->assertSame(['role' => 'system', 'content' => 'You are helpful.'], $messages[0]);
        $this->assertSame(['role' => 'user', 'content' => 'Hi there'], $messages[1]);
        $this->assertSame(['role' => 'assistant', 'content' => 'Earlier reply'], $messages[2]);
    }

    public function testOpenAiProviderReturnsEmptyStringWhenContentMissing(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse(json_encode(['choices' => []]));

        $provider = new OpenAIProvider(apiKey: 'sk-test', httpClient: $http);

        $this->assertSame('', $provider->generateResponse([$this->msg('hi', Sender::VISITOR)]));
    }

    public function testOpenAiIsAvailableChecksModelsEndpoint(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse(json_encode(['data' => []]), 200);

        $provider = new OpenAIProvider(
            apiKey: 'sk-test',
            baseUrl: 'https://example.test/v1',
            httpClient: $http,
        );

        $this->assertTrue($provider->isAvailable());

        $request = $http->getLastRequest();
        $this->assertNotNull($request);
        $this->assertSame('GET', $request['method']);
        $this->assertSame('https://example.test/v1/models', $request['url']);
        $this->assertSame('Bearer sk-test', $request['headers']['Authorization']);
    }

    // ─────────────────────────────────────────────────────────────────
    // 2. AnthropicProvider
    // ─────────────────────────────────────────────────────────────────

    public function testAnthropicProviderBuildsRequestAndParsesResponse(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse(json_encode([
            'content' => [
                ['text' => 'Hello from Claude'],
            ],
        ]));

        $provider = new AnthropicProvider(
            apiKey: 'ak-test',
            baseUrl: 'https://example.test/v1',
            httpClient: $http,
        );

        $reply = $provider->generateResponse(
            [
                $this->msg('Need help', Sender::VISITOR),
                $this->msg('Sure thing', Sender::OPERATOR),
            ],
            'Custom system',
        );

        $this->assertSame('Hello from Claude', $reply);
        $this->assertSame('anthropic', $provider->name());

        $request = $http->getLastRequest();
        $this->assertNotNull($request);
        $this->assertSame('POST', $request['method']);
        $this->assertSame('https://example.test/v1/messages', $request['url']);
        $this->assertSame('ak-test', $request['headers']['x-api-key']);
        $this->assertSame('2023-06-01', $request['headers']['anthropic-version']);
        $this->assertSame('claude-sonnet-4-20250514', $request['data']['model']);
        $this->assertSame('Custom system', $request['data']['system']);

        // No system message inside the array; roles map visitor->user, other->assistant.
        $messages = $request['data']['messages'];
        $this->assertCount(2, $messages);
        $this->assertSame(['role' => 'user', 'content' => 'Need help'], $messages[0]);
        $this->assertSame(['role' => 'assistant', 'content' => 'Sure thing'], $messages[1]);
    }

    public function testAnthropicUsesDefaultSystemPromptWhenNoneGiven(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse(json_encode(['content' => [['text' => 'ok']]]));

        $provider = new AnthropicProvider(apiKey: 'ak-test', httpClient: $http);
        $provider->generateResponse([$this->msg('hi', Sender::VISITOR)]);

        $request = $http->getLastRequest();
        $this->assertNotNull($request);
        $this->assertSame('You are a helpful customer support assistant.', $request['data']['system']);
    }

    public function testAnthropicIsAvailableWhenApiKeySet(): void
    {
        $http = new MockHttpClient();
        $this->assertTrue((new AnthropicProvider(apiKey: 'ak-test', httpClient: $http))->isAvailable());
        $this->assertFalse((new AnthropicProvider(apiKey: '', httpClient: $http))->isAvailable());
    }

    // ─────────────────────────────────────────────────────────────────
    // 3. GeminiProvider
    // ─────────────────────────────────────────────────────────────────

    public function testGeminiProviderBuildsRequestAndParsesResponse(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse(json_encode([
            'candidates' => [
                ['content' => ['parts' => [['text' => 'Hello from Gemini']]]],
            ],
        ]));

        $provider = new GeminiProvider(
            apiKey: 'gk-test',
            baseUrl: 'https://example.test/v1beta',
            httpClient: $http,
        );

        $reply = $provider->generateResponse(
            [
                $this->msg('First question', Sender::VISITOR),
                $this->msg('Assistant line', Sender::OPERATOR),
            ],
            'Be brief.',
        );

        $this->assertSame('Hello from Gemini', $reply);
        $this->assertSame('gemini', $provider->name());

        $request = $http->getLastRequest();
        $this->assertNotNull($request);
        $this->assertSame('POST', $request['method']);
        $this->assertSame(
            'https://example.test/v1beta/models/gemini-1.5-flash:generateContent?key=gk-test',
            $request['url'],
        );

        $contents = $request['data']['contents'];
        $this->assertSame('user', $contents[0]['role']);
        // System prompt prepended to the first user message.
        $this->assertSame("Be brief.\n\nUser: First question", $contents[0]['parts'][0]['text']);
        $this->assertSame('model', $contents[1]['role']);
        $this->assertSame('Assistant line', $contents[1]['parts'][0]['text']);
        $this->assertSame(1000, $request['data']['generationConfig']['maxOutputTokens']);
    }

    public function testGeminiReturnsEmptyStringWhenNoCandidates(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse(json_encode(['candidates' => []]));

        $provider = new GeminiProvider(apiKey: 'gk-test', httpClient: $http);

        $this->assertSame('', $provider->generateResponse([$this->msg('hi', Sender::VISITOR)]));
    }

    // ─────────────────────────────────────────────────────────────────
    // Wiring tests (use a fake in-test provider)
    // ─────────────────────────────────────────────────────────────────

    public function testFallbackTriggersWhenOperatorOfflineAndDelayZero(): void
    {
        $storage = new MemoryStorage();
        $provider = new FakeAiProvider('AI says hi');

        $pp = new PocketPing(
            storage: $storage,
            aiProvider: $provider,
            aiTakeoverDelay: 0,
        );

        $connect = $pp->handleConnect(new ConnectRequest(visitorId: 'v-1'));
        $sessionId = $connect->sessionId;

        $pp->handleMessage(new SendMessageRequest(
            sessionId: $sessionId,
            content: 'Anyone there?',
            sender: Sender::VISITOR,
        ));

        $messages = $storage->getMessages($sessionId);
        $aiMessages = array_values(array_filter(
            $messages,
            fn (Message $m) => $m->sender === Sender::AI,
        ));

        $this->assertCount(1, $aiMessages);
        $this->assertSame('AI says hi', $aiMessages[0]->content);
        $this->assertSame(1, $provider->callCount);

        // Session should be marked AI active.
        $this->assertTrue($storage->getSession($sessionId)->aiActive);
    }

    public function testNoFallbackWhenOperatorOnline(): void
    {
        $storage = new MemoryStorage();
        $provider = new FakeAiProvider('AI says hi');

        $pp = new PocketPing(
            storage: $storage,
            aiProvider: $provider,
            aiTakeoverDelay: 0,
        );
        $pp->setOperatorOnline(true);

        $connect = $pp->handleConnect(new ConnectRequest(visitorId: 'v-2'));
        $sessionId = $connect->sessionId;

        $pp->handleMessage(new SendMessageRequest(
            sessionId: $sessionId,
            content: 'Hello?',
            sender: Sender::VISITOR,
        ));

        $aiMessages = array_filter(
            $storage->getMessages($sessionId),
            fn (Message $m) => $m->sender === Sender::AI,
        );

        $this->assertCount(0, $aiMessages);
        $this->assertSame(0, $provider->callCount);
    }

    public function testNoFallbackWhenNoProviderConfigured(): void
    {
        $storage = new MemoryStorage();
        $pp = new PocketPing(storage: $storage);

        $connect = $pp->handleConnect(new ConnectRequest(visitorId: 'v-noai'));
        $sessionId = $connect->sessionId;

        $pp->handleMessage(new SendMessageRequest(
            sessionId: $sessionId,
            content: 'Hello?',
            sender: Sender::VISITOR,
        ));

        $aiMessages = array_filter(
            $storage->getMessages($sessionId),
            fn (Message $m) => $m->sender === Sender::AI,
        );
        $this->assertCount(0, $aiMessages);
    }

    public function testOperatorMessageDisablesAi(): void
    {
        $storage = new MemoryStorage();
        $provider = new FakeAiProvider('AI says hi');

        $pp = new PocketPing(
            storage: $storage,
            aiProvider: $provider,
            aiTakeoverDelay: 0,
        );

        $connect = $pp->handleConnect(new ConnectRequest(visitorId: 'v-3'));
        $sessionId = $connect->sessionId;

        // Visitor message triggers AI -> aiActive becomes true.
        $pp->handleMessage(new SendMessageRequest(
            sessionId: $sessionId,
            content: 'Need help',
            sender: Sender::VISITOR,
        ));
        $this->assertTrue($storage->getSession($sessionId)->aiActive);

        // Operator replies -> aiActive must be reset to false.
        $pp->handleMessage(new SendMessageRequest(
            sessionId: $sessionId,
            content: 'I am here now',
            sender: Sender::OPERATOR,
        ));
        $this->assertFalse($storage->getSession($sessionId)->aiActive);
    }

    public function testFallbackHandlesProviderErrorGracefully(): void
    {
        $storage = new MemoryStorage();
        $provider = new ThrowingAiProvider();

        $pp = new PocketPing(
            storage: $storage,
            aiProvider: $provider,
            aiTakeoverDelay: 0,
        );

        $connect = $pp->handleConnect(new ConnectRequest(visitorId: 'v-4'));
        $sessionId = $connect->sessionId;

        // Should not throw despite the provider raising an exception.
        $response = $pp->handleMessage(new SendMessageRequest(
            sessionId: $sessionId,
            content: 'Hello?',
            sender: Sender::VISITOR,
        ));

        $this->assertNotEmpty($response->messageId);

        $aiMessages = array_filter(
            $storage->getMessages($sessionId),
            fn (Message $m) => $m->sender === Sender::AI,
        );
        $this->assertCount(0, $aiMessages);
    }

    public function testPresenceReportsAiEnabledAndActiveAfter(): void
    {
        $storage = new MemoryStorage();
        $pp = new PocketPing(
            storage: $storage,
            aiProvider: new FakeAiProvider('hi'),
            aiTakeoverDelay: 120,
        );

        $presence = $pp->handlePresence();
        $this->assertTrue($presence->aiEnabled);
        $this->assertSame(120, $presence->aiActiveAfter);

        $ppNoAi = new PocketPing(storage: new MemoryStorage());
        $this->assertFalse($ppNoAi->handlePresence()->aiEnabled);
    }
}

/**
 * Minimal in-test fake AI provider for wiring tests.
 */
class FakeAiProvider implements AIProviderInterface
{
    public int $callCount = 0;

    public function __construct(private readonly string $reply)
    {
    }

    public function name(): string
    {
        return 'fake';
    }

    public function generateResponse(array $messages, ?string $systemPrompt = null): string
    {
        $this->callCount++;
        return $this->reply;
    }

    public function isAvailable(): bool
    {
        return true;
    }
}

/**
 * Fake provider that always throws, to verify graceful error handling.
 */
class ThrowingAiProvider implements AIProviderInterface
{
    public function name(): string
    {
        return 'throwing';
    }

    public function generateResponse(array $messages, ?string $systemPrompt = null): string
    {
        throw new \RuntimeException('boom');
    }

    public function isAvailable(): bool
    {
        return true;
    }
}

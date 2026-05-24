<?php

declare(strict_types=1);

namespace PocketPing\Tests;

use PHPUnit\Framework\TestCase;
use PocketPing\AI\AnthropicProvider;
use PocketPing\AI\GeminiProvider;
use PocketPing\AI\OpenAIProvider;
use PocketPing\Models\Attachment;
use PocketPing\Models\Message;
use PocketPing\Models\Sender;
use PocketPing\Models\Session;
use PocketPing\Storage\MemoryStorage;

/**
 * AI provider error branches and MemoryStorage edge cases.
 */
class AiAndStorageExtraTest extends TestCase
{
    private function msg(string $content, Sender $sender = Sender::VISITOR): Message
    {
        return new Message('m-' . md5($content), 's', $content, $sender, new \DateTimeImmutable());
    }

    // ─────────────────────────────────────────────────────────────────
    // AI provider error / availability branches
    // ─────────────────────────────────────────────────────────────────

    public function testOpenAiThrowsOnHttpError(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse('{"error":"bad"}', 500);
        $provider = new OpenAIProvider(apiKey: 'sk', httpClient: $http);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('OpenAI API error');
        $provider->generateResponse([$this->msg('hi')]);
    }

    public function testOpenAiThrowsOnCurlError(): void
    {
        $http = new MockHttpClient();
        $http->nextResponse = ['body' => null, 'httpCode' => 0, 'error' => 'timeout'];
        $provider = new OpenAIProvider(apiKey: 'sk', httpClient: $http);

        $this->expectException(\RuntimeException::class);
        $provider->generateResponse([$this->msg('hi')]);
    }

    public function testOpenAiReturnsEmptyOnInvalidJson(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse('not json', 200);
        $provider = new OpenAIProvider(apiKey: 'sk', httpClient: $http);
        $this->assertSame('', $provider->generateResponse([$this->msg('hi')]));
    }

    public function testOpenAiIsAvailableFalseWhenNoKeyOrError(): void
    {
        $http = new MockHttpClient();
        $this->assertFalse((new OpenAIProvider(apiKey: '', httpClient: $http))->isAvailable());

        $http->nextResponse = ['body' => 'err', 'httpCode' => 401, 'error' => null];
        $this->assertFalse((new OpenAIProvider(apiKey: 'sk', httpClient: $http))->isAvailable());
    }

    public function testAnthropicThrowsOnHttpError(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse('{}', 503);
        $provider = new AnthropicProvider(apiKey: 'ak', httpClient: $http);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Anthropic API error');
        $provider->generateResponse([$this->msg('hi')]);
    }

    public function testAnthropicReturnsEmptyOnInvalidJson(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse('garbage', 200);
        $provider = new AnthropicProvider(apiKey: 'ak', httpClient: $http);
        $this->assertSame('', $provider->generateResponse([$this->msg('hi')]));
    }

    public function testGeminiThrowsOnHttpError(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse('{}', 429);
        $provider = new GeminiProvider(apiKey: 'gk', httpClient: $http);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Gemini API error');
        $provider->generateResponse([$this->msg('hi')]);
    }

    public function testGeminiThrowsOnCurlError(): void
    {
        $http = new MockHttpClient();
        $http->nextResponse = ['body' => null, 'httpCode' => 0, 'error' => 'dns'];
        $provider = new GeminiProvider(apiKey: 'gk', httpClient: $http);

        $this->expectException(\RuntimeException::class);
        $provider->generateResponse([$this->msg('hi')]);
    }

    public function testGeminiReturnsEmptyOnInvalidJson(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse('bad', 200);
        $provider = new GeminiProvider(apiKey: 'gk', httpClient: $http);
        $this->assertSame('', $provider->generateResponse([$this->msg('hi')]));
    }

    public function testGeminiIsAvailableBranches(): void
    {
        $http = new MockHttpClient();
        $this->assertFalse((new GeminiProvider(apiKey: '', httpClient: $http))->isAvailable());

        $http->nextResponse = ['body' => '{}', 'httpCode' => 200, 'error' => null];
        $this->assertTrue((new GeminiProvider(apiKey: 'gk', httpClient: $http))->isAvailable());
    }

    public function testGeminiNoLeadingUserSkipsSystemPromptPrepend(): void
    {
        $http = new MockHttpClient();
        $http->queueResponse(json_encode(['candidates' => [['content' => ['parts' => [['text' => 'ok']]]]]]));
        $provider = new GeminiProvider(apiKey: 'gk', httpClient: $http);

        // First message is from operator (role 'model'), so system prompt is NOT prepended.
        $provider->generateResponse([$this->msg('assistant first', Sender::OPERATOR)], 'system');
        $contents = $http->getLastRequest()['data']['contents'];
        $this->assertSame('model', $contents[0]['role']);
        $this->assertSame('assistant first', $contents[0]['parts'][0]['text']);
    }

    // ─────────────────────────────────────────────────────────────────
    // MemoryStorage edge cases
    // ─────────────────────────────────────────────────────────────────

    public function testDeleteSessionRemovesMessages(): void
    {
        $storage = new MemoryStorage();
        $storage->createSession(new Session('s', 'v', new \DateTimeImmutable(), new \DateTimeImmutable()));
        $storage->saveMessage($this->msg('hi'));

        $storage->deleteSession('s');
        $this->assertNull($storage->getSession('s'));
        $this->assertSame([], $storage->getMessages('s'));
    }

    public function testCleanupOldSessions(): void
    {
        $storage = new MemoryStorage();
        $old = new Session('old', 'v1', new \DateTimeImmutable('-2 days'), new \DateTimeImmutable('-2 days'));
        $fresh = new Session('fresh', 'v2', new \DateTimeImmutable(), new \DateTimeImmutable());
        $storage->createSession($old);
        $storage->createSession($fresh);

        $deleted = $storage->cleanupOldSessions(new \DateTimeImmutable('-1 day'));
        $this->assertSame(1, $deleted);
        $this->assertNull($storage->getSession('old'));
        $this->assertNotNull($storage->getSession('fresh'));
    }

    public function testGetSessionByVisitorIdReturnsMostRecent(): void
    {
        $storage = new MemoryStorage();
        $s1 = new Session('s1', 'v', new \DateTimeImmutable('-2 hours'), new \DateTimeImmutable('-2 hours'));
        $s2 = new Session('s2', 'v', new \DateTimeImmutable('-1 hour'), new \DateTimeImmutable('-1 hour'));
        $storage->createSession($s1);
        $storage->createSession($s2);

        $found = $storage->getSessionByVisitorId('v');
        $this->assertSame('s2', $found->id);
        $this->assertNull($storage->getSessionByVisitorId('nobody'));
    }

    public function testGetAllSessionsAndCount(): void
    {
        $storage = new MemoryStorage();
        $storage->createSession(new Session('a', 'v', new \DateTimeImmutable(), new \DateTimeImmutable()));
        $storage->createSession(new Session('b', 'v', new \DateTimeImmutable(), new \DateTimeImmutable()));
        $this->assertCount(2, $storage->getAllSessions());
        $this->assertSame(2, $storage->getSessionCount());
    }

    public function testGetMessagesPaginationAfter(): void
    {
        $storage = new MemoryStorage();
        $storage->createSession(new Session('s', 'v', new \DateTimeImmutable(), new \DateTimeImmutable()));
        for ($i = 0; $i < 4; $i++) {
            $storage->saveMessage(new Message("m-{$i}", 's', "c{$i}", Sender::VISITOR, new \DateTimeImmutable()));
        }
        $after = $storage->getMessages('s', 'm-1');
        $this->assertCount(2, $after);
        $this->assertSame('m-2', $after[0]->id);
    }

    public function testSaveMessageUpdatesExisting(): void
    {
        $storage = new MemoryStorage();
        $storage->createSession(new Session('s', 'v', new \DateTimeImmutable(), new \DateTimeImmutable()));
        $msg = new Message('m', 's', 'first', Sender::VISITOR, new \DateTimeImmutable());
        $storage->saveMessage($msg);
        $msg->content = 'second';
        $storage->saveMessage($msg);

        $this->assertCount(1, $storage->getMessages('s'));
        $this->assertSame('second', $storage->getMessage('m')->content);
    }

    public function testUpdateMessageNoOpForUnknownId(): void
    {
        $storage = new MemoryStorage();
        // Should not throw, and message remains unknown.
        $storage->updateMessage(new Message('ghost', 's', 'x', Sender::VISITOR, new \DateTimeImmutable()));
        $this->assertNull($storage->getMessage('ghost'));
    }

    public function testHydrateAttachmentsOnGetMessage(): void
    {
        $storage = new MemoryStorage();
        $storage->createSession(new Session('s', 'v', new \DateTimeImmutable(), new \DateTimeImmutable()));
        $storage->saveMessage(new Message('m', 's', 'c', Sender::VISITOR, new \DateTimeImmutable()));

        $att = new Attachment('a', 'f.png', 'image/png', 1, 'u', messageId: 'm');
        $storage->saveAttachment($att);

        $hydrated = $storage->getMessage('m');
        $this->assertNotNull($hydrated->attachments);
        $this->assertSame('a', $hydrated->attachments[0]->id);
    }

    public function testGetMessageReturnsNullForUnknown(): void
    {
        $storage = new MemoryStorage();
        $this->assertNull($storage->getMessage('nope'));
    }

    public function testAttachmentCrud(): void
    {
        $storage = new MemoryStorage();
        $att = new Attachment('a', 'f', 'image/png', 1, 'u', messageId: 'm');
        $storage->saveAttachment($att);
        $this->assertSame('a', $storage->getAttachment('a')->id);
        $this->assertCount(1, $storage->getMessageAttachments('m'));

        $updated = $att->withMessageId('m2');
        $storage->updateAttachment($updated);
        $this->assertCount(1, $storage->getMessageAttachments('m2'));
        $this->assertCount(0, $storage->getMessageAttachments('m'));

        $this->assertNull($storage->getAttachment('missing'));
    }

    public function testSaveBridgeMessageIdsMerges(): void
    {
        $storage = new MemoryStorage();
        $storage->saveBridgeMessageIds('m', new \PocketPing\Models\BridgeMessageIds(telegramMessageId: 1));
        $storage->saveBridgeMessageIds('m', new \PocketPing\Models\BridgeMessageIds(discordMessageId: 'd'));
        $ids = $storage->getBridgeMessageIds('m');
        $this->assertSame(1, $ids->telegramMessageId);
        $this->assertSame('d', $ids->discordMessageId);
        $this->assertNull($storage->getBridgeMessageIds('unknown'));
    }
}

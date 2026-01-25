/**
 * @vitest-environment jsdom
 *
 * API Contract Tests
 *
 * These tests verify that the client sends requests that match
 * what the API actually expects. They would have caught the bug where
 * deleteMessage sent sessionId in body instead of query params.
 *
 * Each test simulates the API's validation logic to catch mismatches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PocketPingClient } from '../src/client';

// Access mocks from globalThis
const MockWebSocket = globalThis.WebSocket as any;
const MockEventSource = globalThis.EventSource as any;
const localStorageMock = globalThis.localStorage as any;

/**
 * API Contract Definitions
 * These mirror the actual API validation rules
 */
const API_CONTRACTS = {
  'POST /connect': {
    method: 'POST',
    bodyRequired: ['visitorId'],
    bodyOptional: ['sessionId', 'inspectorToken', 'metadata', 'identity'],
  },
  'POST /message': {
    method: 'POST',
    bodyRequired: ['sessionId', 'content', 'sender'],
    bodyOptional: ['attachmentIds', 'replyTo'],
  },
  'PATCH /message/:id': {
    method: 'PATCH',
    bodyRequired: ['sessionId', 'content'],
    // sessionId in body for PATCH
  },
  'DELETE /message/:id': {
    method: 'DELETE',
    queryRequired: ['sessionId'],
    // sessionId in query params for DELETE (NOT in body!)
  },
  'GET /messages': {
    method: 'GET',
    queryRequired: ['sessionId'],
    queryOptional: ['after'],
  },
};

/**
 * Mock fetch that validates requests against API contracts
 */
function createContractValidatingFetch() {
  const calls: Array<{ url: string; options: RequestInit; contract: string }> = [];

  const mockFetch = vi.fn(async (url: string, options: RequestInit = {}) => {
    const method = options.method || 'GET';
    const urlObj = new URL(url, 'http://localhost');
    const pathname = urlObj.pathname;
    const searchParams = urlObj.searchParams;

    // Determine which contract applies
    let contract: keyof typeof API_CONTRACTS | null = null;
    let pathParams: Record<string, string> = {};

    if (pathname.endsWith('/connect') && method === 'POST') {
      contract = 'POST /connect';
    } else if (pathname.match(/\/message\/[^/]+$/) && method === 'PATCH') {
      contract = 'PATCH /message/:id';
      pathParams.id = pathname.split('/').pop()!;
    } else if (pathname.match(/\/message\/[^/]+$/) && method === 'DELETE') {
      contract = 'DELETE /message/:id';
      pathParams.id = pathname.split('/').pop()!;
    } else if (pathname.endsWith('/message') && method === 'POST') {
      contract = 'POST /message';
    } else if (pathname.endsWith('/messages') && method === 'GET') {
      contract = 'GET /messages';
    }

    calls.push({ url, options, contract: contract || 'unknown' });

    // Validate against contract
    if (contract) {
      const spec = API_CONTRACTS[contract];

      // Validate query params
      if ('queryRequired' in spec) {
        for (const param of spec.queryRequired) {
          if (!searchParams.has(param)) {
            return {
              ok: false,
              status: 400,
              json: () => Promise.resolve({ error: `${param} is required in query params` }),
              headers: new Headers(),
            };
          }
        }
      }

      // Validate body
      if ('bodyRequired' in spec && options.body) {
        try {
          const body = JSON.parse(options.body as string);
          for (const field of spec.bodyRequired) {
            if (!(field in body)) {
              return {
                ok: false,
                status: 400,
                json: () => Promise.resolve({ error: `${field} is required in body` }),
                headers: new Headers(),
              };
            }
          }
        } catch {
          // Body parsing failed
        }
      }
    }

    // Return success response based on endpoint
    if (contract === 'POST /connect') {
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'session-123',
            visitorId: 'visitor-456',
            operatorOnline: true,
            messages: [],
          }),
        headers: new Headers(),
      };
    }

    if (contract === 'POST /message') {
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            messageId: 'msg-new',
            timestamp: new Date().toISOString(),
          }),
        headers: new Headers(),
      };
    }

    if (contract === 'PATCH /message/:id') {
      const body = JSON.parse(options.body as string);
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            message: {
              id: pathParams.id,
              content: body.content,
              editedAt: new Date().toISOString(),
            },
          }),
        headers: new Headers(),
      };
    }

    if (contract === 'DELETE /message/:id') {
      return {
        ok: true,
        json: () => Promise.resolve({ deleted: true }),
        headers: new Headers(),
      };
    }

    // Default response
    return {
      ok: true,
      json: () => Promise.resolve({}),
      headers: new Headers(),
    };
  });

  return { mockFetch, calls };
}

describe('API Contract Tests', () => {
  let client: PocketPingClient;
  let contractFetch: ReturnType<typeof createContractValidatingFetch>;

  const mockConfig = {
    endpoint: 'http://localhost:8000/pocketping',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.reset();
    MockEventSource.reset();
    localStorageMock.clear();

    contractFetch = createContractValidatingFetch();
    (globalThis.fetch as any) = contractFetch.mockFetch;

    client = new PocketPingClient(mockConfig);
  });

  afterEach(() => {
    client.disconnect();
  });

  describe('connect()', () => {
    it('should send POST /connect with visitorId in body', async () => {
      await client.connect();

      const connectCall = contractFetch.calls.find((c) => c.contract === 'POST /connect');
      expect(connectCall).toBeDefined();
      expect(connectCall!.options.method).toBe('POST');

      const body = JSON.parse(connectCall!.options.body as string);
      expect(body.visitorId).toBeDefined();
    });
  });

  describe('sendMessage()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should send POST /message with sessionId and content in body', async () => {
      await client.sendMessage('Hello');

      const messageCall = contractFetch.calls.find((c) => c.contract === 'POST /message');
      expect(messageCall).toBeDefined();

      const body = JSON.parse(messageCall!.options.body as string);
      expect(body.sessionId).toBe('session-123');
      expect(body.content).toBe('Hello');
      expect(body.sender).toBe('visitor');
    });
  });

  describe('editMessage()', () => {
    beforeEach(async () => {
      // Connect with existing message
      contractFetch.mockFetch.mockImplementationOnce(async () => ({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'session-123',
            visitorId: 'visitor-456',
            operatorOnline: true,
            messages: [{ id: 'msg-1', content: 'Original', sender: 'visitor', timestamp: new Date().toISOString() }],
          }),
        headers: new Headers(),
      }));
      await client.connect();
    });

    it('should send PATCH /message/:id with sessionId and content in body', async () => {
      await client.editMessage('msg-1', 'Updated content');

      const editCall = contractFetch.calls.find((c) => c.contract === 'PATCH /message/:id');
      expect(editCall).toBeDefined();
      expect(editCall!.options.method).toBe('PATCH');

      const body = JSON.parse(editCall!.options.body as string);
      expect(body.sessionId).toBe('session-123');
      expect(body.content).toBe('Updated content');
    });
  });

  describe('deleteMessage()', () => {
    beforeEach(async () => {
      // Connect with existing message
      contractFetch.mockFetch.mockImplementationOnce(async () => ({
        ok: true,
        json: () =>
          Promise.resolve({
            sessionId: 'session-123',
            visitorId: 'visitor-456',
            operatorOnline: true,
            messages: [{ id: 'msg-1', content: 'To delete', sender: 'visitor', timestamp: new Date().toISOString() }],
          }),
        headers: new Headers(),
      }));
      await client.connect();
    });

    it('should send DELETE /message/:id with sessionId in QUERY PARAMS (not body)', async () => {
      await client.deleteMessage('msg-1');

      const deleteCall = contractFetch.calls.find((c) => c.contract === 'DELETE /message/:id');
      expect(deleteCall).toBeDefined();
      expect(deleteCall!.options.method).toBe('DELETE');

      // CRITICAL: This is the bug we fixed!
      // sessionId MUST be in query params for DELETE endpoint
      const url = new URL(deleteCall!.url);
      expect(url.searchParams.get('sessionId')).toBe('session-123');

      // Body should NOT contain sessionId (or be empty)
      if (deleteCall!.options.body) {
        const body = JSON.parse(deleteCall!.options.body as string);
        expect(body.sessionId).toBeUndefined();
      }
    });

    it('should fail if sessionId is sent in body instead of query params', async () => {
      // This test documents the bug we fixed
      // If someone reverts the fix, this test will fail

      await client.deleteMessage('msg-1');

      const deleteCall = contractFetch.calls.find((c) => c.contract === 'DELETE /message/:id');

      // Verify the URL contains sessionId
      expect(deleteCall!.url).toContain('sessionId=session-123');
    });
  });

  describe('Contract Validation', () => {
    it('should reject DELETE request without sessionId in query params', async () => {
      // This simulates what the actual API does
      const result = await contractFetch.mockFetch(
        'http://localhost:8000/pocketping/message/msg-1', // No sessionId!
        { method: 'DELETE' }
      );

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const error = await result.json();
      expect(error.error).toContain('sessionId is required');
    });

    it('should accept DELETE request with sessionId in query params', async () => {
      const result = await contractFetch.mockFetch(
        'http://localhost:8000/pocketping/message/msg-1?sessionId=session-123',
        { method: 'DELETE' }
      );

      expect(result.ok).toBe(true);
    });
  });
});

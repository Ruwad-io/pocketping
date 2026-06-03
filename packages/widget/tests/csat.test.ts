import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PocketPingClient } from '../src/client';

/**
 * CSAT Feature Tests
 * - csat_request SSE event → 'csatRequested' client event
 * - submitCsat() → POST /csat + 'csatSubmitted' event
 * - score validation
 */

const MockWebSocket = globalThis.WebSocket as any;
const MockEventSource = globalThis.EventSource as any;
const localStorageMock = globalThis.localStorage as any;

describe('CSAT Feature', () => {
  let client: PocketPingClient;

  const mockConfig = { endpoint: 'http://localhost:8000/pocketping' };
  const mockConnectResponse = {
    sessionId: 'session-123',
    visitorId: 'visitor-456',
    operatorOnline: true,
    messages: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.reset();
    MockEventSource.reset();
    localStorageMock.clear();
    client = new PocketPingClient(mockConfig);
  });

  afterEach(() => {
    client.disconnect();
  });

  it('emits csatRequested on a csat_request SSE event', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConnectResponse),
      headers: new Headers(),
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 10));

    // Force SSE path (WS closed)
    const wsInstance = MockWebSocket.instances[0];
    if (wsInstance) {
      wsInstance.readyState = 3;
      wsInstance.onclose?.();
    }
    await new Promise((r) => setTimeout(r, 10));

    const sseInstance = MockEventSource.instances[0];
    expect(sseInstance).toBeDefined();

    const onCsat = vi.fn();
    client.on('csatRequested', onCsat);

    sseInstance.simulateEvent('csat_request', {
      type: 'csat_request',
      data: { requestedAt: '2026-06-03T10:00:00.000Z' },
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(onCsat).toHaveBeenCalledWith({ requestedAt: '2026-06-03T10:00:00.000Z' });
  });

  it('submitCsat posts the score/comment and emits csatSubmitted', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConnectResponse),
      headers: new Headers(),
    });
    await client.connect();
    await new Promise((r) => setTimeout(r, 10));

    const onSubmitted = vi.fn();
    client.on('csatSubmitted', onSubmitted);

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
      headers: new Headers(),
    });

    await client.submitCsat(5, '  great help  ');

    const calls = (globalThis.fetch as any).mock.calls as any[];
    const csatCall = calls.find((c) => String(c[0]).includes('/csat'));
    expect(csatCall).toBeDefined();
    const body = JSON.parse(csatCall[1].body);
    expect(body).toMatchObject({ sessionId: 'session-123', score: 5, comment: 'great help' });
    expect(onSubmitted).toHaveBeenCalledWith({ score: 5, comment: '  great help  ' });
  });

  it('rejects an out-of-range score', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConnectResponse),
      headers: new Headers(),
    });
    await client.connect();
    await new Promise((r) => setTimeout(r, 10));

    await expect(client.submitCsat(0)).rejects.toThrow(/1-5/);
    await expect(client.submitCsat(6)).rejects.toThrow(/1-5/);
  });
});

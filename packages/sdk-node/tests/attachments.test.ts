import { beforeEach, describe, expect, it } from 'vitest';
import type { Bridge } from '../src/bridges/types';
import { MAX_ATTACHMENT_SIZE, PocketPing } from '../src/pocketping';
import type { Attachment, Message, Session, UploadRequest } from '../src/types';

/** Bridge that records the messages it receives. */
class RecordingBridge implements Bridge {
  name = 'recording';
  visitorMessages: Array<{ message: Message; session: Session }> = [];

  onVisitorMessage(message: Message, session: Session): void {
    this.visitorMessages.push({ message, session });
  }
}

function uploadReq(sessionId: string, overrides: Partial<UploadRequest> = {}): UploadRequest {
  return {
    sessionId,
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
    ...overrides,
  };
}

describe('File Attachments', () => {
  let pp: PocketPing;
  let sessionId: string;

  beforeEach(async () => {
    pp = new PocketPing();
    const conn = await pp.handleConnect({ visitorId: 'visitor-1' });
    sessionId = conn.sessionId;
  });

  // 1. Creates upload request with presigned URL
  it('creates upload request with presigned URL', async () => {
    const before = Date.now();
    const res = await pp.handleUploadRequest(uploadReq(sessionId));

    expect(res.attachmentId).toBeTruthy();
    expect(res.uploadUrl).toContain(res.attachmentId);
    expect(res.expiresAt.getTime()).toBeGreaterThan(before);

    const stored = await pp.getStorage().getAttachment?.(res.attachmentId);
    expect(stored?.status).toBe('pending');
    expect(stored?.messageId).toBeNull();
  });

  // 2. Marks attachment as ready after upload
  it('marks attachment as ready after upload', async () => {
    const res = await pp.handleUploadRequest(uploadReq(sessionId));

    const ready = await pp.handleUploadComplete(res.attachmentId);
    expect(ready.status).toBe('ready');

    const stored = await pp.getStorage().getAttachment?.(res.attachmentId);
    expect(stored?.status).toBe('ready');
  });

  // 3. Links attachments to message
  it('links attachments to message', async () => {
    const res = await pp.handleUploadRequest(uploadReq(sessionId));
    await pp.handleUploadComplete(res.attachmentId);

    const sent = await pp.handleMessage({
      sessionId,
      content: 'Here is a file',
      sender: 'visitor',
      attachmentIds: [res.attachmentId],
    });

    const stored = await pp.getStorage().getAttachment?.(res.attachmentId);
    expect(stored?.messageId).toBe(sent.messageId);
  });

  // 4. Returns attachments with message
  it('returns attachments with message', async () => {
    const res = await pp.handleUploadRequest(uploadReq(sessionId, { filename: 'doc.pdf', mimeType: 'application/pdf' }));
    await pp.handleUploadComplete(res.attachmentId);

    await pp.handleMessage({
      sessionId,
      content: 'doc attached',
      sender: 'visitor',
      attachmentIds: [res.attachmentId],
    });

    const { messages } = await pp.handleGetMessages({ sessionId });
    const withAttachment = messages.find((m) => m.attachments && m.attachments.length > 0);
    expect(withAttachment).toBeDefined();
    expect(withAttachment?.attachments?.[0].id).toBe(res.attachmentId);
    expect(withAttachment?.attachments?.[0].filename).toBe('doc.pdf');

    // Also returned via connect (resume)
    const reconnect = await pp.handleConnect({ visitorId: 'visitor-1', sessionId });
    const fromConnect = reconnect.messages.find((m) => m.attachments && m.attachments.length > 0);
    expect(fromConnect?.attachments?.[0].id).toBe(res.attachmentId);
  });

  // 5. Rejects invalid mime types
  it('rejects invalid mime types', async () => {
    await expect(
      pp.handleUploadRequest(uploadReq(sessionId, { mimeType: 'application/x-msdownload' }))
    ).rejects.toThrow();
  });

  // 6. Rejects files over size limit
  it('rejects files over size limit', async () => {
    await expect(
      pp.handleUploadRequest(uploadReq(sessionId, { size: MAX_ATTACHMENT_SIZE + 1 }))
    ).rejects.toThrow();
  });

  // 7. Handles upload failure gracefully
  it('handles upload failure gracefully', async () => {
    const res = await pp.handleUploadRequest(uploadReq(sessionId));

    const failed = await pp.handleUploadFailed(res.attachmentId);
    expect(failed.status).toBe('failed');

    // Unknown id returns null without crashing
    const unknown = await pp.getStorage().getAttachment?.('does-not-exist');
    expect(unknown ?? null).toBeNull();
  });

  // 8. Syncs attachments to bridges
  it('syncs attachments to bridges', async () => {
    const bridge = new RecordingBridge();
    const ppWithBridge = new PocketPing({ bridges: [bridge] });
    const conn = await ppWithBridge.handleConnect({ visitorId: 'visitor-2' });

    const res = await ppWithBridge.handleUploadRequest(uploadReq(conn.sessionId));
    await ppWithBridge.handleUploadComplete(res.attachmentId);

    await ppWithBridge.handleMessage({
      sessionId: conn.sessionId,
      content: 'with attachment',
      sender: 'visitor',
      attachmentIds: [res.attachmentId],
    });

    expect(bridge.visitorMessages.length).toBe(1);
    const received = bridge.visitorMessages[0].message;
    expect(received.attachments).toBeDefined();
    expect(received.attachments?.map((a: Attachment) => a.id)).toContain(res.attachmentId);
  });

  // Extra: validates session existence
  it('rejects upload requests for unknown sessions', async () => {
    await expect(pp.handleUploadRequest(uploadReq('unknown-session'))).rejects.toThrow(
      'Session not found'
    );
  });

  // Extra: respects overridable config
  it('respects overridable max size, mime list, and upload base url', async () => {
    const custom = new PocketPing({
      maxAttachmentSize: 100,
      allowedMimeTypes: ['image/png'],
      uploadBaseUrl: 'https://files.example.com',
    });
    const conn = await custom.handleConnect({ visitorId: 'visitor-3' });

    const res = await custom.handleUploadRequest(
      uploadReq(conn.sessionId, { mimeType: 'image/png', size: 50 })
    );
    expect(res.uploadUrl.startsWith('https://files.example.com/')).toBe(true);

    await expect(
      custom.handleUploadRequest(uploadReq(conn.sessionId, { mimeType: 'image/jpeg', size: 50 }))
    ).rejects.toThrow();
    await expect(
      custom.handleUploadRequest(uploadReq(conn.sessionId, { mimeType: 'image/png', size: 101 }))
    ).rejects.toThrow();
  });
});

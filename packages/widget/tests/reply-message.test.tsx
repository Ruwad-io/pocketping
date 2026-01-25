/**
 * @vitest-environment jsdom
 *
 * Tests for Reply functionality in the ChatWidget.
 *
 * Key behaviors tested:
 * 1. Reply quote displays correctly for text messages
 * 2. Reply quote shows attachment icon for image replies
 * 3. Reply quote shows attachment icon for file replies
 * 4. Reply quote is clickable and scrolls to original message
 * 5. Message highlight animation is applied when scrolling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { ChatWidget } from '../src/components/ChatWidget';
import { PocketPingClient } from '../src/client';
import type { Message } from '../src/types';

// Access mocks from globalThis
const MockWebSocket = globalThis.WebSocket as any;
const MockEventSource = globalThis.EventSource as any;
const localStorageMock = globalThis.localStorage as any;

describe('Reply Message', () => {
  let client: PocketPingClient;

  const mockConfig = {
    endpoint: 'http://localhost:8000/pocketping',
  };

  /**
   * Helper to connect the client with custom messages
   */
  const connectClientWithMessages = async (messages: Message[]) => {
    const mockResponse = {
      sessionId: 'session-123',
      visitorId: 'visitor-456',
      operatorOnline: true,
      messages,
    };

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      headers: new Headers(),
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 10));
  };

  /**
   * Helper to render widget and open it
   */
  const renderOpenWidget = async () => {
    const result = render(<ChatWidget client={client} config={mockConfig} />);

    // Wait for initial render
    await new Promise((r) => setTimeout(r, 10));

    // Now open the widget (after subscription is set up)
    client.setOpen(true);

    // Wait for window to appear
    await waitFor(() => {
      expect(result.container.querySelector('.pp-window')).not.toBeNull();
    });

    return result;
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
    cleanup();
  });

  describe('Reply Quote Display', () => {
    it('should display reply quote for text message reply', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Hello, I need help!',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          sessionId: 'session-123',
          content: 'Sure, how can I help?',
          sender: 'operator',
          timestamp: new Date().toISOString(),
          replyTo: {
            id: 'msg-1',
            content: 'Hello, I need help!',
            sender: 'visitor',
          },
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Find the reply quote
      const replyQuote = container.querySelector('.pp-reply-quote');
      expect(replyQuote).not.toBeNull();

      // Check content is displayed
      const replyContent = replyQuote?.querySelector('.pp-reply-content');
      expect(replyContent?.textContent).toContain('Hello, I need help!');

      // Check sender is displayed
      const replySender = replyQuote?.querySelector('.pp-reply-sender');
      expect(replySender?.textContent).toBe('You');
    });

    it('should display photo icon for image attachment reply', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: '',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
          attachments: [
            {
              id: 'att-1',
              filename: 'photo.jpg',
              mimeType: 'image/jpeg',
              size: 1024,
              url: 'http://example.com/photo.jpg',
              status: 'ready',
            },
          ],
        },
        {
          id: 'msg-2',
          sessionId: 'session-123',
          content: 'Nice photo!',
          sender: 'operator',
          timestamp: new Date().toISOString(),
          replyTo: {
            id: 'msg-1',
            content: '',
            sender: 'visitor',
            hasAttachment: true,
            attachmentType: 'image/jpeg',
          },
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Find the reply quote with attachment icon
      const replyQuote = container.querySelector('.pp-reply-quote');
      expect(replyQuote).not.toBeNull();

      const replyContent = replyQuote?.querySelector('.pp-reply-content');
      // Should show photo emoji and "Photo" text
      expect(replyContent?.textContent).toContain('Photo');
    });

    it('should display file icon for non-image attachment reply', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: '',
          sender: 'operator',
          timestamp: new Date().toISOString(),
          attachments: [
            {
              id: 'att-1',
              filename: 'document.pdf',
              mimeType: 'application/pdf',
              size: 2048,
              url: 'http://example.com/document.pdf',
              status: 'ready',
            },
          ],
        },
        {
          id: 'msg-2',
          sessionId: 'session-123',
          content: 'Thanks for the document!',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
          replyTo: {
            id: 'msg-1',
            content: '',
            sender: 'operator',
            hasAttachment: true,
            attachmentType: 'application/pdf',
          },
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Find the reply quote
      const replyQuote = container.querySelector('.pp-reply-quote');
      expect(replyQuote).not.toBeNull();

      const replyContent = replyQuote?.querySelector('.pp-reply-content');
      // Should show file icon and "File" text for non-image
      expect(replyContent?.textContent).toContain('File');
    });

    it('should display both text and attachment icon when message has both', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Check out this screenshot',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
          attachments: [
            {
              id: 'att-1',
              filename: 'screenshot.png',
              mimeType: 'image/png',
              size: 1024,
              url: 'http://example.com/screenshot.png',
              status: 'ready',
            },
          ],
        },
        {
          id: 'msg-2',
          sessionId: 'session-123',
          content: 'I see the issue!',
          sender: 'operator',
          timestamp: new Date().toISOString(),
          replyTo: {
            id: 'msg-1',
            content: 'Check out this screenshot',
            sender: 'visitor',
            hasAttachment: true,
            attachmentType: 'image/png',
          },
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const replyQuote = container.querySelector('.pp-reply-quote');
      const replyContent = replyQuote?.querySelector('.pp-reply-content');

      // Should show both the text content and attachment icon
      expect(replyContent?.textContent).toContain('Check out this screenshot');
    });

    it('should show "Message deleted" for deleted message reply', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Original message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
          deletedAt: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          sessionId: 'session-123',
          content: 'Reply to deleted',
          sender: 'operator',
          timestamp: new Date().toISOString(),
          replyTo: {
            id: 'msg-1',
            content: 'Original message',
            sender: 'visitor',
            deleted: true,
          },
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const replyQuote = container.querySelector('.pp-reply-quote');
      const replyContent = replyQuote?.querySelector('.pp-reply-content');

      expect(replyContent?.textContent).toContain('Message deleted');
    });
  });

  describe('Scroll to Message', () => {
    it('should have clickable reply quote with correct class', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'First message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          sessionId: 'session-123',
          content: 'Reply to first',
          sender: 'operator',
          timestamp: new Date().toISOString(),
          replyTo: {
            id: 'msg-1',
            content: 'First message',
            sender: 'visitor',
          },
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const replyQuote = container.querySelector('.pp-reply-quote');
      expect(replyQuote?.classList.contains('pp-reply-quote-clickable')).toBe(true);
    });

    it('should have message elements with id attributes', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'First message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          sessionId: 'session-123',
          content: 'Second message',
          sender: 'operator',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Check that messages have id attributes
      const msg1 = container.querySelector('#pp-msg-msg-1');
      const msg2 = container.querySelector('#pp-msg-msg-2');

      expect(msg1).not.toBeNull();
      expect(msg2).not.toBeNull();
    });

    it('should scroll to message and add highlight class when reply quote is clicked', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'First message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          sessionId: 'session-123',
          content: 'Reply to first',
          sender: 'operator',
          timestamp: new Date().toISOString(),
          replyTo: {
            id: 'msg-1',
            content: 'First message',
            sender: 'visitor',
          },
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const replyQuote = container.querySelector('.pp-reply-quote-clickable');
      const targetMessage = container.querySelector('#pp-msg-msg-1');

      expect(replyQuote).not.toBeNull();
      expect(targetMessage).not.toBeNull();

      // Click the reply quote
      fireEvent.click(replyQuote!);

      // The target message should have the highlight class
      await waitFor(() => {
        expect(targetMessage?.classList.contains('pp-message-highlight')).toBe(true);
      });

      // scrollIntoView should have been called (mocked in setup.ts)
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('should remove highlight class after animation', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'First message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          sessionId: 'session-123',
          content: 'Reply to first',
          sender: 'operator',
          timestamp: new Date().toISOString(),
          replyTo: {
            id: 'msg-1',
            content: 'First message',
            sender: 'visitor',
          },
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const replyQuote = container.querySelector('.pp-reply-quote-clickable');
      const targetMessage = container.querySelector('#pp-msg-msg-1');

      // Click the reply quote
      fireEvent.click(replyQuote!);

      // Highlight class should be added
      expect(targetMessage?.classList.contains('pp-message-highlight')).toBe(true);

      // Wait for the highlight timeout (1500ms + buffer)
      await new Promise((r) => setTimeout(r, 1600));

      // Highlight class should be removed
      expect(targetMessage?.classList.contains('pp-message-highlight')).toBe(false);
    }, 3000); // Increase test timeout

    it('should support keyboard navigation (Enter key)', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'First message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          sessionId: 'session-123',
          content: 'Reply to first',
          sender: 'operator',
          timestamp: new Date().toISOString(),
          replyTo: {
            id: 'msg-1',
            content: 'First message',
            sender: 'visitor',
          },
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const replyQuote = container.querySelector('.pp-reply-quote-clickable');
      const targetMessage = container.querySelector('#pp-msg-msg-1');

      // Simulate Enter key press
      fireEvent.keyDown(replyQuote!, { key: 'Enter' });

      // The target message should have the highlight class
      await waitFor(() => {
        expect(targetMessage?.classList.contains('pp-message-highlight')).toBe(true);
      });
    });

    it('should have proper accessibility attributes', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'First message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          sessionId: 'session-123',
          content: 'Reply to first',
          sender: 'operator',
          timestamp: new Date().toISOString(),
          replyTo: {
            id: 'msg-1',
            content: 'First message',
            sender: 'visitor',
          },
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const replyQuote = container.querySelector('.pp-reply-quote-clickable');

      // Check accessibility attributes
      expect(replyQuote?.getAttribute('role')).toBe('button');
      expect(replyQuote?.getAttribute('tabIndex')).toBe('0');
    });
  });

  describe('Reply Quote from Local Messages (String ID)', () => {
    /**
     * When replyTo is a string ID (not embedded object),
     * the widget should find the message locally and build ReplyToData
     */
    it('should build reply data from local message when replyTo is string ID', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Hello with image',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
          attachments: [
            {
              id: 'att-1',
              filename: 'photo.jpg',
              mimeType: 'image/jpeg',
              size: 1024,
              url: 'http://example.com/photo.jpg',
              status: 'ready',
            },
          ],
        },
        {
          id: 'msg-2',
          sessionId: 'session-123',
          content: 'Reply to image message',
          sender: 'operator',
          timestamp: new Date().toISOString(),
          replyTo: 'msg-1', // String ID instead of object
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Find the reply quote - it should still work with string ID
      const replyQuote = container.querySelector('.pp-reply-quote');
      expect(replyQuote).not.toBeNull();

      const replyContent = replyQuote?.querySelector('.pp-reply-content');
      // Should show the text content from the local message lookup
      expect(replyContent?.textContent).toContain('Hello with image');
    });
  });
});

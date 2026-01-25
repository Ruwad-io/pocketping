/**
 * @vitest-environment jsdom
 *
 * Tests for Edit and Delete message functionality in the ChatWidget.
 *
 * Key behaviors tested:
 * 1. Message context menu (right-click / long-press)
 * 2. Edit message modal and flow
 * 3. Delete message confirmation and flow
 * 4. Edited message badge display
 * 5. Deleted message placeholder display
 * 6. Only visitor messages can be edited/deleted
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

// Helper to find button by text content
const findButtonByText = (container: HTMLElement, text: string): HTMLButtonElement | null => {
  const buttons = container.querySelectorAll('button');
  return (
    Array.from(buttons).find((btn) => btn.textContent?.toLowerCase().includes(text.toLowerCase())) as HTMLButtonElement | undefined
  ) || null;
};

describe('Edit/Delete Message', () => {
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

  /**
   * Helper to open context menu and find edit button
   */
  const openContextMenuAndFindEditButton = async (container: HTMLElement, messageId: string) => {
    const messageElement = container.querySelector(`#pp-msg-${messageId}`);
    fireEvent.contextMenu(messageElement!);

    await waitFor(() => {
      const menu = container.querySelector('.pp-message-menu');
      expect(menu).not.toBeNull();
    });

    const menu = container.querySelector('.pp-message-menu') as HTMLElement;
    return findButtonByText(menu, 'Edit');
  };

  /**
   * Helper to open context menu and find reply button
   */
  const openContextMenuAndFindReplyButton = async (container: HTMLElement, messageId: string) => {
    const messageElement = container.querySelector(`#pp-msg-${messageId}`);
    fireEvent.contextMenu(messageElement!);

    await waitFor(() => {
      const menu = container.querySelector('.pp-message-menu');
      expect(menu).not.toBeNull();
    });

    const menu = container.querySelector('.pp-message-menu') as HTMLElement;
    return findButtonByText(menu, 'Reply');
  };

  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.reset();
    MockEventSource.reset();
    localStorageMock.clear();

    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    client = new PocketPingClient(mockConfig);
  });

  afterEach(() => {
    client.disconnect();
    cleanup();
    vi.restoreAllMocks();
  });

  describe('Edited Message Display', () => {
    it('should display edited badge for edited messages', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Updated content',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
          editedAt: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Find the edited badge
      const editedBadge = container.querySelector('.pp-edited-badge');
      expect(editedBadge).not.toBeNull();
      expect(editedBadge?.textContent).toBe('edited');
    });

    it('should not display edited badge for non-edited messages', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Normal message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const editedBadge = container.querySelector('.pp-edited-badge');
      expect(editedBadge).toBeNull();
    });
  });

  describe('Deleted Message Display', () => {
    it('should display deleted placeholder for deleted messages', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: '',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
          deletedAt: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Find the deleted message
      const deletedMessage = container.querySelector('.pp-message-deleted');
      expect(deletedMessage).not.toBeNull();

      // Check for deleted content placeholder
      const deletedContent = container.querySelector('.pp-deleted-content');
      expect(deletedContent).not.toBeNull();
      expect(deletedContent?.textContent).toContain('Message deleted');
    });

    it('should apply deleted class to message container', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: '',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
          deletedAt: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const messageElement = container.querySelector('#pp-msg-msg-1');
      expect(messageElement?.classList.contains('pp-message-deleted')).toBe(true);
    });
  });

  describe('Message Context Menu', () => {
    it('should show context menu on right-click for visitor messages', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'My message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const messageElement = container.querySelector('#pp-msg-msg-1');
      expect(messageElement).not.toBeNull();

      // Right-click on the message
      fireEvent.contextMenu(messageElement!);

      // Wait for context menu to appear
      await waitFor(() => {
        const menu = container.querySelector('.pp-message-menu');
        expect(menu).not.toBeNull();
      });
    });

    it('should show edit and delete buttons in context menu for visitor messages', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'My message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const messageElement = container.querySelector('#pp-msg-msg-1');
      fireEvent.contextMenu(messageElement!);

      await waitFor(() => {
        const menu = container.querySelector('.pp-message-menu');
        expect(menu).not.toBeNull();
        // Find buttons by text content
        const editButton = findButtonByText(menu as HTMLElement, 'Edit');
        const deleteButton = container.querySelector('.pp-menu-delete');
        expect(editButton).not.toBeNull();
        expect(deleteButton).not.toBeNull();
      });
    });

    it('should not show edit/delete buttons for operator messages', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Operator message',
          sender: 'operator',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const messageElement = container.querySelector('#pp-msg-msg-1');
      fireEvent.contextMenu(messageElement!);

      await waitFor(() => {
        const menu = container.querySelector('.pp-message-menu');
        expect(menu).not.toBeNull();
      });

      // Edit and delete should NOT be visible for operator messages
      const menu = container.querySelector('.pp-message-menu') as HTMLElement;
      const editButton = findButtonByText(menu, 'Edit');
      const deleteButton = container.querySelector('.pp-menu-delete');
      expect(editButton).toBeNull();
      expect(deleteButton).toBeNull();
    });

    it('should close context menu when clicking outside', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'My message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const messageElement = container.querySelector('#pp-msg-msg-1');
      fireEvent.contextMenu(messageElement!);

      // Wait for menu to appear
      await waitFor(() => {
        expect(container.querySelector('.pp-message-menu')).not.toBeNull();
      });

      // Click outside (on the document body)
      fireEvent.click(document.body);

      // Menu should be closed
      await waitFor(() => {
        expect(container.querySelector('.pp-message-menu')).toBeNull();
      });
    });
  });

  describe('Edit Message Flow', () => {
    it('should open edit modal when clicking edit button', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Original message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Open context menu and find edit button
      const editButton = await openContextMenuAndFindEditButton(container, 'msg-1');
      expect(editButton).not.toBeNull();

      // Click edit button
      fireEvent.click(editButton!);

      // Edit modal should appear
      await waitFor(() => {
        const editModal = container.querySelector('.pp-edit-modal');
        expect(editModal).not.toBeNull();
      });
    });

    it('should pre-fill edit input with original message content', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Original message content',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const editButton = await openContextMenuAndFindEditButton(container, 'msg-1');
      fireEvent.click(editButton!);

      // Check input value
      await waitFor(() => {
        const editInput = container.querySelector('.pp-edit-input') as HTMLTextAreaElement;
        expect(editInput).not.toBeNull();
        expect(editInput.value).toBe('Original message content');
      });
    });

    it('should close edit modal when clicking cancel', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Original message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const editButton = await openContextMenuAndFindEditButton(container, 'msg-1');
      fireEvent.click(editButton!);

      await waitFor(() => {
        expect(container.querySelector('.pp-edit-modal')).not.toBeNull();
      });

      // Click cancel
      const cancelButton = container.querySelector('.pp-edit-cancel');
      fireEvent.click(cancelButton!);

      // Modal should be closed
      await waitFor(() => {
        expect(container.querySelector('.pp-edit-modal')).toBeNull();
      });
    });

    it('should call editMessage API when saving edit', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Original message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Mock the edit API response
      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            message: {
              id: 'msg-1',
              content: 'Updated message',
              editedAt: new Date().toISOString(),
            },
          }),
        headers: new Headers(),
      });

      const editButton = await openContextMenuAndFindEditButton(container, 'msg-1');
      fireEvent.click(editButton!);

      await waitFor(() => {
        expect(container.querySelector('.pp-edit-modal')).not.toBeNull();
      });

      // Change content
      const editInput = container.querySelector('.pp-edit-input') as HTMLTextAreaElement;
      fireEvent.input(editInput, { target: { value: 'Updated message' } });

      // Click save
      const saveButton = container.querySelector('.pp-edit-save');
      fireEvent.click(saveButton!);

      // Verify API was called
      await waitFor(() => {
        const calls = (globalThis.fetch as any).mock.calls;
        const editCall = calls.find(
          (call: [string, RequestInit]) =>
            call[0].includes('/message/msg-1') && call[1]?.method === 'PATCH'
        );
        expect(editCall).toBeDefined();
      });
    });

    it('should disable save button when content is empty', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Original message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const editButton = await openContextMenuAndFindEditButton(container, 'msg-1');
      fireEvent.click(editButton!);

      await waitFor(() => {
        expect(container.querySelector('.pp-edit-modal')).not.toBeNull();
      });

      // Clear content
      const editInput = container.querySelector('.pp-edit-input') as HTMLTextAreaElement;
      fireEvent.input(editInput, { target: { value: '' } });

      // Save button should be disabled
      const saveButton = container.querySelector('.pp-edit-save') as HTMLButtonElement;
      expect(saveButton.disabled).toBe(true);
    });
  });

  describe('Delete Message Flow', () => {
    it('should show confirmation dialog when clicking delete', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'To be deleted',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Open context menu
      const messageElement = container.querySelector('#pp-msg-msg-1');
      fireEvent.contextMenu(messageElement!);

      await waitFor(() => {
        expect(container.querySelector('.pp-menu-delete')).not.toBeNull();
      });

      // Click delete button
      fireEvent.click(container.querySelector('.pp-menu-delete')!);

      // Confirm should have been called
      expect(window.confirm).toHaveBeenCalledWith('Delete this message?');
    });

    it('should call deleteMessage API with sessionId in query params', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'To be deleted',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Mock the delete API response
      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ deleted: true }),
        headers: new Headers(),
      });

      // Open context menu and click delete
      const messageElement = container.querySelector('#pp-msg-msg-1');
      fireEvent.contextMenu(messageElement!);

      await waitFor(() => {
        expect(container.querySelector('.pp-menu-delete')).not.toBeNull();
      });

      fireEvent.click(container.querySelector('.pp-menu-delete')!);

      // Verify API was called with correct URL (sessionId in query params, not body)
      await waitFor(() => {
        const calls = (globalThis.fetch as any).mock.calls;
        const deleteCall = calls.find(
          (call: [string, RequestInit]) =>
            call[0].includes('/message/msg-1') && call[1]?.method === 'DELETE'
        );
        expect(deleteCall).toBeDefined();
        // IMPORTANT: sessionId must be in query params for the API to work
        expect(deleteCall[0]).toContain('sessionId=session-123');
      });
    });

    it('should not call deleteMessage API when cancelled', async () => {
      // Mock confirm to return false (cancel)
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'To be deleted',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      const initialFetchCalls = (globalThis.fetch as any).mock.calls.length;

      // Open context menu and click delete
      const messageElement = container.querySelector('#pp-msg-msg-1');
      fireEvent.contextMenu(messageElement!);

      await waitFor(() => {
        expect(container.querySelector('.pp-menu-delete')).not.toBeNull();
      });

      fireEvent.click(container.querySelector('.pp-menu-delete')!);

      // No additional fetch calls should have been made
      await new Promise((r) => setTimeout(r, 50));
      expect((globalThis.fetch as any).mock.calls.length).toBe(initialFetchCalls);
    });

    it('should not show delete button for already deleted messages', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: '',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
          deletedAt: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Open context menu on deleted message
      const messageElement = container.querySelector('#pp-msg-msg-1');
      fireEvent.contextMenu(messageElement!);

      await waitFor(() => {
        const menu = container.querySelector('.pp-message-menu');
        expect(menu).not.toBeNull();
      });

      // Delete button should not be visible
      const deleteButton = container.querySelector('.pp-menu-delete');
      expect(deleteButton).toBeNull();
    });
  });

  describe('Reply Button in Context Menu', () => {
    it('should show reply button in context menu', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Test message',
          sender: 'visitor',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Open context menu
      const replyButton = await openContextMenuAndFindReplyButton(container, 'msg-1');
      expect(replyButton).not.toBeNull();
    });

    it('should show reply preview when clicking reply button', async () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          content: 'Message to reply to',
          sender: 'operator',
          timestamp: new Date().toISOString(),
        },
      ];

      await connectClientWithMessages(messages);
      const { container } = await renderOpenWidget();

      // Open context menu and click reply
      const replyButton = await openContextMenuAndFindReplyButton(container, 'msg-1');
      expect(replyButton).not.toBeNull();
      fireEvent.click(replyButton!);

      // Reply preview should appear
      await waitFor(() => {
        const replyPreview = container.querySelector('.pp-reply-preview');
        expect(replyPreview).not.toBeNull();
      });
    });
  });
});

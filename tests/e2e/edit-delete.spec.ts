import { test, expect } from '@playwright/test';

test.describe('Edit Message', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Open chat and send a message first
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Message to edit');
    await page.locator('.pp-send-btn').click();
    // Wait for message to appear
    await page.waitForSelector('.pp-message-visitor');
  });

  test('should show context menu on right-click', async ({ page }) => {
    // Right-click on the message
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });

    // Context menu should appear
    const menu = page.locator('.pp-message-menu');
    await expect(menu).toBeVisible();
  });

  test('should show edit button in context menu for own messages', async ({ page }) => {
    // Right-click on the message
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });

    // Find edit button (contains "Edit" text)
    const editButton = page.locator('.pp-message-menu button', { hasText: 'Edit' });
    await expect(editButton).toBeVisible();
  });

  test('should open edit modal when clicking edit', async ({ page }) => {
    // Right-click and click edit
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-message-menu button', { hasText: 'Edit' }).click();

    // Edit modal should appear
    const editModal = page.locator('.pp-edit-modal');
    await expect(editModal).toBeVisible();
  });

  test('should pre-fill edit input with original content', async ({ page }) => {
    // Right-click and click edit
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-message-menu button', { hasText: 'Edit' }).click();

    // Input should have original content
    const editInput = page.locator('.pp-edit-input');
    await expect(editInput).toHaveValue('Message to edit');
  });

  test('should close edit modal when clicking cancel', async ({ page }) => {
    // Open edit modal
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-message-menu button', { hasText: 'Edit' }).click();

    // Click cancel
    await page.locator('.pp-edit-cancel').click();

    // Modal should close
    const editModal = page.locator('.pp-edit-modal');
    await expect(editModal).not.toBeVisible();
  });

  test('should update message content after saving edit', async ({ page }) => {
    // Open edit modal
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-message-menu button', { hasText: 'Edit' }).click();

    // Clear and enter new content
    const editInput = page.locator('.pp-edit-input');
    await editInput.clear();
    await editInput.fill('Updated message content');

    // Save
    await page.locator('.pp-edit-save').click();

    // Message should show updated content
    await expect(message).toContainText('Updated message content');
  });

  test('should show edited badge after editing', async ({ page }) => {
    // Edit the message
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-message-menu button', { hasText: 'Edit' }).click();
    await page.locator('.pp-edit-input').fill('Edited content');
    await page.locator('.pp-edit-save').click();

    // Edited badge should appear
    const editedBadge = page.locator('.pp-edited-badge');
    await expect(editedBadge).toBeVisible();
    await expect(editedBadge).toContainText('edited');
  });

  test('should disable save button when content is empty', async ({ page }) => {
    // Open edit modal
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-message-menu button', { hasText: 'Edit' }).click();

    // Clear content
    const editInput = page.locator('.pp-edit-input');
    await editInput.clear();

    // Save button should be disabled
    const saveButton = page.locator('.pp-edit-save');
    await expect(saveButton).toBeDisabled();
  });
});

test.describe('Delete Message', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Open chat and send a message first
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Message to delete');
    await page.locator('.pp-send-btn').click();
    // Wait for message to appear
    await page.waitForSelector('.pp-message-visitor');
  });

  test('should show delete button in context menu for own messages', async ({ page }) => {
    // Right-click on the message
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });

    // Delete button should be visible
    const deleteButton = page.locator('.pp-menu-delete');
    await expect(deleteButton).toBeVisible();
  });

  test('should show confirmation dialog when clicking delete', async ({ page }) => {
    // Setup dialog handler
    let dialogMessage = '';
    page.on('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });

    // Right-click and click delete
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-menu-delete').click();

    // Confirm dialog message
    expect(dialogMessage).toBe('Delete this message?');
  });

  test('should show deleted placeholder after confirming delete', async ({ page }) => {
    // Accept the confirmation dialog
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Right-click and click delete
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-menu-delete').click();

    // Message should show deleted state
    const deletedContent = page.locator('.pp-deleted-content');
    await expect(deletedContent).toBeVisible();
    await expect(deletedContent).toContainText('Message deleted');
  });

  test('should not delete when cancelling confirmation', async ({ page }) => {
    // Dismiss the confirmation dialog
    page.on('dialog', async (dialog) => {
      await dialog.dismiss();
    });

    // Right-click and click delete
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-menu-delete').click();

    // Message should still show original content
    await expect(message).toContainText('Message to delete');
  });

  test('should not show edit/delete for deleted messages', async ({ page }) => {
    // Accept confirmation and delete the message
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-menu-delete').click();

    // Wait for deleted state
    await page.waitForSelector('.pp-deleted-content');

    // Right-click on the deleted message
    await message.click({ button: 'right' });

    // Edit and delete buttons should not be visible
    const editButton = page.locator('.pp-message-menu button', { hasText: 'Edit' });
    const deleteButton = page.locator('.pp-menu-delete');
    await expect(editButton).not.toBeVisible();
    await expect(deleteButton).not.toBeVisible();
  });
});

test.describe('Reply Button in Context Menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Test message');
    await page.locator('.pp-send-btn').click();
    await page.waitForSelector('.pp-message-visitor');
  });

  test('should show reply button in context menu', async ({ page }) => {
    // Right-click on the message
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });

    // Reply button should be visible
    const replyButton = page.locator('.pp-message-menu button', { hasText: 'Reply' });
    await expect(replyButton).toBeVisible();
  });

  test('should show reply preview when clicking reply', async ({ page }) => {
    // Right-click and click reply
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-message-menu button', { hasText: 'Reply' }).click();

    // Reply preview should appear
    const replyPreview = page.locator('.pp-reply-preview');
    await expect(replyPreview).toBeVisible();
  });

  test('should close context menu after clicking any action', async ({ page }) => {
    // Right-click and click reply
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });

    // Menu should be visible
    const menu = page.locator('.pp-message-menu');
    await expect(menu).toBeVisible();

    // Click reply
    await page.locator('.pp-message-menu button', { hasText: 'Reply' }).click();

    // Menu should be closed
    await expect(menu).not.toBeVisible();
  });
});

test.describe('Operator Messages', () => {
  // Note: These tests require operator messages to be present
  // They may need a test fixture that includes operator responses

  test('should not show edit/delete for operator messages', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pp-toggle').click();

    // Check if there are any operator messages
    const operatorMessage = page.locator('.pp-message-operator').first();
    const hasOperatorMessages = await operatorMessage.count() > 0;

    if (hasOperatorMessages) {
      // Right-click on operator message
      await operatorMessage.click({ button: 'right' });

      // Menu should appear but without edit/delete
      const menu = page.locator('.pp-message-menu');
      await expect(menu).toBeVisible();

      const editButton = page.locator('.pp-message-menu button', { hasText: 'Edit' });
      const deleteButton = page.locator('.pp-menu-delete');
      await expect(editButton).not.toBeVisible();
      await expect(deleteButton).not.toBeVisible();
    } else {
      // Skip if no operator messages
      test.skip();
    }
  });
});

test.describe('Edit/Delete Persistence', () => {
  test('edited message should persist after page reload', async ({ page }) => {
    await page.goto('/');
    // Send and edit a message
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Original message');
    await page.locator('.pp-send-btn').click();
    await page.waitForSelector('.pp-message-visitor');

    // Edit the message
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-message-menu button', { hasText: 'Edit' }).click();
    await page.locator('.pp-edit-input').fill('Edited message');
    await page.locator('.pp-edit-save').click();

    // Wait for edit to complete
    await page.waitForSelector('.pp-edited-badge');

    // Reload the page
    await page.reload();

    // Open chat again
    await page.locator('.pp-toggle').click();

    // Message should still show edited content and badge
    const reloadedMessage = page.locator('.pp-message-visitor').first();
    await expect(reloadedMessage).toContainText('Edited message');
    await expect(page.locator('.pp-edited-badge')).toBeVisible();
  });

  test('deleted message should persist after page reload', async ({ page }) => {
    await page.goto('/');
    // Accept deletion confirmation
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Send and delete a message
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Message to delete');
    await page.locator('.pp-send-btn').click();
    await page.waitForSelector('.pp-message-visitor');

    // Delete the message
    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-menu-delete').click();

    // Wait for deletion
    await page.waitForSelector('.pp-deleted-content');

    // Reload the page
    await page.reload();

    // Open chat again
    await page.locator('.pp-toggle').click();

    // Message should still show deleted state
    const deletedContent = page.locator('.pp-deleted-content');
    await expect(deletedContent).toBeVisible();
  });
});

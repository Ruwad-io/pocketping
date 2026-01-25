import { test, expect } from '@playwright/test';

// TODO: These tests are skipped until the edit/delete UI is fully implemented in the widget
// The backend API and SDK support is ready, but the widget UI needs:
// - Context menu with Edit/Delete/Reply buttons
// - Edit modal (.pp-edit-modal, .pp-edit-input, .pp-edit-save, .pp-edit-cancel)
// - Edited badge (.pp-edited-badge)
// - Deleted content placeholder (.pp-deleted-content)
// - Reply preview (.pp-reply-preview)

test.describe('Edit Message', () => {
  test.skip('should show context menu on right-click', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Message to edit');
    await page.locator('.pp-send-btn').click();
    await page.waitForSelector('.pp-message-visitor');

    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });

    const menu = page.locator('.pp-message-menu');
    await expect(menu).toBeVisible();
  });

  test.skip('should show edit button in context menu for own messages', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Message to edit');
    await page.locator('.pp-send-btn').click();
    await page.waitForSelector('.pp-message-visitor');

    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });

    const editButton = page.locator('.pp-message-menu button', { hasText: 'Edit' });
    await expect(editButton).toBeVisible();
  });

  test.skip('should update message content after saving edit', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Message to edit');
    await page.locator('.pp-send-btn').click();
    await page.waitForSelector('.pp-message-visitor');

    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-message-menu button', { hasText: 'Edit' }).click();

    const editInput = page.locator('.pp-edit-input');
    await editInput.clear();
    await editInput.fill('Updated message content');
    await page.locator('.pp-edit-save').click();

    await expect(message).toContainText('Updated message content');
  });

  test.skip('should show edited badge after editing', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Message to edit');
    await page.locator('.pp-send-btn').click();
    await page.waitForSelector('.pp-message-visitor');

    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-message-menu button', { hasText: 'Edit' }).click();
    await page.locator('.pp-edit-input').fill('Edited content');
    await page.locator('.pp-edit-save').click();

    const editedBadge = page.locator('.pp-edited-badge');
    await expect(editedBadge).toBeVisible();
    await expect(editedBadge).toContainText('edited');
  });
});

test.describe('Delete Message', () => {
  test.skip('should show deleted placeholder after confirming delete', async ({ page }) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto('/');
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Message to delete');
    await page.locator('.pp-send-btn').click();
    await page.waitForSelector('.pp-message-visitor');

    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-menu-delete').click();

    const deletedContent = page.locator('.pp-deleted-content');
    await expect(deletedContent).toBeVisible();
    await expect(deletedContent).toContainText('Message deleted');
  });

  test.skip('should not show edit/delete for deleted messages', async ({ page }) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto('/');
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Message to delete');
    await page.locator('.pp-send-btn').click();
    await page.waitForSelector('.pp-message-visitor');

    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-menu-delete').click();

    await page.waitForSelector('.pp-deleted-content');

    await message.click({ button: 'right' });

    const editButton = page.locator('.pp-message-menu button', { hasText: 'Edit' });
    const deleteButton = page.locator('.pp-menu-delete');
    await expect(editButton).not.toBeVisible();
    await expect(deleteButton).not.toBeVisible();
  });
});

test.describe('Edit/Delete Persistence', () => {
  test.skip('edited message should persist after page reload', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Original message');
    await page.locator('.pp-send-btn').click();
    await page.waitForSelector('.pp-message-visitor');

    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-message-menu button', { hasText: 'Edit' }).click();
    await page.locator('.pp-edit-input').fill('Edited message');
    await page.locator('.pp-edit-save').click();

    await page.waitForSelector('.pp-edited-badge');
    await page.reload();
    await page.locator('.pp-toggle').click();

    const reloadedMessage = page.locator('.pp-message-visitor').first();
    await expect(reloadedMessage).toContainText('Edited message');
    await expect(page.locator('.pp-edited-badge')).toBeVisible();
  });

  test.skip('deleted message should persist after page reload', async ({ page }) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto('/');
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Message to delete');
    await page.locator('.pp-send-btn').click();
    await page.waitForSelector('.pp-message-visitor');

    const message = page.locator('.pp-message-visitor').first();
    await message.click({ button: 'right' });
    await page.locator('.pp-menu-delete').click();

    await page.waitForSelector('.pp-deleted-content');
    await page.reload();
    await page.locator('.pp-toggle').click();

    const deletedContent = page.locator('.pp-deleted-content');
    await expect(deletedContent).toBeVisible();
  });
});

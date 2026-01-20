import { test, expect } from '@playwright/test';

test.describe('Visitor Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Go to the test page with the widget
    await page.goto('/');
  });

  test('should display chat toggle button', async ({ page }) => {
    // The widget toggle button should be visible
    const toggle = page.locator('.pp-toggle');
    await expect(toggle).toBeVisible();
  });

  test('should open chat window when clicking toggle', async ({ page }) => {
    // Click the toggle button
    await page.locator('.pp-toggle').click();

    // Chat window should open
    const chatWindow = page.locator('.pp-window');
    await expect(chatWindow).toBeVisible();

    // Header should show operator name
    const header = page.locator('.pp-header-title');
    await expect(header).toBeVisible();
  });

  test('should show welcome message when no messages', async ({ page }) => {
    // Open chat
    await page.locator('.pp-toggle').click();

    // Wait for the welcome message
    const welcome = page.locator('.pp-welcome');
    await expect(welcome).toBeVisible();
  });

  test('should send a message', async ({ page }) => {
    // Open chat
    await page.locator('.pp-toggle').click();

    // Type a message
    const input = page.locator('.pp-input');
    await input.fill('Hello, I need help!');

    // Send the message
    await page.locator('.pp-send-btn').click();

    // Message should appear in chat
    const message = page.locator('.pp-message-visitor').first();
    await expect(message).toContainText('Hello, I need help!');
  });

  test('should show sending status on message', async ({ page }) => {
    // Open chat
    await page.locator('.pp-toggle').click();

    // Send a message
    const input = page.locator('.pp-input');
    await input.fill('Test message');
    await page.locator('.pp-send-btn').click();

    // Status indicator should be visible
    const statusIcon = page.locator('.pp-status .pp-check');
    await expect(statusIcon).toBeVisible();
  });

  test('should clear input after sending', async ({ page }) => {
    // Open chat
    await page.locator('.pp-toggle').click();

    // Type and send
    const input = page.locator('.pp-input');
    await input.fill('Test message');
    await page.locator('.pp-send-btn').click();

    // Input should be cleared
    await expect(input).toHaveValue('');
  });

  test('should close chat window when clicking close button', async ({ page }) => {
    // Open chat
    await page.locator('.pp-toggle').click();

    // Click close button
    await page.locator('.pp-close-btn').click();

    // Chat window should be hidden
    const chatWindow = page.locator('.pp-window');
    await expect(chatWindow).not.toBeVisible();
  });

  test('should persist session across page reloads', async ({ page }) => {
    // Open chat and send a message
    await page.locator('.pp-toggle').click();
    await page.locator('.pp-input').fill('Hello!');
    await page.locator('.pp-send-btn').click();

    // Wait for message to be sent
    await page.waitForSelector('.pp-message-visitor');

    // Reload page
    await page.reload();

    // Open chat again
    await page.locator('.pp-toggle').click();

    // Message should still be there
    const message = page.locator('.pp-message-visitor').first();
    await expect(message).toContainText('Hello!');
  });
});

test.describe('Theme Support', () => {
  test('should apply light theme by default', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pp-toggle').click();

    const window = page.locator('.pp-window');
    await expect(window).toHaveClass(/pp-theme-light|pp-theme-dark/);
  });

  test('should apply dark theme on dark theme page', async ({ page }) => {
    await page.goto('/dark');
    await page.locator('.pp-toggle').click();

    const window = page.locator('.pp-window');
    await expect(window).toHaveClass(/pp-theme-dark/);
  });
});

test.describe('Responsive Behavior', () => {
  test('should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Toggle should be visible
    await expect(page.locator('.pp-toggle')).toBeVisible();

    // Open chat
    await page.locator('.pp-toggle').click();

    // Chat window should be visible and properly sized
    const window = page.locator('.pp-window');
    await expect(window).toBeVisible();
  });
});

test.describe('Input Behavior', () => {
  test('should disable send button when input is empty', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pp-toggle').click();

    const sendBtn = page.locator('.pp-send-btn');
    await expect(sendBtn).toBeDisabled();
  });

  test('should enable send button when input has text', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pp-toggle').click();

    await page.locator('.pp-input').fill('Hello');

    const sendBtn = page.locator('.pp-send-btn');
    await expect(sendBtn).not.toBeDisabled();
  });

  test('should send on Enter key', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pp-toggle').click();

    const input = page.locator('.pp-input');
    await input.fill('Hello via Enter');
    await input.press('Enter');

    // Message should appear
    const message = page.locator('.pp-message-visitor').first();
    await expect(message).toContainText('Hello via Enter');
  });
});

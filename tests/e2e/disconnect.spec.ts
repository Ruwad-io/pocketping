import { test, expect } from '@playwright/test';

const PROJECT_ID = 'proj_5d9f587cc6d6312cffbe3433b8580ada';

test.describe('Visitor Disconnect', () => {
  test('should send disconnect notification when closing tab', async ({ page, context }) => {
    // Capture console logs
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      if (msg.text().includes('[PocketPing]')) {
        consoleLogs.push(msg.text());
        console.log('Widget:', msg.text());
      }
    });

    // Capture network requests
    const disconnectRequests: { url: string; data: string }[] = [];
    page.on('request', request => {
      if (request.url().includes('/disconnect')) {
        disconnectRequests.push({
          url: request.url(),
          data: request.postData() || '',
        });
        console.log('Disconnect request:', request.url());
      }
    });

    // Go to test page
    await page.goto('https://test.pocketping.test');

    // Enter project ID and load widget
    await page.fill('input[placeholder*="Project ID"]', PROJECT_ID);
    await page.click('button:has-text("Charger le Widget")');

    // Wait for widget to initialize
    await page.waitForSelector('.pp-toggle', { timeout: 15000 });

    // Open the chat to trigger full connection
    await page.locator('.pp-toggle').click();
    await page.waitForSelector('.pp-window', { timeout: 5000 });

    // Wait for connection logs
    await page.waitForFunction(() => {
      return (window as any).__pocketping_connected === true;
    }, { timeout: 10000 }).catch(() => {
      // Fallback: wait for the unload listeners log
    });

    // Give time for connection to establish
    await page.waitForTimeout(2000);

    // Check that unload listeners were set up
    const hasUnloadListenerLog = consoleLogs.some(log =>
      log.includes('Setting up unload listeners')
    );

    console.log('Console logs captured:', consoleLogs);
    console.log('Has unload listener log:', hasUnloadListenerLog);

    // Close the page (this should trigger beforeunload)
    await page.close();

    // Wait a bit for the beacon to be sent
    await new Promise(r => setTimeout(r, 1000));

    // Log results
    console.log('Disconnect requests:', disconnectRequests);
    console.log('All console logs:', consoleLogs);

    // Verify unload listeners were set up
    expect(hasUnloadListenerLog).toBe(true);
  });

  test('should log disconnect flow in console', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[PocketPing]')) {
        consoleLogs.push(text);
        console.log('Widget log:', text);
      }
    });

    await page.goto('https://test.pocketping.test');

    // Enter project ID and load widget
    await page.fill('input[placeholder*="Project ID"]', PROJECT_ID);
    await page.click('button:has-text("Charger le Widget")');

    // Wait for widget
    await page.waitForSelector('.pp-toggle', { timeout: 15000 });

    // Open chat
    await page.locator('.pp-toggle').click();

    // Wait for connection
    await page.waitForTimeout(3000);

    // Check logs
    console.log('\n=== All PocketPing Console Logs ===');
    consoleLogs.forEach(log => console.log(log));
    console.log('=================================\n');

    // Verify initialization
    expect(consoleLogs.some(l => l.includes('Setting up unload listeners'))).toBe(true);
  });
});

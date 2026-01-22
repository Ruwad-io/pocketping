import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['list']],

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // In CI, services are started via Docker Compose
  // Locally, start them manually or use: make dev
  webServer: process.env.CI
    ? undefined
    : [
        {
          command: 'docker compose -f docker-compose.dev.yml up demo',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 60000,
        },
        {
          command: 'docker compose -f docker-compose.dev.yml up bridge',
          url: 'http://localhost:3001/health',
          reuseExistingServer: true,
          timeout: 60000,
        },
      ],
})

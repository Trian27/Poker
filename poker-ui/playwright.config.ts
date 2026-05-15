import { defineConfig } from '@playwright/test';

const PORT = Number.parseInt(process.env.PLAYWRIGHT_UI_PORT || '4173', 10);
const FULL_STACK = process.env.PLAYWRIGHT_FULL_STACK === '1';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;
const REPORT_DIR = process.env.PLAYWRIGHT_REPORT_DIR || 'playwright-report';
const OUTPUT_DIR = process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: OUTPUT_DIR,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: FULL_STACK ? 0 : (process.env.CI ? 1 : 0),
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: REPORT_DIR }]]
    : [['list'], ['html', { open: 'never', outputFolder: REPORT_DIR }]],
  use: {
    baseURL: BASE_URL,
    trace: FULL_STACK ? 'off' : 'on-first-retry',
    screenshot: 'only-on-failure',
    video: FULL_STACK ? 'off' : 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone-small',
      use: {
        viewport: { width: 360, height: 640 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'phone-portrait',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
      },
    },
    {
      name: 'tablet-portrait',
      use: {
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'tablet-landscape',
      use: {
        viewport: { width: 1024, height: 768 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'laptop',
      use: {
        viewport: { width: 1366, height: 768 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'desktop-hd',
      use: {
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'desktop-ultrawide',
      use: {
        viewport: { width: 2560, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEB_SERVER === '1'
    ? undefined
    : {
        command: `npm run dev -- --host 127.0.0.1 --port ${PORT}`,
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        env: {
          VITE_API_URL: 'http://127.0.0.1:18000',
          VITE_GAME_SERVER_URL: 'http://127.0.0.1:13000',
        },
      },
});

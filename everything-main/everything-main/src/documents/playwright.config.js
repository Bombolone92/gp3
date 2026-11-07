import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 5189);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PLAYWRIGHT_PORT must be a port number from 1 to 65535.');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  use: {
    baseURL,
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${baseURL}/playground.html`,
    reuseExistingServer: false,
  },
});

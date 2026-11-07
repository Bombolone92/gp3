import { defineConfig } from "@playwright/test";
const port = Number(process.env.PHOTO_EDITOR_TEST_PORT ?? 5175);
// PW_CHROME_PATH points at a Chrome executable (or wrapper script) to use instead
// of the installed channel, e.g. a wrapper that starts the arm64 binary when
// Node itself runs under Rosetta on Apple Silicon.
const executablePath = process.env.PW_CHROME_PATH || undefined;
export default defineConfig({
  testDir: "tests/browser",
  // The editor compiles shaders and workers on first load; shared CI machines
  // and loaded laptops need generous budgets rather than fixed sleeps.
  expect: { timeout: 30_000 },
  timeout: 120_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    launchOptions: {
      ...(executablePath ? { executablePath } : { channel: "chrome" }),
      args: [
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan",
        "--use-angle=swiftshader",
      ],
    },
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  workers: 1,
});

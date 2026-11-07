// Startup timings of a production build in headless Chrome with 4x CPU
// throttling: first contentful paint, workspace shell ready (menus, tools and
// panels interactive), editor ready (compositor started) and the first frame
// of an opened image, from the editor's performance marks.
// Usage: npm run build && npx vite preview --port 5424 &
//        node scripts/perf-startup.mjs [port=5424] [runs=5] [mbit,rttMs] [delayMs]
// The optional third argument also throttles the network (e.g. 10,40); the
// fourth waits before opening the image, as a person choosing a file would.
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";

const port = process.argv[2] ?? "5424";
const runs = Number(process.argv[3] ?? 5);
const network = process.argv[4] && process.argv[4] !== "-" ? process.argv[4].split(",").map(Number) : undefined;
const delay = Number(process.argv[5] ?? 0);
const image = await readFile(new URL("../public/icon-512.png", import.meta.url));
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=swiftshader"],
});
const results = [];
for (let i = 0; i < runs; i++) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.route("https://js.puter.com/**", (r) => r.fulfill({ contentType: "application/javascript", body: 'window.puter={env:"app"};' }));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  if (network) {
    const [mbit, rtt] = network;
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: rtt, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (mbit * 1e6) / 8 });
  }
  let scripts = 0;
  page.on("response", async (r) => {
    if (r.url().endsWith(".js")) scripts += (await r.body().catch(() => Buffer.alloc(0))).length;
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => performance.getEntriesByName("photo-studio:ready").length, null, { timeout: 120_000 });
  const m = await page.evaluate(() => {
    const at = (name) => performance.getEntriesByName(name)[0]?.startTime ?? NaN;
    return { fcp: performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint")?.startTime ?? NaN, shell: at("photo-studio:shell"), ready: at("photo-studio:ready") };
  });
  m.scriptKB = scripts / 1024;
  if (delay) await page.waitForTimeout(delay);
  const t0 = await page.evaluate(() => performance.now());
  await page.locator("#file-input").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: image });
  await page.waitForFunction(() => performance.getEntriesByName("photo-studio:first-document").length, null, { timeout: 120_000 });
  m.firstDocument = (await page.evaluate(() => performance.getEntriesByName("photo-studio:first-document")[0].startTime)) - t0;
  results.push(m);
  await context.close();
}
await browser.close();
const median = (k) => {
  const v = results.map((r) => r[k]).sort((a, b) => a - b);
  return Math.round(v[v.length >> 1]);
};
console.log(`median of ${runs} (ms): FCP ${median("fcp")}, shell ${median("shell")}, ready ${median("ready")}, first document ${median("firstDocument")}; script before ready ${median("scriptKB")} kB`);

// Optional investigation tool using Photopea's public client-side messaging API.
// It records a compatible editor's observed output, not a format rule.
// node scripts/probe-gradient-reference.mjs <input-directory> <output-directory>
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const input = process.argv[2],
  output = process.argv[3];
if (!input || !output) throw new Error("Provide input and output directories.");
await mkdir(output, { recursive: true });
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><title>Gradient reference probe</title>
<iframe id="editor" src="https://www.photopea.com/" width="1000" height="800"></iframe>
<script>
  window.ready = false;
  window.pending = null;
  window.result = null;
  addEventListener("message", event => {
    if (event.origin !== "https://www.photopea.com" || event.source !== editor.contentWindow) return;
    if (event.data instanceof ArrayBuffer) window.result = event.data;
    if (event.data === "done") {
      window.ready = true;
      if (pending) { const done = pending; pending = null; done(); }
    }
  });
  window.send = value => new Promise((resolve, reject) => {
    window.result = null;
    const timeout = setTimeout(() => { pending = null; reject(new Error("Reference command timed out")); }, 30000);
    pending = () => { clearTimeout(timeout); resolve(); };
    editor.contentWindow.postMessage(value, "https://www.photopea.com");
  });
  window.resultBase64 = () => {
    if (!result) throw new Error("Reference command returned no binary data");
    const bytes = new Uint8Array(result), chunks = [];
    for (let i = 0; i < bytes.length; i += 32768)
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    return btoa(chunks.join(""));
  };
</script>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const start = page
    .frameLocator("#editor")
    .getByRole("button", { name: "Start using Photopea" });
  await Promise.race([
    page.waitForFunction(() => window.ready, {}, { timeout: 45000 }),
    start
      .first()
      .waitFor({ state: "visible", timeout: 45000 })
      .then(() => start.first().click()),
  ]);
  await page.waitForFunction(() => window.ready, {}, { timeout: 45000 });
  // The editor has loaded. Block further network requests before sending any
  // document; files and exports travel only between these local browser frames.
  await page.route("**/*", (route) => route.abort());
  const files = (await readdir(input))
    .filter((name) => /\.ps[db]$/i.test(name))
    .sort();
  if (!files.length) throw new Error("No PSD/PSB probes found.");
  for (const name of files) {
    const data = await readFile(path.join(input, name));
    await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      await window.send(bytes.buffer);
    }, data.toString("base64"));
    // An edit forces stale cached pixels to regenerate. The paired translation
    // has zero net displacement; inspect the saved descriptor before treating
    // the rendered pixels as evidence of the original definition.
    await page.evaluate(() =>
      window.send(
        'app.activeDocument.activeLayer.translate(1,0);app.activeDocument.activeLayer.translate(-1,0);app.activeDocument.saveToOE("png");',
      ),
    );
    await writeFile(
      path.join(output, `${name}.png`),
      Buffer.from(await page.evaluate(() => window.resultBase64()), "base64"),
    );
    await page.evaluate(() =>
      window.send('app.activeDocument.saveToOE("psd");'),
    );
    await writeFile(
      path.join(output, `${name}.reference.psd`),
      Buffer.from(await page.evaluate(() => window.resultBase64()), "base64"),
    );
    await page.evaluate(() =>
      window.send("app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);"),
    );
    console.log(`Captured ${name}`);
  }
  await writeFile(
    path.join(output, "capture.json"),
    JSON.stringify(
      {
        editor: "Photopea",
        api: "https://www.photopea.com/api/live",
        capturedAt: new Date().toISOString(),
        browser: browser.version(),
        files,
        regeneratedBy: "paired one-pixel translation",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

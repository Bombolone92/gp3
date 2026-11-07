// Captures the running app with a mocked Puter SDK for visual comparison.
// Usage: node dev/capture.mjs <url> <out.png> [script.js] [width] [height]
// The optional script is evaluated in the page after the editor opens; it may
// be async and may export steps as `async ({ page }) => {}` when it ends .mjs.
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const [url, out, script, width = "1512", height = "900"] =
  process.argv.slice(2);
const MOCK = `(()=>{let signedIn=false;const files={};window.puter={env:"web",auth:{isSignedIn:async()=>signedIn,getUser:async()=>({username:'test-user',uuid:'test-user-id'}),signIn:async()=>{signedIn=true},signOut:async()=>{signedIn=false}},fs:{readdir:async()=>Object.values(files),write:async(path,blob)=>{files[path]={path,name:path.split('/').pop(),modified:Date.now()/1000,bytes:blob};return files[path]},read:async p=>files[p].bytes,rename:async(p,n)=>({path:p}),delete:async p=>delete files[p]},ui:{onLaunchedWithItems:()=>{}}};})();`;
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: +width, height: +height },
  deviceScaleFactor: +(process.env.SCALE || 2),
});
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on(
  "console",
  (m) => m.type() === "error" && console.error("console:", m.text()),
);
await page.route("https://js.puter.com/v2/", (r) =>
  r.fulfill({ contentType: "application/javascript", body: MOCK }),
);
await page.goto(url);
await page.waitForTimeout(1500);
if (script) {
  if (script.endsWith(".mjs")) {
    const mod = await import(pathToFileURL(script).href);
    await mod.default({ page });
  } else {
    await page.evaluate(await readFile(script, "utf8"));
  }
  await page.waitForTimeout(800);
}
await page.screenshot({ path: out });
await browser.close();

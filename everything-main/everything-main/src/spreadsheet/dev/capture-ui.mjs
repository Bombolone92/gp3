/** Capture app screenshots through headless Chrome for UI before/after evidence.
 * Run: node dev/capture-ui.mjs <url> <steps.json> <out-dir>
 * steps.json: [{ "name": "home", "width": 1440, "height": 900, "script": "JS run in the page (await allowed)" }]
 * Each step loads the URL fresh, runs its script, waits for layout, then writes <out-dir>/<name>.png.
 * Chrome is found at CHROME_PATH or the default macOS location. Only synthetic data should be used.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const [url, stepsPath, outDir] = process.argv.slice(2);
if (!url || !stepsPath || !outDir) {
  console.error('usage: node dev/capture-ui.mjs <url> <steps.json> <out-dir>');
  process.exit(2);
}
const steps = JSON.parse(await readFile(stepsPath, 'utf8'));
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const profile = await mkdtemp(join(tmpdir(), 'capture-ui-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--force-device-scale-factor=${process.env.SCALE || 1}`, 'about:blank'], { stdio: 'ignore' });

const getJson = path => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path }, res => {
    let body = '';
    res.on('data', d => { body += d; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
  }).on('error', reject);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50 && !targets; i++) { await sleep(200); targets = await getJson('/json/list').catch(() => null); }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  // A step that never answers fails after a minute (CAPTURE_TIMEOUT ms on a busy machine) instead of hanging the whole capture.
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: timed out`)); }, Number(process.env.CAPTURE_TIMEOUT) || 60000);
  const settle = resolve;
  resolve = value => { clearTimeout(timer); settle(value); };
  pending.set(id, msg => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

let failed = false;
try {
  await send('Page.enable');
  await send('Runtime.enable');
  for (const step of steps) {
    const width = step.width || 1440, height = step.height || 900;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: step.scale || Number(process.env.SCALE) || 1, mobile: !!step.mobile });
    await send('Page.navigate', { url: step.url || url });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if (await evaluate("!!document.querySelector('.grid, .home, .app > *')").catch(() => false)) break;
    }
    await sleep(step.settle ?? 800);
    try {
      const value = step.script ? await evaluate(`(async () => { ${step.script} })()`) : undefined;
      if (value !== undefined) console.log(`${step.name}: ${JSON.stringify(value)}`);
    } catch (e) {
      failed = true;
      console.error(`${step.name}: script failed: ${e.message}`);
    }
    await sleep(step.after ?? 400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, `${step.name}.png`), Buffer.from(shot.data, 'base64'));
    console.log(`wrote ${join(outDir, `${step.name}.png`)}`);
  }
} finally {
  ws.close();
  proc.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);

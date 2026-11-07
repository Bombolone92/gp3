/**
 * A very small Chrome DevTools Protocol client: enough to launch headless
 * Chrome, drive a page, and take a screenshot of an exact pixel size.
 *
 * `Emulation.setDeviceMetricsOverride` is what makes the size exact. The
 * capture is independent of any real window, so the 1080x2280 phone canvas
 * needs no 2280px-tall display to render it, and nothing about the machine
 * taking the shot can leak into it.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where Chrome lives, in order of preference. Override with $CHROME. */
const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333 } = {}) {
  const { existsSync } = await import('node:fs');
  const bin = CANDIDATES.find((p) => existsSync(p));
  if (!bin) {
    throw new Error(`No Chrome found. Set $CHROME to the binary. Tried:\n  ${CANDIDATES.join('\n  ')}`);
  }
  const profile = mkdtempSync(join(tmpdir(), 'bg-shots-'));
  const child = spawn(
    bin,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      // A throttled timer would let a clock or a spinner drift between the
      // moment a scene is set up and the moment it is photographed.
      '--disable-background-timer-throttling',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );

  let version = null;
  for (let i = 0; i < 100 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await sleep(100);
    }
  }
  if (!version) {
    child.kill();
    throw new Error('Chrome did not come up on the debugging port.');
  }

  return {
    port,
    async close() {
      child.kill();
      // Chrome writes to its profile on the way out, so give it a moment and
      // do not let a leftover temp directory fail the build.
      await sleep(300);
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // A stray profile in $TMPDIR is not worth reporting.
      }
    },
  };
}

export async function newPage(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await res.json();
  const page = connect(target.webSocketDebuggerUrl, target.id, port);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  return page;
}

function connect(wsUrl, targetId, port) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', reject);
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    for (const handler of listeners.get(msg.method) || []) handler(msg.params);
  });

  const send = async (method, params = {}) => {
    await ready;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const once = (method) =>
    new Promise((resolve) => {
      if (!listeners.has(method)) listeners.set(method, new Set());
      const set = listeners.get(method);
      const handler = (params) => {
        set.delete(handler);
        resolve(params);
      };
      set.add(handler);
    });

  return {
    send,

    async close() {
      try {
        await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
      } catch {
        // The browser is going away anyway.
      }
      ws.close();
    },

    /** Set the exact capture size. `dpr` scales the output pixels. */
    viewport({ width, height, dpr = 1, mobile = false }) {
      return send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: dpr,
        mobile,
        screenWidth: width,
        screenHeight: height,
      });
    },

    async goto(url, { waitMs = 0 } = {}) {
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url });
      await Promise.race([loaded, sleep(15000)]);
      if (waitMs) await sleep(waitMs);
    },

    async eval(expression, { awaitPromise = false } = {}) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
      if (result.exceptionDetails) {
        const d = result.exceptionDetails;
        throw new Error(`evaluate failed: ${d.exception?.description || d.text}`);
      }
      return result.result.value;
    },

    /** Wait until `expression` is truthy in the page. */
    async waitFor(expression, { timeoutMs = 15000, everyMs = 100 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        let ok = false;
        try {
          ok = await this.eval(`!!(${expression})`);
        } catch {
          ok = false;
        }
        if (ok) return;
        if (Date.now() > deadline) throw new Error(`timed out waiting for: ${expression}`);
        await sleep(everyMs);
      }
    },

    /** Run `source` at the start of every document loaded from now on. */
    async onNewDocument(source, previous) {
      if (previous) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: previous });
      const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source });
      return identifier;
    },

    async shot(path, { clip = null } = {}) {
      const params = { format: 'png', captureBeyondViewport: false, fromSurface: true };
      if (clip) params.clip = { ...clip, scale: clip.scale ?? 1 };
      const { data } = await send('Page.captureScreenshot', params);
      writeFileSync(path, Buffer.from(data, 'base64'));
      return path;
    },
  };
}

import '../src/styles/tokens.css';
import '../src/styles/base.css';
import '../src/styles/app.css';
import { renderApp } from '../src/ui/app.js';

// Synthetic transport: no account, SDK, network or private mail. Precomputed
// sorted arrays and binary seeks avoid charging fixture scans to app timings.
const params = new URLSearchParams(location.search);
const count = Number(params.get('n') || 1000);
const latency = Number(params.get('latency') || 5);
const sparse = params.has('sparse');
const large = params.has('large');
const threadSize = Number(params.get('thread') || 0);
const emptyDays = Number(params.get('emptyDays') || 0);
const mailPath = '/benchmark/.mail';
const objectsPath = `${mailPath}/objects`;
const dirs = new Map();
const all = [];
const files = new Map();
for (let i = 0; i < count; i++) {
  const day = new Date(Date.UTC(2026, 8, 17) - (sparse ? Math.floor(i / 2) : Math.floor(i / 10000)) * 86400000).toISOString().slice(0, 10);
  const subject = i % 1000 === 0 || i < threadSize ? 'Needle discussion' : `Message ${i}`;
  const name = `${String(count - i).padStart(8, '0')}--${btoa(subject)}`;
  const path = `${objectsPath}/${day}/${name}`;
  const item = { name, path, is_dir: false, size: large ? 8 * 1024 * 1024 : 512 };
  if (!dirs.has(day)) dirs.set(day, []);
  dirs.get(day).push(item);
  all.push(item);
  files.set(path, { i, subject });
}
for (let i = 0; i < emptyDays; i++) {
  const day = new Date(Date.UTC(2026, 8, 18 + i)).toISOString().slice(0, 10);
  dirs.set(day, []);
}
const directories = [...dirs.keys()].sort((a, b) => b.localeCompare(a))
  .map(name => ({ name, path: `${objectsPath}/${name}`, is_dir: true }));
const recursive = [...directories, ...all].sort((a, b) => b.name.localeCompare(a.name));
const metrics = window.metrics = { requests: 0, listings: 0, headers: 0, bodies: 0, bytes: 0, active: 0, peakActive: 0, longTasks: [], fail: false, lastComplete: 0 };
new PerformanceObserver(list => metrics.longTasks.push(...list.getEntries().filter(e => e.startTime >= window.started).map(e => e.duration))).observe({ type: 'longtask', buffered: true });
const wait = async () => {
  metrics.requests++;
  metrics.peakActive = Math.max(metrics.peakActive, ++metrics.active);
  await new Promise(resolve => setTimeout(resolve, latency));
  metrics.active--;
  metrics.lastComplete = performance.now();
  if (metrics.fail) throw new Error('Synthetic offline');
};
const fs = {
  async readdir(path, options = {}) {
    metrics.listings++;
    await wait();
    const entries = path === objectsPath ? options.recursive ? recursive : directories
      : path.startsWith(`${objectsPath}/`) ? dirs.get(path.split('/').at(-1)) ?? [] : [];
    const field = 'name';
    const direction = -1;
    let lo = 0, hi = entries.length;
    if (options.cursor) while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (direction * entries[mid][field].localeCompare(options.cursor) <= 0) lo = mid + 1;
      else hi = mid;
    }
    const end = Math.min(entries.length, lo + (options.limit ?? 1000));
    const items = entries.slice(lo, end).map(item => ({ ...item }));
    const result = { items, ...(end < entries.length ? { cursor: entries[end - 1][field] } : {}) };
    metrics.bytes += new TextEncoder().encode(JSON.stringify(result)).length;
    return result;
  },
  async read(path, options = {}) {
    metrics[options.byte_count ? 'headers' : 'bodies']++;
    await wait();
    const byteCount = params.has('ignoreRanges') ? undefined : options.byte_count;
    const { i, subject } = files.get(path);
    const references = i > 0 && i < threadSize ? 'References: <0@benchmark>\r\n' : '';
    const head = `From: Alice <alice@example.com>\r\nTo: Benchmark <benchmark@puter.com>\r\nSubject: ${subject}\r\nMessage-ID: <${i}@benchmark>\r\n${references}Date: Thu, 17 Sep 2026 12:00:00 +0000\r\nContent-Type: ${large ? 'multipart/mixed; boundary=bench' : 'text/plain'}\r\n\r\n`;
    const body = large ? '--bench\r\nContent-Type: text/plain\r\n\r\nHello benchmark\r\n--bench\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=large.bin\r\nContent-Transfer-Encoding: base64\r\n\r\n' : 'Hello benchmark';
    const length = large ? 8 * 1024 * 1024 : 512;
    const raw = (head + body).padEnd(Math.min(length, byteCount || length), 'A');
    const blob = new Blob([raw.slice(0, byteCount || undefined), large && !byteCount ? '\r\n--bench--' : '']);
    metrics.bytes += blob.size;
    return blob;
  },
};
window.benchFS = fs;
window.started = performance.now();
renderApp(document.querySelector('#app'), { fs, mailPath, objectsPath, sample: true,
  account: { username: 'benchmark' }, onCompose() {} });

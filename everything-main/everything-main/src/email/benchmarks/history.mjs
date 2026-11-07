// CPU-only synthetic history benchmark; not a browser or live Puter measure.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!isMainThread) {
  const { conversationHistory } = await import(workerData.module);
  const message = i => ({ path: `/mail/${i}`, name: String(i).padStart(8, '0'), day: '2026-09-17',
    subject: i ? 'Re: Long discussion' : 'Long discussion', messageId: `<${i}@test>`,
    references: i ? ['<0@test>'] : [], from: { email: 'alice@test' }, to: [] });
  const messages = Array.from({ length: workerData.n }, (_, i) => message(i));
  const before = process.memoryUsage().heapUsed;
  const start = performance.now();
  const result = conversationHistory([messages[0]], messages);
  parentPort.postMessage({ n: workerData.n, ms: Math.round(performance.now() - start),
    count: result.length, heapBefore: before, heapAfter: process.memoryUsage().heapUsed,
    ordered: result.every((entry, i) => entry === messages[i]), completed: true });
} else {
  const label = process.argv[2] || 'history-current';
  const module = pathToFileURL(resolve(process.env.HISTORY_MODULE || 'src/lib/thread.js')).href;
  const rows = [];
  for (const n of [1000, 10000, 100000]) {
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { module, n } });
      const timer = setTimeout(async () => {
        await worker.terminate();
        resolve({ n, completed: false, deadlineMs: 10000 });
      }, 10000);
      worker.once('message', row => { clearTimeout(timer); resolve(row); });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
    });
    rows.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(`benchmarks/results/${label}.json`, JSON.stringify(rows, null, 2) + '\n');
}

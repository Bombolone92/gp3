import http from 'node:http';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createMailFS } from '../benchmarks/range-transport.js';

// Real loopback HTTP, synthetic data and the source-inspected /read contract.
// This is not a measurement of a deployed Puter service or its S3/Dynamo cost.
const data = Buffer.alloc(8 * 1024 * 1024, 65);
let bytes = 0;
const server = http.createServer((req, res) => {
  const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
  const body = data.subarray(start, end + 1);
  bytes += body.length;
  res.writeHead(range ? 206 : 200, { 'Content-Length': body.length,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) });
  res.end(body);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const count of [1, 60]) for (const mode of ['sdk-query-contract', 'mail-range-transport']) {
    bytes = 0;
    const start = performance.now();
    let next = 0, returnedBytes = 0;
    await Promise.all(Array.from({ length: Math.min(count, 12) }, async () => {
      while (next++ < count) {
        const blob = mode === 'sdk-query-contract'
          ? await (await fetch(`${origin}/read?file=/user/.mail/a&byte_count=8192`)).blob()
          : await createMailFS({ APIOrigin: origin, authToken: 'synthetic', fs: {} }, '/user/.mail').read('/user/.mail/a', { byte_count: 8192 });
        returnedBytes += blob.size;
      }
    }));
    results.push({ mode, ms: performance.now() - start, bytes, returnedBytes, requests: count });
  }
  await writeFile('benchmarks/results/range.json', JSON.stringify(results, null, 2) + '\n');
  console.log(results);
} finally { server.closeAllConnections(); server.close(); }

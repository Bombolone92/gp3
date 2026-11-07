import test from "node:test";
import assert from "node:assert/strict";
import { build } from "vite";
import { Miniflare } from "miniflare";

test("queued storage listings survive separate Cloudflare request contexts", async () => {
  // Node's promises do not model Cloudflare cancelling a waiter with no I/O
  // of its own. Exercise the actual BoardService bundle under workerd too.
  const bundle = await build({
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: "worker/service.js",
        name: "WhiteboardService",
        formats: ["iife"],
      },
    },
  });
  const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
    (file) => file.type === "chunk" && file.isEntry,
  ).code;
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2025-07-15",
    script: `${code}
      const service = new WhiteboardService.BoardService({
        kv: { list: async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return { items: [] };
        } }
      });
      export default { async fetch() {
        return Response.json(await service.listPage({ pattern: "org:user:" }));
      } };
    `,
  });
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const response = await runtime.dispatchFetch("https://worker.test/api");
        return { status: response.status, body: await response.text() };
      }),
    );
    for (const result of results) {
      assert.equal(result.status, 200, result.body);
      assert.deepEqual(JSON.parse(result.body), { items: [] });
    }
    const later = await runtime.dispatchFetch("https://worker.test/api");
    assert.equal(later.status, 200, await later.text());
  } finally {
    await runtime.dispose();
  }
});

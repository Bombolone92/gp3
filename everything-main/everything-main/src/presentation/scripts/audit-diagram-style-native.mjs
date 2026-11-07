import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createServer } from "vite";

// Native differences remain failures, never expected-success test baselines.
// Exit 1: mismatch/unsupported. Exit 2: runner failure.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let server, cache;
try {
  const native = JSON.parse(
    await readFile(
      join(root, "tests/data/diagram-style-fallback-native.json"),
      "utf8",
    ),
  );
  cache = await mkdtemp(join(tmpdir(), "diagram-style-native-audit-"));
  server = await createServer({
    root,
    logLevel: "error",
    cacheDir: cache,
    server: { middlewareMode: true, ws: false },
    appType: "custom",
  });
  const { styleFallbackDeck, inspectStyleFallback, expectedStyleFallback } =
    await server.ssrLoadModule("/tests/diagram-style-fallback-fixture.js");
  const rows = [];
  for (const row of native.cases) {
    try {
      const { frame } = await styleFallbackDeck(row),
        actual = inspectStyleFallback(frame);
      const differences = [];
      if (actual.length !== row.expected.length)
        differences.push({
          property: "shape count",
          expected: row.expected.length,
          actual: actual.length,
        });
      for (const [i, expected] of expectedStyleFallback(row).entries())
        for (const property of ["text", "paint", "font"])
          if (!isDeepStrictEqual(actual[i]?.[property], expected[property]))
            differences.push({
              shape: i,
              property,
              expected: expected[property],
              actual: actual[i]?.[property] ?? null,
            });
      rows.push({
        name: row.name,
        status: differences.length ? "mismatch" : "match",
        differences,
      });
    } catch (error) {
      rows.push({
        name: row.name,
        status: "unsupported",
        error: error.message,
      });
    }
  }
  console.log(
    JSON.stringify(
      {
        scope:
          "Semantic SmartArt shape paint and quick-style font defaults; PDF glyph data recorded separately",
        cases: rows.length,
        counts: Object.fromEntries(
          ["match", "mismatch", "unsupported"].map((status) => [
            status,
            rows.filter((row) => row.status === status).length,
          ]),
        ),
        rows,
      },
      null,
      2,
    ),
  );
  process.exitCode = rows.every((row) => row.status === "match") ? 0 : 1;
} catch (error) {
  console.error(error);
  process.exitCode = 2;
} finally {
  await server?.close();
  if (cache) await rm(cache, { recursive: true, force: true });
}

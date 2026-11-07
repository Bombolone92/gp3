import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const postcss = require.resolve("postcss");

test("CSS source maps cannot stall the build through nested indexed sections", async () => {
  // Exercise the real PostCSS dependency used by Vite in a separate process.
  // Keep a deadline and heap cap so a vulnerable lockfile cannot hang tests.
  const script = `
    const postcss = require(process.argv[1]);
    let map = {
      version: 3, sources: ['a.css'], names: [], mappings: 'AAAA',
      sourcesContent: ['a{color:red}']
    };
    for (let depth = 0; depth < 26; depth++)
      map = {version: 3, sections: [{offset: {line: 0, column: 0}, map}]};
    const result = postcss([{postcssPlugin: 'local-noop', Once(){}}])
      .process('a{color:red}', {
        from: 'input.css', map: {prev: map, inline: false, annotation: false}
      });
    console.log(JSON.stringify({css: result.css, map: result.map.toJSON()}));
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--max-old-space-size=128", "-e", script, postcss],
    { timeout: 5000, maxBuffer: 100_000 },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.css, "a{color:red}");
  assert.equal(result.map.version, 3);
  assert.deepEqual(result.map.sources, ["input.css", "a.css"]);
  assert.deepEqual(result.map.sourcesContent, [null, "a{color:red}"]);
  assert.ok(result.map.mappings.length < 1000);
});

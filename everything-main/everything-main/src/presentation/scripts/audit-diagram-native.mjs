import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Run unresolved native benchmarks without making a mismatch an accepted test
// result. Exit 1 means a native mismatch/unsupported case, and 2 a runner error.
// Glyph predicates are recorded independently from the native geometry oracle.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let server, cache;
try {
  const native = JSON.parse(
    await readFile(
      join(root, "tests/data/diagram-composite-execution-native.json"),
      "utf8",
    ),
  );
  const canvas = JSON.parse(
    await readFile(
      join(root, "tests/data/diagram-composite-canvas-native.json"),
      "utf8",
    ),
  );
  native.cases.push(
    ...[...canvas.cases, ...canvas.openCases].map((row) => ({
      ...row,
      name: `canvases: ${row.name}`,
      matrix: "canvases",
    })),
  );
  const heightAllocations = JSON.parse(
    await readFile(
      join(root, "tests/data/diagram-composite-height-allocation-native.json"),
      "utf8",
    ),
  );
  native.cases.push(...heightAllocations.cases);
  const heightPreferences = JSON.parse(
    await readFile(
      join(root, "tests/data/diagram-composite-height-preference-native.json"),
      "utf8",
    ),
  );
  native.cases.push(...heightPreferences.cases);
  const requested = new Set(process.argv.slice(2));
  const matrices = new Set(native.cases.map((row) => row.matrix));
  for (const matrix of requested)
    if (!matrices.has(matrix))
      throw new Error(
        `Unknown matrix ${matrix}; choose ${[...matrices].join(", ")}`,
      );
  cache = await mkdtemp(join(tmpdir(), "diagram-native-audit-"));
  server = await createServer({
    root,
    logLevel: "error",
    cacheDir: cache,
    server: { middlewareMode: true, ws: false },
    appType: "custom",
  });
  const { parseXml, getAttrValue, qname } = await server.ssrLoadModule(
    "/lib/pptx/src/internal/xml/index.ts",
  );
  const { readDiagramDataModel } = await server.ssrLoadModule(
    "/lib/pptx/src/internal/diagram/data-model.ts",
  );
  const { readDiagramHierarchy } = await server.ssrLoadModule(
    "/lib/pptx/src/internal/diagram/hierarchy.ts",
  );
  const { expandDiagramLayout } = await server.ssrLoadModule(
    "/lib/pptx/src/internal/diagram/layout.ts",
  );
  const { reflowDiagramLayout } = await server.ssrLoadModule(
    "/lib/pptx/src/internal/diagram/reflow.ts",
  );
  const rows = [];
  for (const row of native.cases) {
    if (requested.size && !requested.has(row.matrix)) continue;
    let missingMeasurement = false;
    try {
      const tree = expandDiagramLayout(
        parseXml(row.layout).root,
        readDiagramHierarchy(readDiagramDataModel(parseXml(row.data).root)),
      );
      const result = reflowDiagramLayout(tree, row.available, {
        textFits: (node, state) => {
          const key = JSON.stringify([
            node.name,
            node.context.point.id,
            state.size.w,
            state.size.h,
            ...[
              "primFontSz",
              "secFontSz",
              "lMarg",
              "rMarg",
              "tMarg",
              "bMarg",
            ].map((type) => state.values.get(type)),
          ]);
          const measurement = row.measurements[key];
          if (!measurement) {
            missingMeasurement = true;
            throw new Error(`Unrecorded glyph measurement ${key}`);
          }
          const heightFits = state.size.h >= measurement.requiredHeight;
          return { heightFits, fits: heightFits && measurement.wordFits };
        },
      });
      const leaves = [...result.bounds.keys()].filter(
        (n) => !n.children.length,
      );
      const differences = [];
      if (
        JSON.stringify(leaves.map((n) => n.name)) !==
        JSON.stringify(row.expected.map((n) => n.name))
      )
        differences.push({
          property: "leaf order",
          expected: row.expected.map((n) => n.name),
          actual: leaves.map((n) => n.name),
        });
      else
        for (const [index, node] of leaves.entries()) {
          const expected = row.expected[index];
          for (const key of ["x", "y", "w", "h"]) {
            const actual = Math.trunc(result.bounds.get(node)[key] * 36000);
            if (
              !Number.isFinite(actual) ||
              Math.abs(actual - expected.bounds[key]) > 1
            )
              differences.push({
                node: node.name,
                property: key,
                expected: expected.bounds[key],
                actual,
              });
          }
          // SP has no TX font variable. Its displayed inherited font is
          // separately verified in the native/browser capture, not this pass.
          const actual = result.drawing.get(node).values.get("primFontSz");
          if (
            node.algorithm &&
            getAttrValue(node.algorithm, qname("", "type", "")) === "tx" &&
            expected.font !== null &&
            actual !== expected.font
          )
            differences.push({
              node: node.name,
              property: "font",
              expected: expected.font,
              actual,
            });
        }
      rows.push({
        name: row.name,
        matrix: row.matrix,
        status: differences.length ? "mismatch" : "match",
        fits: result.fits,
        differences,
      });
    } catch (error) {
      rows.push({
        name: row.name,
        matrix: row.matrix,
        status: missingMeasurement ? "unmeasured" : "unsupported",
        error: error.message,
      });
    }
  }
  const counts = Object.fromEntries(
    ["match", "mismatch", "unsupported", "unmeasured"].map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ]),
  );
  console.log(
    JSON.stringify(
      {
        scope:
          "Geometry and TX constraint fonts; content fit reported separately",
        cases: rows.length,
        counts,
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

// Local, comparative compositor probe, not a correctness or performance gate.
// Usage: node scripts/benchmark-sampling.mjs <baseline-git-ref> [output.json]
// PHOTO_EDITOR_BENCHMARK_HARDWARE=1 uses Chrome's normal adapter instead of
// SwiftShader. Do not run GPU tests or another benchmark concurrently.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ref = process.argv[2];
if (!ref) throw new Error("Provide a baseline git ref.");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
const baseline = git("rev-parse", "--verify", `${ref}^{commit}`);
const repo = git("rev-parse", "--show-toplevel");
const prefix = "/__sampling_baseline/";
const modules = new Map();
function load(name) {
  if (modules.has(prefix + name)) return;
  const file = path.relative(repo, path.join(root, "src/renderer", name));
  const source = git("show", `${baseline}:${file}`);
  let compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  }).outputText;
  const dependencies = [];
  compiled = compiled.replace(
    /from (["'])\.\/([^"']+)\1/g,
    (_, quote, dependency) => {
      const name = dependency.endsWith(".ts") ? dependency : `${dependency}.ts`;
      dependencies.push(name);
      return `from ${quote}${prefix}${name}${quote}`;
    },
  );
  modules.set(prefix + name, compiled);
  dependencies.forEach(load);
}
load("webgl.ts");
load("webgpu.ts");
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [
    {
      name: "sampling-benchmark-reference",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = new URL(req.url, "http://localhost").pathname;
          if (pathname === "/__sampling_benchmark") {
            res.setHeader("Content-Type", "text/html");
            res.end("<!doctype html><title>Compositor benchmark</title>");
          } else if (modules.has(pathname)) {
            res.setHeader("Content-Type", "application/javascript");
            res.end(modules.get(pathname));
          } else next();
        });
      },
    },
  ],
});
await server.listen();
const hardware = process.env.PHOTO_EDITOR_BENCHMARK_HARDWARE === "1";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: hardware
    ? ["--enable-unsafe-webgpu"]
    : [
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan",
        "--use-angle=swiftshader",
      ],
});
try {
  const page = await browser.newPage();
  await page.goto(
    new URL("/__sampling_benchmark", server.resolvedUrls.local[0]).href,
  );
  const adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) return null;
    const { vendor, architecture, device, description, isFallbackAdapter } =
      adapter.info;
    return { vendor, architecture, device, description, isFallbackAdapter };
  });
  const results = await page.evaluate(async () => {
    const currentGL = await import("/src/renderer/webgl.ts");
    const currentGPU = await import("/src/renderer/webgpu.ts");
    const baselineGL = await import("/__sampling_baseline/webgl.ts");
    const baselineGPU = await import("/__sampling_baseline/webgpu.ts");
    const { uniforms } = await import("/src/renderer/renderer.ts");
    const { layer } = await import("/src/model/document.ts");
    const results = [];
    const median = (values) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    for (const [width, height] of [
      [128, 96],
      [512, 384],
    ])
      for (const kind of ["WebGL", "WebGPU"])
        for (const floating of [false, true])
          for (const aligned of [true, false]) {
            const states = [];
            try {
              for (const version of ["before", "after"]) {
                const canvas = document.createElement("canvas");
                const backend =
                  kind === "WebGL"
                    ? new (version === "before"
                        ? baselineGL
                        : currentGL
                      ).WebGLBackend(canvas)
                    : await (
                        version === "before" ? baselineGPU : currentGPU
                      ).WebGPUBackend.create(canvas);
                const data = new Float32Array(width * height * 4);
                for (let i = 0; i < width * height; i++)
                  data.set(
                    [(i % 3) / 2, 0.35, 0.6, i % 4 === 0 ? 0 : 0.75],
                    i * 4,
                  );
                const source = floating
                  ? backend.floatTexture(width, height, data)
                  : backend.texture(
                      width,
                      height,
                      new Uint8Array(data.map((v) => Math.round(v * 255))),
                    );
                let back = floating
                  ? backend.floatTexture(width, height)
                  : backend.texture(width, height);
                let target = floating
                  ? backend.floatTexture(width, height)
                  : backend.texture(width, height);
                const mask = backend.texture(
                  1,
                  1,
                  new Uint8Array([255, 255, 255, 255]),
                );
                const item = layer("image", "Probe", width, height);
                if (!aligned)
                  item.transform = {
                    x: 0.375,
                    y: -0.25,
                    width: width * 1.05,
                    height: height * 0.95,
                    rotation: 7,
                  };
                const u = uniforms(item, width, height, width, height);
                backend.clear(back);
                const rounds = [];
                const run = async () => {
                  const start = performance.now();
                  for (let i = 0; i < 20; i++) {
                    backend.pass(back, source, mask, u, target);
                    [back, target] = [target, back];
                  }
                  const encoded = performance.now() - start;
                  await (floating
                    ? backend.readFloat(back)
                    : backend.read(back));
                  return { encoded, completed: performance.now() - start };
                };
                states.push({
                  version,
                  rounds,
                  run,
                  dispose() {
                    [source, back, target, mask].forEach((t) =>
                      backend.destroy(t),
                    );
                    backend.dispose();
                  },
                });
              }
              // Alternate ordering to reduce warm-up/thermal drift bias.
              for (let round = 0; round < 9; round++)
                for (const state of round % 2
                  ? [...states].reverse()
                  : states) {
                  const timing = await state.run();
                  if (round >= 4) state.rounds.push(timing);
                }
              for (const state of states)
                results.push({
                  kind,
                  floating,
                  aligned,
                  width,
                  height,
                  version: state.version,
                  encodedMs: median(state.rounds.map((r) => r.encoded)),
                  completedMs: median(state.rounds.map((r) => r.completed)),
                  rounds: state.rounds,
                });
            } finally {
              states.forEach((state) => state.dispose());
            }
          }
    return results;
  });
  const report = {
    baseline,
    hardware,
    adapter,
    passes: 20,
    warmupRounds: 4,
    timingRounds: 5,
    results,
  };
  console.log(JSON.stringify({ baseline, hardware, adapter }));
  if (process.argv[3])
    await writeFile(
      path.resolve(process.argv[3]),
      JSON.stringify(report, null, 2) + "\n",
    );
  for (let i = 0; i < results.length; i += 2) {
    const a = results[i],
      b = results[i + 1];
    console.log(
      `${a.kind} ${a.width}×${a.height} ${a.floating ? "float" : "byte"} ${a.aligned ? "native" : "resampled"}: ${a.completedMs.toFixed(1)} → ${b.completedMs.toFixed(1)} ms (${a.encodedMs.toFixed(1)} → ${b.encodedMs.toFixed(1)} ms encoding)`,
    );
  }
} finally {
  await browser.close();
  await server.close();
}

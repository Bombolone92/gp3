import { defineConfig } from "vite";
import { createHash } from "node:crypto";
// The build identifier is a hash of the bundled worker itself, so a change to
// any module the worker imports triggers the automatic worker update.
// The build time is filled in after hashing so it never changes the hash.
const PLACEHOLDER = "__WHITEBOARD_WORKER_BUILD__";
const TIME_PLACEHOLDER = "__WHITEBOARD_WORKER_BUILT_AT__";
const builtAt = Date.now();
export default defineConfig({
  publicDir: false,
  plugins: [
    {
      name: "whiteboard-worker-metadata",
      generateBundle(_options, bundle) {
        // Add the deployment header after minification, which strips comments.
        for (const output of Object.values(bundle))
          if (output.type === "chunk" && output.isEntry) {
            const build = createHash("sha256")
              .update(output.code)
              .digest("hex")
              .slice(0, 16);
            const code = output.code
              .replaceAll(PLACEHOLDER, build)
              .replaceAll(JSON.stringify(TIME_PLACEHOLDER), String(builtAt));
            if (code.includes(TIME_PLACEHOLDER))
              this.error("The worker build time could not be filled in.");
            output.code = `/* whiteboard-worker build=${build} at=${builtAt} */\n${code}`;
          }
      },
    },
  ],
  define: {
    __WORKER_BUILD__: JSON.stringify(PLACEHOLDER),
    __WORKER_BUILT_AT__: JSON.stringify(TIME_PLACEHOLDER),
  },
  build: {
    target: "es2022",
    outDir: "public/worker",
    emptyOutDir: true,
    lib: {
      entry: "worker/index.js",
      name: "WhiteboardWorker",
      formats: ["iife"],
      fileName: () => "whiteboard-worker.js",
    },
  },
});

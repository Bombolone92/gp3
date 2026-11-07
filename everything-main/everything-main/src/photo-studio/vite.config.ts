import { defineConfig } from "vite";
import puterLocalhost from "../../dev/puter-localhost.mjs";

export default defineConfig({
  plugins: [puterLocalhost("photo-studio")],
  // Prebundle lazy CJS entry points so first use does not reload an open editor.
  // PathKit remains loaded on demand at runtime, including in the worker.
  optimizeDeps: {
    include: [
      "ag-psd",
      "ag-psd/dist/psdWriter",
      "ag-psd/dist/additionalInfo",
      "ag-psd/dist/imageResources",
      "ag-psd/dist/helpers",
      "ag-psd/dist/psdReader",
      "ag-psd/dist/descriptor",
      "pathkit-wasm",
      "pako",
    ],
  },
  // Image processing uses a module worker; vector geometry loads its toolkit on
  // demand without adding it to ordinary document startup or the UI bundle.
  worker: { format: "es" },
});
